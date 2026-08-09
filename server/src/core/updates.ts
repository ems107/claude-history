import type { UpdateProgress, UpdateRelease, UpdateState, UpdateStatusResponse } from '@claude-history/shared';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeFetchError } from '../util/fetchError.ts';
import { APP_VERSION } from '../version.ts';
import { createLogger } from './logger.ts';

const log = createLogger('updates');

// Automatic update CHECK is the only background network call in the app:
// a tiny JSON GET against the GitHub releases API, sent with If-None-Match
// so unchanged answers are free 304s (which don't count against GitHub's
// unauthenticated rate limit of 60 req/h). Downloading and applying an
// update NEVER happens without explicit user confirmation in the UI.
//
// Everything an apply does is logged under this source, from the click to the
// moment the helper takes over: which release, which URL, every download
// attempt and how many bytes it moved, the checksum, the tar command line and
// its exit code, the helper registration and its output. The helper's own
// lines land in <root>\update.log and are imported back here on the next start
// (updateLogImport.ts), so one query answers "what happened and where".
const DEFAULT_REPO = 'ems107/claude-history';
const STARTUP_DELAY_MS = 30_000;
const MANUAL_THROTTLE_MS = 10_000;
const FETCH_TIMEOUT_MS = 15_000;
/**
 * Download attempts before giving up, each resuming from what the previous one
 * left behind. The release zip is ~35 MB and used to be one non-resumable
 * request: when a CDN edge served it at 17 KB/s and then reset the connection,
 * the whole update died with nothing to show for it.
 */
const DOWNLOAD_ATTEMPTS = 5;
/**
 * A transfer that receives NOTHING for this long is dead. The deadline is on
 * silence, never on the total: a slow line is not a failure, and an overall
 * timeout only guarantees that the biggest downloads fail on the worst days.
 */
const DOWNLOAD_STALL_MS = 60_000;
/** Waits between download attempts (the last one repeats if needed). */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];
/** How often download progress is published over SSE, and logged. */
const PROGRESS_EMIT_MS = 700;
const PROGRESS_LOG_MS = 5_000;
/**
 * A step that has not moved at all in this long is dead, not busy. Measured
 * from the last state change OR the last byte received, so a legitimately slow
 * download is never mistaken for a wedged one.
 */
const STUCK_STATE_MS = 6 * 60_000;

/** What to call each step when it is the one that failed. */
const STEP_FAILURE: Partial<Record<UpdateState, string>> = {
  downloading: 'Download failed',
  verifying: 'Verification failed',
  staging: 'Extraction failed',
  restarting: 'Handover to the update helper failed',
};

export interface InstallInfo {
  /** Install root (the folder containing install.json, current\, versions\). */
  root: string;
  /** Real directory the running version lives in (versions\vX.Y.Z). */
  versionDir: string;
}

interface ReleaseAssets {
  zipUrl: string;
  zipName: string;
  checksumsUrl: string;
}

interface KnownRelease {
  info: UpdateRelease;
  assets: ReleaseAssets | null;
}

/**
 * Detect whether this process runs from an installed portable layout:
 * <root>\versions\vX.Y.Z\server.cjs with <root>\install.json present.
 * The entry path goes through the `current` junction, so resolve real paths.
 */
export function detectInstall(entryPath = process.argv[1] ?? ''): InstallInfo | null {
  try {
    const versionDir = fs.realpathSync(path.dirname(path.resolve(entryPath)));
    // 'vdev' is a locally built install — still a managed one.
    if (!/^v(\d+\.\d+\.\d+|dev$)/.test(path.basename(versionDir))) return null;
    const versionsDir = path.dirname(versionDir);
    if (path.basename(versionsDir).toLowerCase() !== 'versions') return null;
    const root = path.dirname(versionsDir);
    if (!fs.existsSync(path.join(root, 'install.json'))) return null;
    return { root, versionDir };
  } catch {
    return null;
  }
}

/**
 * Numeric semver comparison. A prerelease sorts BELOW the same numbers
 * without one (1.3.1-dev < 1.3.1), which is what makes locally built -dev
 * installs get superseded by the real release instead of looking equal to it.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map(Number), pre: pre ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1; // release beats prerelease
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Hash the staged file without holding 35 MB of it in memory. */
async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const fileSize = (file: string): number => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

