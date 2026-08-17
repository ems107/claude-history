import { parseTerms, type Turn } from '@claude-history/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFindCorpus,
  FIND_ROLES,
  findHits,
  hitSnippet,
  ROLE_LABEL,
  shortfall,
  unitKey,
  type FindRole,
} from '../../lib/findInSession.ts';
import { focusKeyAt, type MatchHighlight } from '../../lib/highlight.ts';
import { SnippetRow } from '../list/SnippetRow.tsx';
import type { FindState, FindTarget } from './TurnList.tsx';

/** Long enough that a word is typed before it is scanned, short enough not to lag. */
const DEBOUNCE_MS = 150;
/** Rows the panel draws before asking. A common word matches thousands of times. */
const PAGE_ROWS = 40;

/** Where the bar is allowed to look. */
export type FindScope = 'all' | 'visible' | 'focused';
const SCOPE_LABEL: Record<FindScope, string> = { all: 'All', visible: 'Visible', focused: 'Focused' };

export interface FindBarProps {
  open: boolean;
  query: string;
  setQuery: (q: string) => void;
  wholeWord: boolean;
  setWholeWord: (v: boolean) => void;
  scope: FindScope;
  setScope: (s: FindScope) => void;
  hasFocus: boolean;
  off: Set<FindRole>;
  toggleRole: (r: FindRole) => void;
  byRole: Record<FindRole, number>;
  panel: boolean;
  setPanel: (v: boolean) => void;
  /** Which of the found matches the reader is standing on, or -1 before the first step. */
  at: number;
  total: number;
  capped: boolean;
  rows: { key: string; snippet: ReturnType<typeof hitSnippet>; active: boolean; select: () => void }[];
  moreRows: number;
  showMore: () => void;
  hiddenThinking: number;
  short: { truncated: number; offloaded: number };
  sessionId: string;
  next: () => void;
  prev: () => void;
  close: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * The find bar, and the state behind it.
 *
 * Both live in one file for the same reason `useFollowBottom` and its button do:
 * the hook is the feature and the component is its face, and splitting them
 * would mean an interface between two halves that are never used apart.
 */
export function useFindBar(
  turns: Turn[],
  sessionId: string,
  opts: {
    showThinking: boolean;
    enabled: boolean;
    /**
     * The words a search link brought the reader here with. Opening the bar on
     * such a page starts from them — "the search sent me here, now walk all of
     * them" becomes one keystroke, which is the most useful thing this bar can
     * do for somebody who did not type the query in the first place. They arrive
     * already folded, which is what was matched; folding is idempotent, so
     * re-parsing them changes nothing.
     */
    seed?: MatchHighlight | null;
  },
) {
  const [open, setOpen] = useState(false);
  /** The corpus is built the first time the bar is opened and not before: a reader who never presses Ctrl+F pays nothing. */
  const [everOpened, setEverOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<FindScope>('all');
  const [off, setOff] = useState<Set<FindRole>>(() => new Set());
  const [panel, setPanel] = useState(false);
  const [rowLimit, setRowLimit] = useState(PAGE_ROWS);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  /** Where the reader is standing, by identity: a live session appending a turn must not slide them onto another match. */
  const [standing, setStanding] = useState<{ key: string; ordinal: number } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [visible, setVisible] = useState<Map<string, number>>(() => new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const units = useMemo(() => (everOpened ? buildFindCorpus(turns) : []), [turns, everOpened]);
  const short = useMemo(() => shortfall(units), [units]);

  const highlight = useMemo<MatchHighlight | null>(() => {
    // Phrase, always: this is the browser's Ctrl+F and what you typed is what
    // you meant. It is also why MAX_FIND_HITS exists — phrase mode applies no
    // minimum term length, so a single letter is a legal query.
    const terms = parseTerms(query, 'phrase');
    return terms.length > 0 ? { terms, wholeWord } : null;
  }, [query, wholeWord]);

  const roles = useMemo(() => {
    const set = new Set(FIND_ROLES.filter((r) => !off.has(r)));
    // Thinking that is not being drawn cannot be shown, so it is not offered —
    // but it is still counted, and the bar says how many and where the switch is.
    if (!opts.showThinking) set.delete('thinking');
    return set;
  }, [off, opts.showThinking]);

  const index = useMemo(() => (highlight ? findHits(units, highlight, roles) : null), [units, highlight, roles]);

  const hits = useMemo(() => {
    if (!index) return [];
    if (scope === 'focused') {
      return focusedKey ? index.hits.filter((h) => unitKey(units[h.unit]) === focusedKey) : [];
    }
    if (scope === 'visible') {
      // A box's DOM ranges are the truth about what is on screen: a folded body
      // has no text nodes at all, so it reports nothing and drops out.
      return index.hits.filter((h) => h.ordinal < (visible.get(unitKey(units[h.unit])) ?? 0));
    }
    return index.hits;
  }, [index, scope, focusedKey, visible, units]);

  // A new question means a new place to stand.
  useEffect(() => setStanding(null), [highlight, scope, roles]);
  useEffect(() => setRowLimit(PAGE_ROWS), [highlight, scope, roles]);

  const at = useMemo(() => {
    if (!standing) return -1;
    return hits.findIndex((h) => unitKey(units[h.unit]) === standing.key && h.ordinal === standing.ordinal);
  }, [standing, hits, units]);

  const stepTo = useCallback(
    (i: number) => {
      if (hits.length === 0) return;
      const wrapped = ((i % hits.length) + hits.length) % hits.length;
      const hit = hits[wrapped];
      setStanding({ key: unitKey(units[hit.unit]), ordinal: hit.ordinal });
      setNonce((n) => n + 1);
    },
    [hits, units],
  );

  /**
   * Where the first step goes: the first match at or below where the reader is
   * already reading. Starting at the top of a three-hundred-message session
   * would be the wrong answer to Enter.
   *
   * It is measured by what is ABOVE, not by what is below, and that is the whole
   * subtlety: most of these matches are folded away and have no element to
   * measure at all. Taking "no element" as "not yet reached" would skip every
   * hidden match before the first visible one — with the page at the very top it
   * still opened at the ninth of 113. So an unmeasurable hit inherits the
   * position of the last measurable one before it, which document order makes
   * sound, and the walk stops at the first box that is on screen.
   */
  const fromReadingPosition = useCallback((): number => {
    let lastAbove = -1;
    for (let i = 0; i < hits.length; i++) {
      const unit = units[hits[i].unit];
      const el = unit.toolUseId
        ? document.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(unit.toolUseId)}"]`)
        : document.getElementById(unit.uuid);
      if (!el) continue;
      if (el.getBoundingClientRect().top >= 0) break;
      lastAbove = i;
    }
    return lastAbove + 1;
  }, [hits, units]);

  const next = useCallback(() => stepTo(at < 0 ? fromReadingPosition() : at + 1), [at, stepTo, fromReadingPosition]);
  const prev = useCallback(
    () => stepTo(at < 0 ? fromReadingPosition() - 1 : at - 1),
    [at, stepTo, fromReadingPosition],
  );

  const target = useMemo<FindTarget | null>(() => {
    if (at < 0) return null;
    const unit = units[hits[at].unit];
    return { uuid: unit.uuid, toolUseId: unit.toolUseId, ordinal: hits[at].ordinal, nonce };
    // `nonce` and not `at`: the object may be rebuilt by a refetch, and the list
    // only moves for a step that was asked for.
  }, [at, hits, units, nonce]);

  const find = useMemo<FindState | null>(
    () => (open ? { highlight, focusedKey, target } : null),
    [open, highlight, focusedKey, target],
  );

  const onFindMarks = useCallback((counts: Map<string, number>) => {
    // Only when it really changed, or the marking pass and this state would keep
    // handing work back to each other.
    setVisible((prev) => {
      if (prev.size === counts.size && [...counts].every(([k, v]) => prev.get(k) === v)) return prev;
      return counts;
    });
  }, []);

  const seed = opts.seed;
  const openBar = useCallback(() => {
    setEverOpened(true);
    setOpen(true);
    setTyped((prev) => {
      if (prev.length > 0 || !seed) return prev;
      setWholeWord(seed.wholeWord);
      return seed.terms.join(' ');
    });
    // Focus after the strip has been drawn, and select what is there so typing
    // replaces the previous search rather than extending it.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [seed]);

  const close = useCallback(() => {
    setOpen(false);
    setPanel(false);
    setStanding(null);
  }, []);

  // Another session starts clean: what was searched here says nothing about there.
  useEffect(() => {
    setOpen(false);
    setPanel(false);
    setTyped('');
    setQuery('');
    setStanding(null);
    setFocusedKey(null);
    setScope('all');
    setOff(new Set());
  }, [sessionId]);

  useEffect(() => {
    if (!opts.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openBar();
        return;
      }
      if (!open) return;
      if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts.enabled, open, openBar, next, prev]);

  const rows = useMemo(() => {
    if (!highlight) return [];
    return hits.slice(0, rowLimit).map((hit, i) => ({
      key: `${hit.unit}:${hit.ordinal}`,
      snippet: hitSnippet(units, hit, highlight),
      active: i === at,
      select: () => stepTo(i),
    }));
  }, [hits, units, highlight, rowLimit, at, stepTo]);

  const bar: FindBarProps = {
    open,
    query: typed,
    setQuery: setTyped,
    wholeWord,
    setWholeWord,
    scope,
    setScope,
    hasFocus: focusedKey !== null,
    off,
    toggleRole: (role) =>
      setOff((prev) => {
        const nextOff = new Set(prev);
        if (!nextOff.delete(role)) nextOff.add(role);
        return nextOff;
      }),
    byRole: index?.byRole ?? { user: 0, assistant: 0, thinking: 0, tool: 0, plan: 0, notice: 0, system: 0 },
    panel,
    setPanel,
    at,
    total: hits.length,
    capped: index?.capped ?? false,
    rows,
    moreRows: Math.max(0, hits.length - rowLimit),
    showMore: () => setRowLimit((n) => n + PAGE_ROWS),
    hiddenThinking: opts.showThinking ? 0 : (index?.byRole.thinking ?? 0),
    short,
    sessionId,
    next,
    prev,
    close,
    inputRef,
  };

  /**
   * One delegated listener over the conversation, which is what keeps `Bubble`
   * free of the `onClick` it must not have. Clicking a message or a call marks
   * it; clicking anywhere else clears the mark. It changes nothing that is
   * drawn or folded — the whole reason the invariant's argument does not reach
   * it — so a drag that ends in another bubble simply focuses that one.
   */
  const onConversationClick = useCallback(
    (e: React.MouseEvent) => setFocusedKey(focusKeyAt(e.target)),
    [],
  );

  return { bar, find, onFindMarks, openBar, close, isOpen: open, onConversationClick };
}

const control =
  'cursor-pointer rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:cursor-default disabled:opacity-40';
const idle = 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]';
const on = 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text)]';

export function FindBar(p: FindBarProps) {
  if (!p.open) return null;
  const asked = p.query.trim().length > 0;
  const nothing = asked && p.total === 0;
  // What is off its default, and what this corpus cannot reach. Both belong out
  // here rather than in the panel: a panel nobody has open must never change the
  // results in silence. The reach notes wait for a question — with an empty box
  // they are trivia about the session, not a caveat about an answer.
  const notes: string[] = [];
  if (p.scope !== 'all') notes.push(SCOPE_LABEL[p.scope]);
  if (p.off.size > 0) notes.push(`${FIND_ROLES.length - p.off.size} of ${FIND_ROLES.length} kinds`);
  if (asked && p.hiddenThinking > 0) notes.push(`${p.hiddenThinking} in hidden thinking`);
  if (asked && p.short.offloaded > 0) {
    notes.push(`${p.short.offloaded} output${p.short.offloaded === 1 ? '' : 's'} on disk, not searched`);
  }
  if (asked && p.short.truncated > 0) {
    notes.push(`${p.short.truncated} output${p.short.truncated === 1 ? '' : 's'} cut short`);
  }

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-raised)]/60 px-4 py-1.5 text-xs">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
        <input
          ref={p.inputRef}
          value={p.query}
          onChange={(e) => p.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) p.prev();
              else p.next();
            }
            if (e.key === 'Escape') {
              // Handled here and stopped here: the window listener would take
              // Escape as "go back a page".
              e.preventDefault();
              e.stopPropagation();
              p.close();
            }
          }}
          placeholder="Find in this conversation…"
          className="min-w-56 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 outline-none focus:border-[var(--accent)]"
        />
        <button type="button" onClick={() => p.setWholeWord(!p.wholeWord)} className={`${control} ${p.wholeWord ? on : idle}`} title="Whole words only">
          Aa
        </button>
        <span className={`min-w-24 text-right ${nothing ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>
          {p.query.trim().length === 0
            ? ''
            : nothing
              ? 'no matches'
              : p.at < 0
                ? `${p.total}${p.capped ? '+' : ''} match${p.total === 1 ? '' : 'es'}`
                : `${p.at + 1} of ${p.total}${p.capped ? '+' : ''}`}
        </span>
        <button type="button" onClick={p.prev} disabled={p.total === 0} className={`${control} ${idle}`} title="Previous (Shift+Enter)">
          ▲
        </button>
        <button type="button" onClick={p.next} disabled={p.total === 0} className={`${control} ${idle}`} title="Next (Enter)">
          ▼
        </button>
        <button type="button" onClick={() => p.setPanel(!p.panel)} className={`${control} ${p.panel ? on : idle}`} title="Scope, kinds and the list of matches">
          {p.panel ? '▴' : '▾'}
        </button>
        <button type="button" onClick={p.close} className={`${control} ${idle}`} title="Close (Esc)">
          ✕
        </button>
      </div>

      {/* Whatever is off its default says so out here, where it can be seen: a
          panel nobody has open must never change the results in silence. */}
      {notes.length > 0 && (
        <div className="mx-auto max-w-5xl pt-1 text-[11px] text-[var(--text-dim)]/80">{notes.join(' · ')}</div>
      )}

      {p.panel && (
        <div className="mx-auto mt-2 max-w-5xl space-y-2 border-t border-[var(--border)] pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">Look in</span>
            {(['all', 'visible', 'focused'] as FindScope[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={s === 'focused' && !p.hasFocus}
                onClick={() => p.setScope(s)}
                title={
                  s === 'visible'
                    ? 'Only what is unfolded right now — what the browser’s own Ctrl+F would have reached'
                    : s === 'focused'
                      ? p.hasFocus
                        ? 'Only the message or tool call you clicked'
                        : 'Click a message or a tool call first'
                      : 'The whole conversation, folded or not'
                }
                className={`${control} ${p.scope === s ? on : idle}`}
              >
                {SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">Kinds</span>
            {FIND_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                disabled={p.byRole[role] === 0}
                onClick={() => p.toggleRole(role)}
                className={`${control} ${p.off.has(role) || p.byRole[role] === 0 ? idle : on}`}
              >
                {ROLE_LABEL[role]} {p.byRole[role]}
              </button>
            ))}
          </div>
          {p.rows.length > 0 && (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {p.rows.map((row) => (
                <SnippetRow
                  key={row.key}
                  sessionId={p.sessionId}
                  snippet={row.snippet}
                  query={{ terms: [], mode: 'phrase', scope: 'message', wholeWord: false }}
                  onSelect={row.select}
                  active={row.active}
                />
              ))}
              {p.moreRows > 0 && (
                <button type="button" onClick={p.showMore} className={`${control} ${idle} ml-2`}>
                  Show {Math.min(p.moreRows, PAGE_ROWS)} more of {p.moreRows}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
