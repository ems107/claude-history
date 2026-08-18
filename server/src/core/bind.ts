import fs from 'node:fs';
import { BIND_REASONS, type BindReason } from '@claude-history/shared';
import { ANY_HOST, LOOPBACK_HOST, isLoopbackHost, type AppConfig } from '../config.ts';
import {
  evaluateFirewall,
  probeFirewall,
  type FirewallProbe,
  type FirewallVerdict,
} from '../util/firewall.ts';
import { createLogger } from './logger.ts';

const log = createLogger('bind');

/**
 * Where this process will listen, and why.
 *
 * Made once, before `app.listen()`, and then a fixed fact about the process:
 * the address a socket is bound to cannot be changed under it, which is why
 * turning remote access on or off asks for a restart.
 */
export interface BindDecision {
  /** What to pass to `listen()`. */
  host: string;
  /** The port the whole question was about. */
  port: number;
  /** Reachable from other machines. */
  network: boolean;
  reason: BindReason;
  /** The switch is on, credentials exist, and this is not a dev instance. */
  wantsNetwork: boolean;
  /** What the firewall said, or null when it was not asked. */
  probe: FirewallProbe | null;
  verdict: FirewallVerdict | null;
  /** The running `node.exe`, junctions resolved — what the firewall calls us. */
  exePath: string;
}

/**
 * The half of the decision that needs no firewall, or null for "ask Windows".
 *
 * Shared with `/api/firewall` on purpose. The route has to answer a question
 * this one already knows how to settle — *what stands between this server and
 * the network right now* — and the answer must be the same one the next restart
 * will act on. Two copies of this order would drift, and the first symptom
 * would be a panel confidently naming an obstacle that is no longer there.
 */
export function localReason(
  config: AppConfig,
  settings: { remoteAccessEnabled: boolean },
  hasCredentials: boolean,
): BindReason | null {
  if (config.hostOverride !== null) return 'explicit-host';
  if (config.devInstance) return 'dev-instance';
  if (!settings.remoteAccessEnabled) return 'switch-off';
  if (!hasCredentials) return 'no-credentials';
  if (process.platform !== 'win32') return 'not-windows';
  return null;
}

/**
 * The `node.exe` path the firewall would record for us.
 *
 * The scheduled task launches through the stable `current` junction, but the
 * kernel resolves reparse points, so what ends up in a firewall rule is
 * `versions\vX.Y.Z\node\node.exe` — a different program on every update. Same
 * reason `updates.ts` resolves its own directory this way.
 */
export function resolvedExePath(): string {
  try {
    return fs.realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

/**
 * Decide the bind, asking Windows first.
 *
 * The rule this implements, and the one thing to keep true: **listening on
 * anything but loopback with no firewall rule to decide the matter makes
 * Windows raise its "allow this app?" dialog** — at `listen()`, before any
 * connection, and about the `node.exe` PATH, which changes with every update.
 * That dialog must never appear on its own, so it is not enough for the user to
 * want remote access: the permission has to already exist.
 *
 * Hence the order below. The switch and the credentials are cheap and local, so
 * they are asked first and a machine with remote access off never pays for a
 * PowerShell call at all. `--host` skips the lot: it is typed by hand, it is the
 * only way left to get the dialog, and `config.ts` warns about exactly that.
 *
 * Re-decided on every start against the live firewall, never from a remembered
 * verdict — a rule deleted while the server was down must mean loopback on the
 * next start, and that is what makes "no dialog, ever" true rather than likely.
 */
export async function decideBind(
  config: AppConfig,
  settings: { remoteAccessEnabled: boolean },
  hasCredentials: boolean,
): Promise<BindDecision> {
  const exePath = resolvedExePath();
  const wantsNetwork = !config.devInstance && settings.remoteAccessEnabled && hasCredentials;
  const base = { port: config.port, wantsNetwork, probe: null, verdict: null, exePath };
  const local = (reason: BindReason): BindDecision => ({ ...base, host: LOOPBACK_HOST, network: false, reason });

  const early = localReason(config, settings, hasCredentials);
  if (early === 'explicit-host') {
    const host = config.hostOverride ?? LOOPBACK_HOST;
    return { ...base, host, network: !isLoopbackHost(host), reason: 'explicit-host' };
  }
  if (early === 'not-windows') return { ...base, host: ANY_HOST, network: true, reason: 'not-windows' };
  if (early !== null) return local(early);

  const probe = await probeFirewall(config.port, true);
  const verdict = evaluateFirewall(probe, config.port, exePath);
  return {
    ...base,
    probe,
    verdict,
    host: verdict.permitted ? ANY_HOST : LOOPBACK_HOST,
    network: verdict.permitted,
    reason: verdict.reason,
  };
}

/**
 * The sentence the log gets: the same cause the panel shows, plus the detail
 * only a log wants — the profiles that did not match, the error that stopped the
 * read. It is the first line anyone reads when "I cannot reach it from my phone".
 */
export function describeBind(decision: BindDecision): string {
  const where = decision.network
    ? `listening on ${decision.host} (every interface), port ${String(decision.port)}`
    : `listening on this machine only, port ${String(decision.port)}`;
  const detail =
    decision.reason === 'rule-other-profile'
      ? ` (this machine is on ${decision.probe?.activeProfiles.join(', ') || 'no network'}, the rule covers ${
          decision.verdict?.rule?.profiles.join(', ') || 'nothing'
        })`
      : decision.reason === 'firewall-unreadable'
        ? ` (${decision.probe?.error ?? 'no reason given'})`
        : decision.reason === 'rule-other-program'
          ? ` (we are ${decision.exePath})`
          : '';
  return `${where}, because ${BIND_REASONS[decision.reason]}${detail}`;
}

/** Log the decision, once, at the level it deserves. */
export function logBind(decision: BindDecision): void {
  const message = describeBind(decision);
  // Wanting the network and not having it is the one case worth a warning: it is
  // a switch that looks on and does nothing until the port is opened.
  if (decision.wantsNetwork && !decision.network) log.warn(message);
  else log.info(message);
}
