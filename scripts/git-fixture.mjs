// Builds the throwaway git repositories the GIT tab is verified against.
//
// Usage:  node scripts/git-fixture.mjs [--reset] [--root <dir>] [--git <git.exe>] [--json]
//
// NOTHING in this project may be verified against a real repository on this
// machine — not a write, not even a read. Every check in CLAUDE.md's "Git tab"
// section runs against what this script builds, served by a SECOND server
// instance with its own data root, cache and userdata.json:
//
//   node server/src/main.ts --data-root <tmp> --port 7434 --logs-dir <tmp>
//   (with CLAUDE_HISTORY_CACHE pointing into <tmp> as well)
//
// Everything lands under %TEMP%\claude-history-git-fixture. Author identity is
// set PER REPO (`git config`, never `--global`), commit timestamps are fixed,
// and no fixture has a remote pointing anywhere outside this folder — so the
// bench is reproducible, offline, and cannot touch anything of yours.
//
//   repos/linear       20 commits, one branch, tracking the local bare remote
//   repos/branchy      6 branches, 4 merges, 3 tags, 2 stashes
//   repos/conflict     two branches that collide on the same lines
//   repos/odd-names    foo[1].txt, accents, spaces, 400 files to stage at once
//   repos/big          ~5,000 commits and 60 branches (graph performance)
//   repos/withsub      one submodule, pointing at the local bare remote
//   remote/origin.git  bare repo standing in for a remote — most of the network
//                      phase is verified against this, offline
//   remote-worker/     a second clone of that bare, so "somebody else pushed"
//                      is a situation this bench can actually produce
//   scan/              a tree for the scan-root discovery rules
//   bin-nn/git.exe     a "git" under a path with n-tilde, for findGitExe()
//   serve-401.mjs      a local HTTP server that answers 401 (optionally after a
//                      delay). It provokes git's credential path with no network
//                      and no real remote, which is the only way to check that a
//                      push needing credentials FAILS rather than hanging — and
//                      a delayed one gives a slow fetch to cancel.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const GIT = arg('git', 'git');
const ROOT = path.resolve(arg('root', path.join(os.tmpdir(), 'claude-history-git-fixture')));
const JSON_OUT = flag('json');

// Fixed clock, so two runs produce the same shas and the same ordering.
const BASE_EPOCH = 1_700_000_000; // 2023-11-14 22:13:20 UTC
const TZ = '+0100';
let clock = BASE_EPOCH;
const tick = (seconds = 600) => (clock += seconds);

const NAME = 'Fixture Bot';
const EMAIL = 'fixture@example.invalid';
// One repo deliberately carries non-ASCII in the author name: it is what proves
// the output is decoded as UTF-8 once, rather than per stdout chunk.
const ODD_NAME = 'Édgar Ñoño';
const ODD_EMAIL = 'edgar@example.invalid';

const log = (msg) => {
  if (!JSON_OUT) console.log(`[git-fixture] ${msg}`);
};

// ---------------------------------------------------------------- helpers

function git(cwd, args, { stdin, env, allowFail } = {}) {
  const res = spawnSync(GIT, args, {
    cwd,
    input: stdin,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  if (res.error) throw new Error(`git ${args.join(' ')} failed to start: ${res.error.message}`);
  if (res.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} exited ${res.status}\n${res.stderr ?? ''}`);
  }
  return res;
}

/**
 * Delete a tree that contains a git repository. Loose objects are written
 * read-only, and `fs.rmSync` cannot remove those on Windows (EPERM) — so every
 * file is made writable first.
 */
function rmrf(target) {
  if (!fs.existsSync(target)) return;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          fs.chmodSync(full, 0o666);
        } catch {
          // best effort; rmSync reports the real problem
        }
      }
    }
  };
  walk(target);
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function write(repo, rel, content) {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function init(dir, { bare = false, name = NAME, email = EMAIL } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', ...(bare ? ['--bare'] : []), '-b', 'main', '-q']);
  if (bare) return dir;
  // Local config only — the user's global config is never touched.
  git(dir, ['config', 'user.name', name]);
  git(dir, ['config', 'user.email', email]);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function commit(repo, message, { allowEmpty = false } = {}) {
  const when = `${tick()} ${TZ}`;
  git(repo, ['add', '--all']);
  git(repo, ['commit', ...(allowEmpty ? ['--allow-empty'] : []), '-q', '-m', message], {
    env: { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
}

// ---------------------------------------------------------------- fixtures

function buildLinear(dir, remote) {
  init(dir);
  for (let i = 1; i <= 20; i++) {
    write(dir, 'notes.md', `# Notes\n\n${Array.from({ length: i }, (_, n) => `- entry ${n + 1}`).join('\n')}\n`);
    commit(dir, `Add entry ${i}`);
  }
  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['push', '-q', '--set-upstream', 'origin', 'main']);
  return dir;
}

