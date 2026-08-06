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

const dtf = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const dtfFull = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  year: 'numeric',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatDateTime(when: string | number | null): string {
  if (when === null) return '—';
  const ms = typeof when === 'number' ? when : Date.parse(when);
  return Number.isNaN(ms) ? '—' : dtf.format(ms);
}

export function formatDateTimeFull(when: string | number | null): string {
  if (when === null) return '—';
  const ms = typeof when === 'number' ? when : Date.parse(when);
  return Number.isNaN(ms) ? '—' : dtfFull.format(ms);
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
