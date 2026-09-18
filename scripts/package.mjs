// Builds the distributable portable zip for Windows x64.
//
// Usage:  node scripts/package.mjs                        (local build, version "dev")
//         node scripts/package.mjs --release --version 1.2.0   (release.mjs only)
//
// Output layout inside the zip (see docs/AI_DISTRIBUTION.md):
//   install.ps1 / uninstall.ps1 / launch.vbs      <- installer: a stable PATH, but
//                                                    update-helper.ps1 copies these
//                                                    back over from the new version
//                                                    on every successful update
//   versions/v<version>/
//     node/node.exe                               <- embedded Node runtime
//     server.cjs                                  <- esbuild bundle of the server
//     node_modules/@lydell/node-pty*              <- the ONE native dependency
//     web/                                        <- built frontend (web/dist)
//     start-hidden.vbs, update-helper.ps1         <- per-version runtime scripts
//
// Also writes dist/checksums.txt (sha256sum format) — the in-app updater
// verifies downloads against the copy attached to the GitHub release.

import AdmZip from 'adm-zip';
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned embedded runtime. Bump deliberately; each version folder is
// self-contained so updates can change the runtime safely.
const NODE_VERSION = '24.18.0';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

// A local build is simply "dev" — no invented version numbers. Only
// scripts/release.mjs passes --release (with a real X.Y.Z), so a hand-built
// zip can never present itself as a published version.
const isRelease = flag('release');
const version = isRelease ? arg('version', '') : 'dev';
if (isRelease && !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid --version "${version}" (expected X.Y.Z)`);
  process.exit(1);
}

const webDist = path.join(rootDir, 'web', 'dist');
if (!fs.existsSync(path.join(webDist, 'index.html'))) {
  console.error('web/dist/index.html not found — run "pnpm build" first.');
  process.exit(1);
}

const distDir = path.join(rootDir, 'dist');
const stageDir = path.join(distDir, 'stage');
const verDir = path.join(stageDir, 'versions', `v${version}`);
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(verDir, { recursive: true });

// 1. Bundle the server (CJS avoids dynamic-require issues with CJS deps).
console.log(`[package] bundling server (version ${version})...`);
await build({
  entryPoints: [path.join(rootDir, 'server', 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: path.join(verDir, 'server.cjs'),
  // The embedded terminal's pseudo-console is a compiled `.node` binary, and a
  // binary cannot go inside a JS bundle. It is copied beside server.cjs below
  // instead, where Node's own resolution finds it walking up from that file.
  external: ['@lydell/node-pty'],
  // The Agent SDK calls `createRequire(import.meta.url)` at module scope. In a
  // CJS bundle esbuild has no import.meta to give it, so that argument arrives
  // undefined and the whole bundle throws ERR_INVALID_ARG_VALUE before a line
  // of ours runs. Hand it the equivalent for this file.
  banner: { js: "const __sdkFileUrl = require('url').pathToFileURL(__filename).href;" },
  define: { __APP_VERSION__: JSON.stringify(version), 'import.meta.url': '__sdkFileUrl' },
  sourcemap: false,
  logLevel: 'warning',
});

// 2. The one native dependency, beside the bundle.
//
// This is the only reason a release carries a node_modules at all. Two packages:
// the wrapper, whose `index.js` requires the platform one by name, and the
// win32-x64 build itself, which holds `conpty.node` and the ConPTY runtime
// (conpty.dll + OpenConsole.exe). Both go under `versions/v<version>/`, so an
// update carries them like everything else and two versions never share one.
//
// The `.pdb` files are debug symbols for a debugger nobody here is running, and
// they are 10.6 of the package's 12 MB. Dropped.
console.log('[package] copying the native pseudo-terminal...');
const requireFromServer = createRequire(path.join(rootDir, 'server', 'package.json'));

/**
 * The directory a package actually lives in.
 *
 * `require.resolve` answers with an ENTRY POINT, and these packages export only
 * `./lib/index.js`, so neither the dirname of that nor `resolve('<pkg>/package.json')`
 * is the answer. Walk up until a package.json says its own name.
 */
function packageDirOf(req, name) {
  let dir = path.dirname(req.resolve(name));
  for (let i = 0; i < 8; i++) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return dir;
      } catch {
        // Unreadable manifest on the way up — keep climbing.
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  console.error(`Could not locate the package directory for ${name} — run "pnpm install" first.`);
  process.exit(1);
}

const ptyWrapperDir = packageDirOf(requireFromServer, '@lydell/node-pty');
const ptyPlatformDir = packageDirOf(
  createRequire(path.join(ptyWrapperDir, 'package.json')),
  '@lydell/node-pty-win32-x64',
);
for (const [src, name] of [
  [ptyWrapperDir, 'node-pty'],
  [ptyPlatformDir, 'node-pty-win32-x64'],
]) {
  fs.cpSync(src, path.join(verDir, 'node_modules', '@lydell', name), {
    recursive: true,
    // pnpm links rather than copies, so the sources are symlinks into the store.
    dereference: true,
    filter: (from) => !from.endsWith('.pdb'),
  });
}

// 3. Frontend.
fs.cpSync(webDist, path.join(verDir, 'web'), { recursive: true });

// 4. Embedded Node runtime (downloaded once, cached under dist/.node-cache).
const nodeZipName = `node-v${NODE_VERSION}-win-x64.zip`;
const nodeCache = path.join(distDir, '.node-cache', nodeZipName);
if (!fs.existsSync(nodeCache)) {
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${nodeZipName}`;
  console.log(`[package] downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to download Node runtime: HTTP ${res.status}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(nodeCache), { recursive: true });
  fs.writeFileSync(nodeCache, Buffer.from(await res.arrayBuffer()));
}
const nodeZip = new AdmZip(nodeCache);
const nodeExe = nodeZip.getEntry(`node-v${NODE_VERSION}-win-x64/node.exe`);
if (!nodeExe) {
  console.error('node.exe not found inside the Node runtime zip');
  process.exit(1);
}
fs.mkdirSync(path.join(verDir, 'node'), { recursive: true });
fs.writeFileSync(path.join(verDir, 'node', 'node.exe'), nodeExe.getData());

// 5. Installer / runtime scripts.
const installerDir = path.join(rootDir, 'installer');
const rootScripts = ['install.ps1', 'uninstall.ps1', 'launch.vbs'];
// The installer scripts also ship inside the version folder: the in-app
// updater only extracts versions/, so update-helper.ps1 refreshes the root
// copies from there — otherwise they would stay frozen at install time.
const versionScripts = ['start-hidden.vbs', 'update-helper.ps1', 'install.ps1', 'uninstall.ps1', 'launch.vbs'];
for (const [files, target] of [
  [rootScripts, stageDir],
  [versionScripts, verDir],
]) {
  for (const f of files) {
    const src = path.join(installerDir, f);
    if (fs.existsSync(src)) {
      // Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI, and wscript is
      // similar with .vbs — any non-ASCII byte breaks parsing on the target
      // machine, so enforce pure ASCII here.
      const text = fs.readFileSync(src, 'utf8');
      if (/[^\x00-\x7F]/.test(text)) {
        console.error(`[package] installer/${f} contains non-ASCII characters (breaks PowerShell 5.1 / wscript)`);
        process.exit(1);
      }
      fs.copyFileSync(src, path.join(target, f));
    } else {
      console.warn(`[package] WARNING: installer/${f} missing — zip will not include it`);
    }
  }
}

// 6. Zip + checksums.
const zipName = `claude-history-${version}-win-x64.zip`;
const zipPath = path.join(distDir, zipName);
fs.rmSync(zipPath, { force: true });
const outZip = new AdmZip();
outZip.addLocalFolder(stageDir);
outZip.writeZip(zipPath);

const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
fs.writeFileSync(path.join(distDir, 'checksums.txt'), `${hash}  ${zipName}\n`);

const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`[package] ${zipName} (${mb} MB)`);
console.log(`[package] sha256 ${hash}`);
