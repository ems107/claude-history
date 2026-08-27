const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

export function relativeTime(when: string | number | null): string {
  if (when === null) return '—';
  const ms = typeof when === 'number' ? when : Date.parse(when);
  if (Number.isNaN(ms)) return '—';
  const diff = ms - Date.now();
  for (const [unit, unitMs] of UNITS) {
    if (Math.abs(diff) >= unitMs) return rtf.format(Math.round(diff / unitMs), unit);
  }
  return 'just now';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Absolute datetimes are always dd/MM/yyyy HH:mm:ss (local time). */
export function formatDateTime(when: string | number | null): string {
  if (when === null) return '—';
  const ms = typeof when === 'number' ? when : Date.parse(when);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const formatDateTimeFull = formatDateTime;

/**
 * The same clock with the year and the seconds dropped — for a place where the
 * stamp is a hint beside something else and every character it takes is a
 * character of that something else. The full one belongs on the hover.
 */
export function formatDateTimeShort(when: string | number | null): string {
  if (when === null) return '—';
  const ms = typeof when === 'number' ? when : Date.parse(when);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Just the time of day — for a row whose date is already said by the headers around it. */
export function formatTimeOfDay(when: string | number | null): string {
  if (when === null) return '—';
  const ms = typeof when === 'number' ? when : Date.parse(when);
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Time left until `when`, always rounded DOWN: "2 hr 37 min" promises less
 * than is actually left, never more, which is the safe direction for a quota
 * countdown. `compact` keeps only the largest unit ("2 hr", "5 d").
 */
export function timeUntil(when: string | number | null, compact = false): string | null {
  if (when === null) return null;
  const ms = (typeof when === 'number' ? when : Date.parse(when)) - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'now';

  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;

  if (compact) {
    if (days > 0) return `${days} d`;
    if (hours > 0) return `${hours} hr`;
    return `${Math.max(1, minutes)} min`;
  }

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hr`);
  // Minutes are noise next to a multi-day countdown only when hours are 0 too.
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(' ');
}

/** Below this, elapsed time reads "just now" instead of counting seconds. */
export const JUST_NOW_SECONDS = 5;

/**
 * Elapsed time since `when`, exact to the second: "just now" for the first few
 * seconds, then "12 s ago", "1 min 12 s ago", "1 hr 4 min ago". Unlike
 * `relativeTime` this is meant to be re-rendered every second, so the seconds
 * have to be truthful — they are floored, never rounded.
 */
export function timeSince(when: string | number | null): string {
  const since = elapsed(when);
  if (since === null) return '—';
  const ms = typeof when === 'number' ? when : Date.parse(when as string);
  if (Math.floor(Math.max(0, Date.now() - ms) / 1000) < JUST_NOW_SECONDS) return 'just now';
  return `${since} ago`;
}

/**
 * The same duration as a bare span — "12 s", "1 min 12 s", "1 hr 4 min" — with
 * no "ago" and no "just now" floor, so a counter that starts at zero can read
 * "0 s" instead of claiming the past tense. `timeSince` is worded on top of it:
 * one place decides how a duration is spelt.
 */
export function elapsed(when: string | number | null): string | null {
  if (when === null) return null;
  const ms = typeof when === 'number' ? when : Date.parse(when);
  if (Number.isNaN(ms)) return null;
  return formatDuration(Date.now() - ms);
}

/**
 * A span in the same words, between two instants that are both in the past —
 * how long an agent ran, say. `elapsed` is this one measured against now: the
 * spelling lives here, once.
 */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  // Seconds are the point of this format; they only become noise past an hour.
  if (hours === 0) parts.push(`${seconds} s`);
  return parts.join(' ');
}

/**
 * The same span where fractions of a second are the point — a tool call's wall
 * time is 60 ms at one median in this corpus. `formatDuration` starts flooring
 * at the second, which would spell most of a tool run "0 s".
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  // 59,950+ would print "60.0 s" below and "N min 60 s" if the seconds were
  // rounded after the minutes were cut — so round to whole seconds FIRST and
  // split what that gives (the bug shipped in answerTime for a while).
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const totalS = Math.round(ms / 1000);
  return `${Math.floor(totalS / 60)} min ${totalS % 60} s`;
}

/**
 * Milliseconds between two transcript timestamps, or null when either is
 * missing or unreadable. Clamped at zero: a replayed segment keeps its original
 * clocks, and a span must never read negative for it.
 */
export function msBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, b - a);
}

/** The span between two transcript timestamps, or null when either is missing. */
export function durationBetween(from: string | null, to: string | null): string | null {
  const ms = msBetween(from, to);
  return ms === null ? null : formatDuration(ms);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "claude-fable-5" → "fable-5" */
export function shortModel(model: string | null): string | null {
  return model ? model.replace(/^claude-/, '') : null;
}

export function entrypointLabel(entrypoint: string | null): string | null {
  switch (entrypoint) {
    case 'cli':
      return '❯ cli';
    case 'claude-desktop':
      return '🖥 desktop';
    case 'claude-vscode':
      return '⧉ vscode';
    default:
      return entrypoint;
  }
}

/**
 * The tail of the folder a file is in — the last two segments, marked as cut.
 *
 * Here rather than in the component that first needed it, because two now do and
 * they must cut identically: the delivery card in the conversation and the panel
 * that indexes every delivery of the session.
 *
 * The whole path is neither useful nor showable in a row: these are absolute
 * scratchpad paths of ~130 characters whose first ~110 are identical on every
 * one, so a truncated column spends its width on the shared half and runs out
 * before the part that differs. The end is the part that says anything, and the
 * whole path belongs on the link's title and in its href.
 */
export function folderTail(path: string, name: string): string {
  const dir = path.slice(0, path.length - name.length).replace(/[\\/]+$/, '');
  const parts = dir.split(/[\\/]/);
  const tail = parts.slice(-2).join('\\');
  return parts.length > 2 ? `…\\${tail}` : dir;
}
