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
 * **Neither header present does not mean the same thing for every method**, and
 * getting that wrong broke the file panel for every remote reader:
 *
 * - `Origin` rides on every state-changing request, same-origin ones included.
 *   Its absence on a POST really does mean nobody's browser sent it.
 * - `Sec-Fetch-*` is only sent to **potentially trustworthy** origins — HTTPS,
 *   or localhost. Served over plain HTTP from a LAN address we are neither, so
 *   a same-origin GET from our own page arrives with **no Sec-Fetch-Site and no
 *   Origin at all**. Their absence there says nothing whatsoever, and refusing
 *   on it answered 403 to the file viewer's own reads. (Measured: exactly that,
 *   the first time this was used from another machine.)
 *
 * So the question is only asked where the answer means something. For a
 * state-changing request from another machine, no headers is refused — the
 * caller has a session cookie and no browser, which is not a shape our own UI
 * ever takes. From THIS machine it is allowed, as it always was: forging both
 * is trivial for anything that can already run code here, so refusing would
 * cost the ability to test with curl and buy nothing.
 *
 * What that leaves for a plain-HTTP GET is the `Origin` check alone, which a
 * cross-origin `fetch` still carries — but which an `<img>` never sends. See
 * [AI_REMOTE_ACCESS.md](../../../docs/AI_REMOTE_ACCESS.md) for what that costs.
 */
export function isSameOrigin(request: FastifyRequest): boolean {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin' || site === 'none';

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') {
    const stateChanging = request.method !== 'GET' && request.method !== 'HEAD';
    return !stateChanging || isLocalRequest(request);
  }
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
