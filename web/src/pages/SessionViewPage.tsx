import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { ExportButton } from '../components/viewer/ExportButton.tsx';
import { FileChangesPanel } from '../components/viewer/FileChangesPanel.tsx';
import { FollowBottomButton, useFollowBottom } from '../components/viewer/FollowBottom.tsx';
import { LineagePanel } from '../components/viewer/LineagePanel.tsx';
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
  const [expandTools, setExpandTools] = useState(() => localStorage.getItem('expandTools') === 'true');
  const [promptsOnly, setPromptsOnly] = useState(() => localStorage.getItem('promptsOnly') === 'true');
  // Not persisted: folded is the point of the feature, and a session opened
  // tomorrow should still open on the context that is alive.
  const [expandSegments, setExpandSegments] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const [showLineage, setShowLineage] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  // Keyed on the session id: opening another one starts unfollowed.
  const follow = useFollowBottom(id);

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

  const { thinkingCount, toolCount, compactionCount } = useMemo(() => {
    const blocks = (detail.data?.turns ?? []).flatMap((t) => t.items).flatMap((i) => i.blocks);
    return {
      thinkingCount: blocks.filter((b) => b.kind === 'thinking').length,
      toolCount: blocks.filter((b) => b.kind === 'tool').length,
      compactionCount: blocks.filter((b) => b.kind === 'compact').length,
    };
  }, [detail.data]);

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
        thinkingCount={thinkingCount}
        expandTools={expandTools}
        onToggleTools={() => {
          setExpandTools((v) => {
            localStorage.setItem('expandTools', String(!v));
            return !v;
          });
        }}
        toolCount={toolCount}
        promptsOnly={promptsOnly}
        onTogglePromptsOnly={() => {
          setPromptsOnly((v) => {
            localStorage.setItem('promptsOnly', String(!v));
            return !v;
          });
        }}
        expandSegments={expandSegments}
        onToggleSegments={() => setExpandSegments((v) => !v)}
        compactionCount={compactionCount}
        showTokens={showTokens}
        onToggleTokens={() => setShowTokens((v) => !v)}
        showLineage={showLineage}
        onToggleLineage={() => setShowLineage((v) => !v)}
        showFiles={showFiles}
        onToggleFiles={() => setShowFiles((v) => !v)}
        actions={
          <>
            <ExportButton detail={detail.data} />
            <ResumeButtons session={detail.data.summary} />
          </>
        }
      />
      {showTokens && <TokenPanel summary={detail.data.summary} turns={detail.data.turns} />}
      {showLineage && <LineagePanel sessionId={id} />}
      {showFiles && <FileChangesPanel fileChanges={detail.data.fileChanges} />}
      {/* The pill is a sibling of the scroller, not a child: inside it, it would
          scroll away with the conversation. */}
      <div className="relative min-h-0 flex-1">
        <div ref={follow.scrollRef} className="h-full overflow-y-auto px-4 py-4">
          <div ref={follow.contentRef} className="mx-auto max-w-4xl">
            <TurnList
              // Keyed on the session: what the user unfolded here must not
              // carry over to the next session's segments and turns.
              key={id}
              turns={detail.data.turns}
              showThinking={showThinking}
              expandTools={expandTools}
              promptsOnly={promptsOnly}
              expandSegments={expandSegments}
              scrollToUuid={msg}
              onOpenAgent={openAgent}
            />
            {detail.data.turns.length === 0 && (
              <div className="p-8 text-center text-[var(--text-dim)]">This session has no conversation content.</div>
            )}
          </div>
        </div>
        {follow.scrollable && <FollowBottomButton following={follow.following} toggle={follow.toggle} />}
      </div>
      {agentId && (
        <SubagentDrawer sessionId={id} agentId={agentId} showThinking={showThinking} onClose={closeAgent} />
      )}
    </div>
  );
}