/**
 * Windows' own tar.exe (bsdtar) by absolute path. A bare `tar` resolves
 * through PATH, where a Git-for-Windows GNU tar can easily win — and GNU tar
 * cannot read a zip at all, so the extraction would fail for a reason nobody
 * would guess from the error.
 */
function resolveTar(): string {
  const sysRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  const sysTar = path.join(sysRoot, 'System32', 'tar.exe');
  return fs.existsSync(sysTar) ? sysTar : 'tar';
}

export class UpdateService {
  readonly events = new EventEmitter();
  readonly install: InstallInfo | null;

  private readonly repo: string;
  private etag: string | null = null;
  /** Every published release, newest first (as returned by GitHub). */
  private releases: KnownRelease[] = [];
  private lastCheckAt: string | null = null;
  private lastError: string | null = null;
  private state: UpdateState = 'idle';
  private lastManualCheck = 0;
  /** The apply in flight, if any. Set before the starting POST answers. */
  private applying: { version: string; tag: string; startedMs: number } | null = null;
  private progress: UpdateProgress | null = null;
  private lastApplyError: string | null = null;
  private lastApplyErrorAt: string | null = null;
  /** Bumped by every state change and every chunk received; feeds isBusy(). */
  private lastActivity = 0;
  private lastEmitMs = 0;
  private lastProgressLogMs = 0;

  constructor() {
    this.repo = process.env.CLAUDE_HISTORY_UPDATE_REPO || DEFAULT_REPO;
    this.install = detectInstall();
    log.debug(
      this.install
        ? `managed install at ${this.install.root}, running from ${this.install.versionDir}`
        : 'not a managed install (source or portable) — updates can be checked but not applied',
      { repo: this.repo, version: APP_VERSION },
    );
  }

  /**
   * Schedule the automatic checks. `getSettings` is read on every tick, so
   * toggling auto-check or the interval in the UI takes effect immediately.
   */
  start(getSettings: () => { updateAutoCheck: boolean; updateIntervalMinutes: number }): void {
    let lastCheckMs = 0;
    const tick = () => {
      const { updateAutoCheck, updateIntervalMinutes } = getSettings();
      if (!updateAutoCheck) return;
      if (Date.now() - lastCheckMs < Math.max(5, updateIntervalMinutes) * 60_000) return;
      lastCheckMs = Date.now();
      void this.check('scheduled');
    };
    setTimeout(tick, STARTUP_DELAY_MS).unref();
    setInterval(tick, 60_000).unref();
  }

  getStatus(): UpdateStatusResponse {
    const available = this.newerReleases();
    return {
      currentVersion: APP_VERSION,
      installed: this.install !== null,
      updateAvailable: available.length > 0,
      available: available.map((r) => r.info),
      lastCheckAt: this.lastCheckAt,
      lastError: this.lastError,
      state: this.state,
      applyingVersion: this.applying?.version ?? null,
      progress: this.progress,
      lastApplyError: this.lastApplyError,
      lastApplyErrorAt: this.lastApplyErrorAt,
    };
  }

  /** True while an update is being installed — nothing may stop the server. */
  isApplying(): boolean {
    return this.applying !== null && this.isBusy();
  }

  /**
   * Releases newer than the running one, newest first. A local build reports
   * "dev", which has no position in the version order — treat every published
   * release as newer, so a hand-built install can always move onto a real one.
   */
  private newerReleases(): KnownRelease[] {
    if (APP_VERSION === 'dev') return this.releases;
    return this.releases.filter((r) => compareVersions(r.info.version, APP_VERSION) > 0);
  }

  private setState(state: UpdateState): void {
    this.state = state;
    this.lastActivity = Date.now();
    this.emit();
  }

  /**
   * True while a step is genuinely in progress. "In progress" means something
   * moved recently — a state change or a received byte — so a 20-minute
   * download on a bad line stays busy while a wedged step gets reset.
   */
  private isBusy(): boolean {
    if (this.state === 'idle') return false;
    if (Date.now() - this.lastActivity < STUCK_STATE_MS) return true;
    log.warn(`the "${this.state}" step has not moved in ${Math.round(STUCK_STATE_MS / 60_000)} min — treating it as dead`);
    this.failApply(`The ${this.state} step stopped responding.`);
    return false;
  }

  private describeStep(): string {
    const p = this.progress;
    if (this.state === 'downloading' && p?.totalBytes) {
      return `downloading ${Math.round((p.receivedBytes / p.totalBytes) * 100)}%`;
    }
    return this.state;
  }

