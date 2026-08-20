import {
  MAX_STAT_PATHS,
  type ChatPermissionMode,
  type LiveInfo,
  type MessageItem,
  type SubagentMeta,
  type Turn,
} from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { FILE_PARAM, type FileRef, formatFileRef, normalisePath, parseFileRef } from '../lib/fileRefs.ts';
import { collectMentionedFiles, filterMentions } from '../lib/mentionedFiles.ts';
import { useFoldState } from '../lib/folding.ts';
import { anchorOfKey, focusKeyAt, parseHighlight, setHighlightTerms, TOOL_PARAM } from '../lib/highlight.ts';
import { selectMessage, useRestoredSelection } from '../lib/selectedMessage.ts';
import { collectSessionFiles } from '../lib/sessionFiles.ts';
import { buildSubagentIndex, runningAgents } from '../lib/subagents.ts';
import { isFromTerminal } from '../lib/terminalPrefs.ts';
import { turnActivity } from '../lib/turnActivity.ts';
import { useViewPrefs, WIDTH_FULL, ZOOM_DEFAULT } from '../lib/viewPrefs.ts';
import { Composer } from '../components/viewer/Composer.tsx';
import { ExportButton } from '../components/viewer/ExportButton.tsx';
import { FindBar, useFindBar } from '../components/viewer/FindBar.tsx';
import { FileChangesPanel } from '../components/viewer/FileChangesPanel.tsx';
import { MentionedFilesPanel } from '../components/viewer/MentionedFilesPanel.tsx';
import { SessionFilesPanel } from '../components/viewer/SessionFilesPanel.tsx';
import { FileRefContext, type FileRefContextValue } from '../components/viewer/FileRefContext.ts';
import { FileViewerPanel } from '../components/viewer/FileViewerPanel.tsx';
import { FollowBottomButton, useFollowBottom } from '../components/viewer/FollowBottom.tsx';
import { LineagePanel } from '../components/viewer/LineagePanel.tsx';
import { PendingTurn } from '../components/viewer/PendingTurn.tsx';
import { ResumeButtons } from '../components/viewer/ResumeButtons.tsx';
import { SessionHeader } from '../components/viewer/SessionHeader.tsx';
import { SessionTerminal } from '../components/viewer/SessionTerminal.tsx';
import { StarContext, type StarContextValue } from '../components/viewer/StarContext.ts';
import { SubagentContext, type SubagentContextValue } from '../components/viewer/SubagentContext.ts';
import { SubagentDrawer } from '../components/viewer/SubagentDrawer.tsx';
import { SubagentsPanel } from '../components/viewer/SubagentsPanel.tsx';
import { TokenPanel } from '../components/viewer/TokenPanel.tsx';
import { TurnList } from '../components/viewer/TurnList.tsx';
import { ViewButton } from '../components/viewer/ViewButton.tsx';
import { isWorking, WorkingIndicator, workingSince } from '../components/viewer/WorkingIndicator.tsx';

const FALLBACK_COLOR = 'hsl(0 0% 55%)';
/** Stable identity while the conversation loads, so the fold state is not rebuilt. */
const EMPTY_TURNS: Turn[] = [];
const EMPTY_AGENTS: SubagentMeta[] = [];
/** How often the running-agent rule re-reads the clock. See `now` below. */
const RUNNING_TICK_MS = 15_000;
/** Opens the subagent list. `agent` (singular) opens one transcript — they are not the same thing. */
const AGENTS_PARAM = 'agents';
/** Anchors inside the OPEN DRAWER, the drawer's counterpart of `tool` and `msg`. */
const AGENT_TOOL_PARAM = 'agentTool';
const AGENT_MSG_PARAM = 'agentMsg';

