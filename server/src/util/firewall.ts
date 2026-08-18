import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { BindReason, BlockingRule } from '@claude-history/shared';
import { RELEASE_PORT } from '../config.ts';
import { createLogger } from '../core/logger.ts';

const log = createLogger('firewall');
const run = promisify(execFile);

/** A UAC prompt is a person reading a dialog, not a command running. */
const ELEVATED_TIMEOUT_MS = 120_000;
/** Reading the rules for the panel: no elevation, but PowerShell is PowerShell. */
const READ_TIMEOUT_MS = 20_000;
/**
 * Reading them at startup, which is different: this one delays `listen()`, so
 * it gets a shorter leash. Loading the NetSecurity module alone costs ~1.5 s.
 */
const PROBE_TIMEOUT_MS = 30_000;
/**
 * How long the probe waits for Windows to classify a network before giving up.
 *
 * The scheduled task runs at logon and Wi-Fi may still be associating, so
 * `Get-NetConnectionProfile` can legitimately answer "no networks" for a few
 * seconds after boot. Without this wait that answer decides the whole bind and
 * remote access is dead until someone restarts the server by hand — every
 * morning. Inside the same PowerShell process because the module load, not the
 * query, is what costs.
 */
const NETWORK_WAIT_SECONDS = 10;

/**
 * The rule this app manages, named after the port it opens.
 *
 * The release keeps the bare name it has always had, so a rule created by an
 * older version keeps working. Anything else — a `preview.ps1` run on 7435 —
 * gets its own, because with the bind gated on this rule two instances sharing
 * one name would read each other's answer and open the wrong port.
 */
export function ruleNameFor(port: number): string {
  return port === RELEASE_PORT ? 'claude-history' : `claude-history (port ${String(port)})`;
}

/** Single-quoted PowerShell literal: the only escape inside one is a doubled quote. */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Run PowerShell without a single quoting problem.
 *
 * `-EncodedCommand` takes base64 of UTF-16LE, so the script can contain quotes,
 * parentheses and anything else without meeting either Windows' argv escaping
 * or PowerShell's own parser on the way in. Worth it here because the scripts
 * below nest one command inside another.
 */
export function powershell(script: string, timeout: number): Promise<{ stdout: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    timeout,
    windowsHide: true,
    encoding: 'utf8',
  });
}

/**
 * Ask for a change to the firewall, with administrator rights.
 *
 * Windows will not let a per-user process touch the firewall, and this app is
 * installed per user with no elevation at all (`installer/launch.vbs`). So the
 * work is handed to an elevated child, and the UAC dialog that authorises it
 * appears on the machine's own desktop — which is exactly why these endpoints
 * are local-only: over the network it would pop a dialog nobody is there to
 * accept.
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
    `  $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}')`,
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

/**
 * This machine's own IPv4 addresses, so the panel can print the URL to type on
 * the other computer instead of leaving it to be hunted down with `ipconfig`.
 * Loopback is left out — it is the one address that cannot be the answer here.
 */
export function localAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

/** One inbound rule carrying our name, flattened to what the decision needs. */
export interface FirewallRuleInfo {
  displayName: string;
  enabled: boolean;
  /** `Allow` or `Block`. */
  action: string;
  /** `Any`, or some of `Domain` / `Private` / `Public`. */
  profiles: string[];
  /** `Any`, `TCP`, `UDP`, or a protocol number. */
  protocols: string[];
  /** `Any`, single ports, or `from-to` ranges. */
  localPorts: string[];
  /**
   * Empty means "every program", which is what a port rule looks like.
   * Lower-cased, and Windows' own word for it (`Any`) is dropped on the way in
   * so that emptiness is the only spelling of it here.
   */
  programs: string[];
}

/** What the firewall says right now, read without elevation. */
export interface FirewallProbe {
  /** Inbound rules that carry our name, whatever they turned out to say. */
  rules: FirewallRuleInfo[];
  /** `NetworkCategory` of every connected network: Public, Private, DomainAuthenticated. */
  activeProfiles: string[];
  /** Windows would raise its dialog for an unruled listen rather than block in silence. */
  notifyOnListen: boolean;
  /** Every active profile allows unsolicited inbound traffic by policy. */
  defaultInboundAllow: boolean;
  error: string | null;
}

const UNREADABLE: Omit<FirewallProbe, 'error'> = {
  rules: [],
  activeProfiles: [],
  // The safe assumption on both counts: Windows asks, and nothing is allowed
  // that has not been allowed on purpose.
  notifyOnListen: true,
  defaultInboundAllow: false,
};

