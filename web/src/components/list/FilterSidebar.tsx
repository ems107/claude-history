import type { ProjectInfo, SessionSummary } from '@claude-history/shared';
import { useMemo, type ReactNode } from 'react';
import { entrypointLabel, shortModel } from '../../lib/format.ts';
import type { BadgeFilter, FilterState } from '../../lib/filters.ts';

const BADGE_OPTIONS: Array<{ id: BadgeFilter; label: string }> = [
  { id: 'live', label: 'Running now' },
  { id: 'pr', label: 'Has PR' },
  { id: 'subagents', label: 'Has subagents' },
  { id: 'resumed', label: 'Resumed' },
  { id: 'bg', label: 'Background' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-[var(--border)] px-3 py-3">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">{title}</div>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
  count,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm select-none hover:bg-[var(--bg-hover)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)]"
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="text-xs text-[var(--text-dim)]">{count}</span>}
    </label>
  );
}

function toggle(list: string[], value: string, on: boolean): string[] {
  return on ? [...list, value] : list.filter((v) => v !== value);
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}

export function FilterSidebar({
  sessions,
  projects,
  filters,
  onChange,
}: {
  sessions: SessionSummary[];
  projects: ProjectInfo[];
  filters: FilterState;
  onChange: (f: FilterState) => void;
}) {
  const counts = useMemo(() => {
    const entry = new Map<string, number>();
    const model = new Map<string, number>();
    for (const s of sessions) {
      if (s.isEmpty && !filters.showEmpty) continue;
      if (s.entrypoint) entry.set(s.entrypoint, (entry.get(s.entrypoint) ?? 0) + 1);
      if (s.model) model.set(s.model, (model.get(s.model) ?? 0) + 1);
    }
    return { entry: [...entry.entries()].sort((a, b) => b[1] - a[1]), model: [...model.entries()].sort((a, b) => b[1] - a[1]) };
  }, [sessions, filters.showEmpty]);

  const activePreset =
    filters.to === null
      ? filters.from === null
        ? 'all'
        : filters.from === isoDaysAgo(0)
          ? 'today'
          : filters.from === isoDaysAgo(7)
            ? '7d'
            : filters.from === isoDaysAgo(30)
              ? '30d'
              : 'custom'
      : 'custom';

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)]">
      <Section title="Projects">
        {filters.projects.length > 0 && (
          <button
            type="button"
            className="mb-1 cursor-pointer text-xs text-[var(--accent)] hover:underline"
            onClick={() => onChange({ ...filters, projects: [] })}
          >
            Clear selection
          </button>
        )}
        {projects.map((p) => (
          <CheckRow
            key={p.key}
            checked={filters.projects.includes(p.key)}
            onChange={(on) => onChange({ ...filters, projects: toggle(filters.projects, p.key, on) })}
            count={p.sessionCount}
          >
            <span className="inline-flex items-center gap-1.5" title={p.path}>
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
          </CheckRow>
        ))}
      </Section>

      <Section title="Date">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['all', 'All', null],
              ['today', 'Today', 0],
              ['7d', '7 days', 7],
              ['30d', '30 days', 30],
            ] as Array<[string, string, number | null]>
          ).map(([id, label, days]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange({ ...filters, from: days === null ? null : isoDaysAgo(days), to: null })}
              className={`cursor-pointer rounded border px-2 py-0.5 text-xs ${
                activePreset === id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1 text-xs text-[var(--text-dim)]">
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => onChange({ ...filters, from: e.target.value || null })}
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-1 py-0.5"
          />
          <span>→</span>
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => onChange({ ...filters, to: e.target.value || null })}
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-1 py-0.5"
          />
        </div>
      </Section>

      {counts.entry.length > 1 && (
        <Section title="Source">
          {counts.entry.map(([e, n]) => (
            <CheckRow
              key={e}
              checked={filters.entrypoints.includes(e)}
              onChange={(on) => onChange({ ...filters, entrypoints: toggle(filters.entrypoints, e, on) })}
              count={n}
            >
              {entrypointLabel(e)}
            </CheckRow>
          ))}
        </Section>
      )}

      {counts.model.length > 1 && (
        <Section title="Model">
          {counts.model.map(([m, n]) => (
            <CheckRow
              key={m}
              checked={filters.models.includes(m)}
              onChange={(on) => onChange({ ...filters, models: toggle(filters.models, m, on) })}
              count={n}
            >
              {shortModel(m)}
            </CheckRow>
          ))}
        </Section>
      )}

      <Section title="Badges">
        {BADGE_OPTIONS.map((b) => (
          <CheckRow
            key={b.id}
            checked={filters.badges.includes(b.id)}
            onChange={(on) =>
              onChange({ ...filters, badges: toggle(filters.badges, b.id, on) as BadgeFilter[] })
            }
          >
            {b.label}
          </CheckRow>
        ))}
      </Section>

      <Section title="Other">
        <CheckRow checked={filters.showEmpty} onChange={(on) => onChange({ ...filters, showEmpty: on })}>
          Show empty sessions
        </CheckRow>
      </Section>
    </aside>
  );
}
