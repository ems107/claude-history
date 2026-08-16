import type { PlanEntry } from '@claude-history/shared';
import { foldText } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { ProjectTag } from '../components/list/ProjectTag.tsx';
import { formatDateTime, relativeTime } from '../lib/format.ts';

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

export function PlansPage() {
  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [q, setQ] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [status, setStatus] = useState('');

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
        <span className="ml-auto text-[var(--text-dim)]">
          {rows.length} plan{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((p) => (
          <div key={`${p.sessionId}-${p.toolUseId}`} className="border-b border-[var(--border)] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
              <ProjectTag
                name={p.projectName}
                path={p.project}
                color={colorByProject.get(p.projectKey) ?? FALLBACK_COLOR}
              />
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
            <div className="mt-0.5 text-xs text-[var(--text-dim)]/80">
              {p.chars.toLocaleString()} chars · in{' '}
              <Link to={`/session/${p.sessionId}`} className="hover:text-[var(--text)] hover:underline">
                {p.sessionTitle}
              </Link>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-8 text-center text-[var(--text-dim)]">No plans match.</div>}
      </div>
    </div>
  );
}
