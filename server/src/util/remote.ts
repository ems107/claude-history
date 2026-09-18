import type { FastifyRequest } from 'fastify';

/**
 * Did this request come from this machine?
 *
 * The whole trust model rests on this one answer: a local request is the user
 * sitting at the PC, and gets everything with no password — the same person who
 * can already open a terminal and run anything. Everything else has to log in.
 *
 * It is taken from the SOCKET and from nothing else. `X-Forwarded-For` and
 * `Host` are written by the caller, so trusting either would let a remote
 * request declare itself local and switch the authentication off in one header.
 * That also means this app must never be put behind a reverse proxy: every
 * request would arrive from loopback and be waved through. If that ever becomes
 * a thing worth supporting, it needs an explicit "trusted proxy" setting and a
 * decision made here, not an accident.
 *
 * IPv6 is the trap: Node reports a v4 loopback connection as `::ffff:127.0.0.1`
 * whenever the listening socket is dual-stack, so matching `'127.0.0.1'` alone
 * would ask half the local browsers for a password.
 */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  // A v4-mapped v6 address is a v4 address wearing a prefix.
  const addr = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (addr === '::1') return true;
  // The whole 127.0.0.0/8 block, not just 127.0.0.1: `127.0.0.2` and friends
  // are equally this machine and a browser can be pointed at them.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr);
}

export function isLocalRequest(request: FastifyRequest): boolean {
  return isLocalAddress(request.socket.remoteAddress);
}
