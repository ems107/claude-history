import type { SessionDetail } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatUsd, sessionCostParts } from '../../lib/cost.ts';
import { entrypointLabel, formatDateTimeFull, shortModel } from '../../lib/format.ts';
import { listUrl } from '../../lib/listState.ts';
import { Badge, SessionBadges } from '../list/Badges.tsx';
import { ProjectTag } from '../list/ProjectTag.tsx';
import { SessionMenu } from './SessionActions.tsx';

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-3 shrink-0"
      style={up ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M3.5 6.2 8 10.2 12.5 6.2" />
    </svg>
  );
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

/** The id, and the only thing anyone ever wants to do with it. */
function IdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono opacity-50" title="Session id">
        {id}
      </span>
      <button
        type="button"
        onClick={() => {
          void copyPlain(id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="cursor-pointer rounded px-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        title="Copy the session id"
      >
        {copied ? '✓' : '⧉'}
      </button>
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

const KEY = 'headerDetails';

/**
 * Who this conversation is, and the way into everything about it.
 *
 * It held eighteen controls in one row, which at 1440 px came to about 2,030 px
 * of content in 1,408 available: the title truncated to nothing and the row ran
 * off the screen. The count was the symptom. What made it unreadable is that
 * those eighteen mixed four unrelated kinds of thing at one visual weight — how
 * the conversation is drawn, which panel is open, what can be done with the
 * session, and find — so no amount of squeezing would have helped.
 *
 * Two lines now, each with one job. Identity and three controls up top; the
 * facts about the session below, ending in the `more` that holds the ones you
 * look up rather than read. The panels are not here at all any more: they are
 * the rail down the right-hand side ([inspector.ts](../../lib/inspector.ts)).
 */
export function SessionHeader({
  detail,
  draft,
  color,
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
  /**
   * Find and the view menu — the two the page owns the state of. The session's
   * own menu is drawn here, after them, because the rename it offers is edited
   * where the title is.
   */
  actions?: import('react').ReactNode;
}) {
  const s = detail.summary;
  /**
   * The figures survive their own recalculation. A transcript that grows
   * invalidates the cached enrichment, so `GET /api/sessions/:id` answers
   * WITHOUT it for as long as the enricher takes — measured at ~105 ms — and the
   * counts are the only thing in this header that comes and goes. Losing them
   * for that moment took 22 px out of the page, so every message a live session
   * wrote shoved the whole conversation down and pulled it back: the shake.
   * Keeping the last figures is stiller and no less true — they are one message
   * stale for a tenth of a second instead of absent — and a session with no
   * enrichment at all still draws no figures, because there is nothing to
   * remember. They share a WRAPPING row with the rest of the facts now, where a
   * chip coming and going can cost a whole line rather than 22 px.
   */
  const lastEnrichment = useRef(s.enrichment);
  if (s.enrichment) lastEnrichment.current = s.enrichment;
  const e = s.enrichment ?? lastEnrichment.current;
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(() => localStorage.getItem(KEY) === 'true');
  // One shared query with every other reader of the price table.
  const prices = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  // The same figure, from the same function, as the list and the sort: a session
  // that delegated its work to eleven agents spent that money as surely as one
  // that did the work itself. Remembered along with the counts, or it would
  // blink out on every message a live session writes.
  const cost = sessionCostParts(
    e ? { ...s, enrichment: e } : s,
    prices.data?.prices ?? {},
  );

  return (
    <div className="border-b border-[var(--border)] px-4 pt-2.5 pb-2">
      <div className="flex items-center gap-2">
        <Link to={listUrl()} className="mr-1 shrink-0 text-[var(--text-dim)] hover:text-[var(--text)]" title="Back to list (Esc)">
          ←
        </Link>
        <ProjectTag name={s.projectName} path={s.projectPath} color={color} />
        {draft ? (
          <h1 className="min-w-0 truncate text-base font-semibold text-[var(--text-dim)]" title={s.title}>
            {s.title}
          </h1>
        ) : editing ? (
          <TitleEditor sessionId={s.id} title={s.title} isLocal={s.titleSource === 'local'} onDone={() => setEditing(false)} />
        ) : (
          <h1 className="min-w-0 truncate text-base font-semibold" title={s.title}>
            {s.title}
          </h1>
        )}
        {/* Right AFTER the title, not pushed to the far end of the row: what
            they say is WHO this session is — it is live, it is pinned, it is a
            fork, it is a throwaway — and that reads with the name or not at all.
            The title is the one that gives way, which is what `min-w-0
            truncate` on it and `shrink-0` here mean together.
            Two are drawn elsewhere and would otherwise be said twice: the ⑂
            count is in the rail, and the PR is one press away under `more`. */}
{/* `flex`, not a bare span: the badges are an `inline-flex`, and inside a
            block wrapper they are baseline-aligned in the row's 24 px line box
            rather than centred in it — 2.5 px low against the title, which at
            this size is exactly enough to look wrong. `gap-1` is the gap
            `SessionBadges` uses inside itself, so the mark below joins that row
            rather than sitting slightly apart from it. */}
        <span className="flex shrink-0 items-center gap-1">
          {/* Renamed: a STATE, so it belongs with the other states rather than in
              the menu that changes it — and wearing the same `Badge` the pin
              does, because the two are the same kind of thing and one component
              is what keeps them looking like it. The full original title is
              under `more`, where a string that long can have a line of its own;
              this says there IS one, and its hover says what it was.
              (U+270E and not U+270F: this one's default presentation is TEXT, so
              it takes the amber from the CSS instead of arriving as a colour
              emoji. Checked at 8×, with and without a variation selector —
              identical, so there is nothing to ask for.) */}
          {s.titleSource === 'local' && (
            <Badge
              label="✎"
              title={`Renamed locally — original title: “${s.originalTitle ?? ''}”`}
              className="bg-amber-500/15 text-amber-400"
            />
          )}
          <SessionBadges session={s} omitPr omitAgents omitNews live={live} />
        </span>
        <span className="flex-1" />
        <span className="flex shrink-0 items-center gap-2">
          {actions}
          <SessionMenu detail={detail} draft={draft} onRename={() => setEditing(true)} />
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-dim)]">
        {s.gitBranch && <span>⎇ {s.gitBranch}</span>}
        {s.model && <span className="font-mono">{shortModel(s.model)}</span>}
        {s.entrypoint && <span>{entrypointLabel(s.entrypoint)}</span>}
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
        {e && (
          <>
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
          </>
        )}
        {/* The whole of what it spent, agents included — they can be 88% of it —
            with the split on the hover. A session that cannot be priced stays
            blank rather than claiming it was free. */}
        {cost.total !== null && (
          <span
            className="font-semibold text-[var(--text)]"
            title={
              cost.subagents !== null
                ? `${formatUsd(cost.own)} in this conversation + ${formatUsd(cost.subagents)} in ${
                    s.subagentCount
                  } subagent${s.subagentCount === 1 ? '' : 's'} — API-equivalent value at the configured prices`
                : 'API-equivalent value at the configured prices — not actual subscription spend (see Stats)'
            }
          >
            {formatUsd(cost.total)}
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          onClick={() =>
            setDetails((v) => {
              localStorage.setItem(KEY, String(!v));
              return !v;
            })
          }
          className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${
            details ? 'text-[var(--accent)]' : ''
          }`}
          title="The rest of what is known about this session"
        >
          {details ? 'less' : 'more'}
          <Chevron up={details} />
        </button>
      </div>

      {/* Everything you look UP rather than read: it is here in full, one press
          away, instead of spending a line of the row above on every session. */}
      {details && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-[var(--border)] pt-1.5 text-xs text-[var(--text-dim)]">
          {/* A local rename may never hide what Claude Code still calls this
              session. The ✎ beside the title says there IS one; this is the
              string, which is far too long to spend a row of the header on. */}
          {s.titleSource === 'local' && s.originalTitle && (
            <span className="inline-flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-amber-400/80">✎</span>
              <span className="shrink-0 opacity-60">original title</span>
              <span className="min-w-0 truncate text-[var(--text)] italic" title={s.originalTitle}>
                “{s.originalTitle}”
              </span>
            </span>
          )}
          {s.slug && <span className="font-mono opacity-70">{s.slug}</span>}
          {s.claudeVersion && <span className="opacity-70">cc {s.claudeVersion}</span>}
          {s.messageCount !== null && (
            <span title="Claude Code's internal context-entry count (includes tool results and streamed chunks)">
              <b className="text-[var(--text)]">~{s.messageCount}</b> context entries
            </span>
          )}
          {e && e.runIds.length > 0 && (
            <span
              title={`Appended to by ${e.runIds.length} other Claude Code run(s) — what the transcript records in session_id: ${e.runIds.join(', ')}. Those are the ids of the CLI processes that resumed this session, not sessions it came from.`}
            >
              <span className="opacity-60">resumed ×</span>
              {e.runIds.length}
            </span>
          )}
          <AncestryChips label="forked from" ids={detail.ancestry.forkedFrom ? [detail.ancestry.forkedFrom] : []} />
          <AncestryChips label="branched into" ids={detail.ancestry.descendants} />
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
          <IdChip id={s.id} />
        </div>
      )}
    </div>
  );
}
