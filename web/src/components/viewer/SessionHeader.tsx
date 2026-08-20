import type { SessionDetail } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { entrypointLabel, formatDateTimeFull, shortModel } from '../../lib/format.ts';
import { listUrl } from '../../lib/listState.ts';
import { SessionBadges } from '../list/Badges.tsx';
import { ProjectTag } from '../list/ProjectTag.tsx';

/** The look of every control in the session header, wherever it is rendered. */
export function toggleClass(active: boolean, disabled = false): string {
  return `rounded border px-2 py-0.5 text-xs ${
    disabled
      ? 'cursor-default border-[var(--border)] text-[var(--text-dim)]/50'
      : active
        ? 'cursor-pointer border-[var(--accent)] text-[var(--accent)]'
        : 'cursor-pointer border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
  }`;
}

function AncestryChips({ label, ids }: { label: string; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[var(--text-dim)]">{label}</span>
      {ids.map((id) => (
        <Link
          key={id}
          to={`/session/${id}`}
          className="rounded bg-amber-500/10 px-1.5 py-px font-mono text-amber-400 hover:bg-amber-500/20"
          title={id}
        >
          {id.slice(0, 8)}
        </Link>
      ))}
    </span>
  );
}

function TitleEditor({
  sessionId,
  title,
  isLocal,
  onDone,
}: {
  sessionId: string;
  title: string;
  isLocal: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const save = (newTitle: string) => {
    setSaving(true);
    api
      .renameSession(sessionId, newTitle)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        onDone();
      })
      .catch(() => setSaving(false));
  };

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        autoFocus
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save(value.trim());
          if (e.key === 'Escape') onDone();
        }}
        className="min-w-0 flex-1 rounded border border-[var(--accent-dim)] bg-[var(--bg-raised)] px-2 py-0.5 text-base font-semibold focus:outline-none"
        placeholder="Session title (Enter to save, Esc to cancel)"
      />
      {isLocal && (
        <button
          type="button"
          disabled={saving}
          onClick={() => save('')}
          className="shrink-0 cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)]"
          title="Remove the local rename and restore the original title"
        >
          Restore original
        </button>
      )}
    </span>
  );
}

