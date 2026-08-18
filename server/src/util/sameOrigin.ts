import type { FastifyRequest } from 'fastify';
import { isLocalRequest } from './remote.ts';

/**
 * Is this request coming from the app's own pages?
 *
 * Reaching the server at all — from this machine, or from another one after
 * signing in — says nothing about which page made the request. Any page the
 * user has open can POST to http://127.0.0.1:7433: it cannot read the reply,
 * but it does not need to, because these endpoints launch terminals, open
 * folders, stop the server and run Claude with a prompt of the caller's
 * choosing and auto-approved tools. The side effect IS the attack.
 *
 * Two headers answer it, in order:
 *
 * - `Sec-Fetch-Site` is set by the browser itself and cannot be forged from a
 *   page. `same-origin` is our own UI; `none` is the user typing the URL.
 *   Anything else is another site talking to us.
 * - `Origin` catches browsers old enough to lack the first (and is what a
 *   cross-origin POST always carries). It must name this very server.
 *
 * Neither header present means it is not a browser at all — curl, a script,
 * the installer's health check:
 *
 * - From THIS machine that is allowed through, and always was. Forging both
 *   headers is trivial for anything that can already run code here, so
 *   refusing would cost the ability to test with curl and buy nothing.
 * - From ANOTHER machine it is refused. The reasoning above does not survive
 *   the trip: the caller has a session cookie but no browser, which is not a
 *   shape our own UI ever takes. The session check has already run by this
 *   point, so this is defence in depth rather than the lock itself.
 */
export function isSameOrigin(request: FastifyRequest): boolean {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin' || site === 'none';

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') return isLocalRequest(request);
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
