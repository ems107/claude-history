import type { FirewallStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { localReason } from '../core/bind.ts';
import { createLogger } from '../core/logger.ts';
import {
  blockingRules,
  ensureRule,
  evaluateFirewall,
  localAddresses,
  probeFirewall,
  removeBlockingRules,
  removeRule,
  ruleNameFor,
  trustedAliases,
} from '../util/firewall.ts';

const log = createLogger('firewall');

export function registerFirewallRoutes(app: FastifyInstance, ctx: AppContext): void {
  const port = ctx.config.port;
  const ruleName = ruleNameFor(port);

  /**
   * Everything about "can another machine reach this one", in one read: where
   * this process is listening and why (decided at startup, `core/bind.ts`), and
   * what the firewall says right now.
   *
   * The two are separate facts and both are needed. The bind is history — it is
   * what the firewall said when the process started, and it cannot change while
   * it runs. The rule is the present, and it is what says whether a restart
   * would help. A panel that showed only one of them would have to lie about
   * the other.
   */
  app.get('/api/firewall', async (): Promise<FirewallStatusResponse> => {
    const settings = ctx.index.getSettings();
    const hasCredentials = ctx.index.getAuth() !== null;
    const wantsNetwork = settings.remoteAccessEnabled && hasCredentials;
    const listening = ctx.bind.network ? 'network' : 'local';
    // Two PowerShell calls, and neither needs the other's answer — so they run
    // together. Starting PowerShell is now most of the cost of each (the reads
    // themselves are around a tenth of a second since they stopped going through
    // the NetSecurity module), and in sequence it was two visible seconds of
    // "reading…" in the panel.
    //
    // No waiting for a network in the probe: by the time anyone opens Settings
    // the answer is whatever it is, and a panel that stalls ten seconds to say
    // "no networks" is not an improvement on saying it at once.
    const [probe, blocks] = await Promise.all([
      probeFirewall(port, false),
      blockingRules(ctx.bind.exePath, ctx.updates.install?.root ?? null),
    ]);
    const verdict = evaluateFirewall(probe, port, ctx.bind.exePath);
    return {
      ruleName,
      port,
      // Null rather than false: "we could not look" and "it is not there" lead
      // to different buttons, and guessing between them would offer to create a
      // rule that already exists.
      ruleExists: probe.error ? null : verdict.rule !== null,
      ruleCount: probe.rules.length,
      ruleCoversPort: verdict.ruleCoversPort,
      ruleProfiles: verdict.rule?.profiles ?? [],
      activeProfiles: probe.activeProfiles,
      activeConnections: probe.activeConnections,
      // Ordered so the address the panel offers first is one another machine can
      // actually reach: link-local ones are dropped, and the adapters Windows
      // calls Private come before a host-only switch or a VPN tunnel.
      addresses: localAddresses(trustedAliases(probe)),
      notifyOnListen: probe.notifyOnListen,
      defaultInboundAllow: probe.defaultInboundAllow,
      blockingRules: blocks.rules,
      blockingRulesError: blocks.error,
      listening,
      bindReason: ctx.bind.reason,
      // The same order the next restart will follow, from `core/bind.ts`, so the
      // panel can never name an obstacle that has since been cleared.
      currentReason: localReason(ctx.config, settings, hasCredentials) ?? verdict.reason,
      wantsNetwork,
      // Only true when a restart would actually change something: wanting the
      // network with the door now open, or no longer wanting it while the socket
      // is still wide. Wanting it with the port still shut is not a restart
      // problem, and offering one would waste a restart. `--host` is excluded
      // outright: it settles the bind before any of this, so a restart under it
      // changes nothing.
      restartNeeded:
        ctx.config.hostOverride === null &&
        (wantsNetwork ? listening === 'local' && verdict.permitted : listening === 'network'),
      error: probe.error,
    };
  });

  // Idempotent, so this is also the "tidy up the duplicates" button: it leaves
  // exactly one rule whether it found none, one, or the six that accumulated
  // while the panel could not see them.
  app.post('/api/firewall', async (_request, reply) => {
    try {
      await ensureRule(port);
      return { ok: true };
    } catch (err) {
      // Cancelling the UAC dialog lands here too, and it is the likeliest way
      // to get here — so it is a 409 with an explanation, not a 500.
      log.warn('could not create the firewall rule', err);
      return reply.code(409).send({
        error: `The rule was not created — Windows has to approve it on this machine. ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.delete('/api/firewall', async (_request, reply) => {
    try {
      await removeRule(port);
      return { ok: true };
    } catch (err) {
      log.warn('could not remove the firewall rule', err);
      return reply.code(409).send({
        error: `The rule was not removed — Windows has to approve it on this machine. ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  /**
   * Delete the Block rules Windows wrote when its dialog was answered with
   * Cancel — one pair per version, each nailed to that version's `node.exe`,
   * and every one of them beating the port rule this panel creates.
   *
   * Nothing about which rules to delete is taken from the request — and now not
   * from this process either: the scope goes into the elevated script and that
   * script finds the instance ids itself, so what gets deleted from a firewall is
   * not something a page, or even this route, gets to name.
   */
  app.delete('/api/firewall/blocks', async (_request, reply) => {
    const exe = ctx.bind.exePath;
    const root = ctx.updates.install?.root ?? null;
    const found = await blockingRules(exe, root);
    // "Could not look" is not "nothing to remove". Answering ok/0 here would tell
    // the user their firewall is clean on the strength of a failed read, which is
    // the exact reassurance this whole change exists to stop giving.
    if (found.error) {
      return reply.code(409).send({ error: `Nothing was removed — the firewall could not be read: ${found.error}` });
    }
    if (found.rules.length === 0) return { ok: true, removed: 0 };
    try {
      await removeBlockingRules(exe, root);
    } catch (err) {
      log.warn('could not remove the blocking rules', err);
      return reply.code(409).send({
        error: `Nothing was removed — Windows has to approve it on this machine. ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    // Counted by looking again, rather than by trusting a list we handed to
    // nobody. If the second look fails, report what we set out to remove.
    const after = await blockingRules(exe, root);
    const removed = after.error ? found.rules.length : found.rules.length - after.rules.length;
    return { ok: true, removed };
  });
}
