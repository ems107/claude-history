import type { FirewallStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { localReason } from '../core/bind.ts';
import { createLogger } from '../core/logger.ts';
import {
  blockingRules,
  createRule,
  evaluateFirewall,
  localAddresses,
  probeFirewall,
  removeBlockingRules,
  removeRule,
  ruleNameFor,
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
    // together. Loading the NetSecurity module is most of the cost of each
    // (~2 s for the probe, ~1.5 s for the enumeration the block scan needs), and
    // in sequence that was four seconds of "reading…" in the panel.
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
      ruleCoversPort: verdict.ruleCoversPort,
      ruleProfiles: verdict.rule?.profiles ?? [],
      activeProfiles: probe.activeProfiles,
      addresses: localAddresses(),
      notifyOnListen: probe.notifyOnListen,
      defaultInboundAllow: probe.defaultInboundAllow,
      blockingRules: blocks.map(({ displayName, program, protocol }) => ({ displayName, program, protocol })),
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

  app.post('/api/firewall', async (_request, reply) => {
    try {
      await createRule(port);
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
   * The list is re-read here and never taken from the request: what gets
   * deleted from a firewall is not something a page gets to name.
   */
  app.delete('/api/firewall/blocks', async (_request, reply) => {
    const found = await blockingRules(ctx.bind.exePath, ctx.updates.install?.root ?? null);
    if (found.length === 0) return { ok: true, removed: 0 };
    try {
      await removeBlockingRules(found.map((r) => r.id));
      return { ok: true, removed: found.length };
    } catch (err) {
      log.warn('could not remove the blocking rules', err);
      return reply.code(409).send({
        error: `Nothing was removed — Windows has to approve it on this machine. ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
