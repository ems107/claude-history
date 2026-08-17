import type { PlanEntry } from '@claude-history/shared';
import { foldText } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { OrderBar } from '../components/list/OrderBar.tsx';
import { ProjectTag } from '../components/list/ProjectTag.tsx';
import { formatDateTime, relativeTime } from '../lib/format.ts';
import { groupBySession, sortByDate, useOrder } from '../lib/order.ts';

const FALLBACK_COLOR = 'hsl(0 0% 55%)';

const STATUS: Record<PlanEntry['status'], { label: string; tone: string }> = {
  approved: { label: '✔ approved', tone: 'text-emerald-400' },
  rejected: { label: '✖ not approved', tone: 'text-amber-400' },
  pending: { label: 'awaiting an answer', tone: 'text-[var(--text-dim)]' },
};

/**
 * What is left of a plan on disk, and it is usually nothing.
 *
 * `~/.claude/plans/<slug>.md` is named after the session and overwritten, so a
 * session that planned twice keeps only its latest. Saying so is half the value
 * of this page: the transcript is the archive, the file is a working copy.
 */
function DiskState({ plan }: { plan: PlanEntry }) {
  if (plan.onDisk === null) {
    return (
      <span className="text-[10px] text-[var(--text-dim)]/70" title="This plan recorded no file path.">
        no file
      </span>
    );
  }
  if (plan.onDisk) {
    return (
      <span className="text-[10px] text-emerald-400/80" title={plan.filePath ?? undefined}>
        on disk
      </span>
    );
  }
  return (
    <span
      className="text-[10px] text-[var(--text-dim)]/70"
      title={`${plan.filePath ?? 'The plan file'} now holds a different plan — the file is named after the session and gets overwritten.`}
    >
      overwritten
    </span>
  );
}

