import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { RELEASE_PORT } from '../config.ts';
import { elevate, psLiteral } from './elevate.ts';

const run = promisify(execFile);

/** `schtasks` answers in well under a second; this is for a machine that is struggling. */
const SCHTASKS_TIMEOUT_MS = 15_000;

/**
 * The task this instance registers, named after its port like the firewall rule
 * (`ruleNameFor`) and for the same reason: the release, a dev instance, a
 * preview and the Git fixture each start THEIR OWN host, with their own data
 * folder in its arguments, and two instances sharing one name would start each
 * other's.
 */
export function taskNameFor(port: number): string {
  return port === RELEASE_PORT ? 'claude-history-elevated' : `claude-history-elevated (port ${String(port)})`;
}

/** What the task runs: wscript, the hiding script, and the host behind it. */
export interface HostLaunch {
  /** `run-hidden.vbs`. */
  vbs: string;
  program: string;
  args: string[];
}

/**
 * The command line the task must hold for THIS copy of the app, or why there is
 * none.
 *
 * Three shapes, and the difference is where the files live:
 *
 * - **An installed release goes through `<root>\current\`**, never the version
 *   folder it happens to be running from. The task is registered once, behind a
 *   UAC prompt, and an update moves `current` without asking anybody — so a task
 *   aimed at `versions\v1.2.3` would quietly start the old host after every
 *   update, and then nothing at all once that folder was cleaned up.
 * - **A portable run of a release** (no install root) has only the folder it is
 *   in, and a task pointing there is right until the folder moves.
 * - **The source tree** runs the host's TypeScript through `tsx`'s loader on the
 *   same `node.exe` the dev server is using.
 *
 * `bundled` is decided from this file's own name: the release build defines
 * `import.meta.url` as the bundle's, which ends in `.cjs`.
 */
export function hostLaunch(dataDir: string, installRoot: string | null): HostLaunch | { error: string } {
  const self = fileURLToPath(import.meta.url);
  const tail = ['--data-dir', dataDir];
  if (self.endsWith('.cjs')) {
    const base = installRoot ? path.join(installRoot, 'current') : path.dirname(self);
    const node = path.join(base, 'node', 'node.exe');
    const launch = {
      vbs: path.join(base, 'run-hidden.vbs'),
      program: fs.existsSync(node) ? node : process.execPath,
      args: [path.join(base, 'elevated-host.cjs'), ...tail],
    };
    for (const file of [launch.vbs, launch.args[0]]) {
      if (!fs.existsSync(file)) return { error: `This copy of the app has no ${path.basename(file)} — it predates elevated terminals.` };
    }
    return launch;
  }
  const serverDir = path.resolve(path.dirname(self), '..', '..');
  let loader: string;
  try {
    loader = createRequire(import.meta.url).resolve('tsx');
  } catch {
    return { error: 'tsx could not be found — run "pnpm install".' };
  }
  return {
    vbs: path.resolve(serverDir, '..', 'installer', 'run-hidden.vbs'),
    program: process.execPath,
    args: ['--import', pathToFileURL(loader).href, path.join(serverDir, 'src', 'elevated', 'host.ts'), ...tail],
  };
}

/** The `-Argument` string of the task's action: every piece quoted, as `run-hidden.vbs` expects. */
export function taskArguments(launch: HostLaunch): string {
  return ['//B', ...[launch.vbs, launch.program, ...launch.args].map((a) => `"${a}"`)].join(' ');
}

export type TaskReading =
  | { state: 'absent' }
  | { state: 'present'; command: string; args: string; highest: boolean }
  | { state: 'unreadable'; error: string };

function xmlText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return null;
  return m[1]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Reads the task without elevation.
 *
 * `/xml` because everything else `schtasks /query` prints is localised, and
 * the XML is not. A missing task is a non-zero exit — "ERROR: The system
 * cannot find the file specified." in whatever language the machine speaks —
 * and so is a task this user may not read. The two are told apart by whether
 * ANY task can be read: a query of the root folder succeeds for any user, so
 * a failure there means `schtasks` itself is the problem.
 */