  /** Manual check from the UI; throttled so button mashing stays polite. */
  async checkNow(): Promise<UpdateStatusResponse> {
    const now = Date.now();
    if (now - this.lastManualCheck >= MANUAL_THROTTLE_MS) {
      this.lastManualCheck = now;
      await this.check('manual');
    } else {
      log.debug('manual update check ignored — one was requested seconds ago');
    }
    return this.getStatus();
  }

  /**
   * Accept an update and start applying it in the BACKGROUND: this returns as
   * soon as the release is validated, and the UI follows `state`/`progress`.
   * The alternative — answering only when the whole thing is done — meant the
   * request stayed open for the length of the download, which the browser then
   * had to guess about.
   *
   * `targetVersion` defaults to the newest available one; it must be a release
   * newer than the running version (this never downgrades).
   */
  apply(port: number, targetVersion?: string): { version: string; tag: string } {
    const requested = targetVersion ? targetVersion.replace(/^v/, '') : null;
    const install = this.install;
    if (!install) {
      throw this.refuse(requested, 'This instance is not a managed install (source or portable) — updates cannot be applied here.');
    }
    if (this.isBusy()) throw this.refuse(requested, `An update is already in progress (${this.describeStep()}).`);

    const candidates = this.newerReleases();
    const chosen = requested ? candidates.find((r) => r.info.version === requested) : candidates[0];
    if (!chosen) {
      throw this.refuse(
        requested,
        requested ? `Version ${requested} is not among the available updates.` : 'No update available.',
      );
    }
    const assets = chosen.assets;
    if (!assets) throw this.refuse(requested, `Release ${chosen.info.tag} has no installable zip + checksums.txt.`);

    this.applying = { version: chosen.info.version, tag: chosen.info.tag, startedMs: Date.now() };
    this.progress = null;
    this.lastApplyError = null;
    this.lastApplyErrorAt = null;
    this.setState('downloading');
    log.info(`apply accepted: ${APP_VERSION} -> ${chosen.info.version}`, {
      requested: requested ?? 'newest available',
      tag: chosen.info.tag,
      zip: assets.zipName,
      sizeBytes: chosen.info.sizeBytes,
      zipUrl: assets.zipUrl,
      checksumsUrl: assets.checksumsUrl,
      installRoot: install.root,
      runningFrom: install.versionDir,
      port,
    });
    void this.runApply(install, chosen.info, assets, port);
    return { version: chosen.info.version, tag: chosen.info.tag };
  }

  /** Refusals are logged too: "nothing happened when I clicked" is a symptom. */
  private refuse(requested: string | null, why: string): Error {
    log.warn(`apply refused (target: ${requested ?? 'newest available'}): ${why}`);
    return new Error(why);
  }

  private failApply(message: string): void {
    this.lastApplyError = message;
    this.lastApplyErrorAt = new Date().toISOString();
    this.applying = null;
    this.progress = null;
    this.setState('idle');
  }

