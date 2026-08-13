import type { LiveInfo, Turn } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { useFoldState } from '../lib/folding.ts';
import { parseHighlight, TOOL_PARAM } from '../lib/highlight.ts';
import { useViewPrefs, WIDTH_FULL, ZOOM_DEFAULT } from '../lib/viewPrefs.ts';
import { Composer } from '../components/viewer/Composer.tsx';
import { ExportButton } from '../components/viewer/ExportButton.tsx';
import { FileChangesPanel } from '../components/viewer/FileChangesPanel.tsx';
import { FollowBottomButton, useFollowBottom } from '../components/viewer/FollowBottom.tsx';
import { LineagePanel } from '../components/viewer/LineagePanel.tsx';
import { PendingTurn } from '../components/viewer/PendingTurn.tsx';
import { ResumeButtons } from '../components/viewer/ResumeButtons.tsx';
import { SessionHeader } from '../components/viewer/SessionHeader.tsx';
import { SubagentDrawer } from '../components/viewer/SubagentDrawer.tsx';
import { TokenPanel } from '../components/viewer/TokenPanel.tsx';
import { TurnList } from '../components/viewer/TurnList.tsx';
import { ViewButton } from '../components/viewer/ViewButton.tsx';
import { isWorking, WorkingIndicator } from '../components/viewer/WorkingIndicator.tsx';

const FALLBACK_COLOR = 'hsl(0 0% 55%)';
/** Stable identity while the conversation loads, so the fold state is not rebuilt. */
const EMPTY_TURNS: Turn[] = [];

