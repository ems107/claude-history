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
