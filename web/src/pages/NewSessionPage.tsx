import type { ChatCreateRequest, ChatPermissionMode } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client.ts';
import { useLocalOnly } from '../api/useLocal.ts';
import { ProjectTag } from '../components/list/ProjectTag.tsx';
import { Composer } from '../components/viewer/Composer.tsx';
import { SessionTerminal } from '../components/viewer/SessionTerminal.tsx';
import { PendingTurn } from '../components/viewer/PendingTurn.tsx';
import { ViewButton } from '../components/viewer/ViewButton.tsx';
import { WorkingIndicator } from '../components/viewer/WorkingIndicator.tsx';
import { listUrl } from '../lib/listState.ts';
import { sortProjectsByName } from '../lib/projects.ts';
import { useViewPrefs, WIDTH_FULL, ZOOM_DEFAULT } from '../lib/viewPrefs.ts';

/**
 * The folder someone TYPED last time, and only that one. A project is a row away
 * and needs no memory; a path that was typed out is work, and losing it to a
 * reload is the one thing this page may be careless about. It fills the box
 * behind `Another folder…` and never chooses a row — nothing here arrives chosen.
 */
const REMEMBERED_FOLDER = 'ch:newSessionFolder';
/**
 * How the LAST new session was started. Not a configured default and not read
 * for anything else: continuing a conversation still takes its model from that
 * conversation ([AI_RUNNING_CLAUDE.md]), because a setting would quietly switch
 * the model of a session you only meant to reply to. A session that does not
 * exist yet has nothing to switch, and starting every one of them on whatever
 * the fallback happens to be is its own kind of wrong.
 */
const REMEMBERED_MODEL = 'ch:newSessionModel';
/**
 * The row that is not a project. A space cannot begin a project key — they are
 * normalized absolute paths — so this can never collide with a real one.
 */
const OTHER = ' other';
/** A folder with no project behind it yet, so no colour of its own. */
const FALLBACK_COLOR = 'hsl(0 0% 55%)';

/**
 * A backstop only. `sessions-changed` invalidates `['session', id]` the moment
 * the watcher sees the file, so the handover normally happens on the event; this
 * covers a dropped SSE frame, where the alternative is a page that waits for
 * ever on a session that already exists.
 */
const HANDOVER_POLL_MS = 1_500;

interface StartedWith {
  model: string;
  effort: string | null;
  permissionMode: ChatPermissionMode;
}

