import {
  askingFor,
  MAX_STAT_PATHS,
  messageTally,
  type ChatPermissionMode,
  type LiveInfo,
  type MessageItem,
  type SubagentMeta,
  type Turn,
} from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client.ts';
import { useNotifications } from '../api/useNotifications.ts';
import { useReadMarks } from '../api/useReadMarks.ts';
import { draftSessionDetail } from '../lib/draftSession.ts';
import { FILE_PARAM, type FileRef, formatFileRef, normalisePath, parseFileRef } from '../lib/fileRefs.ts';
import { collectMentionedFiles, filterMentions } from '../lib/mentionedFiles.ts';
import { useFoldState } from '../lib/folding.ts';
import { anchorOfKey, focusKeyAt, isJumpControl, parseHighlight, setHighlightTerms, TOOL_PARAM } from '../lib/highlight.ts';
import { selectMessage, useRestoredSelection } from '../lib/selectedMessage.ts';
import { collectSessionFiles } from '../lib/sessionFiles.ts';
import { buildSubagentIndex, runningAgents } from '../lib/subagents.ts';
import { buildToolCallIndex } from '../lib/toolCalls.ts';
import { isFromTerminal } from '../lib/terminalPrefs.ts';
import { turnActivity } from '../lib/turnActivity.ts';
import { useInspector } from '../lib/inspector.ts';
import { useColumnWidth, useSideLayout } from '../lib/sideColumns.ts';
import { useReadingPrefs } from '../lib/readingPrefs.ts';
import { useViewPrefs, WIDTH_FULL, ZOOM_DEFAULT } from '../lib/viewPrefs.ts';
import { useWindowFocused } from '../lib/windowFocus.ts';
import { Composer } from '../components/viewer/Composer.tsx';
import { FindBar, FindButton, useFindBar } from '../components/viewer/FindBar.tsx';
import { FileChangesPanel } from '../components/viewer/FileChangesPanel.tsx';
import { MentionedFilesPanel } from '../components/viewer/MentionedFilesPanel.tsx';
import { SessionFilesPanel } from '../components/viewer/SessionFilesPanel.tsx';
import { FileRefContext, type FileRefContextValue } from '../components/viewer/FileRefContext.ts';
import { FileViewerPanel } from '../components/viewer/FileViewerPanel.tsx';
import { FollowBottomButton, PILL_CORNER_PX, useFollowBottom } from '../components/viewer/FollowBottom.tsx';
import { Inspector } from '../components/viewer/Inspector.tsx';
import { InspectorRail } from '../components/viewer/InspectorRail.tsx';
import { LineagePanel } from '../components/viewer/LineagePanel.tsx';
import { PendingTurn } from '../components/viewer/PendingTurn.tsx';
import { SessionHeader } from '../components/viewer/SessionHeader.tsx';
import { SideColumn } from '../components/viewer/SideColumn.tsx';
import { SessionTerminal } from '../components/viewer/SessionTerminal.tsx';
import { StarContext, type StarContextValue } from '../components/viewer/StarContext.ts';
import { SubagentContext, type SubagentContextValue } from '../components/viewer/SubagentContext.ts';
import { SubagentDrawer } from '../components/viewer/SubagentDrawer.tsx';
import { SubagentsPanel } from '../components/viewer/SubagentsPanel.tsx';
import { TokenPanel } from '../components/viewer/TokenPanel.tsx';
import { TurnList } from '../components/viewer/TurnList.tsx';
import { ViewMenu } from '../components/viewer/ViewMenu.tsx';
import { TOAST_MS } from '../components/NotificationToasts.tsx';
import { isWaiting, isWorking, waitingSentence, WorkingIndicator, workingSince } from '../components/viewer/WorkingIndicator.tsx';

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
   * The live state comes from here and NOT from `session.summary.live`,
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
    // No poll here any more. The thing it was a backstop for — a CLI killed
    // outright, which leaves its file saying "busy" and writes nothing more —
    // is now caught by the server's watcher, one pid check per running CLI, and
    // announced as `live-changed` like any other. A poll here could only ever
    // tell this page; the event tells every reader of that list, including the
    // amber "already open in a terminal" under the composer.
  });
  /**
   * Opening a session is having seen it, so its row in the bell goes.
   *
   * Gated on the row EXISTING, which is the whole reason this reads the list
   * rather than posting blind: the query is already mounted for the life of the
   * page by the bell in the header, so the common case — a session nothing was
   * waiting on — costs a lookup and sends nothing at all.
   *
   * **And gated on somebody being AT the window**, which is the other half of
   * the same sentence and was missing: a page is mounted whether or not anybody
   * is in front of it, so a session view sitting in a background tab, or behind
   * an editor while you work in it, used to withdraw its own row within
   * milliseconds of the row being raised — taking the card and the badge with it
   * and leaving nothing at all to come back to. That is the one case where the
   * bell has something to say and it was the one case it said nothing.
   *
   * So the row now WAITS, and the effect re-runs the moment the focus arrives,
   * which is the instant the session really was seen. `lib/windowFocus.ts` holds
   * why the test is this one and not the softer one the cards use.
   *
   * With `notifyInFront` on there is one more thing at stake: this stop is
   * being ANNOUNCED, right here, and withdrawing the row kills the card
   * (`NotificationToasts`' `live` filter) and silences the tone (its
   * `listed.current` re-check) before either has happened. So a row younger
   * than the announcement window is withdrawn when that window closes —
   * `TOAST_MS` from the stop, the card's own lifetime — and an older one
   * (walked into long after it stopped) goes immediately, as ever. Keyed on
   * the row's `at` rather than on this tab having raised a card, so a second
   * tab's card lives its ten seconds too.
   */
  const notifications = useNotifications();
  const rowAt = id ? notifications.data?.stopped.find((s) => s.sessionId === id)?.at : undefined;
  const atWindow = useWindowFocused();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const announceInFront =
    settings.data?.settings.notifyEnabled === true && settings.data?.settings.notifyInFront === true;
  useEffect(() => {
    if (!id || rowAt === undefined || !atWindow) return;
    const dismiss = () =>
      void api
        .dismissNotification(id)
        .then((body) => queryClient.setQueryData(['notifications'], body))
        // Nothing to report: the row is a convenience, and the SSE that follows
        // any real change will put the list right anyway.
        .catch(() => undefined);
    const wait = announceInFront ? rowAt + TOAST_MS - Date.now() : 0;
    if (wait <= 0) {
      dismiss();
      return;
    }
    const timer = setTimeout(dismiss, wait);
    return () => clearTimeout(timer);
  }, [id, rowAt, atWindow, announceInFront, queryClient]);
  /**
   * And the same act, said to the list: reading a session is what the row's
   * unread count is measured from (`server/src/core/readMarks.ts`).
   *
   * The server takes the tally itself; this only says WHEN. It is said on every
   * growth rather than once on arrival, which is what keeps what you are
   * WATCHING land from piling up as unread — `['session', id]` is refetched
   * whenever the transcript grows, so this effect re-runs with it — and it is
   * sent only when the mark is actually behind, so a turn of thirty tool calls
   * costs one POST rather than a render's worth.
   *
   * **Gated on the same focus as the bell row above**, and the sentence there
   * applies word for word: a page is mounted whether or not anybody is in front
   * of it, so a session view behind an editor is a session nobody has read. The
   * moment the focus arrives, so does the mark.
   */
  const readMarks = useReadMarks();
  const tally = detail.data ? messageTally(detail.data.summary) : null;
  const marked = id ? readMarks.data?.marks[id] : undefined;
  useEffect(() => {
    if (!id || !atWindow || tally === null || marked === tally) return;
    void api
      .markSessionRead(id)
      .then((body) => queryClient.setQueryData(['readMarks'], body))
      // Nothing to report: the count is a convenience, and the SSE that follows
      // any real change puts every window right anyway.
      .catch(() => undefined);
  }, [id, atWindow, tally, marked, queryClient]);
  const chatEnabled = settings.data?.settings.chatEnabled ?? false;
  // Which of the two the app offers at the foot of a session. Meaningless while
  // `chatEnabled` is off, and never read there: nothing is drawn either way.
  const terminalMode = chatEnabled && settings.data?.settings.chatMode === 'terminal';
  /**
   * We were handed this session by `/new`, which had a terminal open and being
   * typed into. The panel below is a fresh mount of that same terminal, so the
   * focus has to be given back to it — nothing else on this page asks for it,
   * and a session opened to be read never does.
   */
  const handedOver = (useLocation().state as { focusTerminal?: boolean } | null)?.focusTerminal === true;
  /**
   * A terminal has filled the window.
   *
   * The page has to know because the slot below is `position: sticky`, which
   * creates a stacking context: a full-screen panel rendered inside it cannot
   * out-number anything outside, and the follow pill went straight over it.
   * Lifting the whole slot is the only place that can be fixed from.
   */
  const [terminalLayout, setTerminalLayout] = useState({ full: false, open: false, height: 0, rightGap: 0 });
  // The terminal reports from a ResizeObserver, so this fires on every pixel of
  // a drag. Keep the previous object when nothing actually moved: otherwise the
  // whole page re-renders once per frame for a value that did not change.
  const onTerminalLayout = useCallback((next: typeof terminalLayout) => {
    setTerminalLayout((prev) =>
      prev.full === next.full && prev.open === next.open && prev.height === next.height && prev.rightGap === next.rightGap
        ? prev
        : next,
    );
  }, []);
  /**
   * Where the follow pill goes when a terminal is open.
   *
   * Beside it whenever there is room — that corner is where the pill has always
   * lived, and at the ordinary column width the gutter beside the panel is two
   * hundred pixels of nothing. It only climbs above the panel when the column
   * has grown enough to leave it nowhere to stand, which in practice means the
   * `Full` width. Measured, never assumed: `rightGap` is the real distance from
   * the panel's right edge to the scroller's.
   */
  const pillLift =
    terminalMode && terminalLayout.open && !terminalLayout.full && terminalLayout.rightGap < PILL_CORNER_PX
      ? terminalLayout.height
      : 0;
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
  /**
   * The session this page draws — the transcript when there is one, and the
   * shape of a session about to be born when there is not.
   *
   * `draft` is the server saying "I know this id and it has no file yet", which
   * is exactly the window in which `GET /api/sessions/:id` 404s while a CLI of
   * ours runs in it ([draftSessionDetail]). Taken from the chat status rather
   * than from that 404, so the page comes up at once instead of after the retry
   * — and the real detail wins the moment it exists, with no navigation.
   */
  const draft = useMemo(
    () => (chat.data?.draft ? draftSessionDetail(id, chat.data.cwd) : null),
    [chat.data?.draft, chat.data?.cwd, id],
  );
  const session = detail.data ?? draft;
  /** Drawing a session that has no transcript yet: a few things must say less. */
  const isDraft = !detail.data && !!draft;
  const reading = useReadingPrefs();
  const { showThinking, expandTools, expandSegments } = reading;
  const view = useViewPrefs();

  const msg = searchParams.get('msg');
  const tool = searchParams.get(TOOL_PARAM);
  /** Read here rather than beside `fileRef`, because the drawer below defers to it. */
  const fileParam = searchParams.get(FILE_PARAM);
  /** `null` while a file is open — one column beside the session, never two (see `fileRef`). */
  const agentId = fileParam ? null : searchParams.get('agent');
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
          // One column beside the session, never two: see `fileRef` below for
          // the rule and what it costs.
          sp.delete(FILE_PARAM);
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
   * Unconditionally, which a toggle cannot do: opening any other panel has to
   * take this one out of the URL, and asking a toggle to close something that
   * may already be closed would open it.
   */
  const closeAgents = useCallback(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete(AGENTS_PARAM);
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
   *
   * **One column beside the session, never two.** The file and a subagent's
   * transcript are the same kind of thing in the same place, and two of them
   * leave the conversation a strip between two panels — which is what the reader
   * came for. Both writers clear the other (`openFile` below, `openAgent`
   * above); this is the same rule at the reading end, so a URL carrying both —
   * typed, or pasted from before the rule existed — still draws one thing. The
   * file wins because it is the only one of the two that can be opened from
   * inside the other, so where both are set it is the later intent.
   *
   * What it costs is stated here because it was once a reason not to do it: a
   * path clicked inside a subagent's report closes the report, and the place you
   * had in it. The list is still open in the rail, so the way back is one press
   * — but it is a press, and the panel opens at the top.
   */
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

  const projectPath = session?.summary.projectPath ?? '';
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
            // The other column goes, with the anchors that only mean anything
            // inside it — one column beside the session, never two.
            sp.delete('agent');
            sp.delete(AGENT_TOOL_PARAM);
            sp.delete(AGENT_MSG_PARAM);
            return sp;
          },
          { replace: true },
        ),
    }),
    [id, projectPath, setSearchParams],
  );

  /**
   * Ctrl+F, and it is on whatever else is open.
   *
   * It used to be off while a file or a subagent was up, because both were
   * layers laid OVER the conversation: searching what you cannot see, and
   * stepping the page under a panel, is worse than no bar at all. Beside it
   * instead, the conversation is right there — so the bar searches it, exactly
   * as it does with an inspector panel open. It still reads only this
   * transcript and not the drawer's (its `find` prop is already the right shape
   * to serve that list when it does).
   */
  const finder = useFindBar(session?.turns ?? EMPTY_TURNS, id, {
    showThinking,
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
   *
   * **A jump control is not a click on the box it sits in** — that box is the one
   * being left — so it is asked nothing at all (`isJumpControl`, which carries
   * what pressing one twice in a row used to cost).
   */
  const selectFromClick = useCallback(
    (e: React.MouseEvent) => {
      if (isJumpControl(e.target)) return;
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

  /**
   * Drop an echoed prompt as soon as the real one arrives, matched on its text
   * — the transcript line has a uuid we never saw, so there is nothing else to
   * match on. A failed turn clears the lot: the process is gone and no line is
   * coming, and an echo left on screen would claim a message that never landed.
   */
  const turnsData = session?.turns;
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
  const fold = useFoldState(session?.turns ?? EMPTY_TURNS, showThinking, id);

  /**
   * The session's subagents joined to the calls and the reports they left in
   * the conversation — read by the list, by every notice panel and by every
   * Agent call, hence a context rather than three more props threaded down.
   */
  const subagentIndex = useMemo(
    () => buildSubagentIndex(session?.turns ?? EMPTY_TURNS, session?.subagents ?? EMPTY_AGENTS),
    [session],
  );
  /**
   * Every call this parse drew, which is what says a jump has somewhere to land,
   * and which of them announced a task. A walk of its own rather than the
   * subagent index's, because the notices that ask are mostly not agents' and
   * half of their sessions hold no subagent at all.
   */
  const toolCalls = useMemo(
    () => buildToolCallIndex(session?.turns ?? EMPTY_TURNS, session?.subagents ?? EMPTY_AGENTS),
    [session],
  );
  const subagentContext = useMemo<SubagentContextValue>(
    () => ({
      byId: subagentIndex.byId,
      byToolUse: subagentIndex.byToolUse,
      openAgent,
      goToCall: (toolUseId) => jumpTo(TOOL_PARAM, toolUseId),
      goToMessage: (uuid) => jumpTo('msg', uuid),
      hasCall: (toolUseId) => toolCalls.drawn.has(toolUseId),
      callOf: (noticeUuid) => toolCalls.callOfNotice.get(noticeUuid) ?? null,
      answerTo: (toolUseId) => toolCalls.answerOfCall.get(toolUseId) ?? null,
    }),
    [subagentIndex, toolCalls, openAgent, jumpTo],
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
  const sessionFiles = useMemo(() => collectSessionFiles(session?.turns ?? EMPTY_TURNS), [session]);

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
    () => collectMentionedFiles(session?.turns ?? EMPTY_TURNS),
    [session],
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
    () => new Set((session?.fileChanges ?? []).map((fc) => normalisePath(fc.path))),
    [session],
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

  /**
   * Which panel is open beside the conversation. Declared here because the
   * counts it needs are the last of them to be worked out, and read by the
   * Escape unwind just below.
   */
  const inspector = useInspector({
    changed: session?.fileChanges.length ?? 0,
    sent: sessionFiles.total,
    mentionCandidates: mentionCandidates.length,
    mentionCount: mentioned ? mentioned.rows.length : null,
    agentCount: session?.subagents.length ?? 0,
    hasLineage: !!session && (session.ancestry.forkedFrom !== null || session.ancestry.descendants.length > 0),
    agents: { open: agentsOpen, toggle: toggleAgents, close: closeAgents },
  });

  /**
   * The column that opens beside the session — a subagent's transcript, or the
   * file a link pointed at. ONE width for both, because there is one slot: the
   * reader sets a split, and swapping what is in the column is not a reason to
   * change it.
   *
   * Held HERE and not inside the panels for the same reason it survives the
   * swap: the file viewer is keyed on the reference, so it remounts on every new
   * file, and a width in its own state would go back to the default each time a
   * second path was clicked.
   */
  const column = useColumnWidth();
  /**
   * And how wide each thing beside the conversation is actually drawn. The
   * inspector goes in with the column: fitting only the column would let an
   * inspector dragged wide keep the room it was about to give up.
   */
  const sideLayout = useSideLayout({
    inspector: inspector.open === null ? null : inspector.width,
    column: agentId || fileRef ? column.width : null,
    // Whichever seam is under the hand wins, and the other gives way to its
    // floor — the pane you are dragging is the one you mean. At rest it is the
    // column's, which is the thing just opened to be looked at.
    priority: inspector.dragging ? 'inspector' : 'column',
  });
  /** One binding for the one seam, whichever of the two panels is in the slot. */
  const startColumnResize = useCallback(
    (e: React.MouseEvent) => column.startResize(e, sideLayout.maxColumn),
    [column, sideLayout.maxColumn],
  );

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
      // Outermost first: the column beside the session, then the rail's panel
      // inside it, then the page. Two of these four branches can no longer both
      // be true — a file and a subagent transcript are one slot — so the order
      // between them is only what it costs to read; the order that matters is
      // that a column closes before the panel it was opened from.
      //
      // The inspector is one branch for all six panels, which is what makes this
      // list honest: only the subagent list was ever in it, because putting one
      // file panel in and not the other would have been worse than neither.
      //
      // The find bar comes last before going back, and it is the one thing here
      // that is not a pane: it belongs to the conversation's own column and
      // closing it closes nothing you are looking at. Its own input handles
      // Escape and stops it there, so this branch is for an Escape pressed while
      // reading, with the bar still open behind you.
      if (fileRef) closeFile();
      else if (agentId) closeAgent();
      else if (inspector.open !== null) inspector.close();
      else if (finder.isOpen) finder.close();
      else navigate(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fileRef, closeFile, agentId, closeAgent, inspector, finder.isOpen, finder.close, navigate]);

  const { messageCount, thinkingCount, toolCount, compactionCount } = useMemo(() => {
    const items = (session?.turns ?? []).flatMap((t) => t.items);
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
  }, [session]);

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
    // A question of OURS is on screen. It has to be asked before the busy
    // branch: the SDK keeps the turn open while a question stands, so
    // `turnStartedAt` is still set and reading it first would spin the foot at
    // a person — the one lie the indicator refuses to tell. The clock is the
    // question's own `askedAt`, which is exactly the flip a CLI would write.
    const question = chat.data?.state === 'asking' ? (chat.data.question ?? null) : null;
    // The turn our question interrupted is still open, and its start is the
    // composer's own stamp — the badge's turn clock must not restart on it.
    const turnStarted = chat.data?.turnStartedAt != null ? Date.parse(chat.data.turnStartedAt) : NaN;
    if (question) {
      const askedAt = Date.parse(question.askedAt);
      return {
        pid: 0,
        status: 'waiting',
        waitingFor: askingFor(question.toolName),
        name: null,
        startedAt: null,
        updatedAt: null,
        statusUpdatedAt: Number.isNaN(askedAt) ? null : askedAt,
        busySince: Number.isNaN(turnStarted) ? null : turnStarted,
      };
    }
    // The server's figure when it has arrived, and until then the moment the
    // prompt was accepted. Waiting for the round trip left the indicator dark
    // for about a second after the click, which on a short turn is most of it —
    // the prompt was already on screen with nothing to say it was being worked on.
    const busySince =
      chat.data?.turnStartedAt != null ? Date.parse(chat.data.turnStartedAt) : (pending[0]?.at ?? null);
    if (busySince !== null) {
      return {
        pid: 0,
        status: 'busy',
        waitingFor: null,
        name: null,
        startedAt: null,
        updatedAt: null,
        statusUpdatedAt: busySince,
        busySince,
      };
    }
    return live.data?.find((l) => l.sessionId === id) ?? null;
    // The question's two SCALARS, not the object: its identity changes on every
    // refetch of the status, and this memo feeds a memoised TurnList — an object
    // dep would redraw the whole conversation for a payload that said nothing new.
  }, [chat.data?.state, chat.data?.question?.askedAt, chat.data?.question?.toolName, chat.data?.turnStartedAt, pending, live.data, id]);

  /**
   * The two clocks the indicator shows beside the turn's own. Read off the
   * conversation rather than off `/api/live`, which knows when the turn started
   * and nothing about what has happened inside it — and memoised on the parse,
   * so a re-render that changed no message leaves the indicator's props alone.
   */
  const activity = useMemo(() => turnActivity(session?.turns ?? EMPTY_TURNS), [session]);

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
   * the smaller of the two. What does arithmetic with it is whatever the FOOT
   * puts in the follow pill's corner — the composer (its action row and its
   * blocked bar) or the terminal's start bar — so it is written once here rather
   * than at each of them.
   *
   * The working indicator's clocks were the one consumer that was not in the
   * foot, and they stopped being a consumer at all when they moved to the left of
   * their own row: the pill floats in the scroller's bottom-RIGHT, so a row that
   * starts at the left margin has nothing to dodge and nothing to be told about
   * the column.
   */
  // `--conv-box` and not `100vw`: the conversation is centred in what the rail
  // and the open panel leave behind, and everything that measures the column has
  // to be told in the same words. It falls back to the viewport, so a thread
  // drawn outside that subtree is unaffected.
  const columnWidth = view.width === WIDTH_FULL ? 'var(--conv-box, 100vw)' : `min(${view.width}px, var(--conv-box, 100vw))`;

  /**
   * Hung off the last turn's rail rather than after the list: an answer being
   * written belongs where the answers are. Passed only while it has something to
   * draw, and never while a prompt is still waiting for the transcript — the
   * indicator belongs under THAT instead, as the exchange being answered.
   */
  const workingFooter = useMemo(
    () =>
      pending.length === 0 && isWorking(liveInfo) ? (
        <WorkingIndicator since={workingSince(liveInfo)} activity={activity} />
      ) : /**
       * A dialog is on screen — a permission, a question, a plan to approve —
       * and the turn is blocked on the reader. The same row in its waiting
       * mode, in the same place: the ring rests into the amber pulse, the
       * cause is written out, and the clock beside `total` is how long the
       * dialog has been standing. `workingSince` is the busy→waiting flip,
       * which is exactly when it went up.
       */
      pending.length === 0 && isWaiting(liveInfo) ? (
        <WorkingIndicator
          since={workingSince(liveInfo)}
          activity={activity}
          waitingFor={liveInfo?.waitingFor ?? null}
        />
      ) : /**
       * The turn is over and something it sent out is not, which is a state the
       * foot of the conversation said nothing about: an agent is launched
       * asynchronously, the turn ENDS while it works, and the report is what
       * wakes the session up again — so the last thing on screen was a finished
       * answer while three agents were still going.
       *
       * A sentence, where the ordinary row has none: this is the one wait the
       * spinner cannot describe on its own, because the COUNT is the news and
       * `Claude is working` would be false — Claude is idle, and what it sent
       * out is not. One clock only — since the first of them was sent out —
       * because what has landed inside their transcripts is in THEIR drawers,
       * and `activity` describes the parent's last turn, which is precisely the
       * turn that already ended.
       */
      pending.length === 0 && agentsWorking !== null ? (
        <WorkingIndicator since={running.since} startHint="Sent out" news={`${agentsWorking}…`} />
      ) : undefined,
    [pending.length, liveInfo, activity, agentsWorking, running.since],
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
            <WorkingIndicator since={workingSince(liveInfo)} activity={activity} />
          ) : null}
        </PendingTurn>
      )),
    [pending, liveInfo, activity],
  );

  if (!session && (detail.isLoading || chat.isLoading)) {
    return <div className="p-8 text-[var(--text-dim)]">Parsing conversation…</div>;
  }
  // Only now is it really missing: no transcript AND no reservation behind it.
  if (!session) {
    return <div className="p-8 text-red-400">Failed to load session: {String(detail.error ?? 'not found')}</div>;
  }

  const color =
    projects.data?.find((p) => p.key === session.summary.projectKey)?.color ?? FALLBACK_COLOR;
  /**
   * How this session was last answered — the composer's starting point. Read
   * from the end backwards, because that is the state the conversation is
   * actually in; the model at the top may be several changes old.
   */
  const lastAnswer = (() => {
    const turns = session.turns;
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
    const turns = session.turns;
    for (let t = turns.length - 1; t >= 0; t--) {
      const items = turns[t].items;
      for (let i = items.length - 1; i >= 0; i--) {
        const mode = items[i].permissionMode;
        if (mode) return mode === 'plan' ? 'plan' : 'auto';
      }
    }
    return null;
  })();

  /** How much of the window the conversation does NOT get: the rail, every open column, every seam. */
  const convGutter = sideLayout.gutter;

  /**
   * Whichever panel the rail has open. One node rather than six conditionals,
   * because there is one place it can go now — and a panel with nothing to show
   * cannot be reached at all: the rail only offers the ones this session has.
   */
  const panel = (() => {
    switch (inspector.open) {
      case 'tokens':
        return <TokenPanel summary={session.summary} turns={session.turns} />;
      case 'changed':
        return <FileChangesPanel fileChanges={session.fileChanges} />;
      case 'sent':
        return (
          <SessionFilesPanel
            sessionId={id}
            files={sessionFiles}
            onGoToCall={(toolUseId) => jumpTo(TOOL_PARAM, toolUseId)}
            onGoToMessage={(uuid) => jumpTo('msg', uuid)}
          />
        );
      case 'mentioned':
        return (
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
        );
      case 'agents':
        return (
          <SubagentsPanel
            sessionId={id}
            rows={subagentIndex.rows}
            openAgentId={agentId}
            sessionAlive={sessionAlive}
            now={now}
          />
        );
      case 'lineage':
        return <LineagePanel sessionId={id} />;
      default:
        return null;
    }
  })();

  return (
    // Wraps the drawer as well as the conversation: a path written in a
    // subagent's report is a path in this session too.
    <FileRefContext value={fileRefs}>
      <SubagentContext value={subagentContext}>
        {/* The page is a ROW: the session — its own header and everything under
            it — and then the columns that open BESIDE it. That nesting is the
            whole of why those columns run the full height: the session's header
            is inside the box to their left, and the app's header, above all of
            this, is never covered by either of them. */}
        <div className="flex h-full min-w-0">
        {/* `overflow-hidden`, which is the same promise `SideColumn` makes and
            the other half of it: a pane is a BOX, and nothing in one may be
            drawn in its neighbour. Without it the header's own controls — a
            `shrink-0` row that simply runs out of room — were painted straight
            across the seam and over the file beside it. Clipping them is the
            right answer rather than a shame: a session squeezed that far is
            being squeezed on purpose, and a button that is temporarily out of
            reach costs one drag to get back. It clips nothing that matters:
            `position: fixed` escapes it, so the hover cards, the image overlay
            and the terminal's full screen are untouched, and the two header
            menus open downward INSIDE the box. */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <SessionHeader
            detail={session}
            draft={isDraft}
            color={color}
            // Not detail.summary.live: that one only moves when the transcript
            // grows, so the badge would still read "live" through a turn the app
            // itself is running.
            live={liveInfo}
            actions={
              <>
                <FindButton
                  open={finder.isOpen}
                  onToggle={() => (finder.isOpen ? finder.close() : finder.openBar())}
                />
                <ViewMenu
                  view={view}
                  reading={reading}
                  fold={fold}
                  counts={{ thinking: thinkingCount, tools: toolCount, compactions: compactionCount }}
                />
              </>
            }
          />
          {/* Header above, and below it a ROW: the conversation, then whichever
              panel is open, then the rail. Every panel used to be stacked here,
              between the header and the scroller, which is why opening one
              pushed the conversation down — the thing the rail exists to stop. */}
          <div
            className="flex min-h-0 flex-1"
            // What is left of the window once the rail and the open panel have
            // taken theirs. The composer and the terminal give up the follow
            // pill's corner wherever the column reaches the edge of the box it
            // is centred in, and that box is no longer the viewport; inherited
            // as a variable rather than passed down, so the two of them and the
            // width below cannot disagree about it.
            style={{ '--conv-box': `calc(100vw - ${convGutter}px)` } as React.CSSProperties}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Inside the column, not above it: at full width it would run
                  under the inspector, and what it searches is the conversation. */}
              <FindBar {...finder.bar} />
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
              // The embedded terminal's drag handle measures this to run its bar
              // the full width of the scroller rather than of the column.
              data-conversation-scroller
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
                      turns={session.turns}
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
                      lastTurnInFlight={isWorking(liveInfo) || isWaiting(liveInfo)}
                      pending={pendingTurns}
                    />
                  </StarContext>
                  {session.turns.length === 0 && pending.length === 0 && (
                    <div className="p-8 text-center text-[var(--text-dim)]">
                      {isDraft
                        ? 'Nothing here yet — this conversation starts with your first message.'
                        : 'This session has no conversation content.'}
                    </div>
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
                    className={`sticky bottom-0 mt-auto pt-6 ${terminalLayout.full ? 'z-50' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* The two modes share this slot and everything it imposes.
                        The wrapper is the same for both deliberately: what
                        changes is how you talk to Claude, not where the
                        conversation ends. */}
                    {terminalMode ? (
                      <SessionTerminal
                        sessionId={id}
                        columnWidth={columnWidth}
                        autoFocus={handedOver}
                        onLayout={onTerminalLayout}
                      />
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
                reports will land here — but they say so in their own words.
                Waiting is the third state, and it never spins: the pill wears
                the row's amber pulse and its hover says what is being waited
                for, because "is anything more coming" is then answered by the
                reader, not by Claude. */}
            <FollowBottomButton
              following={follow.following}
              toggle={follow.toggle}
              unseen={follow.unseen}
              working={isWorking(liveInfo) || agentsWorking !== null}
              workingWhat={isWorking(liveInfo) ? undefined : (agentsWorking ?? undefined)}
              waiting={isWaiting(liveInfo) ? waitingSentence(liveInfo?.waitingFor ?? null) : undefined}
                  liftPx={pillLift}
                />
              </div>
            </div>
            <Inspector inspector={inspector} width={sideLayout.inspector} maxWidth={sideLayout.maxInspector}>
              {panel}
            </Inspector>
            <InspectorRail inspector={inspector} />
          </div>
        </div>
          {/* A subagent's transcript, then the file — in that order, and it is
              the old z-order restated as a position. A path is often clicked
              from inside a subagent's report, so the report has to stay
              readable while the file it named is read; the file panel used to
              buy that by being drawn OVER the drawer, and buys it now by being
              the column after it. */}
          {agentId && (
            <SideColumn kind="agent" width={sideLayout.column} onResizeStart={startColumnResize}>
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
            </SideColumn>
          )}
          {fileRef && (
            <SideColumn kind="file" width={sideLayout.column} onResizeStart={startColumnResize}>
              <FileViewerPanel
                // Keyed on the reference: opening another file starts a fresh panel
                // rather than scrolling the previous one's state onto a new body.
                // The COLUMN is not keyed, so its width survives the remount.
                key={formatFileRef(fileRef)}
                sessionId={id}
                projectPath={projectPath}
                fileRef={fileRef}
                onClose={closeFile}
              />
            </SideColumn>
          )}
        </div>
      </SubagentContext>
    </FileRefContext>
  );
}
