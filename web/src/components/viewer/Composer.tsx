import { CHAT_MESSAGE_MAX, CLAUDE_EFFORTS, CLAUDE_MODELS } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { QuestionPanel } from './QuestionPanel.tsx';

/** Grow with the text, but never eat the conversation above. */
const MAX_TEXTAREA_PX = 220;

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
  options: readonly string[];
  disabled: boolean;
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
          <option key={o} value={o}>
            {o}
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
 * It is sized and aligned as a USER bubble, because that is what it becomes:
 * same `maxWidth` as the conversation, same `px-4` gutter, and none of the
 * rail's indent — that belongs to the replies. A full-width footer read as
 * chrome bolted to the window instead of as the next thing in the thread.
 */
export function Composer({
  sessionId,
  maxWidth,
  onSent,
}: {
  sessionId: string;
  maxWidth?: string;
  /** The prompt was accepted by the server; show it before the transcript has it. */
  onSent?: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [answering, setAnswering] = useState(false);
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
  const model = status?.model ?? CLAUDE_MODELS[1];
  const effort = status?.effort ?? 'high';
  // What this CLI really accepts, once a session has been asked. Before that,
  // the shared list — which is a reasonable guess, not the truth: the live list
  // turns out to carry variants like `opus[1m]` that no constant here had.
  const models = status?.availableModels.length ? status.availableModels : [...CLAUDE_MODELS];
  const commands = status?.availableCommands ?? [];

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
    api
      .chatSend(sessionId, { text: prompt, model, effort })
      .then(() => {
        setText('');
        // Only once the server has taken it: an echo of a prompt that was
        // refused would be a message the conversation never had.
        onSent?.(prompt);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setSending(false);
        void queryClient.invalidateQueries({ queryKey: ['chat', sessionId] });
      });
  };

  const answer = (answers: Record<string, string | string[]> | null) => {
    setAnswering(true);
    api
      .chatAnswer(sessionId, answers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setAnswering(false);
        void queryClient.invalidateQueries({ queryKey: ['chat', sessionId] });
      });
  };

  const stop = () => {
    api
      .chatStop(sessionId)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['chat', sessionId] }));
  };

  const change = (patch: { model?: string; effort?: string }) => {
    // Both are startup flags, so the server restarts the process to honour a
    // new one. Nothing to do here but remember the choice for the next send.
    queryClient.setQueryData(['chat', sessionId], (old: typeof status) => (old ? { ...old, ...patch } : old));
  };

  // Only while the whole box is a command being typed — a `/` inside a
  // sentence is a slash, not a command.
  const typedCommand = /^\/(\S*)$/.exec(text);
  const suggestions = typedCommand
    ? commands.filter((c) => c.startsWith(typedCommand[1])).slice(0, 8)
    : [];

  // A message the user cannot act on is worse than no message: say why the box
  // is dead, right next to it.
  const notice = blocked ?? error ?? status?.lastError ?? null;
  const canSend = !!text.trim() && !sending && !blocked;

  return (
    // The page's own background, so the conversation scrolls under this rather
    // than through it.
    <div className="relative shrink-0 bg-[var(--bg)] px-4 pt-1 pb-3">
      {/* Above the box, below the conversation: where the next message goes.
          Not a modal — a question is no reason to stop the app being usable. */}
      {status?.question && (
        <QuestionPanel
          question={status.question}
          maxWidth={maxWidth}
          busy={answering}
          onAnswer={(answers) => answer(answers)}
          onDecline={() => answer(null)}
        />
      )}
      {/* Slash commands this CLI really has, offered as you type `/`. */}
      {suggestions.length > 0 && (
        <div className="mx-auto mb-1.5" style={{ maxWidth }}>
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
      <div className="mx-auto" style={{ maxWidth }}>
        {notice && (
          <div
            className={`mb-1.5 rounded-lg px-3 py-1.5 text-xs ${
              blocked
                ? 'border border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-dim)]'
                : 'border border-red-500/40 bg-red-500/10 text-red-300'
            }`}
          >
            {notice}
          </div>
        )}
        <div
          className={`rounded-2xl border bg-[var(--bg-raised)] shadow-lg transition-colors ${
            blocked
              ? 'border-[var(--border)] opacity-60'
              : 'border-[var(--border)] focus-within:border-[var(--accent-dim)]'
          }`}
        >
          <textarea
            ref={box}
            value={text}
            rows={1}
            maxLength={CHAT_MESSAGE_MAX}
            disabled={!!blocked}
            placeholder={blocked ? 'Sending is unavailable' : 'Message Claude…'}
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
          <div className="flex items-center gap-1 px-2 pt-0.5 pb-2">
            <Picker
              value={model}
              options={models}
              disabled={working || !!blocked}
              title="Model for the next prompt"
              onChange={(v) => change({ model: v })}
            />
            <Picker
              value={effort}
              options={CLAUDE_EFFORTS}
              disabled={working || !!blocked}
              title="Effort for the next prompt"
              onChange={(v) => change({ effort: v })}
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
      </div>
    </div>
  );
}