  /**
   * Download, verify and stage the release, then hand over to
   * update-helper.ps1 (which swaps the `current` junction and restarts the
   * scheduled task) and exit.
   */
  private async runApply(install: InstallInfo, release: UpdateRelease, assets: ReleaseAssets, port: number): Promise<void> {
    const t0 = Date.now();
    // One folder per release: a half-finished download survives a failed
    // attempt and the next one resumes it instead of starting over.
    const tmpDir = path.join(os.tmpdir(), 'claude-history-update', release.tag);
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const zipPath = path.join(tmpDir, assets.zipName);
      log.debug(`staging area: ${tmpDir}`);

      // 1. Download (resumable, retried).
      await this.download(assets.zipUrl, zipPath, release.sizeBytes);

      // 2. Verify against the release's checksums.txt.
      this.setState('verifying');
      const sumsRes = await fetch(assets.checksumsUrl, {
        headers: { 'user-agent': 'claude-history-updater' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!sumsRes.ok) throw new Error(`checksums.txt download failed: HTTP ${sumsRes.status}`);
      const sums = await sumsRes.text();
      const line = sums.split('\n').find((l) => l.trim().endsWith(assets.zipName));
      const expected = line?.trim().split(/\s+/)[0]?.toLowerCase();
      if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
        throw new Error(`checksums.txt has no entry for ${assets.zipName}`);
      }
      const actual = await sha256File(zipPath);
      if (actual !== expected) {
        // A file that hashes wrong must never be resumed into: drop it so the
        // next attempt starts clean instead of appending to damaged bytes.
        fs.rmSync(zipPath, { force: true });
        throw new Error(`SHA-256 mismatch (the file was deleted): expected ${expected}, got ${actual}`);
      }
      log.info(`sha256 verified: ${expected}`);

      // 3. Extract only versions/v<new> into the install root.
      this.setState('staging');
      const stagedDir = path.join(install.root, 'versions', release.tag);
      fs.rmSync(stagedDir, { recursive: true, force: true }); // leftovers from a failed attempt
      const tarExe = resolveTar();
      const tarArgs = ['-xf', zipPath, '-C', install.root, `versions/${release.tag}`];
      log.debug(`extracting: "${tarExe}" ${tarArgs.join(' ')}`);
      const tar = spawnSync(tarExe, tarArgs, { windowsHide: true, timeout: 120_000, encoding: 'utf8' });
      if (tar.error) throw new Error(`could not run ${tarExe}: ${tar.error.message}`);
      if (tar.status !== 0) {
        throw new Error(`${path.basename(tarExe)} exited ${tar.status ?? 'on a signal'}: ${tar.stderr?.trim() || '(no stderr)'}`);
      }
      const serverCjs = path.join(stagedDir, 'server.cjs');
      if (!fs.existsSync(serverCjs)) throw new Error(`the extracted version is incomplete (${serverCjs} is missing)`);
      log.info(`staged ${release.tag} into ${stagedDir}`, {
        entries: fs.readdirSync(stagedDir),
        serverBytes: fileSize(serverCjs),
      });

      // 4. Hand over to the helper (run from %TEMP%, never from a folder being
      // swapped) and exit so it can do the junction swap + restart.
      //
      // The helper CANNOT simply be spawned from here: this server runs inside
      // the `claude-history` scheduled task, and Task Scheduler kills that
      // task's entire process tree when the task ends — taking any child of
      // ours with it, detached or not. So run the helper's -Register mode
      // synchronously; the Task Scheduler service then starts the real helper
      // outside our tree.
      this.setState('restarting');
      const helperSrc = path.join(stagedDir, 'update-helper.ps1');
      if (!fs.existsSync(helperSrc)) throw new Error('the extracted version has no update-helper.ps1');
      const helperPath = path.join(tmpDir, 'update-helper.ps1');
      fs.copyFileSync(helperSrc, helperPath);
      const psArgs = [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helperPath, '-Register',
        '-Root', install.root, '-NewVersion', release.tag, '-ServerPid', String(process.pid), '-Port', String(port),
      ];
      log.info('registering the one-shot update helper task', { helper: helperPath, args: psArgs });
      const reg = spawnSync('powershell.exe', psArgs, { windowsHide: true, timeout: 60_000, encoding: 'utf8' });
      const regOut = [reg.stdout, reg.stderr].map((s) => (s ?? '').trim()).filter(Boolean).join(' | ');
      if (reg.error) throw new Error(`could not run powershell.exe: ${reg.error.message}`);
      if (reg.status !== 0) throw new Error(`powershell exited ${reg.status ?? 'on a signal'}: ${regOut || '(no output)'}`);
      if (regOut) log.debug(`update-helper -Register said: ${regOut}`);

      const updateLog = path.join(install.root, 'update.log');
      log.info(
        `handing over to update-helper after ${((Date.now() - t0) / 1000).toFixed(1)}s — this server exits now; ` +
          `the helper continues in ${updateLog} and those lines are imported here on the next start`,
      );
      setTimeout(() => process.exit(0), 500).unref();
    } catch (err) {
      const step = this.state;
      const detail = describeFetchError(err);
      log.error(
        `update to ${release.version} FAILED during "${step}" after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${detail}`,
        err instanceof Error ? err : { value: String(err) },
      );
      this.failApply(`${STEP_FAILURE[step] ?? `The ${step} step failed`}: ${detail}`);
    }
  }

