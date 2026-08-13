import { CHAT_MESSAGE_MAX, CLAUDE_EFFORTS, CLAUDE_MODELS } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';

/** Grow with the text, but never eat the conversation above. */
const MAX_TEXTAREA_PX = 200;

const control =
  'rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:hover:bg-[var(--bg)]';

/**
 * Send a prompt to this session's Claude Code process.
 *
 * There is no transcript rendering here on purpose: the answer arrives the way
 * every live session's does — Claude Code appends to the transcript, the
 * watcher notices, the viewer above re-reads it. This is an input, not a chat
 * window. What it does own is the state of the process, which nothing else can
 * see: a `--print` run writes no `status` into ~/.claude/sessions, so the
 * working indicator is driven from here (see SessionViewPage).
 */
export function Composer({ sessionId }: { sessionId: string }) {
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
    queryClient.setQueryData(['chat', sessionId], (old: typeof status) =>
      old ? { ...old, ...patch } : old,
    );
  };

  // A message the user cannot act on is worse than no message: say why the box
  // is dead, right next to it.
  const notice = blocked ?? error ?? status?.lastError ?? null;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-raised)] px-4 py-2">
      <div className="mx-auto flex max-w-4xl flex-col gap-1.5">
        {notice && (
          <div
            className={`rounded px-2 py-1 text-xs ${
              blocked
                ? 'border border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)]'
                : 'border border-red-500/40 bg-red-500/10 text-red-300'
            }`}
          >
            {notice}
          </div>
        )}
        <textarea
          ref={box}
          value={text}
          rows={1}
          maxLength={CHAT_MESSAGE_MAX}
          disabled={!!blocked}
          placeholder={blocked ? 'Sending is unavailable' : 'Continue this conversation…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline. The page's own Escape
            // handler already ignores TEXTAREA, so nothing else to guard.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="w-full resize-none rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] disabled:opacity-50"
        />
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
          <select
            value={model}
            disabled={working}
            onChange={(e) => change({ model: e.target.value })}
            className={control}
            title="Model for the next prompt"
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={effort}
            disabled={working}
            onChange={(e) => change({ effort: e.target.value })}
            className={control}
            title="Effort for the next prompt"
          >
            {CLAUDE_EFFORTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          {status?.state === 'starting' && <span>starting…</span>}
          {(status?.queued ?? 0) > 0 && (
            <span>
              {status?.queued} queued
            </span>
          )}
          <span className="ml-auto" />
          {working ? (
            <button type="button" onClick={stop} className={control}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!text.trim() || sending || !!blocked}
              className="rounded border border-[var(--accent-dim)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
