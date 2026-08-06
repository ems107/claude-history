import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { ResumeButtons } from '../components/viewer/ResumeButtons.tsx';
import { SessionHeader } from '../components/viewer/SessionHeader.tsx';
import { SubagentDrawer } from '../components/viewer/SubagentDrawer.tsx';
import { TokenPanel } from '../components/viewer/TokenPanel.tsx';
import { TurnList } from '../components/viewer/TurnList.tsx';

const FALLBACK_COLOR = 'hsl(0 0% 55%)';

export function SessionViewPage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const detail = useQuery({ queryKey: ['session', id], queryFn: () => api.session(id), enabled: !!id });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [showThinking, setShowThinking] = useState(() => localStorage.getItem('showThinking') === 'true');
  const [showTokens, setShowTokens] = useState(false);

  const msg = searchParams.get('msg');
  const agentId = searchParams.get('agent');

  const closeAgent = useCallback(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete('agent');
        return sp;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const openAgent = useCallback(
    (aid: string) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set('agent', aid);
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (agentId) closeAgent();
      else navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agentId, closeAgent, navigate]);

  if (detail.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Parsing conversation…</div>;
  }
  if (detail.isError || !detail.data) {
    return <div className="p-8 text-red-400">Failed to load session: {String(detail.error ?? 'not found')}</div>;
  }

  const color =
    projects.data?.find((p) => p.key === detail.data.summary.projectKey)?.color ?? FALLBACK_COLOR;

  return (
    <div className="flex h-full flex-col">
      <SessionHeader
        detail={detail.data}
        color={color}
        showThinking={showThinking}
        onToggleThinking={() => {
          setShowThinking((v) => {
            localStorage.setItem('showThinking', String(!v));
            return !v;
          });
        }}
        showTokens={showTokens}
        onToggleTokens={() => setShowTokens((v) => !v)}
        actions={<ResumeButtons session={detail.data.summary} />}
      />
      {showTokens && <TokenPanel summary={detail.data.summary} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-4xl">
          <TurnList
            turns={detail.data.turns}
            showThinking={showThinking}
            scrollToUuid={msg}
            onOpenAgent={openAgent}
          />
          {detail.data.turns.length === 0 && (
            <div className="p-8 text-center text-[var(--text-dim)]">This session has no conversation content.</div>
          )}
        </div>
      </div>
      {agentId && (
        <SubagentDrawer sessionId={id} agentId={agentId} showThinking={showThinking} onClose={closeAgent} />
      )}
    </div>
  );
}
