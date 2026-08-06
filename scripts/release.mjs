// Cuts a release from this machine: verifies the repo state, builds the
// portable zip, tags, pushes and publishes the GitHub release.
//
// Usage:
//   pnpm release -- --version 1.2.0 --notes-file notes.md
//   pnpm release -- --version 1.2.0 --notes "One-line summary"
//   pnpm release -- --version 1.2.0 --notes-file notes.md --dry-run
//
// The annotated tag message IS the release notes (gh --notes-from-tag), and
// the in-app update popup renders them as markdown.
//
// Requires: git, gh (authenticated), pnpm. There is no CI: releases are cut
// deliberately from a clean main.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

function die(msg) {
  console.error(`\n[release] ${msg}\n`);
  process.exit(1);
}

// Only pnpm needs a shell on Windows (it is a .cmd); git/gh/node are real
// executables, and spawning them without a shell avoids arg-escaping issues.
const needsShell = (cmd) => process.platform === 'win32' && !/^(git|gh|node)$/i.test(path.basename(cmd, '.exe'));

/** Run a command, inheriting stdio; abort the release if it fails. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: rootDir, stdio: 'inherit', shell: needsShell(cmd), ...opts });
  if (res.status !== 0) die(`\`${cmd} ${args.join(' ')}\` failed (exit ${res.status ?? 'signal'})`);
}

/** Run a command and capture stdout (trimmed). */
function capture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: rootDir, encoding: 'utf8', shell: needsShell(cmd) });
  if (res.status !== 0) die(`\`${cmd} ${args.join(' ')}\` failed: ${res.stderr?.trim() || res.stdout?.trim()}`);
  return res.stdout.trim();
}

const version = arg('version');
const dryRun = flag('dry-run');
if (!version) die('Missing --version X.Y.Z');
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`Invalid --version "${version}" (expected X.Y.Z)`);
const tag = `v${version}`;

// Release notes: --notes-file wins, then --notes.
const notesFile = arg('notes-file');
const notesInline = arg('notes');
let notes = notesInline;
if (notesFile) {
  if (!fs.existsSync(notesFile)) die(`--notes-file not found: ${notesFile}`);
  notes = fs.readFileSync(notesFile, 'utf8');
}
if (!notes || !notes.trim()) die('Missing release notes — pass --notes-file <path> or --notes "text"');
notes = `${tag}\n\n${notes.trim()}\n`; // first line = tag, so `gh` titles it sensibly

console.log(`[release] preparing ${tag}${dryRun ? ' (dry run)' : ''}`);

// --- 1. Repo state checks -------------------------------------------------
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main' && !flag('allow-branch')) die(`On branch "${branch}" — release from main (or pass --allow-branch)`);
if (capture('git', ['status', '--porcelain'])) die('Working tree is dirty — commit or stash first');
if (capture('git', ['tag', '--list', tag])) die(`Tag ${tag} already exists locally — delete it or pick another version`);

run('git', ['fetch', 'origin', '--tags', '--quiet']);
if (capture('git', ['ls-remote', '--tags', 'origin', tag])) die(`Tag ${tag} already exists on origin`);
const behind = capture('git', ['rev-list', '--count', `HEAD..origin/${branch}`]);
if (behind !== '0') die(`Local ${branch} is ${behind} commit(s) behind origin — pull first`);

const ghAuth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
if (ghAuth.status !== 0) die('gh is not authenticated — run `gh auth login`');

// --- 2. Build -------------------------------------------------------------
run('pnpm', ['typecheck']);
run('pnpm', ['build']);
run(process.execPath, [path.join('scripts', 'package.mjs'), '--version', version], { shell: false });

const zipPath = path.join(rootDir, 'dist', `claude-history-${version}-win-x64.zip`);
const sumsPath = path.join(rootDir, 'dist', 'checksums.txt');
for (const f of [zipPath, sumsPath]) if (!fs.existsSync(f)) die(`Expected build artifact missing: ${f}`);

if (dryRun) {
  console.log(`\n[release] dry run OK — artifacts in dist/, nothing tagged or published.`);
  console.log(`[release] notes preview:\n${notes}`);
  process.exit(0);
}

// --- 3. Tag, push, publish ------------------------------------------------
const notesPath = path.join(rootDir, 'dist', 'release-notes.txt');
fs.writeFileSync(notesPath, notes, 'utf8');
// --cleanup=verbatim: without it git strips lines starting with '#',
// silently eating markdown headings from the release notes.
run('git', ['tag', '-a', tag, '-F', notesPath, '--cleanup=verbatim']);
run('git', ['push', 'origin', branch]);
run('git', ['push', 'origin', tag]);

// If publishing fails the tag is already pushed: say exactly how to recover.
const gh = spawnSync('gh', ['release', 'create', tag, zipPath, sumsPath, '--title', tag, '--notes-from-tag'], {
  cwd: rootDir,
  stdio: 'inherit',
});
if (gh.status !== 0) {
  die(
    `gh release create failed. The tag ${tag} is already pushed; retry publishing with:\n` +
      `  gh release create ${tag} "${zipPath}" "${sumsPath}" --title ${tag} --notes-from-tag\n` +
      `or remove the tag: git tag -d ${tag} && git push origin :refs/tags/${tag}`,
  );
}

console.log(`\n[release] ${tag} published.`);
