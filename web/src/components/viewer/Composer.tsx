import { CHAT_MESSAGE_MAX, CLAUDE_EFFORTS, CLAUDE_MODELS } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';

/** Grow with the text, but never eat the conversation above. */
const MAX_TEXTAREA_PX = 220;

/**
 * Discreet, borderless chips: the box is the control, these ride inside it.
 * `appearance-none` because a native select draws a chrome dropdown arrow that
 * looks nothing like the rest of the app — the caret is drawn alongside instead.
 */
const chip =
  'cursor-pointer appearance-none rounded-md bg-transparent py-0.5 pr-4 pl-1.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

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
export function Composer({ sessionId, maxWidth }: { sessionId: string; maxWidth?: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
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
  const working = status?.state === 'working' || status?.state === 'starting';
  const blocked = status?.blockedReason ?? null;
  const model = status?.model ?? CLAUDE_MODELS[1];
  const effort = status?.effort ?? 'high';

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
      .then(() => setText(''))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setSending(false);
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

  // A message the user cannot act on is worse than no message: say why the box
  // is dead, right next to it.
  const notice = blocked ?? error ?? status?.lastError ?? null;
  const canSend = !!text.trim() && !sending && !blocked;

  return (
    // The page's own background, so the conversation scrolls under this rather
    // than through it.
    <div className="relative shrink-0 bg-[var(--bg)] px-4 pt-1 pb-3">
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
              options={CLAUDE_MODELS}
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
