import { foldText } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.ts';
import { CopyTextButton } from '../components/list/CopyTextButton.tsx';
import { ProjectTag } from '../components/list/ProjectTag.tsx';
import { formatDateTime, relativeTime } from '../lib/format.ts';

const FALLBACK_COLOR = 'hsl(0 0% 55%)';

export function PromptsPage() {
  const prompts = useQuery({ queryKey: ['prompts'], queryFn: api.prompts });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [q, setQ] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects.data ?? []) map.set(p.key, p.color);
    return map;
  }, [projects.data]);

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of prompts.data ?? []) if (!seen.has(p.projectKey)) seen.set(p.projectKey, p.projectName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }));
  }, [prompts.data]);

  const rows = useMemo(() => {
    let list = prompts.data ?? [];
    if (projectFilter) list = list.filter((p) => p.projectKey === projectFilter);
    const needle = foldText(q.trim());
    if (needle.length >= 2) list = list.filter((p) => foldText(p.display).includes(needle));
    return list;
  }, [prompts.data, q, projectFilter]);

  if (prompts.isLoading) return <div className="p-8 text-[var(--text-dim)]">Loading prompts…</div>;
  if (prompts.isError) return <div className="p-8 text-red-400">Failed: {String(prompts.error)}</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search every prompt you ever typed…"
          className="max-w-md min-w-48 flex-1 rounded border border-[var(--border)] bg-[var(--bg-raised)] px-2.5 py-1 text-sm placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] focus:outline-none"
        />
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
        <span className="ml-auto text-[var(--text-dim)]">{rows.length} prompts</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((p, i) => (
          <div key={`${p.sessionId}-${p.timestamp}-${i}`} className="border-b border-[var(--border)] px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
              <ProjectTag
                name={p.projectName}
                path={p.project}
                color={colorByProject.get(p.projectKey) ?? FALLBACK_COLOR}
              />
              <span title={formatDateTime(p.timestamp)}>
                {formatDateTime(p.timestamp)} · {relativeTime(p.timestamp)}
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                <CopyTextButton text={p.display} title="Copy prompt to clipboard" />
                {p.sessionExists ? (
                  <Link
                    to={`/session/${p.sessionId}`}
                    className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
                  >
                    Open session →
                  </Link>
                ) : (
                  <span className="text-[10px] opacity-60" title="The session transcript no longer exists">
                    session deleted
                  </span>
                )}
              </span>
            </div>
            <div
              onClick={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
              className={`mt-1 cursor-pointer text-sm whitespace-pre-wrap ${expanded.has(i) ? '' : 'line-clamp-2'}`}
              title={expanded.has(i) ? 'Click to collapse' : 'Click to expand'}
            >
              {p.display}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-8 text-center text-[var(--text-dim)]">No prompts match.</div>}
      </div>
    </div>
  );
}
