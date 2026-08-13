import type { FastifyRequest } from 'fastify';

/**
 * Is this request coming from the app's own pages?
 *
 * Binding to 127.0.0.1 keeps other machines out; it does nothing about the
 * browser already running on this one. Any page the user has open can POST to
 * http://127.0.0.1:7433 — it cannot read the reply, but it does not need to:
 * these endpoints launch terminals, open folders, stop the server and, now,
 * run Claude with a prompt of the caller's choosing and auto-approved tools.
 * The side effect IS the attack.
 *
 * Two headers answer it, in order:
 *
 * - `Sec-Fetch-Site` is set by the browser itself and cannot be forged from a
 *   page. `same-origin` is our own UI; `none` is the user typing the URL.
 *   Anything else is another site talking to us.
 * - `Origin` catches browsers old enough to lack the first (and is what a
 *   cross-origin POST always carries). It must name this very server.
 *
 * Neither header means it is not a browser at all — curl, a script, the
 * installer's health check — and those are allowed through: forging both is
 * trivial for anything that can already run code on the machine, so refusing
 * them would cost the ability to test with curl and buy nothing.
 */
export function isSameOrigin(request: FastifyRequest): boolean {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin' || site === 'none';

  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
