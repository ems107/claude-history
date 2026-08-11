import type { SessionDetail } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { entrypointLabel, formatDateTimeFull, shortModel } from '../../lib/format.ts';
import { listUrl } from '../../lib/listState.ts';
import { SessionBadges } from '../list/Badges.tsx';
import { ProjectTag } from '../list/ProjectTag.tsx';

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
  actions,
}: {
  detail: SessionDetail;
  color: string;
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
  actions?: import('react').ReactNode;
}) {
  const s = detail.summary;
  const e = s.enrichment;
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const toggleClass = (active: boolean, disabled = false) =>
    `rounded border px-2 py-0.5 text-xs ${
      disabled
        ? 'cursor-default border-[var(--border)] text-[var(--text-dim)]/50'
        : active
          ? 'cursor-pointer border-[var(--accent)] text-[var(--accent)]'
          : 'cursor-pointer border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)]'
    }`;

  return (
    <div className="border-b border-[var(--border)] px-4 py-3">
      <div className="flex items-center gap-2">
        <Link to={listUrl()} className="mr-1 text-[var(--text-dim)] hover:text-[var(--text)]" title="Back to list (Esc)">
          ←
        </Link>
        <ProjectTag name={s.projectName} path={s.projectPath} color={color} />
        {editing ? (
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
        {detail.ancestry.resumedFrom.length + detail.ancestry.descendants.length > 0 && (
          <button
            type="button"
            onClick={onToggleLineage}
            className={toggleClass(showLineage)}
            title="Show the full resume/fork chain of this session"
          >
            Lineage
          </button>
        )}
        {detail.fileChanges.length > 0 && (
          <button
            type="button"
            onClick={onToggleFiles}
            className={toggleClass(showFiles)}
            title="Files this session edited or wrote"
          >
            Files ({detail.fileChanges.length})
          </button>
        )}
        {actions}
      </div>
      {s.titleSource === 'local' && s.originalTitle && (
        <div className="mt-1 text-xs text-[var(--text-dim)]">
          <span className="opacity-60">original title (what Claude Code shows):</span>{' '}
          <span className="italic">“{s.originalTitle}”</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-dim)]">
        <span>
          <span className="opacity-60">created</span> {formatDateTimeFull(s.createdAt)}
        </span>
        <span>
          <span className="opacity-60">last activity</span> {formatDateTimeFull(s.lastActivityAt)}
        </span>
        {s.gitBranch && <span>⎇ {s.gitBranch}</span>}
        {s.model && <span className="font-mono">{shortModel(s.model)}</span>}
        {s.entrypoint && <span>{entrypointLabel(s.entrypoint)}</span>}
        {s.slug && <span className="font-mono opacity-70">{s.slug}</span>}
        {s.claudeVersion && <span className="opacity-70">cc {s.claudeVersion}</span>}
        <SessionBadges session={s} omitPr />
        <AncestryChips label="resumed from" ids={detail.ancestry.resumedFrom} />
        <AncestryChips label="continued in" ids={detail.ancestry.descendants} />
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
