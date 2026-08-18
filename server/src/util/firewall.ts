import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { ActiveConnection, BindReason, BlockingRule } from '@claude-history/shared';
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
 * it gets a shorter leash. Starting PowerShell is now most of the cost — the
 * reads themselves are ~0.3 s for `Get-NetConnectionProfile` and ~0.1 s for the
 * COM enumeration — but the leash stays generous: a slow machine gains nothing
 * from a tighter one, and a timeout here means loopback for the whole run.
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
 * The Windows Firewall COM API, as PowerShell functions — because **the
 * NetSecurity cmdlets cannot READ rules without elevation**, and this app never
 * runs elevated.
 *
 * Measured on a stock workgroup machine, unelevated, under the same
 * `powershell.exe` this module spawns: `Get-NetFirewallRule` and
 * `Get-NetFirewallApplicationFilter` both answer
 * `CimException: Access is denied.` — while the registry hive behind them reads
 * fine and elevated writes through the same module succeed. So it is an
 * elevation requirement on the `root/StandardCimv2` rule classes alone.
 *
 * What that cost, and the reason this comment is long: the denial was swallowed
 * by `-ErrorAction SilentlyContinue`, which made it **indistinguishable from
 * "there is no rule"**. The bind went to loopback on every start, and the panel
 * invited the user to open a port that was already open — six times, leaving six
 * identical rules. A read that cannot fail loudly fails quietly, as an empty
 * answer that looks like an answer.
 *
 * `HNetCfg.FwPolicy2` (`INetFwPolicy2`) reads the same rules unelevated in about
 * a tenth of a second, and — unlike `netsh advfirewall show rule` — is **not
 * localised**, so nothing here parses translated field names. Its one known
 * limit: it sees the local store only, so a rule deployed by group policy would
 * be invisible to it. Ours is always created locally, so that does not bite.
 *
 * These helpers emit the strings the CMDLETS used to emit, deliberately: the
 * mapping below and the pure `evaluateFirewall` never learn that the source
 * changed, and the shapes they were built against stay the contract.
 *
 * One trap worth keeping written down: late-bound COM has **no `get_X()`
 * accessors**. `$fw.get_DefaultInboundAction(2)` throws "does not contain a
 * method named"; the parameterised property is called as
 * `$fw.DefaultInboundAction(2)`.
 */
const COM_HELPERS = [
  'function Get-FwPolicy { New-Object -ComObject HNetCfg.FwPolicy2 }',
  // 6 TCP, 17 UDP, 256 every protocol. ICMP is named only so a block list reads
  // well; anything else stays a number, which `tcpCovered` rightly rejects.
  'function Convert-FwProtocol([int]$p) {',
  "  switch ($p) { 6 { 'TCP' } 17 { 'UDP' } 256 { 'Any' } 1 { 'ICMPv4' } 58 { 'ICMPv6' } default { [string]$p } }",
  '}',
  // 1 Domain, 2 Private, 4 Public, 0x7FFFFFFF all of them. An unknown mask is
  // emitted as a number on purpose: it then matches no profile, and a mask we do
  // not understand must never be the thing that opens the door.
  'function Convert-FwProfiles([int]$m) {',
  "  if ($m -eq 2147483647) { return 'Any' }",
  '  $n = @()',
  "  if ($m -band 1) { $n += 'Domain' }",
  "  if ($m -band 2) { $n += 'Private' }",
  "  if ($m -band 4) { $n += 'Public' }",
  '  if ($n.Count -eq 0) { return [string]$m }',
  "  return ($n -join ', ')",
  '}',
  // COM gives one comma-joined string where the cmdlets gave a list. Real values
  // on a stock machine include '7433', '80,443', '5000-5020', '554,8554-8558',
  // the service keywords 'RPC,' and 'RPC-EPMap,', the wildcard '*', and $null
  // for every rule that is neither TCP nor UDP.
  //
  // '*' and $null MUST become 'Any': `portCovered` does not know the wildcard,
  // so an every-port rule would otherwise read as `rule-wrong-port`. The service
  // keywords survive as words, match no number, and so cover nothing — which is
  // the conservative answer and the same one the cmdlets produced.
  'function Convert-FwLocalPorts($lp) {',
  "  if ([string]::IsNullOrWhiteSpace($lp) -or $lp -eq '*') { return @('Any') }",
  "  return @($lp.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })",
  '}',
  // `enabled` is a STRING and `notify` is a boolean, because that is what the
  // cmdlets produced and what the mapping compares. Swapping either shape makes
  // `.toLowerCase()` throw inside the parse try/catch, i.e. a perfectly readable
  // firewall reported as unreadable.
  'function Convert-FwRule($r) {',
  '  return @{',
  '    displayName = [string]$r.Name',
  "    direction = $(if ([int]$r.Direction -eq 1) { 'Inbound' } else { 'Outbound' })",
  '    enabled = ([bool]$r.Enabled).ToString()',
  "    action = $(if ([int]$r.Action -eq 1) { 'Allow' } else { 'Block' })",
  '    profile = (Convert-FwProfiles ([int]$r.Profiles))',
  '    protocols = @(Convert-FwProtocol ([int]$r.Protocol))',
  '    localPorts = @(Convert-FwLocalPorts $r.LocalPorts)',
  '    programs = $(if ($r.ApplicationName) { @([string]$r.ApplicationName) } else { @() })',
  '  }',
  '}',
];

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