interface RawProfile {
  name?: string;
  notify?: boolean;
  inbound?: string;
}

interface RawRule {
  displayName?: string;
  direction?: string;
  enabled?: string;
  action?: string;
  profile?: string;
  protocols?: (string | number)[] | string | number;
  localPorts?: (string | number)[] | string | number;
  programs?: string[] | string;
}

function asArray<T>(value: T[] | T | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** `Domain, Private` is one string in a rule and two profiles in fact. */
function splitProfiles(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read the state the bind decision is made from.
 *
 * `waitForNetwork` is for the startup path only: see NETWORK_WAIT_SECONDS. The
 * panel passes false, because by the time anyone opens Settings the answer is
 * whatever it is and a spinner that waits ten seconds to say "no networks" is
 * not an improvement.
 *
 * Note the `-DisplayName` query cannot also take `-Direction`: PowerShell
 * answers "Parameter set cannot be resolved" and the whole probe fails, so the
 * direction is filtered afterwards.
 */
export async function probeFirewall(port: number, waitForNetwork: boolean): Promise<FirewallProbe> {
  if (process.platform !== 'win32') {
    return { ...UNREADABLE, error: 'Not Windows: there is no Windows Firewall to read.' };
  }
  const script = [
    `$name = ${psLiteral(ruleNameFor(port))}`,
    `$wait = ${waitForNetwork ? String(NETWORK_WAIT_SECONDS) : '0'}`,
    '$nets = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)',
    'for ($i = 0; $i -lt $wait -and $nets.Count -eq 0; $i++) {',
    '  Start-Sleep -Seconds 1',
    '  $nets = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)',
    '}',
    '$profiles = @($nets | ForEach-Object { $_.NetworkCategory.ToString() })',
    '$fw = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object {',
    '  @{ name = $_.Name.ToString(); notify = [bool]$_.NotifyOnListen; inbound = $_.DefaultInboundAction.ToString() }',
    '})',
    '$rules = @()',
    'foreach ($r in @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {',
    '  $pf = $r | Get-NetFirewallPortFilter',
    '  $af = $r | Get-NetFirewallApplicationFilter',
    '  $rules += @{',
    '    displayName = $r.DisplayName',
    '    direction = $r.Direction.ToString()',
    '    enabled = $r.Enabled.ToString()',
    '    action = $r.Action.ToString()',
    '    profile = $r.Profile.ToString()',
    '    protocols = @($pf | ForEach-Object { $_.Protocol.ToString() })',
    '    localPorts = @($pf | ForEach-Object { $_.LocalPort })',
    '    programs = @($af | ForEach-Object { $_.Program })',
    '  }',
    '}',
    '@{ profiles = $profiles; fwProfiles = $fw; rules = $rules } | ConvertTo-Json -Compress -Depth 6',
  ].join('\n');

  let stdout: string;
  try {
    ({ stdout } = await powershell(script, PROBE_TIMEOUT_MS));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`could not read the firewall: ${message}`);
    return { ...UNREADABLE, error: message };
  }

  try {
    const parsed = JSON.parse(stdout.trim()) as {
      profiles?: string[] | string;
      fwProfiles?: RawProfile[] | RawProfile;
      rules?: RawRule[] | RawRule;
    };
    const activeProfiles = asArray(parsed.profiles).filter(Boolean);
    const fwProfiles = asArray(parsed.fwProfiles);
    // Only the profiles this machine is actually on can decide anything: a
    // Public policy is irrelevant to a laptop sitting on a private network.
    const relevant = fwProfiles.filter((p) => activeProfiles.some((a) => matchesProfile(p.name ?? '', a)));
    const rules = asArray(parsed.rules)
      .filter((r) => (r.direction ?? '').toLowerCase() === 'inbound')
      .map(
        (r): FirewallRuleInfo => ({
          displayName: r.displayName ?? '',
          enabled: (r.enabled ?? '').toLowerCase() === 'true',
          action: r.action ?? '',
          profiles: splitProfiles(r.profile),
          protocols: asArray(r.protocols).map((p) => String(p)),
          localPorts: asArray(r.localPorts).map((p) => String(p)),
          // `Get-NetFirewallApplicationFilter` says `Any` for a rule that names
          // no program — it does not say nothing. Reading that as a program was
          // enough to make our own port rule look like somebody else's node.exe
          // and refuse the bind it had just been granted.
          programs: asArray(r.programs)
            .filter(Boolean)
            .map((p) => p.toLowerCase())
            .filter((p) => p !== 'any'),
        }),
      );
    return {
      rules,
      activeProfiles,
      notifyOnListen: relevant.length > 0 ? relevant.some((p) => p.notify === true) : true,
      defaultInboundAllow:
        relevant.length > 0 && relevant.every((p) => (p.inbound ?? '').toLowerCase() === 'allow'),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`the firewall answered something unreadable: ${message}`, { stdout: stdout.slice(0, 500) });
    return { ...UNREADABLE, error: `The firewall answered something this could not read: ${message}` };
  }
}

/** `DomainAuthenticated` is what a connection calls the profile a rule calls `Domain`. */
function matchesProfile(ruleProfile: string, networkCategory: string): boolean {
  const rule = ruleProfile.toLowerCase();
  const net = networkCategory.toLowerCase();
  if (rule === 'any') return true;
  if (rule === 'domain') return net === 'domainauthenticated' || net === 'domain';
  return rule === net;
}

function portCovered(localPorts: string[], port: number): boolean {
  return localPorts.some((entry) => {
    const value = entry.trim();
    if (value.toLowerCase() === 'any') return true;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(value);
    if (range) return port >= Number(range[1]) && port <= Number(range[2]);
    return Number(value) === port;
  });
}

/** TCP, `Any`, or 6 — the protocol number Windows sometimes stores instead of the name. */
function tcpCovered(protocols: string[]): boolean {
  return protocols.some((p) => {
    const value = p.trim().toLowerCase();
    return value === 'any' || value === 'tcp' || value === '6';
  });
}

/** What the evaluation concluded, and enough of the rule to explain it. */
export interface FirewallVerdict {
  /**
   * Inbound traffic to our port is already decided in our favour, so opening a
   * listening socket cannot raise the dialog.
   */
  permitted: boolean;
  reason: BindReason;
  /** The rule the verdict is about, when there was one. */
  rule: FirewallRuleInfo | null;
  /** That rule covers this port. Separate from `permitted`: a rule can match the port and fail on the profile. */
  ruleCoversPort: boolean;
}

/**
 * Decide, from a probe, whether listening on every interface is already
 * permitted — the whole question the bind hangs on.
 *
 * Pure on purpose: the startup gate and the Settings panel must never disagree
 * about what the same firewall means, and the only way to be sure of that is
 * for both to call this.
 *
 * `exePath` is the running `node.exe` with every junction resolved. A rule with
 * a program in it is what clicking "Allow" on the dialog leaves behind, and it
 * is nailed to the path of the version that asked — so it stops applying the
 * moment an update moves us into a new `versions\vX.Y.Z` folder, and counting
 * it would mean listening today and being asked again tomorrow.
 */
export function evaluateFirewall(
  probe: FirewallProbe,
  port: number,
  exePath: string,
): FirewallVerdict {
  if (probe.error) return { permitted: false, reason: 'firewall-unreadable', rule: null, ruleCoversPort: false };

  const exe = exePath.toLowerCase();
  let best: FirewallVerdict = { permitted: false, reason: 'no-rule', rule: null, ruleCoversPort: false };
  // The reasons a rule can fail, ordered so the panel names the last obstacle
  // rather than the first — "the port is open but this network is Public" is
  // worth more than "there is a rule".
  const rank: Record<string, number> = {
    'no-rule': 0,
    'rule-other-program': 1,
    'rule-wrong-port': 2,
    'rule-disabled': 3,
    'rule-other-profile': 4,
    allowed: 5,
  };

  for (const rule of probe.rules) {
    if (rule.action.toLowerCase() !== 'allow') continue;
    const covers = tcpCovered(rule.protocols) && portCovered(rule.localPorts, port);
    const forUs = rule.programs.length === 0 || rule.programs.includes(exe);
    const onThisNetwork = rule.profiles.some((p) => probe.activeProfiles.some((a) => matchesProfile(p, a)));
    const reason: BindReason = !forUs
      ? 'rule-other-program'
      : !covers
        ? 'rule-wrong-port'
        : !rule.enabled
          ? 'rule-disabled'
          : !onThisNetwork
            ? 'rule-other-profile'
            : 'allowed';
    if (rank[reason] > rank[best.reason]) {
      best = { permitted: reason === 'allowed', reason, rule, ruleCoversPort: covers && forUs };
    }
  }

  if (best.permitted) return best;
  // A machine whose policy is to allow unsolicited inbound traffic needs no rule
  // from us and would never have shown the dialog in the first place.
  if (probe.defaultInboundAllow) return { ...best, permitted: true, reason: 'default-allow' };
  // No rule, and no network to have one for. Waiting for the network already
  // happened inside the probe, so this is a machine that is genuinely offline.
  if (best.reason === 'no-rule' && probe.activeProfiles.length === 0) {
    return { ...best, reason: 'no-network' };
  }
  return best;
}

/** Create the inbound rule for our port. Elevates: a UAC dialog appears on this desktop. */
export async function createRule(port: number): Promise<void> {
  const name = ruleNameFor(port);
  await elevate(
    `New-NetFirewallRule -DisplayName ${psLiteral(name)} ` +
      `-Description 'Browse claude-history from another machine on this network' ` +
      `-Direction Inbound -Action Allow -Protocol TCP -LocalPort ${String(port)} -Profile Private | Out-Null`,
  );
  log.info(`inbound rule created for port ${String(port)} on the Private profile`);
}

/** Remove it again. */
export async function removeRule(port: number): Promise<void> {
  await elevate(`Remove-NetFirewallRule -DisplayName ${psLiteral(ruleNameFor(port))} -ErrorAction Stop`);
  log.info(`inbound rule for port ${String(port)} removed`);
}

/** A blocking rule, plus the instance name that is the only safe way to delete one. */
export interface BlockingRuleFound extends BlockingRule {
  /** `Name`, not `DisplayName`: Windows generates these and they are unique. */
  id: string;
}

/**
 * Find the rules that block our own `node.exe` — the ones Windows writes when
 * the dialog is answered with Cancel.
 *
 * They are the reason a perfectly good port rule can still let nothing through:
 * an explicit Block beats an Allow, always. And because each one names the
 * `node.exe` of the version that asked, they pile up one pair per update and
 * outlive the folder they point into.
 *
 * `installRoot` is what makes the leftovers findable: the running exe accounts
 * for today's pair, and every older pair lives under the same install root.
 * Without a root (a source or portable run) only the running exe is looked for,
 * which is the fast, targeted query — the full enumeration costs ~1.5 s.
 */
export async function blockingRules(exePath: string, installRoot: string | null): Promise<BlockingRuleFound[]> {
  if (process.platform !== 'win32') return [];
  const script = [
    `$exe = ${psLiteral(exePath)}`,
    `$root = ${installRoot ? psLiteral(installRoot) : '$null'}`,
    '$filters = @()',
    'if ($root) {',
    // One enumeration, because rules for versions that no longer exist can only
    // be found by looking at all of them.
    '  $filters = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object {',
    '    $_.Program -and ($_.Program -eq $exe -or $_.Program.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase))',
    '  })',
    '} else {',
    '  $filters = @(Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue)',
    '}',
    '$out = @()',
    'foreach ($f in $filters) {',
    '  $r = $f | Get-NetFirewallRule -ErrorAction SilentlyContinue',
    '  if (-not $r) { continue }',
    "  if ($r.Direction.ToString() -ne 'Inbound') { continue }",
    "  if ($r.Action.ToString() -ne 'Block') { continue }",
    '  $pf = $r | Get-NetFirewallPortFilter',
    '  $out += @{',
    '    id = $r.Name',
    '    displayName = $r.DisplayName',
    '    program = $f.Program',
    "    protocol = (@($pf | ForEach-Object { $_.Protocol.ToString() }) -join ', ')",
    '  }',
    '}',
    '@{ rules = $out } | ConvertTo-Json -Compress -Depth 5',
  ].join('\n');

  try {
    const { stdout } = await powershell(script, READ_TIMEOUT_MS);
    const parsed = JSON.parse(stdout.trim()) as { rules?: BlockingRuleFound[] | BlockingRuleFound };
    return asArray(parsed.rules).filter((r) => Boolean(r.id));
  } catch (err) {
    // Not fatal for anything: these only ever explain a symptom. The bind never
    // depends on them, so a failure here costs an explanation, not a decision.
    log.warn('could not look for blocking rules', err);
    return [];
  }
}

/**
 * Delete blocking rules, by instance name and one statement each.
 *
 * Never by `DisplayName`: Windows names these after the program ("Node.js
 * JavaScript Runtime"), so a name-based delete would take out every rule any
 * other Node app on this machine ever earned, allow rules included.
 */
export async function removeBlockingRules(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await elevate(
    ["$ErrorActionPreference = 'Stop'", ...ids.map((id) => `Remove-NetFirewallRule -Name ${psLiteral(id)}`)].join('\n'),
  );
  log.info(`${String(ids.length)} blocking rule(s) removed`);
}
