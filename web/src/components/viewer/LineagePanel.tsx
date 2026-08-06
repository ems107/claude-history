import type { LineageResponse } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { formatDateTime } from '../../lib/format.ts';

interface Level {
  depth: number;
  nodes: LineageResponse['nodes'];
}

/** Vertical generations view of the resume/fork chain around a session. */
export function LineagePanel({ sessionId }: { sessionId: string }) {
  const query = useQuery({ queryKey: ['lineage', sessionId], queryFn: () => api.lineage(sessionId) });

  const levels = useMemo((): Level[] => {
    const data = query.data;
    if (!data) return [];
    const incoming = new Map<string, string[]>();
    for (const e of data.edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
    // depth = longest ancestor chain (graph is tiny; iterate to fixpoint)
    const depth = new Map<string, number>();
    const nodeIds = data.nodes.map((n) => n.id);
    for (const id of nodeIds) depth.set(id, 0);
    for (let i = 0; i < nodeIds.length; i++) {
      let changed = false;
      for (const e of data.edges) {
        const d = (depth.get(e.from) ?? 0) + 1;
        if (d > (depth.get(e.to) ?? 0)) {
          depth.set(e.to, d);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const byDepth = new Map<number, LineageResponse['nodes']>();
    for (const n of data.nodes) {
      const d = depth.get(n.id) ?? 0;
      byDepth.set(d, [...(byDepth.get(d) ?? []), n]);
    }
    return [...byDepth.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, nodes]) => ({
        depth: d,
        nodes: nodes.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')),
      }));
  }, [query.data]);

  if (query.isLoading) return <div className="border-b border-[var(--border)] p-3 text-xs text-[var(--text-dim)]">Loading lineage…</div>;
  if (query.isError || !query.data) return null;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-raised)]/50 px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">
        Resume lineage — {query.data.nodes.length} sessions
      </div>
      <div className="space-y-1">
        {levels.map((level) => (
          <div key={level.depth} className="flex items-start gap-2">
            <span className="mt-1 w-10 shrink-0 text-right font-mono text-[10px] text-[var(--text-dim)]">
              {level.depth === 0 ? 'root' : `↳ ${level.depth}`}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {level.nodes.map((n) =>
                n.exists ? (
                  <Link
                    key={n.id}
                    to={`/session/${n.id}`}
                    className={`max-w-full rounded border px-2 py-1 text-xs hover:bg-[var(--bg-hover)] ${
                      n.id === sessionId
                        ? 'border-[var(--accent)] text-[var(--text)]'
                        : 'border-[var(--border)] text-[var(--text-dim)]'
                    }`}
                    title={`${n.id}\nCreated: ${formatDateTime(n.createdAt)}\nLast activity: ${formatDateTime(n.lastActivityAt)}`}
                  >
                    <span className="font-medium">{n.title}</span>
                    <span className="ml-2 opacity-60">
                      {n.projectName} · {formatDateTime(n.createdAt).slice(0, 10)}
                    </span>
                    {n.id === sessionId && <span className="ml-2 text-[var(--accent)]">◀ you are here</span>}
                  </Link>
                ) : (
                  <span
                    key={n.id}
                    className="rounded border border-dashed border-[var(--border)] px-2 py-1 font-mono text-xs text-[var(--text-dim)] opacity-60"
                    title="This session's transcript no longer exists on disk"
                  >
                    {n.id.slice(0, 8)} (deleted)
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