  /**
   * Fetch `url` into `dest`, resuming across attempts. Bytes land in a
   * `.part` file so a stalled or reset connection costs only what it had not
   * transferred yet, which is the difference between a hiccup and a lost
   * update on a 35 MB asset.
   */
  private async download(url: string, dest: string, expectedBytes: number | null): Promise<void> {
    const partPath = `${dest}.part`;
    const startedMs = Date.now();
    let lastError = 'download did not run';

    // A complete zip from an attempt that failed later (extraction, helper)
    // is worth keeping: the checksum below still has to pass, so reusing it
    // risks nothing and turns a retry into an instant one.
    if (expectedBytes !== null && fileSize(dest) === expectedBytes) {
      log.info(`reusing the zip already downloaded at ${dest} (${fmtBytes(expectedBytes)})`);
      return;
    }

    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
      let offset = fileSize(partPath);
      if (expectedBytes !== null && offset > expectedBytes) {
        log.warn(`leftover ${fmtBytes(offset)} is bigger than the release (${fmtBytes(expectedBytes)}) — discarding it`);
        fs.rmSync(partPath, { force: true });
        offset = 0;
      }
      if (offset > 0) log.info(`resuming the download at ${fmtBytes(offset)} (attempt ${attempt}/${DOWNLOAD_ATTEMPTS})`);

      try {
        if (expectedBytes === null || offset < expectedBytes) {
          await this.downloadAttempt(url, partPath, offset, expectedBytes, attempt);
        }
        const size = fileSize(partPath);
        if (expectedBytes !== null && size !== expectedBytes) {
          throw new Error(`got ${size} bytes, the release declares ${expectedBytes}`);
        }
        fs.rmSync(dest, { force: true });
        fs.renameSync(partPath, dest);
        const secs = (Date.now() - startedMs) / 1000;
        log.info(
          `downloaded ${fmtBytes(size)} in ${secs.toFixed(1)}s (${fmtBytes(Math.round(size / Math.max(secs, 0.001)))}/s` +
            `${attempt > 1 ? `, ${attempt} attempts` : ''}) -> ${dest}`,
        );
        return;
      } catch (err) {
        lastError = describeFetchError(err);
        const got = fileSize(partPath);
        log.warn(
          `download attempt ${attempt}/${DOWNLOAD_ATTEMPTS} failed with ${fmtBytes(got)} on disk: ${lastError}`,
          err instanceof Error ? err : { value: String(err) },
        );
        if (attempt === DOWNLOAD_ATTEMPTS) break;
        const wait = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 20_000;
        log.info(`retrying in ${Math.round(wait / 1000)}s, resuming from ${fmtBytes(got)}`);
        await sleep(wait);
      }
    }
    throw new Error(`${DOWNLOAD_ATTEMPTS} attempts failed, last one: ${lastError}`);
  }

  /** One transfer, aborted if it goes quiet for DOWNLOAD_STALL_MS. */
  private async downloadAttempt(
    url: string,
    partPath: string,
    offset: number,
    expectedBytes: number | null,
    attempt: number,
  ): Promise<void> {
    const controller = new AbortController();
    let stalled = false;
    let timer: NodeJS.Timeout | null = null;
    const armStall = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, DOWNLOAD_STALL_MS);
    };

    let file: fs.WriteStream | null = null;
    armStall();
    this.lastEmitMs = Date.now();
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'claude-history-updater',
          ...(offset > 0 ? { range: `bytes=${offset}-` } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      if (!res.body) throw new Error('the response carried no body');

      let received = offset;
      let append = offset > 0;
      if (offset > 0 && res.status !== 206) {
        // Range ignored: the body starts at zero, so appending would corrupt it.
        log.warn(`the server ignored the resume request (HTTP ${res.status}) — restarting the download from zero`);
        append = false;
        received = 0;
      }
      const declared = Number(res.headers.get('content-length'));
      const total = expectedBytes ?? (Number.isFinite(declared) && declared > 0 ? received + declared : null);
      log.debug(
        `attempt ${attempt}: HTTP ${res.status}, ${append ? `appending from ${fmtBytes(received)}` : 'from the start'}` +
          `${total ? `, ${fmtBytes(total)} expected` : ''}`,
      );

      file = fs.createWriteStream(partPath, { flags: append ? 'a' : 'w' });
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armStall();
        received += value.byteLength;
        if (!file.write(value)) await once(file, 'drain');
        this.reportProgress(received, total, attempt);
      }
      const handle = file;
      file = null;
      await new Promise<void>((resolve, reject) => handle.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (err) {
      if (stalled) throw new Error(`no data for ${DOWNLOAD_STALL_MS / 1000}s — the connection went quiet`);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      // On the error path the stream is still open: destroying it releases the
      // handle and keeps whatever was written, which is what resuming needs.
      file?.destroy();
    }
  }

  private reportProgress(received: number, total: number | null, attempt: number): void {
    const now = Date.now();
    this.lastActivity = now;
    if (now - this.lastEmitMs < PROGRESS_EMIT_MS) return;
    const elapsed = (now - this.lastEmitMs) / 1000;
    const previous = this.progress;
    const speed =
      previous && previous.attempt === attempt && elapsed > 0
        ? Math.max(0, Math.round((received - previous.receivedBytes) / elapsed))
        : null;
    this.lastEmitMs = now;
    this.progress = { receivedBytes: received, totalBytes: total, attempt, bytesPerSecond: speed };
    this.emit();
    if (now - this.lastProgressLogMs >= PROGRESS_LOG_MS) {
      this.lastProgressLogMs = now;
      log.debug(
        `downloading ${fmtBytes(received)}${total ? ` of ${fmtBytes(total)} (${Math.round((received / total) * 100)}%)` : ''}` +
          `${speed !== null ? ` at ${fmtBytes(speed)}/s` : ''}`,
      );
    }
  }

  private async check(reason: 'scheduled' | 'manual'): Promise<void> {
    if (this.isBusy()) {
      log.debug(`${reason} update check skipped — "${this.state}" is in progress`);
      return;
    }
    const previousNewest = this.releases[0]?.info.version ?? null;
    this.setState('checking');
    try {
      // The full list (not /releases/latest) so the UI can show every version
      // between the installed one and the newest, with all their notes.
      const res = await fetch(`https://api.github.com/repos/${this.repo}/releases?per_page=50`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'claude-history-updater',
          ...(this.etag ? { 'if-none-match': this.etag } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 304) {
        log.debug(`${reason} update check: 304, the release list is unchanged`);
      } else {
        if (!res.ok) throw new Error(`GitHub API answered HTTP ${res.status}`);
        this.etag = res.headers.get('etag');
        const list = (await res.json()) as Array<{
          tag_name?: string;
          body?: string | null;
          published_at?: string | null;
          draft?: boolean;
          prerelease?: boolean;
          assets?: Array<{ name: string; size: number; browser_download_url: string }>;
        }>;
        if (!Array.isArray(list)) throw new Error('Unexpected releases response');
        this.releases = list
          .filter((rel) => rel.tag_name && !rel.draft && !rel.prerelease && /^v?\d+\.\d+\.\d+/.test(rel.tag_name))
          .map((rel) => {
            const tag = rel.tag_name as string;
            const zip = rel.assets?.find((a) => /^claude-history-.+-win-x64\.zip$/.test(a.name)) ?? null;
            const checksums = rel.assets?.find((a) => a.name === 'checksums.txt') ?? null;
            const assets =
              zip && checksums
                ? { zipUrl: zip.browser_download_url, zipName: zip.name, checksumsUrl: checksums.browser_download_url }
                : null;
            return {
              info: {
                version: tag.replace(/^v/, ''),
                tag,
                notes: rel.body ?? '',
                publishedAt: rel.published_at ?? null,
                sizeBytes: zip?.size ?? null,
                installable: assets !== null,
              },
              assets,
            };
          })
          .sort((a, b) => compareVersions(b.info.version, a.info.version));
        log.debug(`${reason} update check: ${this.releases.length} published releases`);
      }
      const newest = this.releases[0]?.info.version ?? null;
      if (newest && newest !== previousNewest) {
        const newer = this.newerReleases().length;
        log.info(
          `newest published release is ${newest} (running ${APP_VERSION})` +
            `${newer > 0 ? ` — ${newer} update${newer === 1 ? '' : 's'} available` : ' — up to date'}`,
        );
      }
      this.lastError = null;
    } catch (err) {
      // Stay silent for the user: keep whatever we knew, retry on the next
      // cycle. The log is where a run of failed checks becomes visible.
      this.lastError = describeFetchError(err);
      log.warn(`${reason} update check failed: ${this.lastError}`);
    } finally {
      this.lastCheckAt = new Date().toISOString();
      this.state = 'idle';
      this.lastActivity = Date.now();
      this.emit();
    }
  }

  private emit(): void {
    this.events.emit('update-status');
  }
}
