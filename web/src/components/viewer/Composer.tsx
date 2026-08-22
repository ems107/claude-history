import {
  CHAT_MESSAGE_MAX,
  CLAUDE_MODELS,
  type ChatModelInfo,
  type ChatPermissionMode,
  type ChatPlanDecision,
} from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { SessionDetailResponse } from '@claude-history/shared';
import { api } from '../../api/client.ts';
import { shortModel } from '../../lib/format.ts';
import { cacheClockOf, CloseSessionDialog, closingNeedsAsking } from './CloseSessionDialog.tsx';
import { BlockedBar } from './BlockedBar.tsx';
import { PILL_CORNER_PX } from './FollowBottom.tsx';
import { QuestionPanel } from './QuestionPanel.tsx';

/** Grow with the text, but never eat the conversation above. */
const MAX_TEXTAREA_PX = 220;

/**
 * `claude-sonnet-5` and `sonnet` are the same choice wearing two names: the
 * transcript records the resolved id, the CLI offers aliases. `resolvedModel`
 * says which alias covers which id, which is exact; the family match is the
 * fallback for a transcript written by a version that named it differently.
 */
function matchModel(want: string, offered: ChatModelInfo[]): string {
  if (offered.some((m) => m.value === want)) return want;
  const resolved = offered.find((m) => m.resolvedModel === want);
  if (resolved) return resolved.value;
  const family = (s: string) => s.toLowerCase().replace(/^claude-/, '').replace(/\[.*$/, '').split('-')[0];
  const target = family(want);
  return offered.find((m) => family(m.value) === target)?.value ?? want;
}

/**
 * What to call a model in the picker. `description` leads with the version and
 * says when it carries 1M of context (`Opus 5 with 1M context`), which the bare
 * alias never did; `displayName` is the fallback for a row without one.
 */
function modelLabel(m: ChatModelInfo): string {
  const version = m.description.split('·')[0].trim();
  if (!version) return m.displayName;
  return m.value === 'default' ? `Default · ${version}` : version;
}

/**
 * Discreet, borderless chips: the box is the control, these ride inside it.
 * `appearance-none` because a native select draws a chrome dropdown arrow that
 * looks nothing like the rest of the app — the caret is drawn alongside instead.
 */
const chip =
  'cursor-pointer appearance-none rounded-md bg-transparent py-0.5 pr-4 pl-1.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The process is alive between turns — that is what makes the second prompt
 * start in 38 ms instead of a second and a half — and until now nothing said
 * so. A process holding a slot invisibly, with no way to end it but waiting,
 * is the kind of thing found out by accident.
 */
function IdleProcess({ closesAt, onClose }: { closesAt: string | null; onClose: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  const left = closesAt ? Date.parse(closesAt) - Date.now() : null;
  const countdown =
    left === null || left <= 0
      ? null
      : `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;

  return (
    <span className="flex items-center gap-1 px-1 text-[11px] text-[var(--text-dim)]">
      <span title="A Claude Code process is loaded for this session, so the next prompt starts instantly">
        ready{countdown ? ` · closes in ${countdown}` : ''}
      </span>
      <button
        type="button"
        onClick={onClose}
        title="Close the process now instead of waiting for it to time out"
        className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        close
      </button>
    </span>
  );
}

function Picker({
  value,
  options,
  disabled,
  title,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  /** Optional: the mode picker is never disabled, since it needs no running CLI. */
  disabled?: boolean;
  title: string;
  onChange: (v: string) => void;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={chip}
        title={title}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-1 text-[7px] text-[var(--text-dim)]">
        ▼
      </span>
    </span>
  );
}

/**
 * Send a prompt to this session's Claude Code process.
 *
 * There is no transcript rendering here on purpose: the answer arrives the way
 * every live session's does — Claude Code appends to the transcript, the
 * watcher notices, the viewer above re-reads it. This is an input, not a chat
 * window. What it does own is the state of the process, which nothing else can
 * see: a `--print` run writes no `status` into ~/.claude/sessions, so the
 * working indicator is driven from here (see SessionViewPage).
 *
 * It is sized and aligned as a USER bubble, because that is what it becomes: it
 * is drawn INSIDE the conversation's own column (`SessionViewPage` sticks it to
 * the foot of the scroller), so the width and the gutter are the bubbles' own,
 * and it takes none of the rail's indent — that belongs to the replies. A
 * full-width footer read as chrome bolted to the window instead of as the next
 * thing in the thread.
 */
export function Composer({
  sessionId,
  columnWidth,
  onSent,
  lastModel,
  lastEffort,
  lastMode,
}: {
  sessionId: string;
  /**
   * The width of the conversation's column, as a CSS length. Used for one piece
   * of arithmetic: the follow-the-end pill floats in the scroller's bottom-right
   * corner, which is the corner Send sits in, and the pill is on top — it would
   * take the click. `--conv-box/2 - column/2` is the margin between this box
   * and the
   * window's edge, so where that margin is smaller than the pill needs, the
   * action row gives up the difference and Send steps aside. Where it is not
   * (any width with room around it), the row keeps its own padding and nothing
   * moves. Both cases are one `max()`, which also means resizing the window
   * needs no measuring and no re-render.
   *
   * Omitted where there is no pill to dodge — the new-session page, which has no
   * conversation to follow — and then the row simply keeps its own padding.
   */
  columnWidth?: string;
  /**
   * The prompt was accepted by the server; show it before the transcript has it.
   *
   * What it went out ON comes with it, because the composer is the only thing
   * that knows: the model, effort and mode are resolved here from a running CLI,
   * the transcript and the fallbacks, and a caller that wanted to remember the
   * choice would otherwise have to redo that resolution and get it slightly
   * wrong. Ignored by the viewer, which has a transcript to read it back from.
   */
  onSent?: (text: string, sent: { model: string; effort: string | null; permissionMode: ChatPermissionMode }) => void;
  /**
   * How this session was last answered, from the transcript. The starting point
   * for the pickers: there is no configured default, because one would quietly
   * switch the model of a session you only meant to reply to.
   */
  lastModel?: string | null;
  lastEffort?: string | null;
  /** The permission mode the session was last in — `plan` is the one worth restoring. */
  lastMode?: ChatPermissionMode | null;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const chat = useQuery({
    queryKey: ['chat', sessionId],
    queryFn: () => api.chatStatus(sessionId),
    // The SSE event is the real signal; this only covers the gap while a turn
    // runs, where a dropped event would leave the composer looking stuck.
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s === 'working' || s === 'starting' ? 2_000 : false;
    },
  });

  const status = chat.data;
  const working = status?.state === 'working' || status?.state === 'starting' || status?.state === 'asking';
  const blocked = status?.blockedReason ?? null;
  // A running process wins, because that is what a prompt would actually go to.
  // Otherwise: how this session was last answered. Continuing a conversation
  // should continue it — including the model and effort it was being held at.
  // CLAUDE_MODELS[1] is the last resort only: a session with no answer in it at
  // all, which has nothing to continue from.
  const wantedModel = status?.model ?? lastModel ?? CLAUDE_MODELS[1];
  // No invented default: a level this model may not even have is worse than
  // letting the CLI use its own.
  const effort = status?.effort ?? lastEffort ?? null;
  /**
   * The models this CLI offers — knowable only from a running one, so before
   * that there is no list and none is shown. A hard-coded stand-in was worse
   * than nothing: it claimed haiku takes five effort levels, which is exactly
   * the thing the live list corrected.
   */
  const offered: ChatModelInfo[] = status?.availableModels ?? [];
  const model = matchModel(wantedModel, offered);
  // Anything that matches nothing is added as its own option rather than
  // silently replaced: the box must show what will actually be sent.
  const models = offered.length > 0 && !offered.some((m) => m.value === model)
    ? [{ value: model, displayName: model, description: '', resolvedModel: null, efforts: [] }, ...offered]
    : offered;
  const current = models.find((m) => m.value === model);
  // Per model, not a fixed list: haiku takes no effort at all, and offering it
  // five levels was both wrong on screen and wrong on the wire.
  const efforts = current?.efforts ?? [];
  const commands = status?.availableCommands ?? [];
  // Same rule as the model: what is running wins, then what the session was
  // last in, then the ordinary way of sending.
  const mode: ChatPermissionMode = status?.permissionMode ?? lastMode ?? 'auto';

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  const send = () => {
    const prompt = text.trim();
    if (!prompt || sending || blocked) return;
    setSending(true);
    setError(null);
    // With a model list, the effort is one this model actually takes, or none at
    // all. Without one, the effort the session was last answered at is the only
    // evidence available — and it is good evidence: that model took it.
    const sentEffort = models.length > 0 ? (efforts.length > 0 ? (effort ?? efforts[0]) : null) : effort;
    api
      .chatSend(sessionId, { text: prompt, model, effort: sentEffort, permissionMode: mode })
      .then(() => {
        setText('');
        // Only once the server has taken it: an echo of a prompt that was
        // refused would be a message the conversation never had.
        onSent?.(prompt, { model, effort: sentEffort, permissionMode: mode });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setSending(false);
        void queryClient.invalidateQueries({ queryKey: ['chat', sessionId] });
      });
  };

  const open = () => {
    setOpening(true);
    setError(null);
    api
      .chatStart(sessionId, { model: wantedModel, effort, permissionMode: mode })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setOpening(false);
        void queryClient.invalidateQueries({ queryKey: ['chat', sessionId] });
      });
  };

  const answer = (
    answers: Record<string, string | string[]> | null,
    plan?: { decision: ChatPlanDecision; note?: string },
    annotations?: Record<string, { notes?: string }>,
  ) => {
    setAnswering(true);
    api
      .chatAnswer(sessionId, answers, plan, annotations)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setAnswering(false);
        void queryClient.invalidateQueries({ queryKey: ['chat', sessionId] });
      });
  };

  /**
   * Closing can end the CLI mid-answer, and the next prompt then comes from one
   * that has just started — which is the thing that risks the cached prefix
   * ([CloseSessionDialog]). Two conditions, both about not asking a question
   * with no content: there has to be a process to close, and there has to be
   * something to lose by closing it (`closingNeedsAsking`).
   */
  const [confirmClose, setConfirmClose] = useState(false);
  const closeNow = () => {
    setConfirmClose(false);
    api
      .chatStop(sessionId)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['chat', sessionId] }));
  };
  const stop = () => {
    if (status?.running && closingNeedsAsking(queryClient, sessionId, working)) setConfirmClose(true);
    else closeNow();
  };

  const change = (patch: { model?: string; effort?: string | null; permissionMode?: ChatPermissionMode }) => {
    // Model and mode are switched live on the next send, effort restarts the
    // process. Either way there is nothing to do here but remember the choice.
    queryClient.setQueryData(['chat', sessionId], (old: typeof status) => (old ? { ...old, ...patch } : old));
  };

  // Only while the whole box is a command being typed — a `/` inside a
  // sentence is a slash, not a command.
  const typedCommand = /^\/(\S*)$/.exec(text);
  const suggestions = typedCommand
    ? commands.filter((c) => c.startsWith(typedCommand[1])).slice(0, 8)
    : [];

  // What went WRONG, which is not the same as what is not allowed: a failed
  // prompt or a CLI that would not start is red and keeps the box, while a
  // `blocked` session replaces the box altogether ([BlockedBar]) — the box would
  // be dead, and a dead box plus a sentence is two rows saying one thing.
  const notice = error ?? status?.lastError ?? null;
  // Read from the cache rather than fetched: the page already holds this query,
  // and a dialog is no reason to go and ask for a whole transcript again.
  const cacheClock = confirmClose
    ? cacheClockOf(queryClient.getQueryData<SessionDetailResponse>(['session', sessionId]))
    : null;
  const canSend = !!text.trim() && !sending && !blocked;

  return (
    // The page's own background, so the conversation scrolls under this rather
    // than through it — which it now literally does: this is stuck to the bottom
    // of the scroller the turns are in.
    <div className="relative shrink-0 bg-[var(--bg)] pt-1 pb-3">
      {confirmClose && (
        <CloseSessionDialog
          cache={cacheClock}
          busy={working}
          onCancel={() => setConfirmClose(false)}
          onConfirm={closeNow}
        />
      )}
      {/* Above the box, below the conversation: where the next message goes.
          Not a modal — a question is no reason to stop the app being usable. */}
      {status?.question && (
        <QuestionPanel
          question={status.question}
          busy={answering}
          onAnswer={(answers, annotations) => answer(answers, undefined, annotations)}
          onDecline={() => answer(null)}
          onPlanDecision={(decision, note) => answer({}, { decision, note })}
        />
      )}
      {/* Slash commands this CLI really has, offered as you type `/`. */}
      {suggestions.length > 0 && (
        <div className="mb-1.5">
          <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] shadow-lg">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={(e) => {
                  // mousedown, not click: the textarea must not lose focus
                  // before the value is replaced.
                  e.preventDefault();
                  setText(`/${name} `);
                  box.current?.focus();
                }}
                className="block w-full px-3 py-1 text-left font-mono text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              >
                /{name}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* The last bubble used to meet the composer at a hard edge, mid-sentence.
          This fades it out over the scroller instead — it sits outside this box
          on purpose, and takes no space. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-b from-transparent to-[var(--bg)]"
      />
      <div>
        {blocked ? (
          <BlockedBar reason={blocked} columnWidth={columnWidth} />
        ) : (
          <>
            {notice && (
              <div className="mb-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
                {notice}
              </div>
            )}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-raised)] shadow-lg transition-colors focus-within:border-[var(--accent-dim)]">
              <textarea
                ref={box}
                value={text}
                rows={1}
                maxLength={CHAT_MESSAGE_MAX}
                placeholder="Message Claude…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter is a newline. The page's own Escape
                  // handler already ignores TEXTAREA, so nothing else to guard.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-dim)]"
              />
              <div
                className="flex items-center gap-1 px-2 pt-0.5 pb-2"
                style={
                  columnWidth
                    ? { paddingRight: `max(0.5rem, calc(${PILL_CORNER_PX}px - var(--conv-box, 100vw) / 2 + ${columnWidth} / 2))` }
                    : undefined
                }
              >
                {/* No running CLI, no model list — so instead of a stale guess,
                    the offer to go and get the real one. Sending works without it:
                    the prompt goes out on whatever answered this session last. */}
                {models.length === 0 ? (
                  <button
                    type="button"
                    onClick={open}
                    disabled={opening}
                    title={`Loads this session so you can pick a model and effort. Without it, a prompt goes out on ${shortModel(wantedModel) ?? wantedModel}${effort ? ` at ${effort}` : ''} — how this session was last answered.`}
                    className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {opening ? 'opening…' : 'choose model…'}
                  </button>
                ) : (
                  <>
                    <Picker
                      value={model}
                      options={models.map((m) => ({ value: m.value, label: modelLabel(m) }))}
                      disabled={working}
                      title={current?.description || 'Model for the next prompt'}
                      onChange={(v) => {
                        // The new model may not take the effort the old one was on.
                        const next = models.find((m) => m.value === v);
                        const keep = next && effort && next.efforts.includes(effort) ? effort : (next?.efforts[0] ?? null);
                        change({ model: v, effort: keep });
                      }}
                    />
                    {/* Hidden entirely for a model with no effort levels, rather
                        than shown greyed: there is no setting to make. */}
                    {efforts.length > 0 && (
                      <Picker
                        value={effort ?? efforts[0]}
                        options={efforts.map((e: string) => ({ value: e, label: e }))}
                        disabled={working}
                        title="Effort for the next prompt"
                        onChange={(v) => change({ effort: v })}
                      />
                    )}
                  </>
                )}
                {/* Always offered, model list or not: unlike the model and the
                    effort, the mode needs nothing from a running CLI to be picked,
                    and plan mode is most useful on the FIRST prompt of a piece of
                    work — which is exactly when no process exists yet. */}
                <Picker
                  value={mode}
                  options={[
                    { value: 'auto', label: 'auto' },
                    { value: 'plan', label: 'plan' },
                  ]}
                  title={
                    mode === 'plan'
                      ? 'Plan mode: Claude explores and designs, but changes nothing until you approve a plan.'
                      : 'Claude works as usual, approving the ordinary tools by itself.'
                  }
                  onChange={(v) => change({ permissionMode: v as ChatPermissionMode })}
                />
                {status?.state === 'starting' && (
                  <span className="px-1 text-[11px] text-[var(--text-dim)]">starting…</span>
                )}
                {(status?.queued ?? 0) > 0 && (
                  <span className="px-1 text-[11px] text-[var(--text-dim)]">{status?.queued} queued</span>
                )}
                {!working && status?.running && (
                  <IdleProcess closesAt={status.idleClosesAt} onClose={stop} />
                )}
                <span className="ml-auto" />
                {working ? (
                  <button
                    type="button"
                    onClick={stop}
                    title="Stop this turn"
                    aria-label="Stop this turn"
                    className="flex size-7 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                  >
                    <span aria-hidden className="size-2.5 rounded-[2px] bg-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={send}
                    disabled={!canSend}
                    title="Send (Enter)"
                    aria-label="Send"
                    className={`flex size-7 items-center justify-center rounded-full transition-colors ${
                      canSend
                        ? 'bg-[var(--accent)] text-[#1b1512] hover:brightness-110'
                        : 'bg-[var(--bg-hover)] text-[var(--text-dim)]'
                    }`}
                  >
                    <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 13V3.5M8 3.5 4 7.5M8 3.5l4 4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