export function SessionViewPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
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
  // Which of the two the app offers at the foot of a session. Meaningless while
  // `chatEnabled` is off, and never read there: nothing is drawn either way.
  const terminalMode = chatEnabled && settings.data?.settings.chatMode === 'terminal';
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
  const [showSentFiles, setShowSentFiles] = useState(false);
  const [showMentions, setShowMentions] = useState(false);

  const msg = searchParams.get('msg');
  const tool = searchParams.get(TOOL_PARAM);
  const agentId = searchParams.get('agent');
  /**
   * The subagent list, open from the URL rather than from state: the ⑂ badge in
   * the session list opens a session straight onto it, and the link can be
   * copied.
   */
  const agentsOpen = searchParams.get(AGENTS_PARAM) === '1';
  /**
   * Bumped on every jump asked for from the panel. The deep-link effect keys on
   * the anchor alone — deliberately, so a live session is not yanked back to it
   * every few seconds — which also means asking for the SAME anchor twice would
   * do nothing at all, and clicking a row again after scrolling away is exactly
   * that. It stays out of the URL: it is a gesture, not part of the link.
   */
  const [jumpNonce, setJumpNonce] = useState(0);
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
    (aid: string, anchor?: { tool?: string; msg?: string }) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set('agent', aid);
          // Anchors INSIDE the drawer, and always rewritten together: one left
          // over from a previous jump would point into another agent's
          // transcript, where it resolves to nothing at all.
          for (const [param, value] of [
            [AGENT_TOOL_PARAM, anchor?.tool],
            [AGENT_MSG_PARAM, anchor?.msg],
          ] as const) {
            if (value) sp.set(param, value);
            else sp.delete(param);
          }
          return sp;
        },
        { replace: true },
      );
      setJumpNonce((n) => n + 1);
    },
    [setSearchParams],
  );

  const toggleAgents = useCallback(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (sp.get(AGENTS_PARAM) === '1') sp.delete(AGENTS_PARAM);
        else sp.set(AGENTS_PARAM, '1');
        return sp;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  /**
   * Jump to one anchor and drop the other: the two are read together and a
   * `?tool=` left over from the previous click would win over the `?msg=` just
   * asked for. The search marks go too — they belong to the search that put
   * them there, not to a jump made from the panel.
   */
  const jumpTo = useCallback(
    (param: string, value: string, terms: string[] = []) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          for (const p of [TOOL_PARAM, 'msg']) sp.delete(p);
          sp.set(param, value);
          // Always rewritten, which is what makes the comment above true: the
          // words belong to the jump that asked for them, so a jump with none
          // clears a previous search's, and a jump WITH them arrives marked. It
          // is the same `?hl=` a search result carries — one mechanism, so a
          // panel's jump lands the way the search's does.
          setHighlightTerms(sp, terms);
          return sp;
        },
        { replace: true },
      );
      setJumpNonce((n) => n + 1);
    },
    [setSearchParams],
  );

  /**
   * The file a link in the conversation opened. Parsed by the same function
   * that produced the parameter, so the URL is read by the code that wrote it.
   */
  const fileParam = searchParams.get(FILE_PARAM);
  const fileRef = useMemo(() => (fileParam ? parseFileRef(fileParam) : null), [fileParam]);

  const closeFile = useCallback(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete(FILE_PARAM);
        return sp;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const projectPath = detail.data?.summary.projectPath ?? '';
  const fileRefs = useMemo<FileRefContextValue>(
    () => ({
      sessionId: id,
      projectPath,
      // Built from the route alone rather than from the current querystring: a
      // copied link should open that file in that session, not carry somebody
      // else's search marks along.
      hrefFor: (ref: FileRef) => `/session/${id}?${FILE_PARAM}=${encodeURIComponent(formatFileRef(ref))}`,
      openFile: (ref: FileRef) =>
        setSearchParams(
          (prev) => {
            const sp = new URLSearchParams(prev);
            sp.set(FILE_PARAM, formatFileRef(ref));
            return sp;
          },
          { replace: true },
        ),
    }),
    [id, projectPath, setSearchParams],
  );

  /**
   * Ctrl+F. Off while a layer owns the screen: the file panel is a single <pre>
   * the browser's own find handles perfectly well, and the subagent drawer holds
   * another transcript, which this bar does not read (its `find` prop is already
   * the right shape to serve that list when it does).
   */
  const finder = useFindBar(detail.data?.turns ?? EMPTY_TURNS, id, {
    showThinking,
    enabled: !fileRef && !agentId,
    // Read once, on open, and never written back: `hl` belongs to the search
    // that produced it, and a find is a gesture rather than a location.
    seed: highlight,
  });

  /**
   * Which message the reader has clicked. It lives outside React entirely — see
   * `lib/selectedMessage.ts` — so this handler redraws the find bar and nothing
   * else, and the conversation is left alone.
   */
  /**
   * Which box the URL is asking to stand in, as the key a click produces — so
   * the two can be compared at all. `anchorOfKey` is the inverse and lives with
   * the prefixes; this is the only other place that needs to build one.
   */
  const anchorKey = tool ? `tool:${tool}` : msg ? `msg:${msg}` : null;
  /**
   * Whether the remembered ring has been spent.
   *
   * It is an OPENING move: the conversation adopts the ring this tab was left on,
   * and from the first click onwards the reader has said where they are. Without
   * this, retiring the URL's anchor below would fall straight back to it and jump
   * to a message that was being read ten minutes ago.
   */
  const restoreSpent = useRef<string | null>(null);
  /**
   * A click both moves the ring and RETIRES the anchor that is no longer it.
   *
   * `?msg=` has two lives and only one of them should outlast a click. Followed
   * from a search, from Prompts or from Starred it is a link, and it belongs in
   * the address bar. Written by a jump inside the page — this panel's `↑ 2/4
   * mentions`, the subagents panel's `↓ the report` — it is a gesture, and one
   * that used to stay in the URL for ever: F5 landed back on that message however
   * long ago it had been left, `useRestoredSelection` stood down because a link
   * was present, and there was no way out but editing the address bar by hand.
   *
   * So the rule is that the anchor may not outlive the selection it made. A click
   * that lands somewhere else — another message, or the empty gutter, which is
   * what deselecting is — takes it out, along with the words it asked to mark.
   * Clicking the anchored box ITSELF changes nothing: it is still the place, and
   * the marks and the Ctrl+F seed still belong to that arrival.
   */
  const selectFromClick = useCallback(
    (e: React.MouseEvent) => {
      const key = focusKeyAt(e.target);
      selectMessage(key);
      restoreSpent.current = id;
      if (anchorKey === null || key === anchorKey) return;
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.delete('msg');
          sp.delete(TOOL_PARAM);
          setHighlightTerms(sp, []);
          return sp;
        },
        { replace: true },
      );
    },
    [anchorKey, id, setSearchParams],
  );
  /**
   * The ring this tab was left on, adopted as the conversation opens — and
   * nobody at all for a conversation nothing was clicked in, which is what used
   * to happen always. F5 has to come back to the message that was being read,
   * still selected and still on screen; see `useRestoredSelection` for why that
   * is remembered outside the URL and why the message, rather than a scroll
   * offset, is what a reload can be trusted to find again.
   */
  const restoredKey = useRestoredSelection(id, !!msg || !!tool);
  const restored = anchorOfKey(restoredKey);
  /**
   * The two anchors, resolved in one place: the link first, then the remembered
   * ring. Everything downstream reads these rather than the parameters, because
   * a restored message is a request to stand somewhere exactly as `?msg=` is —
   * the jump travels the same road (it is the only one that unfolds its way in)
   * and the follow stands down for both.
   */
  const spent = restoreSpent.current === id;
  const anchorUuid = msg ?? (spent ? null : restored.uuid);
  const anchorTool = tool ?? (spent ? null : restored.toolUseId);

  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      // Escape inside an embedded terminal is the CLI's — it closes ITS menus.
      // (The textarea check above already covers where xterm usually puts the
      // focus; this is the one that stays true when it moves.)
      if (isFromTerminal(e.target)) return;
      // Innermost first: the file sits on top of the subagent drawer, which sits
      // on top of the list that opened it — a path is often clicked from inside a
      // subagent report, and that whole stack has to unwind in order.
      //
      // The find bar comes after all three and before going back: those are
      // layers drawn OVER the conversation, while the bar sits beside it. Its
      // own input handles Escape itself and stops it here, so this branch is for
      // an Escape pressed while reading, with the bar still open behind you.
      if (fileRef) closeFile();
      else if (agentId) closeAgent();
      else if (agentsOpen) toggleAgents();
      else if (finder.isOpen) finder.close();
      else navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fileRef, closeFile, agentId, closeAgent, agentsOpen, toggleAgents, finder.isOpen, finder.close, navigate]);

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

  /**
   * The session's subagents joined to the calls and the reports they left in
   * the conversation — read by the list, by every notice panel and by every
   * Agent call, hence a context rather than three more props threaded down.
   */
  const subagentIndex = useMemo(
    () => buildSubagentIndex(detail.data?.turns ?? EMPTY_TURNS, detail.data?.subagents ?? EMPTY_AGENTS),
    [detail.data],
  );
  const subagentContext = useMemo<SubagentContextValue>(
    () => ({
      byId: subagentIndex.byId,
      byToolUse: subagentIndex.byToolUse,
      openAgent,
      goToCall: (toolUseId) => jumpTo(TOOL_PARAM, toolUseId),
      goToMessage: (uuid) => jumpTo('msg', uuid),
      hasCall: (toolUseId) => subagentIndex.calls.has(toolUseId),
    }),
    [subagentIndex, openAgent, jumpTo],
  );

  /**
   * The stars, for the toolbar inside every bubble. One query for the whole
   * corpus — it is a small list and the Starred page reads the same one, so
   * opening it afterwards costs nothing — filtered here to this session.
   *
   * A write invalidates `['stars']` and NOTHING else. `['session', id]` would
   * re-parse the transcript to redraw a glyph, and the server agrees: it emits
   * `stars-changed` rather than `session-updated`.
   */
  const stars = useQuery({ queryKey: ['stars'], queryFn: api.stars });
  const [starBusy, setStarBusy] = useState<string | null>(null);
  const starredUuids = useMemo(() => {
    const set = new Set<string>();
    for (const s of stars.data ?? []) if (s.sessionId === id) set.add(s.uuid);
    return set;
  }, [stars.data, id]);
  const starContext = useMemo<StarContextValue>(
    () => ({
      // The alias check is what makes this survive a re-parse: a star is stored
      // under the canonical uuid, and a merged answer answers to any of them.
      isStarred: (item: MessageItem) =>
        starredUuids.has(item.uuid) || item.aliasUuids.some((u) => starredUuids.has(u)),
      toggle: (item: MessageItem) => {
        const starred = starredUuids.has(item.uuid) || item.aliasUuids.some((u) => starredUuids.has(u));
        setStarBusy(item.uuid);
        void api
          .starMessage(id, item.uuid, !starred)
          .then(() => queryClient.invalidateQueries({ queryKey: ['stars'] }))
          .finally(() => setStarBusy(null));
      },
      busy: starBusy,
    }),
    [starredUuids, starBusy, id, queryClient],
  );

  /**
   * Everything the session handed over — deliveries, artifacts, plan files.
   * One calculation feeding both the header's count and the panel's rows, so the
   * button can never promise a number the panel does not draw.
   */
  const sessionFiles = useMemo(() => collectSessionFiles(detail.data?.turns ?? EMPTY_TURNS), [detail.data]);

  /**
   * And every path the answers merely NAMED. Three steps rather than one, because
   * this is the panel whose count is not a fact of the transcript:
   *
   * 1. the candidates, from the transcript alone — enough to know whether the
   *    button exists at all;
   * 2. the disk, asked ONCE and only after the panel is first opened, so a
   *    session nobody asks about costs nothing;
   * 3. the filter, which is where most of them go: a path in prose usually
   *    resolves to nothing, and what the other two panels already list is not
   *    news here.
   */
  const mentionCandidates = useMemo(
    () => collectMentionedFiles(detail.data?.turns ?? EMPTY_TURNS),
    [detail.data],
  );
  // Capped at what the endpoint accepts, and what is over the cap is REPORTED by
  // the panel rather than dropped in silence.
  const mentionRefs = useMemo(() => mentionCandidates.slice(0, MAX_STAT_PATHS).map((c) => c.ref), [mentionCandidates]);
  /**
   * Asked as soon as the session is read, and not on the first press.
   *
   * It was lazy, so that a reader who never looks at the panel paid nothing — and
   * the price of that was a button reading `Mentioned` with no number until it had
   * been opened once, which is the one thing in that row that could not say what
   * it held. The count cannot be computed without this: which candidates are
   * FOLDERS and which two spellings are one file are both answers only the disk
   * has.
   *
   * What it costs is one local POST per session view, and only where the answers
   * named a path at all: a `stat` per distinct path, tens of microseconds each,
   * against a page that already makes half a dozen requests. Nothing waits for it
   * — a slow path (a UNC share that is not answering) means a late number, never a
   * late page.
   */
  const mentionStats = useQuery({
    queryKey: ['fileStats', id, mentionRefs],
    queryFn: () => api.fileStats(id, mentionRefs),
    enabled: mentionRefs.length > 0,
    staleTime: 30_000,
  });
  /**
   * What the other two panels hold — absolute and normalised, one lookup each.
   *
   * For a CHIP on the row and not to hide it. Dropping a mention because another
   * panel knew the file took the most obvious mentions of a session with it: the
   * files an answer keeps pointing at are usually the ones it also worked on.
   */
  const changedPaths = useMemo(
    () => new Set((detail.data?.fileChanges ?? []).map((fc) => normalisePath(fc.path))),
    [detail.data],
  );
  const sentPaths = useMemo(
    () => new Set([...sessionFiles.sent, ...sessionFiles.artifacts, ...sessionFiles.plans].map((r) => r.key)),
    [sessionFiles],
  );
  const mentioned = useMemo(
    () =>
      mentionStats.data
        ? filterMentions(
            mentionCandidates.slice(0, MAX_STAT_PATHS),
            mentionStats.data.files,
            changedPaths,
            sentPaths,
            mentionCandidates.length - mentionRefs.length,
          )
        : null,
    [mentionStats.data, mentionCandidates, mentionRefs.length, changedPaths, sentPaths],
  );

  const { messageCount, thinkingCount, toolCount, compactionCount } = useMemo(() => {
    const items = (detail.data?.turns ?? []).flatMap((t) => t.items);
    const blocks = items.flatMap((i) => i.blocks);
    return {
      // What the follow pill's badge counts: messages, the unit the header
      // already counts as prompts and responses. Not blocks — a turn's thirty
      // tool calls are one message doing thirty things — and not turns either,
      // which would sit at 1 through a whole answer arriving. A message whose
      // blocks are all tool calls draws a run rather than a bubble, so the badge
      // can read one ahead of the bubbles you can point at: something did arrive
      // below, which is all the badge claims.
      messageCount: items.length,
      thinkingCount: blocks.filter((b) => b.kind === 'thinking').length,
      toolCount: blocks.filter((b) => b.kind === 'tool').length,
      compactionCount: blocks.filter((b) => b.kind === 'compact').length,
    };
  }, [detail.data]);

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
   *
   * Above the early returns, and memoised, because the two nodes below are
   * props of a memoised `TurnList`: rebuilt on every render they would defeat
   * the comparison and redraw the whole conversation for anything at all.
   */
  const liveInfo = useMemo<LiveInfo | null>(() => {
    // The server's figure when it has arrived, and until then the moment the
    // prompt was accepted. Waiting for the round trip left the indicator dark
    // for about a second after the click, which on a short turn is most of it —
    // the prompt was already on screen with nothing to say it was being worked on.
    const busySince =
      chat.data?.turnStartedAt != null ? Date.parse(chat.data.turnStartedAt) : (pending[0]?.at ?? null);
    if (busySince !== null) {
      return { pid: 0, status: 'busy', name: null, startedAt: null, updatedAt: null, statusUpdatedAt: busySince };
    }
    return live.data?.find((l) => l.sessionId === id) ?? null;
  }, [chat.data?.turnStartedAt, pending, live.data, id]);

  /**
   * The two clocks the indicator shows beside the turn's own. Read off the
   * conversation rather than off `/api/live`, which knows when the turn started
   * and nothing about what has happened inside it — and memoised on the parse,
   * so a re-render that changed no message leaves the indicator's props alone.
   */
  const activity = useMemo(() => turnActivity(detail.data?.turns ?? EMPTY_TURNS), [detail.data]);

  /**
   * The clock the running-agent rule is read against, and it has to tick: an
   * agent is called running partly because it wrote recently
   * (`AGENT_SILENCE_MS`), so the row must be able to go away on its own. Nothing
   * else would take it away — an agent that stops writing without reporting back
   * sends no event, and an idle session may never be asked about again.
   *
   * Only while there is something to wait on, and coarse: a quarter of a minute
   * either way on a fifteen-minute grace is nobody's news.
   */
  const [now, setNow] = useState(() => Date.now());
  const sessionAlive = liveInfo !== null;
  // Only where an answer could still change: an agent that has already reported
  // back is settled, and a session with nothing outstanding needs no clock at all.
  const mayHaveRunning =
    sessionAlive && subagentIndex.rows.some((r) => r.call !== null && r.reports.length === 0);
  useEffect(() => {
    if (!mayHaveRunning) return;
    const timer = setInterval(() => setNow(Date.now()), RUNNING_TICK_MS);
    return () => clearInterval(timer);
  }, [mayHaveRunning]);

  /**
   * Which agents are still out there, and since when. Decided here because this
   * is where both halves are: whether the session's process is alive at all
   * (`['live']`, and nowhere else) and the reports the agents filed into this
   * conversation. `subagentStatus` is the rule and the limits it will not step
   * over.
   */
  const running = useMemo(
    () => runningAgents(subagentIndex.rows, { sessionAlive, now }),
    [subagentIndex, sessionAlive, now],
  );
  // Off the same list rather than asked again, so the drawer and the count can
  // never disagree — and so a tick that changes nothing changes no prop.
  const agentRunning = agentId !== null && running.ids.split(',').includes(agentId);
  /**
   * The foot's news while the turn is over and something it sent out is not.
   * Written once because two things say it: the row at the end of the
   * conversation, and the follow pill's hover — the pill is the only one of the
   * two still on screen once the reader scrolls away from the end.
   */
  const agentsWorking =
    running.count > 0 ? `⑂ ${running.count} subagent${running.count === 1 ? '' : 's'} still working` : null;

  /**
   * The column's real width, which is the limit OR the window when the window is
   * the smaller of the two. Two things do arithmetic with it against the follow
   * pill's corner — the composer's action row and the working indicator's clocks
   * — so it is written once here rather than twice at the two call sites.
   */
  const columnWidth = view.width === WIDTH_FULL ? '100vw' : `min(${view.width}px, 100vw)`;
  /**
   * And what the CLOCKS get, which is the same length or nothing at all. The pill
   * floats over the bottom 16-46 px of the scroller; the composer is stuck across
   * exactly that band and is never remotely that short, so where there is one the
   * pill covers IT and the clocks clear it without paying anything. Paying anyway
   * is what put them 120 px inside their own right edge at `Full` width in every
   * session with the chat on — a gutter for a pill that could not reach them. Only
   * a foot with no composer leaves this row in the pill's band.
   *
   * The composer's own `max()` is untouched: `Send` really is in that corner.
   */
  const clockColumnWidth = chatEnabled ? undefined : columnWidth;

  /**
   * Hung off the last turn's rail rather than after the list: an answer being
   * written belongs where the answers are. Passed only while it has something to
   * draw, and never while a prompt is still waiting for the transcript — the
   * indicator belongs under THAT instead, as the exchange being answered.
   */
  const workingFooter = useMemo(
    () =>
      pending.length === 0 && isWorking(liveInfo) ? (
        <WorkingIndicator since={workingSince(liveInfo)} activity={activity} columnWidth={clockColumnWidth} />
      ) : /**
       * The turn is over and something it sent out is not, which is a state the
       * foot of the conversation said nothing about: an agent is launched
       * asynchronously, the turn ENDS while it works, and the report is what
       * wakes the session up again — so the last thing on screen was a finished
       * answer while three agents were still going.
       *
       * A different sentence, not this row with the old one: `Claude is working`
       * would be false here, and the count is the news. One clock only — since
       * the first of them was sent out — because what has landed inside their
       * transcripts is in THEIR drawers, and `activity` describes the parent's
       * last turn, which is precisely the turn that already ended.
       */
      pending.length === 0 && agentsWorking !== null ? (
        <WorkingIndicator
          since={running.since}
          columnWidth={clockColumnWidth}
          startHint="Sent out"
          label={`${agentsWorking}…`}
        />
      ) : undefined,
    [pending.length, liveInfo, activity, clockColumnWidth, agentsWorking, running.since],
  );
  /**
   * The follow-the-end pill. Keyed on the session id, so opening another one
   * starts unfollowed — unless something is being written into it: a live or
   * busy session opens at its end, following, which is what it was opened for.
   *
   * An anchor says otherwise and wins — the link's, or the ring a reload
   * restored. `?msg=` / `?tool=` is a request to stand somewhere in particular,
   * and the two would fight over the scroll for as long as the turn lasted.
   */
  const follow = useFollowBottom(id, {
    autoFollow: liveInfo !== null && !anchorUuid && !anchorTool,
    messageCount,
  });
  /** Inside the list, so an echoed prompt is spaced like the turn it is about to become. */
  const pendingTurns = useMemo(
    () =>
      pending.map((p, i) => (
        <PendingTurn key={`${p.at}:${i}`} text={p.text}>
          {/* `activity` too, and it draws nothing here on purpose: while the echo
              stands, the last turn in the transcript is the PREVIOUS one, whose
              messages are all older than this turn's start and are filtered out
              by exactly the test that keeps the figures inside their own turn. */}
          {i === pending.length - 1 && isWorking(liveInfo) ? (
            <WorkingIndicator since={workingSince(liveInfo)} activity={activity} columnWidth={clockColumnWidth} />
          ) : null}
        </PendingTurn>
      )),
    [pending, liveInfo, activity, clockColumnWidth],
  );

  if (detail.isLoading) {
    return <div className="p-8 text-[var(--text-dim)]">Parsing conversation…</div>;
  }
  if (detail.isError || !detail.data) {
    return <div className="p-8 text-red-400">Failed to load session: {String(detail.error ?? 'not found')}</div>;
  }

  const color =
    projects.data?.find((p) => p.key === detail.data.summary.projectKey)?.color ?? FALLBACK_COLOR;
  /**
   * How this session was last answered — the composer's starting point. Read
   * from the end backwards, because that is the state the conversation is
   * actually in; the model at the top may be several changes old.
   */
  const lastAnswer = (() => {
    const turns = detail.data.turns;
    for (let t = turns.length - 1; t >= 0; t--) {
      const items = turns[t].items;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.role === 'assistant' && item.model) return { model: item.model, effort: item.effort };
      }
    }
    return null;
  })();
  /**
   * And the mode it was last in — same rule, same reason. Only `user` lines
   * carry it, and only `plan` is worth restoring: every other value means the
   * ordinary way of sending, which is what the composer opens on anyway. It is
   * NOT widened to a mode the picker cannot represent, so a session Claude Code
   * left in `acceptEdits` opens in `auto` rather than claiming otherwise.
   */
  const lastMode: ChatPermissionMode | null = (() => {
    const turns = detail.data.turns;
    for (let t = turns.length - 1; t >= 0; t--) {
      const items = turns[t].items;
      for (let i = items.length - 1; i >= 0; i--) {
        const mode = items[i].permissionMode;
        if (mode) return mode === 'plan' ? 'plan' : 'auto';
      }
    }
    return null;
  })();

  return (
    // Wraps the drawer as well as the conversation: a path written in a
    // subagent's report is a path in this session too.
    <FileRefContext value={fileRefs}>
      <SubagentContext value={subagentContext}>
        <div className="flex h-full flex-col">
          <SessionHeader
            detail={detail.data}
            color={color}
            // Not detail.summary.live: that one only moves when the transcript
            // grows, so the badge would still read "live" through a turn the app
            // itself is running.
            live={liveInfo}
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
            showSentFiles={showSentFiles}
            onToggleSentFiles={() => setShowSentFiles((v) => !v)}
            sentFileCount={sessionFiles.total}
            showMentions={showMentions}
            onToggleMentions={() => setShowMentions((v) => !v)}
            mentionCount={mentioned ? mentioned.rows.length : null}
            mentionCandidates={mentionCandidates.length}
            showAgents={agentsOpen}
            onToggleAgents={toggleAgents}
            findOpen={finder.isOpen}
            onToggleFind={() => (finder.isOpen ? finder.close() : finder.openBar())}
            actions={
              <>
                <ViewButton view={view} />
                <ExportButton detail={detail.data} />
                <ResumeButtons session={detail.data.summary} />
              </>
            }
          />
          <FindBar {...finder.bar} />
          {showTokens && <TokenPanel summary={detail.data.summary} turns={detail.data.turns} />}
          {showLineage && <LineagePanel sessionId={id} />}
          {showFiles && <FileChangesPanel fileChanges={detail.data.fileChanges} />}
          {showSentFiles && (
            <SessionFilesPanel
              sessionId={id}
              files={sessionFiles}
              onGoToCall={(toolUseId) => jumpTo(TOOL_PARAM, toolUseId)}
              onGoToMessage={(uuid) => jumpTo('msg', uuid)}
            />
          )}
          {showMentions && (
            <MentionedFilesPanel
              data={mentioned}
              pending={mentionStats.isPending && mentionRefs.length > 0}
              error={mentionStats.isError ? String(mentionStats.error) : null}
              /**
               * The anchor and the words to underline there, and nothing else.
               *
               * It opened the find bar for a while, to reach the OTHER namings of
               * the same file, and the numbers were what killed it: the bar counts
               * every occurrence in the transcript, so `AI_VIEWER.md` opened on 168
               * matches — 143 of them inside tool calls — against the four messages
               * whose prose actually names it. Walking four namings through 168
               * stops is not a way in. The panel knows exactly which four they are,
               * so the row steps through them itself.
               */
              onGoToMessage={(uuid, marks) => jumpTo('msg', uuid, marks)}
            />
          )}
          {agentsOpen && (
            <SubagentsPanel
              sessionId={id}
              rows={subagentIndex.rows}
              openAgentId={agentId}
              sessionAlive={sessionAlive}
              now={now}
            />
          )}
          {/* The scroller reaches the foot of the window, and the composer rides
              INSIDE it, stuck to the bottom. Nothing is cut off half way down any
              more: the scrollbar runs the full height, the conversation slides
              under the box instead of stopping short of it, and the pill has a
              bottom to sit at. The pill is still a sibling of the scroller — a
              child of it would scroll away with the conversation. */}
          <div className="relative min-h-0 flex-1">
            {/* `both-edges` so the scrollbar does not shift the centre: reserving
                the gutter on one side only moved the conversation off the middle
                of the window by half a scrollbar (measured: 5 px). */}
            {/* Selecting a message is one listener on the scroller, and it is
                always on: it is a feature of the conversation, not of the find
                bar, which only reads it. On the SCROLLER and not on the
                width-limited box inside it, so the empty gutters either side
                count as clicking away — which deselects.
                `Bubble` still takes no `onClick`: React delegates from the root
                whatever you write, so one handler here and three hundred there
                cost the same to dispatch, and this one keeps the invariant and
                the closures. */}
            <div
              ref={follow.scrollRef}
              onClick={selectFromClick}
              className={`h-full overflow-y-auto px-4 pt-4 [scrollbar-gutter:stable_both-edges] ${
                // With no composer there is nothing to keep the last bubble off
                // the window's edge, so the padding comes back.
                chatEnabled ? '' : 'pb-4'
              }`}
            >
              {/* Width on the outer box, zoom on an inner one — never both on the
                  same element: a max-width INSIDE a zoomed box is a length like any
                  other and would be scaled with it, so 896 px would drift to 1344
                  at 150 %. And `zoom` is only ever set when it is not 100, so the
                  default view runs through no zoom at all.
                  `min-h-full` and the column are what put the composer at the foot
                  of a SHORT conversation: the box fills the scroller exactly, so
                  `mt-auto` below has somewhere to push to and nothing becomes
                  scrollable that was not. */}
              <div
                ref={follow.contentRef}
                className="mx-auto flex min-h-full flex-col"
                style={{ maxWidth: view.width === WIDTH_FULL ? undefined : `${view.width}px` }}
              >
                <div style={view.zoom === ZOOM_DEFAULT ? undefined : { zoom: `${view.zoom}%` }}>
                  {/* Only the conversation, deliberately: the drawer below
                      renders the same `TurnList` over a SUBAGENT's transcript,
                      whose uuids are in that file and not in this session — a
                      star there would key on a message this session does not
                      have. No context, no star button. */}
                  <StarContext value={starContext}>
                    <TurnList
                      // Keyed on the session: what the user unfolded here must not
                      // carry over to the next session's segments and turns.
                      key={id}
                      turns={detail.data.turns}
                      showThinking={showThinking}
                      expandTools={expandTools}
                      fold={fold}
                      expandSegments={expandSegments}
                      scrollToUuid={anchorUuid}
                      scrollToTool={anchorTool}
                      jumpNonce={jumpNonce}
                      highlight={highlight}
                      find={finder.find}
                      onFindMarks={finder.onFindMarks}
                      onOpenAgent={openAgent}
                      footer={workingFooter}
                      pending={pendingTurns}
                    />
                  </StarContext>
                  {detail.data.turns.length === 0 && pending.length === 0 && (
                    <div className="p-8 text-center text-[var(--text-dim)]">This session has no conversation content.</div>
                  )}
                </div>
                {/* The last thing in the conversation's own column, and stuck to
                    the bottom of it: `mt-auto` puts it at the foot of a short
                    session, `sticky` keeps it there through a long one. Inside
                    the column it needs no width of its own to line up with the
                    bubbles, and `footerRef` is what makes growing it scroll the
                    conversation clear instead of covering it.
                    `pt-6` is a real gap in the flow, and the composer's own fade
                    is drawn exactly over it: at the end of the conversation the
                    last bubble stops above the fade rather than dissolving into
                    it, and the strip stays transparent, so what scrolls behind it
                    is faded out rather than cut off.
                    Never inside the zoomed div: an input is not the reading.
                    The click is stopped here, and only here: everywhere else in
                    the scroller a click means "nobody is selected", and typing a
                    prompt is not clicking away from the message you were on.
                    `data-sticky-bottom` is how `revealRange` knows the last
                    stretch of this scroller is behind something. */}
                {chatEnabled && (
                  <div
                    ref={follow.footerRef}
                    data-sticky-bottom
                    className="sticky bottom-0 mt-auto pt-6"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* The two modes share this slot and everything it imposes.
                        The wrapper is the same for both deliberately: what
                        changes is how you talk to Claude, not where the
                        conversation ends. */}
                    {terminalMode ? (
                      <SessionTerminal sessionId={id} columnWidth={columnWidth} />
                    ) : (
                      <Composer
                        sessionId={id}
                        // The box does arithmetic with it: without this, Send ends
                        // up under the follow pill at the widths where the column
                        // reaches the window's edge.
                        columnWidth={columnWidth}
                        onSent={(text) => setPending((prev) => [...prev, { text, at: Date.now() }])}
                        lastModel={lastAnswer?.model ?? null}
                        lastEffort={lastAnswer?.effort ?? null}
                        lastMode={lastMode}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* `isWorking(liveInfo)` and not `workingFooter`: the footer is held
                back while a prompt of ours is still an echo, and the turn is in
                flight all the same. Agents outstanding spin it too — what the
                pill answers is whether anything more is coming, and their
                reports will land here — but they say so in their own words. */}
            <FollowBottomButton
              following={follow.following}
              toggle={follow.toggle}
              unseen={follow.unseen}
              working={isWorking(liveInfo) || agentsWorking !== null}
              workingWhat={isWorking(liveInfo) ? undefined : (agentsWorking ?? undefined)}
            />
          </div>
          {agentId && (
            <SubagentDrawer
              sessionId={id}
              agentId={agentId}
              showThinking={showThinking}
              zoom={view.zoom}
              scrollToTool={searchParams.get(AGENT_TOOL_PARAM)}
              scrollToUuid={searchParams.get(AGENT_MSG_PARAM)}
              jumpNonce={jumpNonce}
              running={agentRunning}
              onClose={closeAgent}
            />
          )}
          {fileRef && (
            <FileViewerPanel
              // Keyed on the reference: opening another file starts a fresh panel
              // rather than scrolling the previous one's state onto a new body.
              key={formatFileRef(fileRef)}
              sessionId={id}
              projectPath={projectPath}
              fileRef={fileRef}
              onClose={closeFile}
            />
          )}
        </div>
      </SubagentContext>
    </FileRefContext>
  );
}
