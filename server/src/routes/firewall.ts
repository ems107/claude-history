import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import type { FirewallStatusResponse } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';

const log = createLogger('firewall');
const run = promisify(execFile);

/** The rule this app manages. Matched by name, so it can be found and removed again. */
const RULE_NAME = 'claude-history';
/** A UAC prompt is a person reading a dialog, not a command running. */
const ELEVATED_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 20_000;

/**
 * Run PowerShell without a single quoting problem.
 *
 * `-EncodedCommand` takes base64 of UTF-16LE, so the script can contain quotes,
 * parentheses and anything else without meeting either Windows' argv escaping
 * or PowerShell's own parser on the way in. Worth it here because the scripts
 * below nest one command inside another.
 */
function powershell(script: string, timeout: number): Promise<{ stdout: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    timeout,
    windowsHide: true,
    encoding: 'utf8',
  });
}

/**
 * Ask for the rule to be created or removed, with administrator rights.
 *
 * Windows will not let a per-user process touch the firewall, and this app is
 * installed per user with no elevation at all (`installer/launch.vbs`). So the
 * work is handed to an elevated child, and the UAC dialog that authorises it
 * appears on the machine's own desktop — which is exactly why this endpoint is
 * local-only: over the network it would pop a dialog nobody is there to accept.
 */
async function elevate(innerScript: string): Promise<void> {
  const inner = Buffer.from(innerScript, 'utf16le').toString('base64');
  const outer = [
    "$ErrorActionPreference = 'Stop'",
    '$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden',
    `  -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${inner}')`,
    'exit $p.ExitCode',
  ].join(' `\n');
  await powershell(outer, ELEVATED_TIMEOUT_MS);
}

/**
 * This machine's own IPv4 addresses, so the panel can print the URL to type on
 * the other computer instead of leaving it to be hunted down with `ipconfig`.
 * Loopback is left out — it is the one address that cannot be the answer here.
 */
function localAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

export function registerFirewallRoutes(app: FastifyInstance, ctx: AppContext): void {
  const port = ctx.config.port;

  /**
   * Whether the port is open, and on which profiles this machine currently is.
   *
   * The profile matters as much as the rule: the rule below is created for the
   * Private profile, so a home network Windows has decided to call Public would
   * stay closed and look like a bug in the rule. Reading needs no elevation.
   */
  app.get('/api/firewall', async (): Promise<FirewallStatusResponse> => {
    const base = { ruleName: RULE_NAME, port, activeProfiles: [] as string[], addresses: localAddresses() };
    try {
      const { stdout } = await powershell(
        [
          "$rule = Get-NetFirewallRule -DisplayName '" + RULE_NAME + "' -ErrorAction SilentlyContinue",
          '$profiles = @(Get-NetConnectionProfile | ForEach-Object { $_.NetworkCategory.ToString() })',
          '@{ exists = [bool]$rule; profiles = $profiles } | ConvertTo-Json -Compress',
        ].join('\n'),
        READ_TIMEOUT_MS,
      );
      const parsed = JSON.parse(stdout.trim()) as { exists?: boolean; profiles?: string[] | string };
      const profiles = parsed.profiles === undefined ? [] : Array.isArray(parsed.profiles) ? parsed.profiles : [parsed.profiles];
      return { ...base, ruleExists: parsed.exists === true, activeProfiles: profiles, error: null };
    } catch (err) {
      // Null rather than false: "we could not look" and "it is not there" lead
      // to different buttons, and guessing between them would offer to create a
      // rule that already exists.
      log.warn('could not read the firewall rule', err);
      return { ...base, ruleExists: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/firewall', async (_request, reply) => {
    try {
      await elevate(
        `New-NetFirewallRule -DisplayName '${RULE_NAME}' -Description 'Browse claude-history from another machine on this network' ` +
          `-Direction Inbound -Action Allow -Protocol TCP -LocalPort ${String(port)} -Profile Private | Out-Null`,
      );
      log.info(`inbound rule created for port ${String(port)} on the Private profile`);
      return { ok: true };
    } catch (err) {
      // Cancelling the UAC dialog lands here too, and it is the likeliest way
      // to get here — so it is a 409 with an explanation, not a 500.
      log.warn('could not create the firewall rule', err);
      return reply.code(409).send({
        error: `The rule was not created. Windows asks for administrator approval on the machine itself — accepting that prompt is what this needs. (${err instanceof Error ? err.message : String(err)})`,
      });
    }
  });

  app.delete('/api/firewall', async (_request, reply) => {
    try {
      await elevate(`Remove-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction Stop`);
      log.info('inbound rule removed');
      return { ok: true };
    } catch (err) {
      log.warn('could not remove the firewall rule', err);
      return reply.code(409).send({
        error: `The rule was not removed. (${err instanceof Error ? err.message : String(err)})`,
      });
    }
  });
}
