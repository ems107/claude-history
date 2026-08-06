import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { SessionRow } from '../components/list/SessionRow.tsx';

const ROW_HEIGHT = 64;
const FALLBACK_COLOR = 'hsl(0 0% 55%)';

export function SessionListPage() {
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [hideEmpty, setHideEmpty] = useState(() => localStorage.getItem('hideEmpty') !== 'false');

  const colorByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects.data ?? []) map.set(p.key, p.color);
    return map;
  }, [projects.data]);

  const rows = useMemo(() => {
    const all = sessions.data ?? [];
    const filtered = hideEmpty ? all.filter((s) => !s.isEmpty) : all;
    return [...filtered].sort((a, b) => b.mtimeMs - a.mtimeMs);
  }, [sessions.data, hideEmpty]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (sessions.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Scanning sessions…</div>;
  }
  if (sessions.isError) {
    return <div className="p-8 text-red-400">Failed to load sessions: {String(sessions.error)}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-4 border-b border-[var(--border)] px-4 py-2 text-sm text-[var(--text-dim)]">
        <span>
          {rows.length} sessions · {projects.data?.length ?? 0} projects
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 select-none">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => {
              setHideEmpty(e.target.checked);
              localStorage.setItem('hideEmpty', String(e.target.checked));
            }}
            className="accent-[var(--accent)]"
          />
          Hide empty sessions
        </label>
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const session = rows[vi.index];
            return (
              <div
                key={session.id}
                className="absolute top-0 left-0 w-full"
                style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
              >
                <SessionRow
                  session={session}
                  color={colorByProject.get(session.projectKey) ?? FALLBACK_COLOR}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
