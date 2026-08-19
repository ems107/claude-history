import type { ProjectInfo } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { Composer } from '../components/viewer/Composer.tsx';
import { PendingTurn } from '../components/viewer/PendingTurn.tsx';
import { WorkingIndicator } from '../components/viewer/WorkingIndicator.tsx';

/** The folder this page opened on last time — a project key, or `folder:<path>`. */
const REMEMBERED = 'ch:newSessionProject';
/** What the picker calls "not one of these". */
const OTHER = '\u0000other';

/**
 * A backstop only. `sessions-changed` invalidates `['session', id]` the moment
 * the watcher sees the file, so the handover normally happens on the event; this
 * covers a dropped SSE frame, where the alternative is a page that waits for
 * ever on a session that already exists.
 */
const HANDOVER_POLL_MS = 1_500;

function label(p: ProjectInfo): string {
  return p.name === p.path ? p.path : `${p.name} — ${p.path}`;
}

/**
 * Start a conversation that does not exist yet.
 *
 * The whole page is scaffolding around one gap: a transcript is written by
 * Claude Code, and until the first turn there is none, so the viewer — which
 * renders transcripts and nothing else — has nothing to draw. Rather than teach
 * it to render an absence, this stands in for it and then gets out of the way:
 * pick a folder, reserve the id, send the first prompt, and hand over to
 * `/session/<id>` as soon as the file is on disk. Everything after that is the
 * ordinary viewer, with its live indicator, its costs and its own composer.
 *
 * The composer here IS that composer, the same component: the question panel,
 * plan mode, the slash commands and Stop all work on the first prompt because
 * nothing about them ever needed a transcript.
 */
export function NewSessionPage() {
  const navigate = useNavigate();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const chatEnabled = settings.data?.settings.chatEnabled ?? false;

  const remembered = useMemo(() => localStorage.getItem(REMEMBERED) ?? '', []);
  const [choice, setChoice] = useState(() => (remembered.startsWith('folder:') ? OTHER : remembered));
  const [folder, setFolder] = useState(() =>
    remembered.startsWith('folder:') ? remembered.slice('folder:'.length) : '',
  );
  /** The reserved id and the folder behind it, or null while the picker is up. */
  const [draft, setDraft] = useState<{ sessionId: string; cwd: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Prompts the server has taken, before Claude Code has written them down. */
  const [pending, setPending] = useState<{ text: string; at: number }[]>([]);

  // Nothing is chosen on a machine with no projects and no memory, and the
  // first row is a better guess than an empty box that refuses to start.
  useEffect(() => {
    if (!choice && projects.data?.length) setChoice(projects.data[0].key);
  }, [choice, projects.data]);

  /**
   * The transcript, once there is one. This is the handover: the same query key
   * the viewer uses, so arriving there costs no second request, and the same key
   * `sessions-changed` invalidates, so the event does the waking.
   *
   * Only after a prompt has gone out. Opening the CLI to read the model list
   * writes no transcript (measured), but a session started from a terminal in
   * the same second would be indistinguishable — and jumping out of a page with
   * an empty box is the one thing this must never do.
   */
  const sent = pending.length > 0;
  const born = useQuery({
    queryKey: ['session', draft?.sessionId ?? ''],
    queryFn: () => api.session(draft?.sessionId ?? ''),
    enabled: sent && !!draft,
    retry: false,
    refetchInterval: (q) => (q.state.data ? false : HANDOVER_POLL_MS),
  });

  const bornId = born.data?.summary.id;
  useEffect(() => {
    // `replace`, so Back goes where the user came from rather than to a picker
    // for a session that has already started.
    if (bornId) navigate(`/session/${bornId}`, { replace: true });
  }, [bornId, navigate]);

  const start = () => {
    setCreating(true);
    setError(null);
    const body = choice === OTHER ? { cwd: folder } : { projectKey: choice };
    api
      .chatCreate(body)
      .then((d) => {
        setDraft(d);
        localStorage.setItem(REMEMBERED, choice === OTHER ? `folder:${d.cwd}` : choice);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false));
  };

  if (settings.isPending) return null;
  if (!chatEnabled) {
    return (
      <div className="mx-auto max-w-xl p-8 text-sm text-[var(--text-dim)]">
        Sending from the app is turned off.{' '}
        <Link to="/settings" className="text-[var(--accent)] hover:underline">
          Turn it on in Settings
        </Link>{' '}
        to start a session from here.
      </div>
    );
  }

  // Phase one: which folder. Deliberately a step of its own rather than a chip
  // above the box — it is the one decision that cannot be changed afterwards,
  // since it is what the whole session's cwd will be.
  if (!draft) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-lg font-semibold tracking-tight">New session</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Claude Code runs in a folder, and everything it reads or writes is relative to that folder.
        </p>
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!creating) start();
          }}
        >
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-sm text-[var(--text)]"
          >
            {(projects.data ?? []).map((p) => (
              <option key={p.key} value={p.key}>
                {label(p)}
              </option>
            ))}
            <option value={OTHER}>Another folder…</option>
          </select>
          {/* The one place in this app where a path comes from the browser. The
              server validates it — absolute, there, a folder — and says which of
              the three is wrong, because this box is the only feedback there is. */}
          {choice === OTHER && (
            <input
              autoFocus
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="C:\path\to\the\project"
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
            />
          )}
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={creating || (choice === OTHER ? !folder.trim() : !choice)}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-[#1b1512] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
          >
            {creating ? 'Starting…' : 'Start here'}
          </button>
        </form>
      </div>
    );
  }

  // Phase two: the composer, laid out like the foot of a conversation — because
  // that is what it is about to become.
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4">
      <div className="flex items-baseline gap-2 py-3 text-sm">
        <span className="font-semibold tracking-tight">New session</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-dim)]" title={draft.cwd}>
          {draft.cwd}
        </span>
        {/* Only until the first prompt: after that the folder is where a real
            session lives, and this page is moments from handing over anyway. */}
        {!sent && (
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded px-1.5 py-0.5 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            change
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-end space-y-1.5 pb-2">
          {!sent && (
            <p className="pb-2 text-center text-sm text-[var(--text-dim)]">
              The conversation appears here as soon as Claude Code has written its first line.
            </p>
          )}
          {pending.map((p, i) => (
            <PendingTurn key={`${p.at}:${i}`} text={p.text}>
              {i === pending.length - 1 && (
                <WorkingIndicator
                  live={{
                    pid: 0,
                    status: 'busy',
                    name: null,
                    startedAt: null,
                    updatedAt: null,
                    statusUpdatedAt: p.at,
                  }}
                />
              )}
            </PendingTurn>
          ))}
        </div>
      </div>
      <Composer
        sessionId={draft.sessionId}
        // Nothing to continue from, so the pickers open on the composer's own
        // fallbacks rather than on a model this conversation never used.
        lastModel={null}
        lastEffort={null}
        lastMode={null}
        onSent={(text) => setPending((prev) => [...prev, { text, at: Date.now() }])}
      />
    </div>
  );
}