export function SessionViewPage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const detail = useQuery({ queryKey: ['session', id], queryFn: () => api.session(id), enabled: !!id });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  /**
   * The live state comes from here and NOT from `detail.data.summary.live`,
   * which carries the same field: that query is invalidated by 'sessions-changed'
   * (the transcript grew), while the busy/idle flip is a write under
   * ~/.claude/sessions and only ever fires 'live-changed'. Reading it off the
   * detail would leave the indicator stuck on "working" after the last line of
   * the turn was written — and re-parsing a multi-MB transcript on every status
   * flip to avoid that would be absurd next to this, which reads two small files.
   */
  const live = useQuery({
    queryKey: ['live'],
    queryFn: api.live,
    enabled: !!id,
    // The poll is a backstop for the one thing SSE cannot report: a CLI killed
    // outright leaves its file saying "busy" and writes nothing more, so no
    // event ever comes — the server drops it by pid liveness, but only if asked.
    // It runs solely while a turn is in flight, and never touches the network.
    refetchInterval: (query) =>
      query.state.data?.some((l) => l.sessionId === id && l.status === 'busy') ? 10_000 : false,
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const chatEnabled = settings.data?.settings.chatEnabled ?? false;
  /**
   * Prompts sent from the composer that the transcript has not caught up with.
   * `at` is when it was accepted, which is also when the turn really began —
   * the indicator counts from it while the server's own figure is in flight.
   */
  const [pending, setPending] = useState<{ text: string; at: number }[]>([]);
  /**
   * Shared with the Composer through the query key — one request, two readers.
   * The page needs it for the working indicator, because a `--print` process
   * writes no `status` into ~/.claude/sessions and so never shows up as busy
   * in /api/live, however long it works.
   */
  const chat = useQuery({
    queryKey: ['chat', id],
    queryFn: () => api.chatStatus(id),
    enabled: !!id && chatEnabled,
  });
  const [showThinking, setShowThinking] = useState(() => localStorage.getItem('showThinking') === 'true');
  const [expandTools, setExpandTools] = useState(() => localStorage.getItem('expandTools') === 'true');
  // Not persisted: folded is the point of the feature, and a session opened
  // tomorrow should still open on the context that is alive.
  const [expandSegments, setExpandSegments] = useState(false);
  const view = useViewPrefs();
  const [showTokens, setShowTokens] = useState(false);
  const [showLineage, setShowLineage] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  // Keyed on the session id: opening another one starts unfollowed.
  const follow = useFollowBottom(id);

  const msg = searchParams.get('msg');
  const tool = searchParams.get(TOOL_PARAM);
  const agentId = searchParams.get('agent');
  // Memoised on the querystring so the identity is stable: the viewer's deep-link
  // effect must fire for the link, not for a re-render.
  const highlight = useMemo(() => parseHighlight(searchParams), [searchParams]);

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

  /**
   * Drop an echoed prompt as soon as the real one arrives, matched on its text
   * — the transcript line has a uuid we never saw, so there is nothing else to
   * match on. A failed turn clears the lot: the process is gone and no line is
   * coming, and an echo left on screen would claim a message that never landed.
   */
  const turnsData = detail.data?.turns;
  const chatState = chat.data?.state;
  useEffect(() => {
    if (pending.length === 0) return;
    if (chatState === 'error') {
      setPending([]);
      return;
    }
    if (!turnsData) return;
    const said = new Set<string>();
    for (const turn of turnsData) {
      for (const item of turn.items) {
        if (item.role !== 'user') continue;
        for (const block of item.blocks) {
          if (block.kind === 'text' || block.kind === 'command') said.add(block.text.trim());
        }
      }
    }
    setPending((prev) => {
      const next = prev.filter((p) => !said.has(p.text.trim()));
      return next.length === prev.length ? prev : next;
    });
  }, [turnsData, chatState, pending.length]);

  // Above the early returns (hooks are not optional) and above TurnList: the
  // header buttons need to know whether anything is left to fold or unfold.
  const fold = useFoldState(detail.data?.turns ?? EMPTY_TURNS, showThinking, id);

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
  /**
   * A turn we started gets a LiveInfo of its own rather than a second
   * indicator: `WorkingIndicator` already knows how to draw "working since",
   * and all it needs is when the turn began.
   *
   * It has to come FIRST, not as a fallback. Our own process registers itself
   * in ~/.claude/sessions like any other, but with no `status` field — so
   * /api/live answers `status: "unknown"` for this very session, and letting
   * that win meant the indicator never appeared at all while the composer was
   * working (the browser check missed it: it caught the seconds before the
   * watcher had picked the file up).
   */
  const busySince =
    // The server's figure when it has arrived, and until then the moment the
    // prompt was accepted. Waiting for the round trip left the indicator dark
    // for about a second after the click, which on a short turn is most of it —
    // the prompt was already on screen with nothing to say it was being worked on.
    chat.data?.turnStartedAt != null ? Date.parse(chat.data.turnStartedAt) : (pending[0]?.at ?? null);
  const chatLive: LiveInfo | null =
    busySince !== null
      ? { pid: 0, status: 'busy', name: null, startedAt: null, updatedAt: null, statusUpdatedAt: busySince }
      : null;
  const liveInfo = chatLive ?? live.data?.find((l) => l.sessionId === id) ?? null;

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
        canHideResponses={fold.canHide}
        onHideResponses={fold.hideAll}
        canShowResponses={fold.canShow}
        onShowResponses={fold.showAll}
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
            <ViewButton view={view} />
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
        {/* `both-edges` so the scrollbar does not shift the centre: the composer
            below is centred on the full width, and reserving the gutter on one
            side only left the two misaligned by half a scrollbar (measured: 5 px). */}
        <div
          ref={follow.scrollRef}
          className="h-full overflow-y-auto px-4 py-4 [scrollbar-gutter:stable_both-edges]"
        >
          {/* Width on the outer box, zoom on an inner one — never both on the
              same element: a max-width INSIDE a zoomed box is a length like any
              other and would be scaled with it, so 896 px would drift to 1344
              at 150 %. And `zoom` is only ever set when it is not 100, so the
              default view runs through no zoom at all. */}
          <div
            ref={follow.contentRef}
            className="mx-auto"
            style={{ maxWidth: view.width === WIDTH_FULL ? undefined : `${view.width}px` }}
          >
            <div style={view.zoom === ZOOM_DEFAULT ? undefined : { zoom: `${view.zoom}%` }}>
              <TurnList
                // Keyed on the session: what the user unfolded here must not
                // carry over to the next session's segments and turns.
                key={id}
                turns={detail.data.turns}
                showThinking={showThinking}
                expandTools={expandTools}
                fold={fold}
                expandSegments={expandSegments}
                scrollToUuid={msg}
                scrollToTool={tool}
                highlight={highlight}
                onOpenAgent={openAgent}
                // Handed to the list, which hangs it off the last turn's rail:
                // an answer being written belongs where the answers are, not at
                // the root level beside the prompt. Passed only while it has
                // something to draw — see isWorking. While a prompt is still
                // waiting for the transcript, the indicator belongs under THAT
                // instead: it is the exchange being answered.
                footer={
                  pending.length === 0 && isWorking(liveInfo) ? <WorkingIndicator live={liveInfo} /> : undefined
                }
              />
              {pending.map((p, i) => (
                <PendingTurn key={`${p.at}:${i}`} text={p.text}>
                  {i === pending.length - 1 && isWorking(liveInfo) ? <WorkingIndicator live={liveInfo} /> : null}
                </PendingTurn>
              ))}
              {detail.data.turns.length === 0 && pending.length === 0 && (
                <div className="p-8 text-center text-[var(--text-dim)]">This session has no conversation content.</div>
              )}
            </div>
          </div>
        </div>
        {follow.scrollable && <FollowBottomButton following={follow.following} toggle={follow.toggle} />}
      </div>
      {/* A sibling of the scroller, not a child: the root is a column and the
          scroller is the only min-h-0 flex-1, so this sits at the foot without
          taking part in the scrolling. It takes the conversation's own width so
          it lines up with the bubbles — the width lives on the outer box here
          too, never on something zoomed. */}
      {chatEnabled && (
        <Composer
          sessionId={id}
          maxWidth={view.width === WIDTH_FULL ? undefined : `${view.width}px`}
          onSent={(text) => setPending((prev) => [...prev, { text, at: Date.now() }])}
        />
      )}
      {agentId && (
        <SubagentDrawer
          sessionId={id}
          agentId={agentId}
          showThinking={showThinking}
          zoom={view.zoom}
          onClose={closeAgent}
        />
      )}
    </div>
  );
}
