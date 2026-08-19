import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { Composer } from '../components/viewer/Composer.tsx';
import { PendingTurn } from '../components/viewer/PendingTurn.tsx';
import { WorkingIndicator } from '../components/viewer/WorkingIndicator.tsx';
import { sortProjectsByName } from '../lib/projects.ts';

/** The folder this page opened on last time — a project key, or `folder:<path>`. */
const REMEMBERED = 'ch:newSessionProject';
/**
 * The row that is not a project. A space cannot begin a project key — they are
 * normalized absolute paths — so this can never collide with a real one.
 */
const OTHER = ' other';

/**
 * A backstop only. `sessions-changed` invalidates `['session', id]` the moment
 * the watcher sees the file, so the handover normally happens on the event; this
 * covers a dropped SSE frame, where the alternative is a page that waits for
 * ever on a session that already exists.
 */
const HANDOVER_POLL_MS = 1_500;

/**
 * One project in the picker, drawn as the filter sidebar draws it.
 *
 * The dot, the colour, the name and the count are that list's, deliberately:
 * these are the same projects, and a person who has learnt which colour their
 * repo is should not have to learn it twice. What a native `<select>` did with
 * them was the argument — the options came out in the operating system's own
 * palette, a blue highlight and a white sheet, with no colour and no counts,
 * which is a different list of the same things.
 */
function ProjectRow({
  color,
  name,
  count,
  path,
  selected,
  onSelect,
}: {
  /** The project's tag colour, or null for the row that is not a project yet. */
  color: string | null;
  name: string;
  count?: number;
  path?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  // The accent edge is on every row, transparent until it is wanted, so the
  // selection cannot shift the names by two pixels as it moves. A tint on its own
  // read as a hover — and this row decides where the session will run, so it has
  // to be unmistakable rather than merely visible.
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      title={path}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 border-l-2 py-1 pr-3 pl-2.5 text-left text-sm ${
        selected
          ? 'border-[var(--accent)] bg-[var(--bg-hover)] text-[var(--text)]'
          : 'border-transparent text-[var(--text-dim)] hover:bg-[var(--bg-hover)]'
      }`}
    >
      {/* The dot keeps its column either way, so the names line up: a project
          fills it, and the row that has no project yet outlines it. */}
      <span
        className={`size-2 shrink-0 rounded-full ${color ? '' : 'border border-dashed border-[var(--text-dim)]'}`}
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {count !== undefined && <span className="shrink-0 text-xs text-[var(--text-dim)]">{count}</span>}
    </button>
  );
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
  const [filter, setFilter] = useState('');
  /** The reserved id and the folder behind it, or null while the picker is up. */
  const [draft, setDraft] = useState<{ sessionId: string; cwd: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Prompts the server has taken, before Claude Code has written them down. */
  const [pending, setPending] = useState<{ text: string; at: number }[]>([]);
  const folderBox = useRef<HTMLInputElement>(null);

  // Alphabetical, from the same helper the sidebar uses — the API's own order is
  // by last activity, which is right for a list you are browsing and wrong for
  // one you are looking a name up in.
  const sorted = useMemo(() => sortProjectsByName(projects.data ?? []), [projects.data]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [sorted, filter]);

  const selected = sorted.find((p) => p.key === choice) ?? null;
  // Nothing is chosen on a machine with no memory, and the first row is a better
  // guess than a dead button. Filtering re-decides it, so typing never leaves the
  // selection on a row that is no longer on screen.
  //
  // Gated on the projects having ARRIVED, not merely on the list being empty:
  // before they do, every remembered key is "not in the list" and this would
  // throw the last choice away a tick before it could be honoured.
  const projectsReady = projects.isSuccess;
  useEffect(() => {
    if (!projectsReady || choice === OTHER) return;
    if (!shown.some((p) => p.key === choice)) setChoice(shown[0]?.key ?? OTHER);
  }, [projectsReady, choice, shown]);

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

  const canStart = choice === OTHER ? !!folder.trim() : !!selected;
  const start = () => {
    if (!canStart || creating) return;
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

  /** Up and down the list from the filter box, so a name can be typed and taken. */
  const step = (delta: number) => {
    const rows = [...shown.map((p) => p.key), OTHER];
    const at = rows.indexOf(choice);
    setChoice(rows[Math.min(rows.length - 1, Math.max(0, at + delta))]);
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
      <div className="mx-auto flex h-full max-w-2xl flex-col p-8">
        <h1 className="text-lg font-semibold tracking-tight">New session</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Claude Code runs in a folder, and everything it reads or writes is relative to that folder.
        </p>
        <form
          className="mt-5 flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                step(e.key === 'ArrowDown' ? 1 : -1);
              }
            }}
            placeholder="Filter projects…"
            spellCheck={false}
            className="w-full rounded-t-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
          />
          {/* The list scrolls, the page does not: the folder, the error and the
              button have to stay where they are however many projects there are. */}
          <div
            role="listbox"
            aria-label="Project"
            className="min-h-0 flex-1 overflow-y-auto rounded-b-lg border border-t-0 border-[var(--border)] bg-[var(--bg-raised)] py-1"
          >
            {shown.map((p) => (
              <ProjectRow
                key={p.key}
                color={p.color}
                name={p.name}
                count={p.sessionCount}
                path={p.path}
                selected={choice === p.key}
                onSelect={() => setChoice(p.key)}
              />
            ))}
            {shown.length === 0 && (
              <div className="px-3 py-1 text-sm text-[var(--text-dim)]">No project matches that.</div>
            )}
            {/* Always last and never filtered out: it is the way out of a list
                that cannot contain what you want — a folder Claude Code has
                never run in is in no index, which is the whole reason it exists. */}
            <ProjectRow
              color={null}
              name="Another folder…"
              selected={choice === OTHER}
              onSelect={() => {
                setChoice(OTHER);
                // The box appears with this click, so focus it on the next frame.
                setTimeout(() => folderBox.current?.focus(), 0);
              }}
            />
          </div>
          {/* Under the list rather than in it: the paths are long enough to
              swamp the names, and only the chosen one has to be readable — which
              is also what tells two projects with the same name apart. */}
          <div className="mt-3">
            {choice === OTHER ? (
              <input
                ref={folderBox}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="C:\path\to\the\project"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
              />
            ) : (
              <div className="truncate px-1 font-mono text-xs text-[var(--text-dim)]" title={selected?.path}>
                {selected?.path ?? ''}
              </div>
            )}
          </div>
          {error && (
            <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="mt-4">
            <button
              type="submit"
              disabled={creating || !canStart}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-[#1b1512] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
            >
              {creating ? 'Starting…' : 'Start here'}
            </button>
          </div>
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