function buildBranchy(dir, remote) {
  init(dir);
  write(dir, 'README.md', '# branchy\n');
  commit(dir, 'Initial commit');
  for (let i = 1; i <= 5; i++) {
    write(dir, `src/mod${i}.txt`, `module ${i}\n`);
    commit(dir, `Add module ${i}`);
  }
  git(dir, ['tag', 'v0.1.0']);

  // Six topic branches; four of them merged back, two left standing so the
  // sidebar has both "merged" and "unmerged" cases.
  const topics = ['feat/alpha', 'feat/beta', 'fix/gamma', 'fix/delta', 'chore/epsilon', 'spike/zeta'];
  topics.forEach((topic, index) => {
    git(dir, ['checkout', '-q', '-b', topic, 'main']);
    for (let i = 1; i <= 3; i++) {
      write(dir, `src/${topic.replace('/', '-')}-${i}.txt`, `${topic} step ${i}\n`);
      commit(dir, `${topic}: step ${i}`);
    }
    git(dir, ['checkout', '-q', 'main']);
    if (index < 4) {
      const when = `${tick()} ${TZ}`;
      git(dir, ['merge', '-q', '--no-ff', '-m', `Merge branch '${topic}'`, topic], {
        env: { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
    }
  });

  git(dir, ['tag', '-a', 'v1.0.0', '-m', 'First real release'], {
    env: { GIT_AUTHOR_DATE: `${tick()} ${TZ}`, GIT_COMMITTER_DATE: `${clock} ${TZ}` },
  });
  git(dir, ['tag', 'v1.0.1']);

  // Two stashes, so the sidebar's stash section is never empty.
  write(dir, 'README.md', '# branchy\n\nwork in progress\n');
  git(dir, ['stash', 'push', '-q', '-m', 'wip: readme rewrite']);
  write(dir, 'src/mod1.txt', 'module 1 — reworked\n');
  write(dir, 'untracked-note.txt', 'not committed anywhere\n');
  git(dir, ['stash', 'push', '-q', '-u', '-m', 'wip: module 1 and a new note']);

  git(dir, ['remote', 'add', 'origin', remote]);
  git(dir, ['push', '-q', 'origin', 'main:branchy']);
  git(dir, ['fetch', '-q', 'origin']);
  return dir;
}

function buildConflict(dir) {
  init(dir);
  write(dir, 'shared.txt', ['first line', 'the contested line', 'last line'].join('\n') + '\n');
  write(dir, 'quiet.txt', 'nobody touches this\n');
  commit(dir, 'Initial commit');

  git(dir, ['checkout', '-q', '-b', 'theirs']);
  write(dir, 'shared.txt', ['first line', 'THEIR version of the contested line', 'last line'].join('\n') + '\n');
  commit(dir, 'Rewrite the contested line their way');
  write(dir, 'theirs-only.txt', 'added on theirs\n');
  commit(dir, 'Add a file only theirs has');

  git(dir, ['checkout', '-q', 'main']);
  write(dir, 'shared.txt', ['first line', 'OUR version of the contested line', 'last line'].join('\n') + '\n');
  commit(dir, 'Rewrite the contested line our way');
  return dir;
}

function buildOddNames(dir) {
  init(dir, { name: ODD_NAME, email: ODD_EMAIL });
  write(dir, 'README.md', '# odd names\n');
  commit(dir, 'Initial commit');

  // Every one of these is a trap for a different rule: the brackets for
  // --literal-pathspecs, the accents for core.quotepath=false, the spaces for
  // anything that ever considers building a command line as a string.
  write(dir, 'foo[1].txt', 'a file whose name looks like a glob\n');
  write(dir, 'acción.txt', 'acentos en el nombre\n');
  write(dir, 'ñandú y coma, punto.txt', 'spaces, a comma and a tilde\n');
  write(dir, 'sub dir/anidado ó.txt', 'nested, spaced, accented\n');
  commit(dir, 'Añadir archivos con nombres difíciles');

  // 400 files inside a TRACKED directory, so status lists them one by one
  // instead of collapsing the directory — that is the mass-staging fixture.
  write(dir, 'bulk/.gitkeep', '');
  commit(dir, 'Add the bulk directory');
  for (let i = 1; i <= 400; i++) {
    write(dir, `bulk/f${String(i).padStart(3, '0')}.txt`, `bulk file ${i}\n`);
  }
  // An untracked directory as well: this one MUST collapse to a single entry.
  write(dir, 'newdir/a.txt', 'a\n');
  write(dir, 'newdir/b.txt', 'b\n');
  write(dir, 'newdir/c.txt', 'c\n');
  // And one modified tracked file, so the working tree has all three groups.
  write(dir, 'README.md', '# odd names\n\nmodified, not staged\n');
  return dir;
}

/**
 * ~5,000 commits and 60 branches, built through `git fast-import`: one process
 * instead of five thousand spawns (seconds instead of many minutes). Each
 * commit rewrites a single file, so the tree stays small and the repo is a
 * graph fixture rather than a disk-space experiment.
 */
function buildBig(dir, { branches = 60, merged = 40, perBranch = 5, target = 5000 } = {}) {
  init(dir);
  const mainCommits = Math.max(1, target - branches * perBranch - merged);
  const out = [];
  let mark = 0;
  const who = `${NAME} <${EMAIL}>`;
  const nextMark = () => ++mark;

  const emit = (ref, subject, { from, merge, body }) => {
    const m = nextMark();
    const when = `${tick(300)} ${TZ}`;
    out.push(`commit ${ref}`);
    out.push(`mark :${m}`);
    out.push(`author ${who} ${when}`);
    out.push(`committer ${who} ${when}`);
    out.push(`data ${Buffer.byteLength(subject, 'utf8')}`);
    out.push(subject);
    if (from) out.push(`from :${from}`);
    if (merge) out.push(`merge :${merge}`);
    out.push('M 644 inline log.txt');
    out.push(`data ${Buffer.byteLength(body, 'utf8')}`);
    out.push(body);
    out.push('');
    return m;
  };

  let head = null;
  let n = 0;
  let openTopics = [];
  const forkEvery = Math.floor(mainCommits / branches) || 1;
  let created = 0;
  let mergedCount = 0;

  for (let i = 1; i <= mainCommits; i++) {
    head = emit('refs/heads/main', `Commit ${++n} on main`, { from: head, body: `main ${n}\n` });

    if (created < branches && i % forkEvery === 0) {
      const topic = `topic/${String(++created).padStart(2, '0')}`;
      let tip = head;
      for (let k = 1; k <= perBranch; k++) {
        tip = emit(`refs/heads/${topic}`, `${topic}: step ${k}`, { from: tip, body: `${topic} ${k}\n` });
      }
      openTopics.push({ topic, tip });
    }

    // Merge a topic back a few commits after it was opened, so the lanes in the
    // graph actually run alongside main instead of closing immediately.
    if (openTopics.length > 3 && mergedCount < merged) {
      const { topic, tip } = openTopics.shift();
      head = emit('refs/heads/main', `Merge branch '${topic}'`, { from: head, merge: tip, body: `merge ${topic}\n` });
      mergedCount++;
    }
  }

  for (let i = 1; i <= 12; i++) {
    out.push(`reset refs/tags/v0.${i}.0`);
    out.push(`from :${Math.max(1, Math.floor((mark / 12) * i))}`);
    out.push('');
  }
  out.push('done');

  git(dir, ['fast-import', '--quiet', '--done'], { stdin: out.join('\n') + '\n' });
  git(dir, ['checkout', '-q', '-f', 'main']);
  git(dir, ['reset', '-q', '--hard']);
  return dir;
}

function buildWithSub(dir, remote) {
  init(dir);
  write(dir, 'README.md', '# has a submodule\n');
  commit(dir, 'Initial commit');
  // Modern git refuses file:// submodules unless told otherwise; the remote is
  // a bare repo two folders away, so nothing leaves the bench.
  git(dir, ['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', remote, 'vendor/linear']);
  commit(dir, 'Add the vendor submodule');
  return dir;
}

/**
 * The discovery fixture. A scan root of `scan/` must find EXACTLY four repos:
 * alpha, clone-a, clone-b (depth 1) and nested/gamma (depth 2). It must not
 * find node_modules/sneaky (ignored directory) nor nested/deep/omega (depth 3,
 * past the limit), and plain-folder is not a repo at all. clone-a and clone-b
 * share a remote, which is what proves repos are keyed by path and not by URL.
 */
function buildScanTree(dir, remote) {
  fs.mkdirSync(dir, { recursive: true });

  init(path.join(dir, 'alpha'));
  write(path.join(dir, 'alpha'), 'a.txt', 'alpha\n');
  commit(path.join(dir, 'alpha'), 'Alpha');

  for (const name of ['clone-a', 'clone-b']) {
    git(dir, ['clone', '-q', remote, name]);
    const clone = path.join(dir, name);
    git(clone, ['config', 'user.name', NAME]);
    git(clone, ['config', 'user.email', EMAIL]);
  }

  const gamma = path.join(dir, 'nested', 'gamma');
  init(gamma);
  write(gamma, 'g.txt', 'gamma\n');
  commit(gamma, 'Gamma');

  const omega = path.join(dir, 'nested', 'deep', 'omega');
  init(omega);
  write(omega, 'o.txt', 'omega\n');
  commit(omega, 'Omega — too deep to be discovered');

  const sneaky = path.join(dir, 'node_modules', 'sneaky');
  init(sneaky);
  write(sneaky, 's.txt', 'sneaky\n');
  commit(sneaky, 'Sneaky — inside node_modules, must be skipped');

  fs.mkdirSync(path.join(dir, 'plain-folder', 'inner'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plain-folder', 'readme.txt'), 'not a repository\n', 'utf8');
  return dir;
}

/**
 * A second working copy of the bare remote.
 *
 * Half the interesting network cases are "somebody else pushed while you were
 * working", and without a second clone the bench cannot produce one: a push
 * rejected as non-fast-forward, a stale `--force-with-lease`, a branch that
 * disappeared and has to be pruned. This is that somebody else.
 */
function buildRemoteWorker(dir, remote) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(path.dirname(dir), ['clone', '-q', remote, path.basename(dir)]);
  git(dir, ['config', 'user.name', 'Other Person']);
  git(dir, ['config', 'user.email', 'other@example.invalid']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

/** The 401 server, written out rather than run: the checks start and stop it themselves. */
function writeAuthServer(root) {
  const file = path.join(root, 'serve-401.mjs');
  fs.writeFileSync(
    file,
    `// A remote that always asks for credentials, and never accepts any.
//
// git's credential path is otherwise unreachable offline, and it is the one
// path whose failure mode is a process that HANGS rather than one that fails —
// invisibly, holding the repository lock. Started with a delay it also gives a
// slow fetch, which is what a cancellation test needs.
//
// Usage: node serve-401.mjs [--port 0] [--delay-ms 0]
import http from 'node:http';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const delay = Number(arg('delay-ms', 0));

const server = http.createServer((req, res) => {
  const answer = () => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' });
    res.end('authentication required\\n');
  };
  process.stdout.write('request ' + req.method + ' ' + req.url + '\\n');
  if (delay > 0) setTimeout(answer, delay);
  else answer();
});

server.listen(Number(arg('port', 0)), '127.0.0.1', () => {
  process.stdout.write('listening ' + server.address().port + '\\n');
});
`,
    'utf8',
  );
  return file;
}

/**
 * A "git" living under a path with a tilde-n, for the executable-resolution
 * check. It is a copy of the running node binary rather than of git.exe: the
 * point is that the resolved string survives byte-identical and that spawning
 * it does not answer ENOENT — Git for Windows' own wrapper would not run once
 * moved away from its installation.
 */
function buildAccentedExe(dir) {
  const binDir = path.join(dir, 'bin-ñ');
  fs.mkdirSync(binDir, { recursive: true });
  const target = path.join(binDir, 'git.exe');
  fs.copyFileSync(process.execPath, target);
  return target;
}

// ---------------------------------------------------------------- main

const gitVersion = git(process.cwd(), ['--version']).stdout.trim();

if (fs.existsSync(ROOT)) {
  if (!flag('reset')) {
    console.error(`${ROOT} already exists. Pass --reset to rebuild it from scratch.`);
    process.exit(1);
  }
  log(`removing ${ROOT}`);
  rmrf(ROOT);
}
fs.mkdirSync(ROOT, { recursive: true });
log(`${gitVersion} — building under ${ROOT}`);

const remoteDir = path.join(ROOT, 'remote', 'origin.git');
const reposDir = path.join(ROOT, 'repos');
const scanDir = path.join(ROOT, 'scan');

log('remote/origin.git (bare)');
init(remoteDir, { bare: true });

log('repos/linear');
const linear = buildLinear(path.join(reposDir, 'linear'), remoteDir);

log('repos/branchy');
const branchy = buildBranchy(path.join(reposDir, 'branchy'), remoteDir);

log('repos/conflict');
const conflict = buildConflict(path.join(reposDir, 'conflict'));

log('repos/odd-names');
const oddNames = buildOddNames(path.join(reposDir, 'odd-names'));

log('repos/big — this one takes a moment');
const big = buildBig(path.join(reposDir, 'big'));

log('repos/withsub');
const withSub = buildWithSub(path.join(reposDir, 'withsub'), remoteDir);

log('remote-worker/');
const worker = buildRemoteWorker(path.join(ROOT, 'remote-worker'), remoteDir);

log('scan/');
buildScanTree(scanDir, remoteDir);

log('bin-ñ/git.exe');
const accentedExe = buildAccentedExe(ROOT);

log('serve-401.mjs');
const authServer = writeAuthServer(ROOT);

const bigCommits = Number(git(big, ['rev-list', '--count', '--all']).stdout.trim());
const bigRefs = git(big, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'])
  .stdout.trim()
  .split('\n').length;

const summary = {
  root: ROOT,
  gitVersion,
  remote: remoteDir,
  worker,
  authServer,
  repos: { linear, branchy, conflict, oddNames, big, withSub },
  scanRoot: scanDir,
  accentedExe,
  big: { commits: bigCommits, refs: bigRefs },
  expected: {
    scanFinds: ['alpha', 'clone-a', 'clone-b', 'nested/gamma'],
    scanSkips: ['node_modules/sneaky', 'nested/deep/omega', 'plain-folder'],
    siblings: ['clone-a', 'clone-b'],
  },
};

if (JSON_OUT) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  console.log('');
  console.log(`[git-fixture] done — ${ROOT}`);
  console.log(`[git-fixture]   big: ${bigCommits} commits, ${bigRefs} refs`);
  console.log(`[git-fixture]   scan root: ${scanDir} (must find 4 repos, skip 2)`);
  console.log(`[git-fixture]   remote: ${remoteDir}`);
  console.log(`[git-fixture]   worker: ${worker} (push from here to move the remote)`);
  console.log(`[git-fixture]   auth:   node ${authServer} --delay-ms 0`);
  console.log('[git-fixture] Nothing here points outside this folder. Never verify against a real repo.');
}
