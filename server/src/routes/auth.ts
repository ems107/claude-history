import type { AuthStatusResponse } from '@claude-history/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import {
  checkCredentials,
  clearedCookie,
  issueToken,
  loginBlockedFor,
  makeAuthConfig,
  newSecret,
  readCookie,
  recordLoginFailure,
  recordLoginSuccess,
  sessionCookie,
  SESSION_COOKIE,
  validateCredentials,
  verifyToken,
} from '../core/auth.ts';
import { createLogger } from '../core/logger.ts';
import { isLocalRequest } from '../util/remote.ts';

const log = createLogger('auth');

/**
 * May this request see the app at all?
 *
 * Local requests always may, with no password: whoever is at the machine can
 * already open a terminal there, so a login screen would protect nothing and
 * lock the owner out of their own tool the day they forget it. Everything else
 * needs the switch to be on, credentials to exist, and a valid cookie.
 */
export function isAuthenticated(ctx: AppContext, request: FastifyRequest): boolean {
  if (isLocalRequest(request)) return true;
  if (!ctx.index.getSettings().remoteAccessEnabled) return false;
  const auth = ctx.index.getAuth();
  if (!auth) return false;
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  return token !== null && verifyToken(token, auth);
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * The only endpoint an unauthenticated caller may reach, and it answers four
   * booleans and nothing else. Not the username (which is half a credential),
   * not the version, not whether any session exists — a page that has not
   * logged in learns only which of the three screens it should draw.
   */
  app.get('/api/auth/status', async (request): Promise<AuthStatusResponse> => {
    const remote = !isLocalRequest(request);
    return {
      remote,
      remoteAccessEnabled: ctx.index.getSettings().remoteAccessEnabled,
      configured: ctx.index.getAuth() !== null,
      authenticated: isAuthenticated(ctx, request),
    };
  });

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/login',
    async (request, reply) => {
      const address = request.socket.remoteAddress ?? 'unknown';
      // Off means off: no login, no hint that one would work. The page for this
      // state says how to switch it on, and only at the machine.
      if (!ctx.index.getSettings().remoteAccessEnabled) {
        return reply.code(403).send({ error: 'Remote access is turned off on this server.' });
      }
      const auth = ctx.index.getAuth();
      if (!auth) return reply.code(403).send({ error: 'No username and password have been set on this server.' });

      const blockedFor = loginBlockedFor(address);
      if (blockedFor > 0) {
        return reply.code(429).send({
          error: `Too many failed attempts. Try again in ${String(Math.ceil(blockedFor / 1000))} seconds.`,
          retryAfterSeconds: Math.ceil(blockedFor / 1000),
        });
      }

      const username = typeof request.body?.username === 'string' ? request.body.username : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!(await checkCredentials(auth, username, password))) {
        const wait = recordLoginFailure(address);
        // One message for both halves being wrong: saying which was right is
        // saying half the credential out loud.
        return reply.code(401).send({
          error: 'Wrong username or password.',
          retryAfterSeconds: Math.ceil(wait / 1000),
        });
      }

      recordLoginSuccess(address);
      const { token, maxAgeSeconds } = issueToken(auth.username, auth.secret);
      return reply.header('set-cookie', sessionCookie(token, maxAgeSeconds)).send({ ok: true });
    },
  );

  app.post('/api/auth/logout', async (_request, reply: FastifyReply) =>
    reply.header('set-cookie', clearedCookie()).send({ ok: true }),
  );

  /**
   * Sign every device out by replacing the signing key.
   *
   * Deliberately reachable from a remote session as well: the moment you need
   * it is the moment a device you no longer hold is still signed in, and
   * refusing it until you get home is refusing it when it matters.
   */
  app.post('/api/auth/logout-all', async (request, reply) => {
    if (!ctx.index.getAuth()) return reply.code(400).send({ error: 'No credentials are set.' });
    await ctx.index.rotateAuthSecret(newSecret());
    log.info(`signed out every device, asked from ${request.socket.remoteAddress ?? 'unknown'}`);
    return reply.header('set-cookie', clearedCookie()).send({ ok: true });
  });

  /**
   * Set or replace the username and password. NO old password is asked for,
   * and none is needed: the local-only hook in `app.ts` has already established
   * that this request comes from the machine itself, where everything this
   * password protects is available anyway. That is also the whole recovery
   * story — forgetting it costs a walk to the PC, not a reinstall.
   */
  app.put<{ Body: { username?: string; password?: string } }>(
    '/api/auth/credentials',
    async (request, reply) => {
      const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const problem = validateCredentials(username, password);
      if (problem) return reply.code(400).send({ error: problem });
      // The signing key is carried over: changing the password at the machine
      // does not mean the phone in your pocket is hostile, and there is a
      // separate button for when it does.
      const existing = ctx.index.getAuth();
      await ctx.index.setAuth(await makeAuthConfig(username, password, existing?.secret));
      log.info(existing ? 'the remote-access credentials were replaced' : 'remote-access credentials were set');
      return { ok: true };
    },
  );
}
