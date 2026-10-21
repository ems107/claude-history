import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** A UAC prompt is a person reading a dialog, not a command running. */
const ELEVATED_TIMEOUT_MS = 120_000;

/** Single-quoted PowerShell literal: the only escape inside one is a doubled quote. */
export function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Run PowerShell without a single quoting problem.
 *
 * `-EncodedCommand` takes base64 of UTF-16LE, so the script can contain quotes,
 * parentheses and anything else without meeting either Windows' argv escaping
 * or PowerShell's own parser on the way in. Worth it here because the scripts
 * below nest one command inside another.
 *
 * **No `-ExecutionPolicy Bypass`, deliberately.** It is what everything else in
 * this repo passes, and everything else in this repo runs a `.ps1` FILE, where
 * the policy genuinely decides. Execution policy has never governed `-Command`
 * or `-EncodedCommand`, so here it bought nothing — while
 * `-ExecutionPolicy Bypass -EncodedCommand` together are the command line
 * Defender's ML scores as an attack, and it blocks the launch outright rather
 * than reading the base64 (see AI_REMOTE_ACCESS.md). Verified before removing it,
 * because "redundant" is a claim and module auto-loading was the way it could
 * have been wrong: forced to `-ExecutionPolicy Restricted` and again to
 * `AllSigned`, this same encoded payload still reached the COM API,
 * `Get-NetConnectionProfile`, `Get-NetFirewallRule` and `New-NetFirewallRule`.
 * Nothing here loads a script file, so nothing here needs the flag.
 */
export function powershell(script: string, timeout: number): Promise<{ stdout: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
    timeout,
    windowsHide: true,
    encoding: 'utf8',
  });
}

/**
 * Run a script with administrator rights, behind a UAC prompt.
 *
 * Windows will not let a per-user process touch the firewall or register a task
 * that runs elevated, and this app is installed per user with no elevation at
 * all (`installer/launch.vbs`). So the work is handed to an elevated child, and
 * the UAC dialog that authorises it appears on the machine's own desktop —
 * which is exactly why every endpoint that calls this is local-only: over the
 * network it would pop a dialog nobody is there to accept.
 *
 * The inner argument list carries no `-ExecutionPolicy Bypass` — see
 * `powershell` above for why it never did anything here, and for the antivirus
 * that treats it as half a signature. This is the launch that gets blocked when
 * it fires, and the throw it produces is `Access is denied.`, which reads
 * exactly like a cancelled UAC prompt.
 *
 * Two things this got wrong the first time, both worth keeping written down:
 *
 * - **One statement per line, and no backticks.** A backtick continues a
 *   STATEMENT; putting one after `$ErrorActionPreference = 'Stop'` glued the
 *   next statement onto it and PowerShell answered `Unexpected token '$p'`
 *   before ever reaching the UAC prompt.
 * - **The outcome is reported on stdout, not through the exit code.** A failing
 *   `powershell.exe` makes `execFile` reject with an Error whose `message` is
 *   the entire command line — a 500-character base64 blob — and whose `stderr`
 *   is PowerShell's CLIXML. Both went straight into the panel. Catching inside
 *   the script means what reaches the user is "The operation was canceled by
 *   the user", which is what actually happened.
 */
export async function elevate(innerScript: string): Promise<void> {
  const inner = Buffer.from(innerScript, 'utf16le').toString('base64');
  const outer = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-EncodedCommand','${inner}')`,
    "  if ($p.ExitCode -eq 0) { 'ok' } else { 'failed: the elevated command exited with ' + $p.ExitCode }",
    '} catch {',
    "  'failed: ' + $_.Exception.Message",
    '}',
  ].join('\n');
  const { stdout } = await powershell(outer, ELEVATED_TIMEOUT_MS);
  const answer = stdout.trim();
  if (answer === 'ok') return;
  throw new Error(answer.replace(/^failed:\s*/, '') || 'PowerShell said nothing at all.');
}