export async function readTask(name: string): Promise<TaskReading> {
  try {
    const { stdout } = await run('schtasks', ['/query', '/tn', name, '/xml'], {
      timeout: SCHTASKS_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
    });
    return {
      state: 'present',
      command: xmlText(stdout, 'Command') ?? '',
      args: xmlText(stdout, 'Arguments') ?? '',
      highest: xmlText(stdout, 'RunLevel') === 'HighestAvailable',
    };
  } catch (err) {
    try {
      await run('schtasks', ['/query', '/fo', 'csv', '/nh'], { timeout: SCHTASKS_TIMEOUT_MS, windowsHide: true });
      return { state: 'absent' };
    } catch {
      return { state: 'unreadable', error: commandError(err) };
    }
  }
}

/**
 * Registers the task, behind the one UAC prompt this feature ever shows.
 *
 * **`Interactive`, not S4U or a stored password.** The host runs in the user's
 * own logon session, so the elevated CLI has what the ordinary one has —
 * Credential Manager, DPAPI, the network drives — and a `git push` from it works
 * for the same reason it works from the composer. S4U would have needed no
 * window station at all and given the CLI no network credentials either.
 *
 * The user is named here rather than read inside the elevated script: with a
 * split token it is the same account either way, but approving the prompt with
 * ANOTHER administrator's credentials would otherwise register the task for
 * that account — a host writing to somebody else's `~/.claude`.
 *
 * `Parallel`, because a host left behind by a server that died is still on its
 * way out when the next server starts one, and `IgnoreNew` would turn that into
 * a host that never arrives. No time limit: the default of three days would
 * kill a terminal somebody left open over a weekend.
 */
export async function registerTask(name: string, launch: HostLaunch): Promise<void> {
  const domain = process.env.USERDOMAIN;
  const user = domain ? `${domain}\\${os.userInfo().username}` : os.userInfo().username;
  await elevate(
    [
      "$ErrorActionPreference = 'Stop'",
      `$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${psLiteral(taskArguments(launch))}`,
      `$principal = New-ScheduledTaskPrincipal -UserId ${psLiteral(user)} -LogonType Interactive -RunLevel Highest`,
      '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel',
      `Register-ScheduledTask -TaskName ${psLiteral(name)} -Action $action -Principal $principal -Settings $settings -Description ${psLiteral('Starts the elevated host behind claude-history\'s administrator terminals. Remove it from claude-history\'s Settings.')} -Force | Out-Null`,
    ].join('\n'),
  );
}

/**
 * Removes the task — unelevated first, which Windows may well allow for a task
 * whose principal is this user, and through UAC only if it does not.
 */
export async function removeTask(name: string): Promise<void> {
  try {
    await run('schtasks', ['/delete', '/tn', name, '/f'], { timeout: SCHTASKS_TIMEOUT_MS, windowsHide: true });
    return;
  } catch {
    // Access denied, most likely: the task was registered from an elevated process.
  }
  await elevate(`Unregister-ScheduledTask -TaskName ${psLiteral(name)} -Confirm:$false -ErrorAction Stop`);
}

/**
 * Starts the task. No elevation and no prompt — that is the entire reason the
 * task exists — and therefore no reason this cannot be asked for from another
 * machine.
 */
export async function runTask(name: string): Promise<void> {
  try {
    await run('schtasks', ['/run', '/tn', name], { timeout: SCHTASKS_TIMEOUT_MS, windowsHide: true });
  } catch (err) {
    throw new Error(`Windows would not start the task "${name}": ${commandError(err)}`);
  }
}

/** The useful line of a failed `schtasks`: its stderr, never the command line `execFile` puts in `message`. */
function commandError(err: unknown): string {
  const stderr = (err as { stderr?: unknown }).stderr;
  const text = typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '';
  return text.trim().replace(/^ERROR:\s*/i, '') || (err instanceof Error ? err.message : String(err));
}