export function SessionHeader({
  detail,
  draft,
  color,
  showThinking,
  onToggleThinking,
  thinkingCount,
  expandTools,
  onToggleTools,
  toolCount,
  canHideResponses,
  onHideResponses,
  canShowResponses,
  onShowResponses,
  expandSegments,
  onToggleSegments,
  compactionCount,
  showTokens,
  onToggleTokens,
  showLineage,
  onToggleLineage,
  showFiles,
  onToggleFiles,
  showSentFiles,
  onToggleSentFiles,
  sentFileCount,
  showMentions,
  onToggleMentions,
  mentionCount,
  mentionCandidates,
  showAgents,
  onToggleAgents,
  findOpen,
  onToggleFind,
  actions,
  live,
}: {
  detail: SessionDetail;
  /**
   * This session has no transcript yet — the app is running a CLI in it and
   * Claude Code has not written the file ([draftSession.ts]). Everything that
   * would be a claim about history says less: there are no dates to show, and
   * renaming or pinning would act on an id the index has never heard of (both
   * endpoints answer 404, correctly).
   */
  draft?: boolean;
  color: string;
  /** Live state from the page, which tracks it far more closely than the summary. */
  live?: import('@claude-history/shared').LiveInfo | null;
  showThinking: boolean;
  onToggleThinking: () => void;
  thinkingCount: number;
  expandTools: boolean;
  onToggleTools: () => void;
  toolCount: number;
  canHideResponses: boolean;
  onHideResponses: () => void;
  canShowResponses: boolean;
  onShowResponses: () => void;
  expandSegments: boolean;
  onToggleSegments: () => void;
  compactionCount: number;
  showTokens: boolean;
  onToggleTokens: () => void;
  showLineage: boolean;
  onToggleLineage: () => void;
  showFiles: boolean;
  onToggleFiles: () => void;
  showSentFiles: boolean;
  onToggleSentFiles: () => void;
  /**
   * Derived from the turns rather than read off `detail`, unlike every other
   * count here, and passed in so the button and the panel come out of the same
   * calculation — two collectors would eventually disagree.
   */
  sentFileCount: number;
  showMentions: boolean;
  onToggleMentions: () => void;
  /**
   * The FILTERED count, or null for as long as it cannot be known.
   *
   * The odd one out in this row: every other count is a fact of the transcript,
   * while this one is what survives being checked against the disk — which
   * candidates are folders, and which two spellings are one file. The page asks
   * for that as soon as it has the transcript, so in practice the number is there
   * before the header is read; null is the moment before the answer lands, and a
   * button with no number is better than one promising rows it cannot draw.
   */
  mentionCount: number | null;
  /** How many paths were named at all: whether the button exists is a transcript fact. */
  mentionCandidates: number;
  showAgents: boolean;
  onToggleAgents: () => void;
  findOpen: boolean;
  onToggleFind: () => void;
  actions?: import('react').ReactNode;
}) {
  const s = detail.summary;
  /**
   * The figures survive their own recalculation. A transcript that grows
   * invalidates the cached enrichment, so `GET /api/sessions/:id` answers
   * WITHOUT it for as long as the enricher takes — measured at ~105 ms — and the
   * counts row is the only row in this header that comes and goes. Losing it for
   * that moment took 22 px out of the page, so every message a live session
   * wrote shoved the whole conversation down and pulled it back: the shake.
   * Keeping the last figures is stiller and no less true — they are one message
   * stale for a tenth of a second instead of absent — and a session with no
   * enrichment at all still draws no row, because there is nothing to remember.
   */
  const lastEnrichment = useRef(s.enrichment);
  if (s.enrichment) lastEnrichment.current = s.enrichment;
  const e = s.enrichment ?? lastEnrichment.current;
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();

  return (
    <div className="border-b border-[var(--border)] px-4 py-3">
      <div className="flex items-center gap-2">
        <Link to={listUrl()} className="mr-1 text-[var(--text-dim)] hover:text-[var(--text)]" title="Back to list (Esc)">
          ←
        </Link>
        <ProjectTag name={s.projectName} path={s.projectPath} color={color} />
        {draft ? (
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text-dim)]" title={s.title}>
            {s.title}
          </h1>
        ) : editing ? (
          <TitleEditor sessionId={s.id} title={s.title} isLocal={s.titleSource === 'local'} onDone={() => setEditing(false)} />
        ) : (
          // Rename/pin sit next to the title and only appear on hover, as in
          // the session list. A pinned star stays visible so the state reads
          // at a glance.
          <span className="group flex min-w-0 flex-1 items-center gap-1">
            <h1 className="min-w-0 truncate text-base font-semibold" title={s.title}>
              {s.title}
              {s.titleSource === 'local' && (
                <span
                  className="ml-2 rounded bg-amber-500/15 px-1.5 py-px align-middle text-[10px] font-semibold tracking-wide text-amber-400 uppercase"
                  title="Renamed locally in claude-history — Claude Code still shows the original title"
                >
                  ✎ local rename
                </span>
              )}
            </h1>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-xs text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:opacity-100"
              title="Rename locally (stored in this tool only; never writes to ~/.claude)"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => {
                void api.pinSession(s.id, !s.pinned).then(() => {
                  void queryClient.invalidateQueries({ queryKey: ['session', s.id] });
                  void queryClient.invalidateQueries({ queryKey: ['sessions'] });
                });
              }}
              className={`shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-sm focus-visible:opacity-100 ${
                s.pinned
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-[var(--text-dim)] opacity-0 group-hover:opacity-100 hover:text-amber-400'
              }`}
              title={s.pinned ? 'Unpin' : 'Pin (stored locally)'}
            >
              {s.pinned ? '★' : '☆'}
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={thinkingCount > 0 ? onToggleThinking : undefined}
          disabled={thinkingCount === 0}
          className={toggleClass(showThinking, thinkingCount === 0)}
          title={
            thinkingCount > 0
              ? 'Show/hide the model’s thinking blocks'
              : 'No visible thinking in this conversation (recent Claude Code versions store thinking encrypted)'
          }
        >
          Thinking{thinkingCount > 0 ? ` (${thinkingCount})` : ''}
        </button>
        <button
          type="button"
          onClick={toolCount > 0 ? onToggleTools : undefined}
          disabled={toolCount === 0}
          className={toggleClass(expandTools, toolCount === 0)}
          title={
            toolCount > 0
              ? 'Expand or collapse every group of tool calls (they start collapsed so prompts and answers read cleanly)'
              : 'This conversation has no tool calls'
          }
        >
          Tools{toolCount > 0 ? ` (${toolCount})` : ''}
        </button>
        {/* Actions, not modes: each one is spent once and then has nothing
            left to do, which is exactly when it greys out. */}
        <button
          type="button"
          onClick={canHideResponses ? onHideResponses : undefined}
          disabled={!canHideResponses}
          className={toggleClass(false, !canHideResponses)}
          title={
            canHideResponses
              ? 'Fold every answer away and leave the prompts — click any prompt to bring its own back'
              : 'Every answer is already folded'
          }
        >
          Hide responses
        </button>
        <button
          type="button"
          onClick={canShowResponses ? onShowResponses : undefined}
          disabled={!canShowResponses}
          className={toggleClass(false, !canShowResponses)}
          title={canShowResponses ? 'Unfold every answer' : 'Nothing is folded'}
        >
          Show responses
        </button>
        {compactionCount > 0 && (
          <button
            type="button"
            onClick={onToggleSegments}
            className={toggleClass(expandSegments)}
            title="Unfold every stretch of conversation that was compacted away (they start folded — only the current context is open)"
          >
            Compactions ({compactionCount})
          </button>
        )}
        <button type="button" onClick={onToggleTokens} className={toggleClass(showTokens)}>
          Tokens
        </button>
        {(detail.ancestry.forkedFrom !== null || detail.ancestry.descendants.length > 0) && (
          <button
            type="button"
            onClick={onToggleLineage}
            className={toggleClass(showLineage)}
            title="Show the full fork chain of this session"
          >
            Lineage
          </button>
        )}
        {/* Two file buttons, and the words are load-bearing: one lists what the
            session CHANGED, the other what it HANDED OVER, and while the first was
            called plain "Files" the second had no name left to take. */}
        {detail.fileChanges.length > 0 && (
          <button
            type="button"
            onClick={onToggleFiles}
            className={toggleClass(showFiles)}
            title="Files this session edited or wrote — from the Edit/Write calls in this transcript"
          >
            Changed Files ({detail.fileChanges.length})
          </button>
        )}
        {sentFileCount > 0 && (
          <button
            type="button"
            onClick={onToggleSentFiles}
            className={toggleClass(showSentFiles)}
            title="Files this session handed over: delivered to you with SendUserFile, published as an artifact, or written as a plan — with the state of each on disk right now"
          >
            Sent Files ({sentFileCount})
          </button>
        )}
        {mentionCandidates > 0 && (
          <button
            type="button"
            onClick={onToggleMentions}
            className={toggleClass(showMentions)}
            title="Files this session only talked about: the paths its own answers named. Most of what an answer names is written for a person to read — a partial path, a placeholder — so a row that finds nothing is listed and marked rather than hidden."
          >
            Mentioned{mentionCount === null ? '' : ` (${mentionCount})`}
          </button>
        )}
        {detail.subagents.length > 0 && (
          <button
            type="button"
            onClick={onToggleAgents}
            className={toggleClass(showAgents)}
            title="The agents this session sent out: what each was asked, what it reported back, and what it cost"
          >
            ⑂ Subagents ({detail.subagents.length})
          </button>
        )}
        {/* Ctrl+F opens it too, and this is how anyone finds that out. */}
        <button
          type="button"
          onClick={onToggleFind}
          className={toggleClass(findOpen)}
          title="Find in this conversation — reaches what is folded away, which the browser's own find cannot. Ctrl+F searches the selected message, or what is unfolded; Ctrl+Shift+F searches all of it."
        >
          Find
        </button>
        {actions}
      </div>
      {s.titleSource === 'local' && s.originalTitle && (
        <div className="mt-1 text-xs text-[var(--text-dim)]">
          <span className="opacity-60">original title (what Claude Code shows):</span>{' '}
          <span className="italic">“{s.originalTitle}”</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-dim)]">
        {draft ? (
          // Two dashes where the dates go would read as data we lost. There are
          // no dates: nothing has happened in this session yet.
          <span className="opacity-60">not started yet</span>
        ) : (
          <>
            <span>
              <span className="opacity-60">created</span> {formatDateTimeFull(s.createdAt)}
            </span>
            <span>
              <span className="opacity-60">last activity</span> {formatDateTimeFull(s.lastActivityAt)}
            </span>
          </>
        )}
        {s.gitBranch && <span>⎇ {s.gitBranch}</span>}
        {s.model && <span className="font-mono">{shortModel(s.model)}</span>}
        {s.entrypoint && <span>{entrypointLabel(s.entrypoint)}</span>}
        {s.slug && <span className="font-mono opacity-70">{s.slug}</span>}
        {s.claudeVersion && <span className="opacity-70">cc {s.claudeVersion}</span>}
        <SessionBadges session={s} omitPr live={live} onSubagentsClick={onToggleAgents} />
        <AncestryChips label="forked from" ids={detail.ancestry.forkedFrom ? [detail.ancestry.forkedFrom] : []} />
        <AncestryChips label="branched into" ids={detail.ancestry.descendants} />
        {/* `e`, not `s.enrichment`: this chip lives in a wrapping row, so it
            coming and going with every recalculation could take the row to two
            lines and back — the same shake, one row higher up. */}
        {e && e.runIds.length > 0 && (
          <span
            title={`Appended to by ${e.runIds.length} other Claude Code run(s) — what the transcript records in session_id: ${e.runIds.join(', ')}. Those are the ids of the CLI processes that resumed this session, not sessions it came from.`}
          >
            <span className="opacity-60">resumed ×</span>
            {e.runIds.length}
          </span>
        )}
        {detail.prLinks.map((pr) => (
          <a
            key={pr.prUrl}
            href={pr.prUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-purple-500/10 px-1.5 py-px text-purple-400 hover:bg-purple-500/20"
          >
            PR #{pr.prNumber} ↗
          </a>
        ))}
        <span className="font-mono opacity-50" title="Session id">
          {s.id}
        </span>
      </div>
      {e && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-dim)]">
          <span title="Messages you typed">
            <b className="text-[var(--text)]">{e.userMessageCount}</b> prompts
          </span>
          <span title="Assistant API messages (deduplicated)">
            <b className="text-[var(--text)]">{e.assistantMessageCount}</b> responses
          </span>
          <span title="Tool invocations">
            <b className="text-[var(--text)]">{e.toolUseCount}</b> tool calls
          </span>
          <span title="Conversation turns">
            <b className="text-[var(--text)]">{e.turnCount}</b> turns
          </span>
          {s.messageCount !== null && (
            <span title="Claude Code's internal context-entry count (includes tool results and streamed chunks)">
              <b className="text-[var(--text)]">~{s.messageCount}</b> context entries
            </span>
          )}
        </div>
      )}
    </div>
  );
}
