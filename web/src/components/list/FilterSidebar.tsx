import type { ProjectInfo, SessionSummary } from '@claude-history/shared';
import { useMemo, type ReactNode } from 'react';
import { entrypointLabel, shortModel } from '../../lib/format.ts';
import type { BadgeFilter, FilterState } from '../../lib/filters.ts';

const BADGE_OPTIONS: Array<{ id: BadgeFilter; label: string }> = [
  { id: 'pinned', label: '★ Pinned' },
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

const PRESETS: Array<[string, string, number | null]> = [
  ['all', 'All', null],
  ['today', 'Today', 0],
  ['7d', '7 days', 7],
  ['30d', '30 days', 30],
];

/** Quick presets + explicit range, shared by the two date filters. */
function DateFilter({
  from,
  to,
  activePreset,
  onChange,
}: {
  from: string | null;
  to: string | null;
  activePreset: string;
  onChange: (from: string | null, to: string | null) => void;
}) {
  // color-scheme: dark makes the browser's native calendar icon light, which
  // is the only way it stays visible on this theme.
  const dateInput =
    'min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-1 py-0.5 [color-scheme:dark]';
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([id, label, days]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(days === null ? null : isoDaysAgo(days), null)}
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
        <input type="date" value={from ?? ''} onChange={(e) => onChange(e.target.value || null, to)} className={dateInput} />
        <span>→</span>
        <input type="date" value={to ?? ''} onChange={(e) => onChange(from, e.target.value || null)} className={dateInput} />
      </div>
    </>
  );
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

  const presetOf = (from: string | null, to: string | null): string => {
    if (to !== null) return 'custom';
    if (from === null) return 'all';
    if (from === isoDaysAgo(0)) return 'today';
    if (from === isoDaysAgo(7)) return '7d';
    if (from === isoDaysAgo(30)) return '30d';
    return 'custom';
  };

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [projects],
  );

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-r border-[var(--border)]">
      <Section title="Projects">
        {sortedProjects.map((p) => (
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

      <Section title="Last activity">
        <DateFilter
          from={filters.from}
          to={filters.to}
          activePreset={presetOf(filters.from, filters.to)}
          onChange={(from, to) => onChange({ ...filters, from, to })}
        />
      </Section>

      <Section title="Created">
        <DateFilter
          from={filters.createdFrom}
          to={filters.createdTo}
          activePreset={presetOf(filters.createdFrom, filters.createdTo)}
          onChange={(createdFrom, createdTo) => onChange({ ...filters, createdFrom, createdTo })}
        />
      </Section>

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

      <Section title="Other">
        <CheckRow checked={filters.showEmpty} onChange={(on) => onChange({ ...filters, showEmpty: on })}>
          Show empty sessions
        </CheckRow>
      </Section>
    </aside>
  );
}
