// Builds the distributable portable zip for Windows x64.
//
// Usage:  node scripts/package.mjs --version 1.2.0
//
// Output layout inside the zip (see CLAUDE.md "Portable install layout"):
//   install.ps1 / uninstall.ps1 / launch.vbs      <- installer (stable across updates)
//   versions/v<version>/
//     node/node.exe                               <- embedded Node runtime
//     server.cjs                                  <- esbuild bundle of the server
//     web/                                        <- built frontend (web/dist)
//     start-hidden.vbs, update-helper.ps1         <- per-version runtime scripts
//
// Also writes dist/checksums.txt (sha256sum format) — the in-app updater
// verifies downloads against the copy attached to the GitHub release.

import AdmZip from 'adm-zip';
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned embedded runtime. Bump deliberately; each version folder is
// self-contained so updates can change the runtime safely.
const NODE_VERSION = '24.18.0';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const version = arg('version', '0.0.0-dev');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
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
  define: { __APP_VERSION__: JSON.stringify(version) },
  sourcemap: false,
  logLevel: 'warning',
});

// 2. Frontend.
fs.cpSync(webDist, path.join(verDir, 'web'), { recursive: true });

// 3. Embedded Node runtime (downloaded once, cached under dist/.node-cache).
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

// 4. Installer / runtime scripts.
const installerDir = path.join(rootDir, 'installer');
const rootScripts = ['install.ps1', 'uninstall.ps1', 'launch.vbs'];
const versionScripts = ['start-hidden.vbs', 'update-helper.ps1'];
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

// 5. Zip + checksums.
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
