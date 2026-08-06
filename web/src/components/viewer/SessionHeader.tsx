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
  showTokens,
  onToggleTokens,
  actions,
}: {
  detail: SessionDetail;
  color: string;
  showThinking: boolean;
  onToggleThinking: () => void;
  thinkingCount: number;
  showTokens: boolean;
  onToggleTokens: () => void;
  actions?: import('react').ReactNode;
}) {
  const s = detail.summary;
  const e = s.enrichment;
  const [editing, setEditing] = useState(false);
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
          <>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold" title={s.title}>
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
              className="cursor-pointer rounded px-1.5 py-0.5 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              title="Rename locally (stored in this tool only; never writes to ~/.claude)"
            >
              ✎
            </button>
          </>
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
        <button type="button" onClick={onToggleTokens} className={toggleClass(showTokens)}>
          Tokens
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