function PlanRow({ plan: p, color }: { plan: PlanEntry; color: string }) {
  return (
    <div className="border-b border-[var(--border)] px-4 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
        <ProjectTag name={p.projectName} path={p.project} color={color} />
        {p.askedAt && (
          <span title={formatDateTime(p.askedAt)}>
            {formatDateTime(p.askedAt)} · {relativeTime(p.askedAt)}
          </span>
        )}
        <span className={`font-semibold ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
        <DiskState plan={p} />
        <span className="ml-auto inline-flex items-center gap-1.5">
          {/* Straight to the plan itself, not merely to the session: the
              viewer opens the segment, the run and the call from `?tool=`. */}
          <Link
            to={`/session/${p.sessionId}?tool=${encodeURIComponent(p.toolUseId)}`}
            className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
          >
            Open the plan →
          </Link>
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--text)]">
        {p.title ?? <span className="font-normal text-[var(--text-dim)] italic">untitled plan</span>}
      </div>
      {p.feedback && (
        <div className="mt-1 border-l-2 border-amber-500/40 pl-2 text-xs text-[var(--text-dim)]">
          <span className="font-semibold text-amber-400/80">the user said: </span>
          {p.feedback}
        </div>
      )}
      {/* Which session this belongs to, by name AND by id. The name is
          what a reader recognises; the id is what the app writes
          everywhere else — the URL, the log, a fork chip — and what
          pasting eight characters back into the search finds. Same eight
          and same mono chip as the session header, so the two read as the
          same thing. */}
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-dim)]/80">
        <span>{p.chars.toLocaleString()} chars</span>
        <span className="opacity-50">·</span>
        <span>in</span>
        <Link to={`/session/${p.sessionId}`} className="hover:text-[var(--text)] hover:underline">
          {p.sessionTitle}
        </Link>
        <Link
          to={`/session/${p.sessionId}`}
          title={p.sessionId}
          className="rounded bg-amber-500/10 px-1.5 py-px font-mono text-amber-400 hover:bg-amber-500/20"
        >
          {p.sessionId.slice(0, 8)}
        </Link>
      </div>
    </div>
  );
}

export function PlansPage() {
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [q, setQ] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [status, setStatus] = useState('');
  const [order, setOrder] = useOrder('plansOrder');

  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects.data ?? []) map.set(p.key, p.color);
    return map;
  }, [projects.data]);

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of plans.data ?? []) if (!seen.has(p.projectKey)) seen.set(p.projectKey, p.projectName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }));
  }, [plans.data]);

  const rows = useMemo(() => {
    let list = plans.data ?? [];
    if (projectFilter) list = list.filter((p) => p.projectKey === projectFilter);
    if (status) list = list.filter((p) => p.status === status);
    const needle = foldText(q.trim());
    if (needle.length >= 2) {
      list = list.filter((p) => foldText(`${p.title ?? ''} ${p.preview} ${p.sessionTitle}`).includes(needle));
    }
    return list;
  }, [plans.data, q, projectFilter, status]);

  // When it was submitted for approval — the one date a plan has from the start
  // (a pending one was never decided).
  const at = (p: PlanEntry) => p.askedAt;
  const flat = useMemo(() => sortByDate(rows, at, order.dir), [rows, order.dir]);
  const groups = useMemo(
    () => groupBySession(rows, at, (p) => ({ sessionId: p.sessionId, sessionTitle: p.sessionTitle }), order.dir),
    [rows, order.dir],
  );

  if (plans.isLoading) return <div className="p-8 text-[var(--text-dim)]">Loading plans…</div>;
  if (plans.isError) return <div className="p-8 text-red-400">Failed: {String(plans.error)}</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search every plan you were ever shown…"
          className="max-w-md min-w-48 flex-1 rounded border border-[var(--border)] bg-[var(--bg-raised)] px-2.5 py-1 text-sm placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] focus:outline-none"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-1 text-xs text-[var(--text-dim)]"
        >
          <option value="">Any outcome</option>
          <option value="approved">Approved</option>
          <option value="rejected">Not approved</option>
          <option value="pending">Awaiting an answer</option>
        </select>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-1 text-xs text-[var(--text-dim)]"
        >
          <option value="">All projects</option>
          {projectOptions.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        <span className="text-[var(--text-dim)]">
          {rows.length} plan{rows.length === 1 ? '' : 's'}
          {order.group === 'session' && ` in ${groups.length} session${groups.length === 1 ? '' : 's'}`}
        </span>
        <span className="ml-auto">
          <OrderBar
            order={order}
            onChange={setOrder}
            field="Asked"
            groupHint="Group the plans by the session that submitted them, newest session first"
          />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {order.group === 'session'
          ? groups.map((group) => (
              <div key={group.sessionId}>
                <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-raised)] px-4 py-1 text-xs text-[var(--text-dim)]">
                  <Link
                    to={`/session/${group.sessionId}`}
                    className="min-w-0 truncate font-semibold text-[var(--text)] hover:underline"
                  >
                    {group.sessionTitle}
                  </Link>
                  <Link
                    to={`/session/${group.sessionId}`}
                    title={group.sessionId}
                    className="shrink-0 rounded bg-amber-500/10 px-1.5 py-px font-mono text-amber-400 hover:bg-amber-500/20"
                  >
                    {group.sessionId.slice(0, 8)}
                  </Link>
                  <span className="ml-auto shrink-0">
                    {group.items.length} plan{group.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                {group.items.map((p) => (
                  <PlanRow
                    key={`${p.sessionId}-${p.toolUseId}`}
                    plan={p}
                    color={colorByProject.get(p.projectKey) ?? FALLBACK_COLOR}
                  />
                ))}
              </div>
            ))
          : flat.map((p) => (
              <PlanRow
                key={`${p.sessionId}-${p.toolUseId}`}
                plan={p}
                color={colorByProject.get(p.projectKey) ?? FALLBACK_COLOR}
              />
            ))}
        {rows.length === 0 && <div className="p-8 text-center text-[var(--text-dim)]">No plans match.</div>}
      </div>
    </div>
  );
}