/** 169.254.0.0/16 — what Windows invents for an adapter that never got a lease. */
function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.');
}

/**
 * This machine's own IPv4 addresses, the likeliest one first, so the panel can
 * print the URL to type on the other computer instead of leaving it to be hunted
 * down with `ipconfig`.
 *
 * Loopback is left out — it is the one address that cannot be the answer here —
 * and so are link-local ones, which no other machine can reach. That is not
 * tidiness: on a machine carrying two Hyper-V switches and a VPN adapter the raw
 * list began `169.254.214.38`, and the panel offered precisely that as the
 * address to open while the only address that answers sat third.
 *
 * `preferAliases` are the adapters worth trusting first — the ones Windows has
 * classified as a network we belong on. `os.networkInterfaces()` keys on the same
 * adapter name Windows calls `InterfaceAlias`, which is what makes the match
 * possible; order inside each group is left as the OS gave it.
 */
export function localAddresses(preferAliases: string[] = []): string[] {
  const preferred = new Set(preferAliases.map((alias) => alias.toLowerCase()));
  const found = Object.entries(os.networkInterfaces()).flatMap(([alias, entries]) =>
    (entries ?? [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal && !isLinkLocal(entry.address))
      .map((entry) => ({ address: entry.address, preferred: preferred.has(alias.toLowerCase()) })),
  );
  return [...found.filter((e) => e.preferred), ...found.filter((e) => !e.preferred)].map((e) => e.address);
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
   * Lower-cased, and any word Windows uses for "no program in particular" is
   * dropped on the way in so that emptiness is the only spelling of it here.
   */
  programs: string[];
}

/** What the firewall says right now, read without elevation. */
export interface FirewallProbe {
  /** Inbound rules that carry our name, whatever they turned out to say. */
  rules: FirewallRuleInfo[];
  /**
   * `NetworkCategory` of every connected network — Public, Private,
   * DomainAuthenticated — **deduplicated**. Three connections across two
   * categories used to read `Public, Private, Public` in the log.
   */
  activeProfiles: string[];
  /** The same networks, named, so a warning can say which one it is about. */
  activeConnections: ActiveConnection[];
  /** Windows would raise its dialog for an unruled listen rather than block in silence. */
  notifyOnListen: boolean;
  /** Every active profile allows unsolicited inbound traffic by policy. */
  defaultInboundAllow: boolean;
  /**
   * Why nothing above can be trusted, or null. **Never null beside an empty rule
   * list that was not actually read**: that conflation is what pinned this server
   * to loopback beside a rule that existed six times over.
   */
  error: string | null;
}

const UNREADABLE: Omit<FirewallProbe, 'error'> = {
  rules: [],
  activeProfiles: [],
  activeConnections: [],
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

interface RawConnection {
  name?: string;
  alias?: string;
  category?: string;
}

/**
 * What the probe script prints. Note `error`: the script reports its own failure
 * **in band, with exit 0**, rather than by failing. A `powershell.exe` that exits
 * non-zero makes `execFile` reject with an Error whose `message` is the whole
 * command line — a 500-character base64 blob — which is the same trap `elevate`
 * documents. In band it arrives as a sentence.
 */
interface RawProbe {
  connections?: RawConnection[] | RawConnection;
  netError?: string[] | string;
  fwProfiles?: RawProfile[] | RawProfile;
  rules?: RawRule[] | RawRule;
  error?: string | null;
}

function asArray<T>(value: T[] | T | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * `Domain, Private` is one string in a rule and two profiles in fact.
 *
 * `String()` rather than the declared type, for the same reason the rule mapping
 * coerces: the value arrives from `JSON.parse` behind a cast, and a `.split` on
 * something that is not a string is an exception rather than a bad answer.
 */
function splitProfiles(value: string | undefined): string[] {
  return String(value ?? '')
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
 * The rules and the two firewall policies come from COM (see `COM_HELPERS`, which
 * carries the whole reason why). The connected networks stay with
 * `Get-NetConnectionProfile`: it needs no elevation, it is the input to the wait
 * loop above, and it names each network, which the panel needs to say anything
 * true about a machine that is on Private and Public at the same time.
 * `CurrentProfileTypes` would look like a substitute and is not — it cannot
 * express "Windows has not classified anything yet", so the wait loop would exit
 * at once and the verdict would be `rule-other-profile` every morning.
 *
 * Nothing on this path loads the NetSecurity module any more, which is the point:
 * that module is the one that cannot read rules unelevated.
 */
export async function probeFirewall(port: number, waitForNetwork: boolean): Promise<FirewallProbe> {
  if (process.platform !== 'win32') {
    return { ...UNREADABLE, error: 'Not Windows: there is no Windows Firewall to read.' };
  }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$name = ${psLiteral(ruleNameFor(port))}`,
    `$wait = ${waitForNetwork ? String(NETWORK_WAIT_SECONDS) : '0'}`,
    ...COM_HELPERS,
    // SilentlyContinue belongs HERE and in almost no other read: an empty answer
    // seconds after logon is the case NETWORK_WAIT_SECONDS exists for, not a
    // failure. The error is captured anyway, so a real one cannot pass for it.
    '$nets = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue -ErrorVariable netErr)',
    'for ($i = 0; $i -lt $wait -and $nets.Count -eq 0; $i++) {',
    '  Start-Sleep -Seconds 1',
    '  $nets = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue -ErrorVariable netErr)',
    '}',
    '$out = @{',
    '  connections = @($nets | ForEach-Object { @{ name = [string]$_.Name; alias = [string]$_.InterfaceAlias; category = $_.NetworkCategory.ToString() } })',
    // Where-Object before ForEach-Object because `$null | ForEach-Object` runs
    // ONCE in PowerShell, with $_ as null — which would report an error that did
    // not happen every time the networks read fine.
    '  netError = @($netErr | Where-Object { $_ } | ForEach-Object { $_.Exception.Message })',
    '  fwProfiles = @()',
    '  rules = @()',
    '  error = $null',
    '}',
    // Everything the firewall itself says goes in ONE try: whatever fails in
    // here, the answer is "could not be read" and never an empty rule list.
    'try {',
    '  $fw = Get-FwPolicy',
    "  $names = @{ 1 = 'Domain'; 2 = 'Private'; 4 = 'Public' }",
    '  $fwp = @()',
    '  foreach ($pt in 1, 2, 4) {',
    '    $fwp += @{',
    '      name = $names[$pt]',
    '      notify = [bool](-not $fw.NotificationsDisabled($pt))',
    "      inbound = $(if ($fw.DefaultInboundAction($pt) -eq 1) { 'Allow' } else { 'Block' })",
    '    }',
    '  }',
    '  $out.fwProfiles = $fwp',
    '  $rules = @()',
    '  foreach ($r in @($fw.Rules)) {',
    '    if ($r.Name -ne $name) { continue }',
    '    $rules += (Convert-FwRule $r)',
    '  }',
    '  $out.rules = $rules',
    '} catch {',
    '  $out.error = $_.Exception.Message',
    '}',
    '$out | ConvertTo-Json -Compress -Depth 6',
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
    const parsed = JSON.parse(stdout.trim()) as RawProbe;
    const activeConnections = asArray(parsed.connections).map(
      (c): ActiveConnection => ({
        name: c.name ?? '',
        interfaceAlias: c.alias ?? '',
        category: c.category ?? '',
      }),
    );
    // Deduplicated: two Hyper-V switches and a VPN adapter put this machine on
    // three connections across two categories, and the undeduplicated list read
    // `Public, Private, Public` everywhere it was shown. Neither the `some` nor
    // the `every` below changes meaning under it.
    const activeProfiles = [...new Set(activeConnections.map((c) => c.category).filter(Boolean))];
    // A failed network query is worth a line in the log and nothing more: an
    // empty answer is legitimate at logon, and the wait above is the response to
    // it. What it must not do is arrive as a silent "no networks".
    const netError = asArray(parsed.netError).filter(Boolean);
    if (netError.length > 0) log.warn(`could not read the connected networks: ${netError[0]}`);
    if (parsed.error) {
      const message = `Windows would not say what its firewall rules are: ${parsed.error}`;
      log.warn(message);
      // The networks we DID read are kept: "the firewall could not be read" and
      // "this machine is on a Public network" are both worth saying, and the
      // verdict is loopback either way.
      return { ...UNREADABLE, activeProfiles, activeConnections, error: message };
    }
    const fwProfiles = asArray(parsed.fwProfiles);
    // Only the profiles this machine is actually on can decide anything: a
    // Public policy is irrelevant to a laptop sitting on a private network.
    const relevant = fwProfiles.filter((p) => activeProfiles.some((a) => matchesProfile(p.name ?? '', a)));
    const rules = asArray(parsed.rules)
      .filter((r) => (r.direction ?? '').toLowerCase() === 'inbound')
      .map(
        // Coerced with String() rather than trusted, because these come from
        // JSON.parse behind a cast and `evaluateFirewall` calls `.toLowerCase()`
        // on `action` OUTSIDE this try: a field that arrived as a boolean or a
        // number would not be a wrong verdict, it would be an exception in
        // `decideBind` and a server that fails to start.
        (r): FirewallRuleInfo => ({
          displayName: String(r.displayName ?? ''),
          enabled: String(r.enabled ?? '').toLowerCase() === 'true',
          action: String(r.action ?? ''),
          profiles: splitProfiles(r.profile),
          protocols: asArray(r.protocols).map((p) => String(p)),
          localPorts: asArray(r.localPorts).map((p) => String(p)),
          // COM answers null for a rule that names no program, where the cmdlet
          // used to answer the word `Any` — and reading that word as a program
          // was once enough to make our own port rule look like somebody else's
          // node.exe and refuse the bind it had just been granted. Both spellings
          // are still dropped here, because emptiness must have one meaning.
          programs: asArray(r.programs)
            .filter(Boolean)
            .map((p) => String(p).toLowerCase())
            .filter((p) => p !== 'any'),
        }),
      );
    return {
      rules,
      activeProfiles,
      activeConnections,
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

/**
 * The adapters carrying a network Windows considers ours — the ones the rule is
 * created for. Used to put the address that can actually be typed on another
 * machine at the front of `localAddresses`, and it asks the same question
 * `matchesProfile` answers everywhere else so the two cannot drift.
 */
export function trustedAliases(probe: FirewallProbe): string[] {
  return probe.activeConnections
    .filter((c) => matchesProfile('Private', c.category) || matchesProfile('Domain', c.category))
    .map((c) => c.interfaceAlias)
    .filter(Boolean);
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

/**
 * Make sure **exactly one** inbound rule for our port exists, whatever was there
 * before. Elevates: a UAC dialog appears on this desktop.
 *
 * Remove-then-create, inside the one elevated script, so it stays a single
 * prompt. This used to only create, and while the rules could not be read the
 * panel reported the port shut after every success — so the button went on
 * offering to open it, and six identical rules piled up. Re-creating also repairs
 * a rule whose port or profile is wrong, which "create only if missing" could not.
 *
 * Deleting by DisplayName is safe HERE and nowhere else in this file: the name is
 * one we chose ourselves (`ruleNameFor`). The Block rules Windows leaves behind
 * are named after the program, which is why those go by instance id.
 */
export async function ensureRule(port: number): Promise<void> {
  const name = ruleNameFor(port);
  await elevate(
    [
      // Without this a non-terminating CIM error exits 0, and `elevate` judges by
      // the exit code — it would report a rule created that never was.
      "$ErrorActionPreference = 'Stop'",
      `$name = ${psLiteral(name)}`,
      // Nothing to remove is the normal case, not a failure.
      'Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue',
      `New-NetFirewallRule -DisplayName $name -Description 'Browse claude-history from another machine on this network' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${String(port)} -Profile Private | Out-Null`,
    ].join('\n'),
  );
  log.info(`inbound rule ensured for port ${String(port)} on the Private profile`);
}

/** Remove it again. */
export async function removeRule(port: number): Promise<void> {
  await elevate(`Remove-NetFirewallRule -DisplayName ${psLiteral(ruleNameFor(port))} -ErrorAction Stop`);
  log.info(`inbound rule for port ${String(port)} removed`);
}

interface RawBlock {
  displayName?: string;
  program?: string;
  protocol?: string;
  profiles?: string;
}

/**
 * The result of looking for blocking rules — and **why the look failed**, when it
 * did.
 *
 * The error is a separate field rather than an empty list because those two used
 * to be the same value: `blockingRules` swallowed a denied read and returned
 * `[]`, so the panel spent months reporting that nothing blocked this app while
 * two Block rules for our own `node.exe` sat in the firewall. An empty list is
 * only good news when something actually looked.
 */
export interface BlockingScan {
  rules: BlockingRule[];
  error: string | null;
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
 * Without a root (a source or portable run) only the running exe counts. Both
 * cases now share one COM enumeration, because it costs about a tenth of a second
 * — the targeted query the cmdlets needed for speed is not worth a second code
 * path, and the cmdlet it used cannot be read unelevated anyway.
 *
 * No instance id comes out of here. `INetFwRule` does not expose one, and the
 * delete does not need it from us — see `removeBlockingRules`.
 */
export async function blockingRules(exePath: string, installRoot: string | null): Promise<BlockingScan> {
  if (process.platform !== 'win32') return { rules: [], error: null };
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$exe = ${psLiteral(exePath)}`,
    `$root = ${installRoot ? psLiteral(installRoot) : '$null'}`,
    ...COM_HELPERS,
    '$out = @{ rules = @(); error = $null }',
    'try {',
    '  $fw = Get-FwPolicy',
    '  $found = @()',
    '  foreach ($r in @($fw.Rules)) {',
    '    if ([int]$r.Direction -ne 1) { continue }',
    '    if ([int]$r.Action -ne 0) { continue }',
    '    $app = [string]$r.ApplicationName',
    '    if (-not $app) { continue }',
    '    $mine = $app -eq $exe',
    // OrdinalIgnoreCase is not optional: the firewall stores some of these paths
    // lower-cased and others exactly as they were typed.
    '    if (-not $mine -and $root) { $mine = $app.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) }',
    '    if (-not $mine) { continue }',
    '    $found += @{',
    '      displayName = [string]$r.Name',
    '      program = $app',
    '      protocol = (Convert-FwProtocol ([int]$r.Protocol))',
    '      profiles = (Convert-FwProfiles ([int]$r.Profiles))',
    '    }',
    '  }',
    '  $out.rules = $found',
    '} catch {',
    '  $out.error = $_.Exception.Message',
    '}',
    '$out | ConvertTo-Json -Compress -Depth 5',
  ].join('\n');

  try {
    const { stdout } = await powershell(script, READ_TIMEOUT_MS);
    const parsed = JSON.parse(stdout.trim()) as { rules?: RawBlock[] | RawBlock; error?: string | null };
    if (parsed.error) {
      log.warn(`could not look for blocking rules: ${parsed.error}`);
      return { rules: [], error: parsed.error };
    }
    return {
      rules: asArray(parsed.rules).map(
        (r): BlockingRule => ({
          displayName: r.displayName ?? '',
          program: r.program ?? '',
          protocol: r.protocol ?? '',
          profiles: splitProfiles(r.profiles),
        }),
      ),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Not fatal for the bind: these only ever explain a symptom, and no decision
    // depends on them. But it is not "none found" either, and saying so is the
    // whole difference between a clean firewall and one nobody could look at.
    log.warn('could not look for blocking rules', err);
    return { rules: [], error: message };
  }
}

/**
 * Delete the blocking rules for our own program, by instance name.
 *
 * Never by `DisplayName`: Windows names these after the program — on a developer
 * machine `node.exe` is also the DisplayName of three other Node installs' rules,
 * Allow rules among them — so a name-based delete would take out every rule any
 * other Node app on this machine ever earned.
 *
 * Which means the ids have to be found where the cmdlet that returns them
 * actually answers: **here, elevated.** `INetFwRule` exposes no instance id at
 * all, so the unelevated COM scan cannot produce one, and that turns out to be an
 * improvement — what crosses into this script is a SCOPE (our own exe, our own
 * install root, both derived from `process.execPath`), never the identity of a
 * rule. Nothing a page said, and nothing even our own read decided, can widen
 * what gets deleted.
 *
 * `$fw.Rules.Remove($name)` was the obvious alternative and is the forbidden one:
 * COM removes by `Name`, which for a rule *is* the DisplayName.
 */
export async function removeBlockingRules(exePath: string, installRoot: string | null): Promise<void> {
  await elevate(
    [
      "$ErrorActionPreference = 'Stop'",
      `$exe = ${psLiteral(exePath)}`,
      `$root = ${installRoot ? psLiteral(installRoot) : '$null'}`,
      // The same filter the unelevated scan uses, deliberately duplicated: this
      // one has to stand on its own, because it is the one that deletes.
      '$filters = @()',
      'if ($root) {',
      // SilentlyContinue on discovery only, and only here: elevated there is no
      // denial left to hide, and "no rules match" must mean nothing to do rather
      // than a failure the panel would report.
      '  $filters = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object {',
      '    $_.Program -and ($_.Program -eq $exe -or $_.Program.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase))',
      '  })',
      '} else {',
      '  $filters = @(Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue)',
      '}',
      'foreach ($f in $filters) {',
      '  $r = $f | Get-NetFirewallRule -ErrorAction SilentlyContinue',
      '  if (-not $r) { continue }',
      "  if ($r.Direction.ToString() -ne 'Inbound') { continue }",
      "  if ($r.Action.ToString() -ne 'Block') { continue }",
      // -Name, the id Windows generated, passed as a variable so it never becomes
      // script text. The delete itself is strict: a rule that refuses to go is an
      // error the user gets to see.
      '  Remove-NetFirewallRule -Name $r.Name',
      '}',
    ].join('\n'),
  );
  log.info('blocking rules for this program removed');
}
