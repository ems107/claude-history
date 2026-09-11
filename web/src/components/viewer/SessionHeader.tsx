import type { SessionDetail } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { formatUsd, sessionCostParts } from '../../lib/cost.ts';
import { entrypointLabel, formatDateTimeFull, shortModel } from '../../lib/format.ts';
import { controlRow } from '../controlClass.ts';
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
  menuSections,
  live,
  onOpenMcp,
}: {
  detail: SessionDetail;
  /**
   * Opens the MCP panel — used only by the phone's warning below, because a
   * phone has no rail and a mark nobody can see is not a warning. Absent on a
   * desktop, where the rail says it and this row is not drawn at all.
   */
  onOpenMcp?: () => void;
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
  /**
   * The same two, plus the panels, as sections of the phone's session sheet.
   *
   * On a phone the title row holds a name and one button, and everything else
   * lives behind it — so these cannot be `actions` in a narrower shape: a
   * popover trigger and a section of a sheet are different components of the
   * same state, and the page builds both.
   */
  menuSections?: (close: () => void) => import('react').ReactNode;
}) {
  const s = detail.summary;
  /**
   * The figures survive their own recalculation, and this header no longer has
   * to do anything about it. A transcript that grows invalidates the cached
   * enrichment and the re-parse takes ~105 ms, during which the counts used to
   * be absent — 22 px out of the page, so every message a live session wrote
   * shoved the whole conversation down and pulled it back. This component kept
   * the last figures in a ref to stand still; the server keeps them now, for
   * every reader at once ([AI_ARCHITECTURE.md](../../../../docs/AI_ARCHITECTURE.md)),
   * so `enrichment` is null here only when the session has never been enriched
   * — and then there is nothing to draw, which is right. They share a WRAPPING
   * row with the rest of the facts, where a chip coming and going can cost a
   * whole line rather than 22 px.
   */
  const e = s.enrichment;
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(() => localStorage.getItem(KEY) === 'true');
  // One shared query with every other reader of the price table.
  const prices = useQuery({ queryKey: ['prices'], queryFn: api.prices });
  // The same figure, from the same function, as the list and the sort: a session
  // that delegated its work to eleven agents spent that money as surely as one
  // that did the work itself.
  const cost = sessionCostParts(s, prices.data?.prices ?? {});

  return (
    // A measurement hook, like `data-conversation-scroller` and `data-inspector`:
    // this header is inside the box that narrows when a column opens beside the
    // session, so its facts row can rewrap — and whatever height it takes, the
    // scroller under it gives up.
    <div data-session-header className="border-b border-[var(--border)] px-4 pt-2.5 pb-2 max-md:px-3">
      {/* On a phone: the name, and one button. Everything that used to sit
          beside it — find, the view menu, the session's own actions and the
          inspector panels — is behind that button, because a title is what somebody
          opens a session to see and the row was spending two thirds of itself on
          controls used a few times each.
          The ← went with them, from BOTH sizes. Escape has always been the way
          out on a desktop and Back is the way out on a phone; the mark in the
          app's own header goes to the list as well, and a glyph whose whole job
          is duplicating the browser's own control is a glyph that had to justify
          its 20px on every session ever opened. */}
      <div className="flex items-center gap-2 max-md:gap-1.5">
        {/* `shrink`, which the list deliberately does not pass: this header can
            be squeezed to 320 px by a column opened beside the session, and a
            tag that held its full width there pushed the row's own controls out
            of the box — where the clip then ate them. */}
        <span className="contents max-md:hidden">
          <ProjectTag name={s.projectName} path={s.projectPath} color={color} shrink />
        </span>
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
        <span className="flex shrink-0 items-center gap-1 max-md:hidden">
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
          <SessionBadges session={s} omitPr omitNews live={live} />
        </span>
        <span className="flex-1" />
        <span className={`shrink-0 ${controlRow}`}>
          {/* Both are sections of the sheet on a phone ([menuSections]). */}
          <span className="flex items-center gap-2 max-md:hidden">{actions}</span>
          <SessionMenu
            detail={detail}
            draft={draft}
            onRename={() => setEditing(true)}
            extra={menuSections}
          />
        </span>
      </div>

      {/* The phone's second row, and it is always drawn: what this session IS.
          `more` does not swap it for something else — it opens the rest of the
          facts UNDERNEATH, so the tag and the badges stay where they were and
          the header simply gets taller until `less` puts it back.
          Above the facts row in the DOM rather than below it, which is what
          makes that the reading order on a phone; on a desktop this row does not
          exist and nothing has moved. */}
      <div className="mt-1 hidden flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-dim)] max-md:flex">
        {/* Capped, because a wrapped row does not shrink its items: a project
            called `OrchardCore.DistribWebAPI_2` took the line on its own. */}
        <span className="flex max-w-40 min-w-0">
          <ProjectTag name={s.projectName} path={s.projectPath} color={color} shrink />
        </span>
        {s.titleSource === 'local' && (
          <Badge
            label="✎"
            title={`Renamed locally — original title: “${s.originalTitle ?? ''}”`}
            className="bg-amber-500/15 text-amber-400"
          />
        )}
        <SessionBadges session={s} omitPr omitNews live={live} />
        {/* The one thing about this session that is WRONG, on the phone only.
            The rail says it on a desktop and this row is not drawn there; here
            there is no rail at all, and a mark that lives inside the ⋮ sheet is
            a warning nobody receives until they go looking. So it is in the
            header, it names what it is about, and it opens the panel. */}
        {detail.mcp.failing > 0 && onOpenMcp && (
          <button
            type="button"
            onClick={onOpenMcp}
            title={`${detail.mcp.failing} MCP server${detail.mcp.failing === 1 ? '' : 's'} never connected — open the panel`}
            // `py-1`, which is the `more` button's on this same row: the row has
            // its own scale and a target twice as tall as everything beside it
            // would break the line it lives in.
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded bg-amber-500/15 px-1.5 py-1 text-[11px] font-semibold tracking-wide text-amber-400"
          >
            ⚠ {detail.mcp.failing} MCP
          </button>
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
          className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 ${
            details ? 'text-[var(--accent)]' : ''
          }`}
        >
          {details ? 'less' : 'more'}
          <Chevron up={details} />
        </button>
      </div>

      {/* Eleven facts, two of them full timestamps, wrapped at 360px: five
          lines, which on a phone is most of what is left after the browser's own
          bars. So a phone keeps them folded until `more` above asks for them —
          the same row, in full, that a desktop never hides. */}
      <div
        className={`mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-dim)] max-md:gap-x-2.5 ${
          details ? '' : 'max-md:hidden'
        }`}
      >
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
        {/* The phone has its own, on the row above, and it is always there. */}
        <button
          type="button"
          onClick={() =>
            setDetails((v) => {
              localStorage.setItem(KEY, String(!v));
              return !v;
            })
          }
          className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] max-md:hidden ${
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