function readRemembered(): StartedWith | null {
  try {
    const raw = localStorage.getItem(REMEMBERED_MODEL);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StartedWith>;
    return typeof v.model === 'string'
      ? {
          model: v.model,
          effort: typeof v.effort === 'string' ? v.effort : null,
          permissionMode: v.permissionMode === 'plan' ? 'plan' : 'auto',
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * One project in the picker, drawn as the filter sidebar draws it.
 *
 * The dot, the colour, the name and the count are that list's, deliberately:
 * these are the same projects, and a person who has learnt which colour their
 * repo is should not have to learn it twice. What a native `<select>` did with
 * them was the argument — the options came out in the operating system's own
 * palette, a blue highlight and a white sheet, with no colour and no counts,
 * which is a different list of the same things.
 *
 * **The row is a door rather than a choice**: clicking it starts the session
 * there, so the name reads at full brightness on every row instead of only on
 * the chosen one — there is no chosen one — and the folder it would run in is
 * beside it. A list that acts on a single click has to say what each click does,
 * and here the folder is the whole of it.
 */
function ProjectRow({
  color,
  name,
  count,
  path,
  armed,
  busy,
  disabled,
  onSelect,
}: {
  /** The project's tag colour, or null for the row that is not a project yet. */
  color: string | null;
  name: string;
  count?: number;
  path?: string;
  /** Where the keyboard is. A highlight and not a decision — the click is that. */
  armed: boolean;
  /** The row a session is being reserved on right now. */
  busy?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  // Kept on screen while the arrows walk the list, because Enter starts what is
  // armed: a highlight below the fold would be a session opening in a folder
  // nobody could see. `nearest` is what makes it the list that scrolls and not
  // the page.
  const row = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (armed) row.current?.scrollIntoView({ block: 'nearest' });
  }, [armed]);

  // The accent edge is on every row, transparent until it is wanted, so the
  // keyboard cannot shift the names by two pixels as it moves.
  return (
    <button
      ref={row}
      type="button"
      role="option"
      aria-selected={armed}
      title={path}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 border-l-2 py-1 pr-3 pl-2.5 text-left text-sm disabled:opacity-50 ${
        armed ? 'border-[var(--accent)] bg-[var(--bg-hover)]' : 'border-transparent hover:bg-[var(--bg-hover)]'
      }`}
    >
      {/* The dot keeps its column either way, so the names line up: a project
          fills it, and the row that has no project yet outlines it. */}
      <span
        className={`size-2 shrink-0 rounded-full ${color ? '' : 'border border-dashed border-[var(--text-dim)]'}`}
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="max-w-[45%] shrink-0 truncate text-[var(--text)]">{name}</span>
      {/* The other half of the answer, and it takes the room that is left: two
          projects can carry the same name, and then this is all there is to tell
          them apart. Dim and monospaced, so the names still read as the list. */}
      {path && <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-dim)]">{path}</span>}
      {busy ? (
        <span className="ml-auto shrink-0 text-xs text-[var(--text-dim)]">Starting…</span>
      ) : (
        count !== undefined && <span className="ml-auto shrink-0 text-xs text-[var(--text-dim)]">{count}</span>
      )}
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
 * `/session/<id>` as soon as the file is on disk.
 *
 * **It is laid out as the session view, not as a form**, and that is the point
 * of the shell below: the same header bar, the same reading preferences, the
 * same column and the same sticky composer at the foot of the same scroller. The
 * handover happens under the reader, and a page that jumped a zoom level or
 * changed its width as it did announced itself as a different screen — which it
 * is not, it is that screen a second before its first line.
 *
 * The composer here IS that composer, the same component: the question panel,
 * plan mode, the slash commands and Stop all work on the first prompt because
 * nothing about them ever needed a transcript.
 */
export function NewSessionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const chatEnabled = settings.data?.settings.chatEnabled ?? false;
  const terminalMode = chatEnabled && settings.data?.settings.chatMode === 'terminal';
  /** A terminal was started on this draft — the terminal-mode equivalent of a first prompt. */
  const [terminalStarted, setTerminalStarted] = useState(false);
  const view = useViewPrefs();
  const browse = useLocalOnly('pickFolder');

  const started = useMemo(readRemembered, []);
  /**
   * Where the keyboard is, and nothing else. It opens on NOTHING: a click starts
   * the session on the row it lands on, so a row that arrived already armed
   * would be a session nobody picked — one Enter away, and the first row of a
   * list is a guess. `OTHER` is the one value that is a real choice, because
   * that row asks a question instead of answering one.
   */
  const [choice, setChoice] = useState('');
  const [folder, setFolder] = useState(() => localStorage.getItem(REMEMBERED_FOLDER) ?? '');
  const [filter, setFilter] = useState('');
  /** The reserved id and the folder behind it, or null while the picker is up. */
  const [draft, setDraft] = useState<{ sessionId: string; cwd: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
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
  // Typing re-decides where the keyboard is, so it can never sit on a row that
  // has left the screen — and it is DROPPED rather than moved along, because
  // moving it would be the page arming a row on its own again.
  useEffect(() => {
    if (!choice || choice === OTHER) return;
    if (!shown.some((p) => p.key === choice)) setChoice('');
  }, [choice, shown]);

  /** The same query the composer reads — deduped, one request between them. */
  const chat = useQuery({
    queryKey: ['chat', draft?.sessionId ?? ''],
    queryFn: () => api.chatStatus(draft?.sessionId ?? ''),
    enabled: !!draft,
  });

  /**
   * The model and effort pickers must never be empty here, and normally are not:
   * the server keeps what the last CLI on this install reported. The one case it
   * cannot answer is a server that has run none since it started — a fresh
   * install, the first new session — and the only way to learn them is to ask a
   * CLI. So ask, once, and only then: opening a process to fill a dropdown that
   * is already filled would be a `claude` spawned for nothing.
   */
  // Never in terminal mode: there are no pickers to fill, and opening a
  // composer process to fill them would take the transcript the terminal is
  // about to be started on — the two-writers guard would then, correctly,
  // refuse the terminal on the strength of a CLI nobody asked for.
  const needsCapabilities =
    !terminalMode && !!chat.data && chat.data.availableModels.length === 0 && !chat.data.blockedReason;
  const asked = useRef(false);
  useEffect(() => {
    if (!draft || !needsCapabilities || asked.current) return;
    asked.current = true;
    api
      .chatStart(draft.sessionId, {
        model: started?.model,
        effort: started?.effort ?? null,
        permissionMode: started?.permissionMode,
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['chat', draft.sessionId] }));
  }, [draft, needsCapabilities, started, queryClient]);

  /**
   * The transcript, once there is one. This is the handover: the same query key
   * the viewer uses, so arriving there costs no second request, and the same key
   * `sessions-changed` invalidates, so the event does the waking.
   *
   * Only after a prompt has gone out. Opening the CLI to read the model list
   * writes no transcript (measured), but a session started from a terminal in
   * the same second would be indistinguishable — and jumping out of a page with
   * an empty box is the one thing this must never do.
   *
   * In terminal mode the equivalent is the terminal having been started: the
   * CLI is there, waiting to be typed into, and the transcript appears when the
   * first turn runs exactly as it would from the composer. Nothing is lost by
   * arriving at the session view — the pseudo-terminal belongs to the server, so
   * it survives the navigation and comes back attached.
   */
  const sent = pending.length > 0 || terminalStarted;
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
    //
    // `focusTerminal` is the one thing the viewer cannot work out for itself:
    // the terminal it draws is a fresh mount of the one being typed into here,
    // and without this the keystroke after the first prompt would go nowhere.
    if (bornId) navigate(`/session/${bornId}`, { replace: true, state: { focusTerminal: terminalStarted } });
  }, [bornId, navigate, terminalStarted]);

  /**
   * Reserve an id and hand the page over to the draft.
   *
   * The body arrives built instead of being derived from `choice`: the click
   * that calls this IS the decision, and reading it back out of state would be
   * one render away from reserving a session in the wrong folder. The ref is the
   * other half of that — the rows go disabled on the same tick, but a click is
   * cheap enough now that nothing here should depend on a re-render to be safe.
   */
  const startingRef = useRef(false);
  const start = (body: ChatCreateRequest, rememberFolder: boolean) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setCreating(true);
    setError(null);
    api
      .chatCreate(body)
      .then((d) => {
        setDraft(d);
        if (rememberFolder) localStorage.setItem(REMEMBERED_FOLDER, d.cwd);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        startingRef.current = false;
        setCreating(false);
      });
  };

  /** A click on a row is the whole gesture: there is no button to reach for. */
  const startProject = (key: string) => {
    // The header's tag reads its colour off `choice`, so the highlight follows
    // the row being started rather than staying where the keyboard left it.
    setChoice(key);
    start({ projectKey: key }, false);
  };
  /** The one answer that cannot be clicked, so the one that keeps its button. */
  const startFolder = () => {
    if (!folder.trim()) return;
    start({ cwd: folder }, true);
  };

  /** The Windows folder browser, on the server's own desktop. */
  const browseForFolder = () => {
    setBrowsing(true);
    setError(null);
    api
      .pickFolder(folder.trim() || undefined)
      .then((picked) => {
        // null is Cancel, and leaves what was typed alone.
        if (picked) setFolder(picked);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBrowsing(false));
  };

  /** Back to the picker, and take the process with us — it was opened for this folder. */
  const changeFolder = () => {
    if (draft) void api.chatStop(draft.sessionId).catch(() => undefined);
    asked.current = false;
    setDraft(null);
  };

  /** Up and down the list from the filter box, so a name can be typed and taken. */
  const step = (delta: number) => {
    const rows = [...shown.map((p) => p.key), OTHER];
    const at = rows.indexOf(choice);
    setChoice(rows[Math.min(rows.length - 1, Math.max(0, at + delta))]);
  };

  const openTarget = (target: 'explorer' | 'vscode') => {
    if (!draft) return;
    fetch(`/api/sessions/${draft.sessionId}/open?target=${target}`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const btn =
    'cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-50';

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

  return (
    <div className="flex h-full flex-col">
      {/* The session header's own shell, carrying only what a session that does
          not exist yet can honestly offer: where it will run, and how it will be
          read. No title (Claude names it), no counts, no fold controls. */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Link to={listUrl()} className="mr-1 text-[var(--text-dim)] hover:text-[var(--text)]" title="Back to list">
            ←
          </Link>
          {draft && (
            <ProjectTag
              name={draft.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? draft.cwd}
              path={draft.cwd}
              color={selected?.color ?? FALLBACK_COLOR}
            />
          )}
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">New session</h1>
          <span className="flex shrink-0 items-center gap-1.5">
            {draft && (
              <>
                {!sent && (
                  <button type="button" onClick={changeFolder} className={btn} title="Choose a different folder">
                    ← Change folder
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openTarget('explorer')}
                  className={btn}
                  title={`Open ${draft.cwd} in Explorer`}
                >
                  📁 Open folder
                </button>
                <button
                  type="button"
                  onClick={() => openTarget('vscode')}
                  className={btn}
                  title={`Open ${draft.cwd} in VS Code`}
                >
                  {'{ }'} Open VS Code
                </button>
              </>
            )}
            <ViewButton view={view} />
          </span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto px-4 pt-4 [scrollbar-gutter:stable_both-edges]">
          <div
            className="mx-auto flex min-h-full flex-col"
            style={{ maxWidth: view.width === WIDTH_FULL ? undefined : `${view.width}px` }}
          >
            {/* Zoomed like the conversation it is about to be, and for the same
                reason: these bubbles are the first two messages of it. */}
            <div style={view.zoom === ZOOM_DEFAULT ? undefined : { zoom: `${view.zoom}%` }}>
              {!draft ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    // Only ever the typed folder: nothing else on this form can
                    // submit it, and Enter in the filter box never reaches here.
                    e.preventDefault();
                    startFolder();
                  }}
                >
                  <p className="text-sm text-[var(--text-dim)]">
                    Claude Code runs in a folder, and everything it reads or writes is relative to that folder. Pick
                    one and the session starts there.
                  </p>
                  <div>
                    <input
                      autoFocus
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          step(e.key === 'ArrowDown' ? 1 : -1);
                        } else if (e.key === 'Enter') {
                          // Never the form's submit — what that would send is a
                          // folder nobody is typing. Enter takes the row the
                          // arrows armed and nothing else: with none armed it
                          // does nothing, because a first row is not an answer.
                          e.preventDefault();
                          if (choice === OTHER) folderBox.current?.focus();
                          else if (choice) startProject(choice);
                        }
                      }}
                      placeholder="Filter projects…"
                      spellCheck={false}
                      className="w-full rounded-t-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)]"
                    />
                    <div
                      role="listbox"
                      aria-label="Project"
                      className="max-h-[45vh] overflow-y-auto rounded-b-lg border border-t-0 border-[var(--border)] bg-[var(--bg-raised)] py-1"
                    >
                      {shown.map((p) => (
                        <ProjectRow
                          key={p.key}
                          color={p.color}
                          name={p.name}
                          count={p.sessionCount}
                          path={p.path}
                          armed={choice === p.key}
                          busy={creating && choice === p.key}
                          disabled={creating}
                          onSelect={() => startProject(p.key)}
                        />
                      ))}
                      {shown.length === 0 && (
                        <div className="px-3 py-1 text-sm text-[var(--text-dim)]">No project matches that.</div>
                      )}
                      {/* Always last and never filtered out: it is the way out of
                          a list that cannot contain what you want — a folder
                          Claude Code has never run in is in no index, which is
                          the whole reason it exists. */}
                      <ProjectRow
                        color={null}
                        name="Another folder…"
                        armed={choice === OTHER}
                        disabled={creating}
                        onSelect={() => {
                          setChoice(OTHER);
                          // The box appears with this click, so focus it next frame.
                          setTimeout(() => folderBox.current?.focus(), 0);
                        }}
                      />
                    </div>
                  </div>
                  {/* The one row that answers with something other than itself,
                      so the only one with anything under the list. */}
                  {choice === OTHER && (
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={folderBox}
                        value={folder}
                        onChange={(e) => setFolder(e.target.value)}
                        placeholder="C:\path\to\the\project"
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-1.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
                      />
                      {/* The browser opens on the server's desktop, so from
                          another machine it is dead — and the box beside it is
                          not, which is the whole reason only this button goes. */}
                      <button
                        type="button"
                        onClick={browseForFolder}
                        disabled={browsing || browse.disabled}
                        className={`${btn} shrink-0 py-1.5`}
                        title={browse.reason ?? 'Browse for a folder'}
                      >
                        {browsing ? 'Browsing…' : '📁 Browse…'}
                      </button>
                    </div>
                  )}
                  {error && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
                      {error}
                    </div>
                  )}
                  {/* The one button left on the page, and only ever beside the
                      box: every other answer here is a row, and a row starts
                      itself. A path being typed has no such moment. */}
                  {choice === OTHER && (
                    <button
                      type="submit"
                      disabled={creating || !folder.trim()}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-[#1b1512] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
                    >
                      {creating ? 'Starting…' : 'Start here'}
                    </button>
                  )}
                </form>
              ) : (
                <>
                  {!sent && (
                    <p className="py-8 text-center text-sm text-[var(--text-dim)]">
                      The conversation appears here as soon as Claude Code has written its first line.
                    </p>
                  )}
                  {error && (
                    <div className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
                      {error}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {pending.map((p, i) => (
                      <PendingTurn key={`${p.at}:${i}`} text={p.text}>
                        {/* A prompt still waiting for its first line IS a turn in
                            flight, so the row needs nothing but the moment it was
                            accepted — there is no session on disk to ask yet. */}
                        {i === pending.length - 1 && <WorkingIndicator since={p.at} />}
                      </PendingTurn>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Stuck to the foot of the scroller, in the conversation's own
                column and outside the zoom — the viewer's arrangement exactly,
                so the handover moves nothing. No `columnWidth`: there is no
                follow pill here for `Send` to step aside from. */}
            {draft && (
              <div className="sticky bottom-0 mt-auto pt-6">
                {terminalMode ? (
                  <SessionTerminal
                    sessionId={draft.sessionId}
                    // The folder was the question this page asks, and it has
                    // been answered — so the terminal comes up running and
                    // focused rather than behind a button repeating it.
                    autoStart
                    onStarted={() => setTerminalStarted(true)}
                  />
                ) : (
                  <Composer
                    sessionId={draft.sessionId}
                    // Nothing to continue from — so the last new session is the
                    // best evidence there is, and the composer's own fallbacks
                    // are what a first-ever one gets.
                    lastModel={started?.model ?? null}
                    lastEffort={started?.effort ?? null}
                    lastMode={started?.permissionMode ?? null}
                    onSent={(text, how) => {
                      setPending((prev) => [...prev, { text, at: Date.now() }]);
                      localStorage.setItem(REMEMBERED_MODEL, JSON.stringify(how));
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
