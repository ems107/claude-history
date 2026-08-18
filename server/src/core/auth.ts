import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { MIN_PASSWORD_LENGTH } from '@claude-history/shared';
import { createLogger } from './logger.ts';

const log = createLogger('auth');
const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * What is stored in `userdata.json` under `auth`.
 *
 * NOT in `AppSettings`: `GET /api/settings` hands the whole settings object to
 * any authenticated browser, and the hash has no business travelling. It is a
 * top-level key of its own, which also keeps it out of every settings event.
 */
export interface AuthConfig {
  username: string;
  /** `scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>` — self-describing, so the cost can change later. */
  passwordHash: string;
  /** HMAC key for session cookies. Rotating it signs every device out at once. */
  secret: string;
  updatedAt: string;
}

export const SESSION_COOKIE = 'ch_session';
/** Long on purpose: this is a personal tool on a private network, and a login prompt every week is what makes people pick a worse password. */
const SESSION_DAYS = 30;
/** scrypt cost. ~100 ms per hash here, which is the point — it is a login, not a loop. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

/** Fresh HMAC key. Also what "sign out everywhere" replaces. */
export function newSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  let key: Buffer;
  try {
    key = await scrypt(password, salt, expected.length);
  } catch {
    return false;
  }
  // Same length by construction, but timingSafeEqual throws rather than
  // answering false when they differ — and a stored hash can be hand-edited.
  if (key.length !== expected.length) return false;
  return crypto.timingSafeEqual(key, expected);
}

/**
 * A session cookie, signed and self-contained.
 *
 * No server-side store, and that is a requirement rather than a shortcut:
 * applying an update from a remote browser restarts this process, and a store
 * in memory would sign the user out in the middle of the one operation that
 * cannot be finished from the machine they are not at. The signature is over
 * the payload, so nothing has to be remembered except the secret — which lives
 * in `userdata.json` and therefore survives restarts and updates alike.
 */
interface TokenPayload {
  /** Who. Checked against the current username, so a rename invalidates old cookies. */
  u: string;
  /** Issued at, epoch seconds. */
  iat: number;
  /** Expires at, epoch seconds. */
  exp: number;
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function issueToken(username: string, secret: string, now = Date.now()): { token: string; maxAgeSeconds: number } {
  const iat = Math.floor(now / 1000);
  const maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60;
  const payload: TokenPayload = { u: username, iat, exp: iat + maxAgeSeconds };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { token: `${body}.${sign(body, secret)}`, maxAgeSeconds };
}

export function verifyToken(token: string, auth: AuthConfig, now = Date.now()): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, auth.secret);
  // Both are base64url of a sha256, so the lengths match unless the cookie was
  // tampered with — in which case this is the answer anyway.
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return false;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return false;
  // A cookie issued for a username that is no longer the one configured is
  // spent: renaming the user is a way of locking the old sessions out.
  return payload.u === auth.username;
}

/**
 * How long a failed login costs, per source address.
 *
 * A password over plain HTTP on a LAN is brute-forceable at the speed of the
 * network, and scrypt alone only makes each attempt expensive for US too. The
 * delay doubles per failure and is capped; the counter is per address so one
 * device being wrong cannot lock the others out, and it is cleared by a
 * success.
 */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** In-memory: a restart forgiving the attempts is fine, it costs an attacker a restart they cannot cause. */
const attempts = new Map<string, { failures: number; blockedUntil: number }>();

export function loginBlockedFor(address: string, now = Date.now()): number {
  const entry = attempts.get(address);
  if (!entry) return 0;
  return Math.max(0, entry.blockedUntil - now);
}

export function recordLoginFailure(address: string, now = Date.now()): number {
  const entry = attempts.get(address) ?? { failures: 0, blockedUntil: 0 };
  entry.failures += 1;
  const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (entry.failures - 1));
  entry.blockedUntil = now + wait;
  attempts.set(address, entry);
  log.warn(`failed login from ${address} (attempt ${String(entry.failures)}) — blocked for ${String(Math.round(wait / 1000))}s`);
  return wait;
}

export function recordLoginSuccess(address: string): void {
  attempts.delete(address);
  log.info(`login from ${address}`);
}

/** One cookie out of a `Cookie:` header. Hand-rolled — a dependency for this would be silly. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * `Set-Cookie` for the session.
 *
 * No `Secure`: this app is served over plain HTTP on a private network, and
 * the flag would stop the browser sending the cookie at all. `SameSite=Strict`
 * is what covers the gap it leaves — a request from any other site carries no
 * cookie, so it is refused before the same-origin hook even looks at it.
 */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(maxAgeSeconds)}`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export async function makeAuthConfig(username: string, password: string, secret?: string): Promise<AuthConfig> {
  return {
    username,
    passwordHash: await hashPassword(password),
    // Kept across a password change on purpose: changing the password is done
    // at the machine and does not mean the other devices are hostile. Signing
    // them out is a separate, deliberate button.
    secret: secret ?? newSecret(),
    updatedAt: new Date().toISOString(),
  };
}

export async function checkCredentials(auth: AuthConfig, username: string, password: string): Promise<boolean> {
  // The username is compared too, and the password is verified either way: an
  // early return on an unknown username is how a login endpoint tells an
  // attacker which half was right, by answering faster.
  const ok = await verifyPassword(password, auth.passwordHash);
  return ok && username === auth.username;
}

/** Both halves of what a caller may set, validated in one place. */
export function validateCredentials(username: string, password: string): string | null {
  if (!username.trim()) return 'The username is empty.';
  if (username.length > 64) return 'The username is too long (64 characters maximum).';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  return null;
}
