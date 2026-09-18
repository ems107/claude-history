import type { ProjectGroup, ProjectInfo, SessionSummary } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { entrypointLabel, shortModel } from '../../lib/format.ts';
import type { BadgeFilter, FilterState } from '../../lib/filters.ts';
import { projectFilterRows } from '../../lib/projects.ts';
import { RetentionFooter } from './RetentionFooter.tsx';

const BADGE_OPTIONS: Array<{ id: BadgeFilter; label: string }> = [
  { id: 'pinned', label: '★ Pinned' },
  { id: 'live', label: 'Running now' },
  { id: 'pr', label: 'Has PR' },
  { id: 'subagents', label: 'Has subagents' },
  { id: 'fork', label: 'Fork' },
  { id: 'bg', label: 'Background' },
];

/**
 * One array, so a settings query that has not answered yet does not hand
 * `projectFilterRows` a new empty list to re-sort on every render.
 */
const NO_GROUPS: ProjectGroup[] = [];

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
  indeterminate,
  indented,
  onChange,
  children,
  count,
}: {
  checked: boolean;
  /**
   * Some of what this row stands for is selected — a group with part of it
   * ticked, and nothing else here has a third state.
   *
   * Set through a ref because it is not an attribute: React knows nothing about
   * `indeterminate` and will not reconcile it, so it has to be written to the
   * node on every render. An inline callback ref is a new function each time,
   * which is exactly what makes that happen — and the body is a BLOCK, because
   * React 19 refuses a callback ref that returns anything but a cleanup.
   */
  indeterminate?: boolean;
  /** A member of the group above it. */
  indented?: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm select-none hover:bg-[var(--bg-hover)] max-md:min-h-11 max-md:gap-3 max-md:px-2 ${
        indented ? 'pl-5 max-md:pl-7' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate === true;
        }}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)] max-md:size-5"
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="text-xs text-[var(--text-dim)]">{count}</span>}
    </label>
  );
}

/**
 * Add or remove a set of values from a selection, as a SET.
 *
 * It took one value before, and appending it was harmless while only one row
 * could ever produce it. A group's checkbox produces several at once and the
 * rows below it can produce the same ones again: tick a group, then tick one of
 * its members, and `[...list, value]` had the key in there twice — after which
 * unticking that member removed BOTH copies and the group jumped from "all" to
 * "some" in one click. So adding is a union and removing is a difference, and no
 * caller has to think about it.
 */
function toggle(list: string[], values: readonly string[], on: boolean): string[] {
  if (!on) {
    const drop = new Set(values);
    return list.filter((v) => !drop.has(v));
  }
  const have = new Set(list);
  return [...list, ...values.filter((v) => !have.has(v))];
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
    'min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-1 py-0.5 [color-scheme:dark] max-md:min-h-10 max-md:px-2 max-md:text-sm';
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([id, label, days]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(days === null ? null : isoDaysAgo(days), null)}
            className={`cursor-pointer rounded border px-2 py-0.5 text-xs max-md:min-h-9 max-md:px-3 max-md:text-[13px] ${
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

  // `['settings']` is mounted for the life of the page by the header's usage
  // widget, so this is a read of a cache rather than a request — and reading it
  // here is what keeps the groups from being threaded through two pages and a
  // sheet to reach the one component that draws them.
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const groups = settings.data?.settings.projectGroups ?? NO_GROUPS;
  const hiddenCount = settings.data?.settings.hiddenProjects.length ?? 0;
  const rows = useMemo(() => projectFilterRows(projects, groups), [projects, groups]);
  const selected = useMemo(() => new Set(filters.projects), [filters.projects]);

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-r border-[var(--border)] max-md:border-r-0">
      <Section title="Projects">
        {rows.map((row) =>
          row.kind === 'group' ? (
            /* A group narrows nothing by itself: its checkbox is the whole of
               what it does in here, and what it does is tick its members. The
               URL still carries the keys, so a copied link keeps meaning what
               it meant after the group is renamed or deleted. */
            <CheckRow
              key={`g-${row.id}`}
              checked={row.keys.every((k) => selected.has(k))}
              indeterminate={!row.keys.every((k) => selected.has(k)) && row.keys.some((k) => selected.has(k))}
              onChange={(on) => onChange({ ...filters, projects: toggle(filters.projects, row.keys, on) })}
              count={row.count}
            >
              {/* No colour dot: a group has no colour of its own, and borrowing
                  a member's would say something untrue about the rows below. */}
              <span className="font-medium">{row.name}</span>
            </CheckRow>
          ) : (
            <CheckRow
              key={row.project.key}
              checked={selected.has(row.project.key)}
              indented={row.indented}
              onChange={(on) => onChange({ ...filters, projects: toggle(filters.projects, [row.project.key], on) })}
              count={row.project.sessionCount}
            >
              <span className="inline-flex items-center gap-1.5" title={row.project.path}>
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.project.color }} />
                {row.project.name}
              </span>
            </CheckRow>
          ),
        )}
        {/* A hidden project is a shorter list with no filter to explain it, which
            is the one thing `activeFilterCount` exists to prevent — and it
            cannot count this, because hiding is not a filter and un-hiding is
            not something this panel can do. So the panel says it instead, and
            links to where it can be undone. */}
        {hiddenCount > 0 && (
          <Link
            to="/settings/projects#projects-visible"
            // A link is a decision, so it gets a thumb: `block` at 17px tall is
            // a desktop target, and this section is a full-screen sheet on a
            // phone where it is the only way to what it points at.
            className="mt-1.5 flex items-center px-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--accent)] max-md:min-h-11 max-md:px-2 max-md:text-[13px]"
          >
            {hiddenCount} project{hiddenCount === 1 ? '' : 's'} hidden in Settings
          </Link>
        )}
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
              onChange({ ...filters, badges: toggle(filters.badges, [b.id], on) as BadgeFilter[] })
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
              onChange={(on) => onChange({ ...filters, entrypoints: toggle(filters.entrypoints, [e], on) })}
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
              onChange={(on) => onChange({ ...filters, models: toggle(filters.models, [m], on) })}
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

      {/* Every session listed here has an expiry date, and it is set outside this
          app. `mt-auto` pins this to the bottom when the filters are short and
          lets it scroll with them when they are not. */}
      <RetentionFooter />
    </aside>
  );
}
