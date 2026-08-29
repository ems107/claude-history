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
import type { MatchHighlight } from '../../lib/highlight.ts';
import { useSelectedMessage } from '../../lib/selectedMessage.ts';
import { isFromTerminal } from '../../lib/terminalPrefs.ts';
import { SnippetRow } from '../list/SnippetRow.tsx';
import { toggleClass } from '../controlClass.ts';
import type { FindState, FindTarget } from './TurnList.tsx';

/** Long enough that a word is typed before it is scanned, short enough not to lag. */
const DEBOUNCE_MS = 150;
/** Rows the panel draws before asking. A common word matches thousands of times. */
const PAGE_ROWS = 40;

/**
 * Where the bar is allowed to look.
 *
 * Two of the three follow the selected message on their own: clicking a message
 * means "search in this one", clicking away means "search what I can see".
 * `all` is only ever chosen by hand — a scope that reaches into folded text is a
 * decision, not a default somebody should find themselves in — and once chosen
 * it is held until the bar is closed, selection or no selection.
 */
export type FindScope = 'all' | 'visible' | 'current';
const SCOPE_LABEL: Record<FindScope, string> = { all: 'All', visible: 'Visible', current: 'Current message' };
/**
 * What each one actually searches, spelled out under the bar. The buttons are
 * two words each and two of the three are chosen for the reader rather than by
 * them, so the one thing that must never be a guess is where the number in the
 * counter came from.
 */
const SCOPE_BLURB: Record<FindScope, string> = {
  current: 'Searching only the message you have selected.',
  visible: 'Searching only what is unfolded right now — folded turns, tool runs and compacted stretches are left out.',
  all: 'Searching the whole conversation, including everything folded away.',
};

export interface FindBarProps {
  open: boolean;
  query: string;
  setQuery: (q: string) => void;
  wholeWord: boolean;
  setWholeWord: (v: boolean) => void;
  scope: FindScope;
  setScope: (s: FindScope) => void;
  hasSelected: boolean;
  /** Matches in the whole conversation, so a narrowed scope can say what it is holding back. */
  totalEverywhere: number;
  off: Set<FindRole>;
  toggleRole: (r: FindRole) => void;
  byRole: Record<FindRole, number>;
  panel: boolean;
  setPanel: (v: boolean) => void;
  /** Which of the found matches the reader is standing on, or -1 before the first step. */
  at: number;
  total: number;
  capped: boolean;
  rows: {
    key: string;
    snippet: ReturnType<typeof hitSnippet>;
    active: boolean;
    select: () => void;
  }[];
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
  const [scope, setScope] = useState<FindScope>('visible');
  const [off, setOff] = useState<Set<FindRole>>(() => new Set());
  const [panel, setPanel] = useState(false);
  const [rowLimit, setRowLimit] = useState(PAGE_ROWS);
  /**
   * Read, never owned: the selection is its own feature and outlives the bar.
   * This is the one subscription to it in the page, which is what keeps a click
   * from redrawing the conversation — see `lib/selectedMessage.ts`.
   */
  const selected = useSelectedMessage();
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

  /**
   * The selection drives the scope: clicking a message asks to search inside it,
   * clicking away asks for what is on screen. Nothing puts the reader into `all`
   * but the button — and once they have pressed it, nothing takes them out of it
   * either, until the bar is closed and opened again. Asking for the whole
   * conversation and then losing it to a stray click on the margin is the kind of
   * help nobody wants.
   */
  const [allPinned, setAllPinned] = useState(false);
  useEffect(() => {
    if (allPinned) return;
    setScope(selected ? 'current' : 'visible');
  }, [selected, allPinned]);
  const chooseScope = useCallback((next: FindScope) => {
    setAllPinned(next === 'all');
    setScope(next);
  }, []);

  const hits = useMemo(() => {
    if (!index) return [];
    if (scope === 'current') {
      return selected ? index.hits.filter((h) => unitKey(units[h.unit]) === selected) : [];
    }
    if (scope === 'visible') {
      // A box's DOM ranges are the truth about what is on screen: a folded body
      // has no text nodes at all, so it reports nothing and drops out.
      return index.hits.filter((h) => h.ordinal < (visible.get(unitKey(units[h.unit])) ?? 0));
    }
    return index.hits;
  }, [index, scope, selected, visible, units]);

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

  const find = useMemo<FindState | null>(() => (open ? { highlight, target } : null), [open, highlight, target]);

  const onFindMarks = useCallback((counts: Map<string, number>) => {
    // Only when it really changed, or the marking pass and this state would keep
    // handing work back to each other.
    setVisible((prev) => {
      if (prev.size === counts.size && [...counts].every(([k, v]) => prev.get(k) === v)) return prev;
      return counts;
    });
  }, []);

  const seed = opts.seed;
  /**
   * `everywhere` is Ctrl+Shift+F: open on `All` whatever is selected. The
   * shortcut is the second half of "All is never chosen for you" — there has to
   * be a way to ASK for it that does not mean clicking away from the message you
   * are reading first.
   */
  const openBar = useCallback((everywhere = false) => {
    setEverOpened(true);
    setOpen(true);
    if (everywhere) {
      setAllPinned(true);
      setScope('all');
    }
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
    // Closing is what un-pins `All`: it was asked for, for this search.
    setAllPinned(false);
  }, []);

  // Another session starts clean: what was searched here says nothing about
  // there. The selection is cleared by the page, which owns it.
  useEffect(() => {
    setOpen(false);
    setPanel(false);
    setTyped('');
    setQuery('');
    setStanding(null);
    setOff(new Set());
    setAllPinned(false);
  }, [sessionId]);

  // Always listening. It was gated on the page having no layer over the
  // conversation, which stopped being a state the moment the file viewer and the
  // subagent transcript became columns BESIDE it — there is nothing left that
  // hides what this bar marks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+F belongs to whatever has the focus, and inside an embedded
      // terminal that is the CLI's own search, not this bar.
      if (isFromTerminal(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        openBar(e.shiftKey);
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
  }, [open, openBar, next, prev]);

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
    setScope: chooseScope,
    hasSelected: selected !== null,
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
    totalEverywhere: index?.hits.length ?? 0,
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

  return { bar, find, onFindMarks, openBar, close, isOpen: open };
}

const control =
  'cursor-pointer rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:cursor-default disabled:opacity-40';
const idle = 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]';
const on = 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--text)]';

/**
 * The way into the bar for anyone who does not know Ctrl+F opens it — which is
 * how anyone finds that out. Here rather than in the header because it belongs
 * to the find, and the shortcut printed on it is one fact with one home.
 */
export function FindButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={toggleClass(open)}
      title="Find in this conversation — reaches what is folded away, which the browser's own find cannot. Ctrl+F searches the selected message, or what is unfolded; Ctrl+Shift+F searches all of it."
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="size-3.5 shrink-0"
      >
        <circle cx="7" cy="7" r="4.3" />
        <path d="M10.3 10.3 13.8 13.8" />
      </svg>
      Find
      <span className="rounded border border-[var(--border)] px-1 text-[10px] leading-4 opacity-60">Ctrl+F</span>
    </button>
  );
}

export function FindBar(p: FindBarProps) {
  if (!p.open) return null;
  const asked = p.query.trim().length > 0;
  const nothing = asked && p.total === 0;
  /**
   * What the scope is holding back, and the way to it.
   *
   * The default scope is `Visible`, which is most of a conversation short — so
   * a word that lives only in a folded tool result reads as "no matches", which
   * is precisely the answer this bar exists to stop anyone getting. It cannot
   * simply widen: `All` is never chosen for the reader. So it says the number
   * and makes it the button.
   */
  const held = asked && p.scope !== 'all' ? p.totalEverywhere - p.total : 0;
  // What is off its default, and what this corpus cannot reach. Both belong out
  // here rather than in the panel: a panel nobody has open must never change the
  // results in silence. The reach notes wait for a question — with an empty box
  // they are trivia about the session, not a caveat about an answer.
  const notes: { text: string; title?: string }[] = [];
  if (p.off.size > 0) notes.push({ text: `${FIND_ROLES.length - p.off.size} of ${FIND_ROLES.length} kinds` });
  if (asked && p.hiddenThinking > 0) {
    notes.push({
      text: `${p.hiddenThinking} in hidden thinking`,
      title: 'Matches inside thinking blocks, which this conversation is not drawing — turn Thinking on in the header to reach them.',
    });
  }
  if (asked && p.short.offloaded > 0) {
    notes.push({
      text: `${p.short.offloaded} tool output${p.short.offloaded === 1 ? '' : 's'} on disk, not searched`,
      title:
        'Output too large for the transcript, written to a file beside it. The browser never receives those, so nothing in them is counted here. Search ▸ deep, on the session list, does read them.',
    });
  }
  if (asked && p.short.truncated > 0) {
    notes.push({
      text: `${p.short.truncated} long output${p.short.truncated === 1 ? '' : 's'} searched only in part`,
      title:
        'The server sends the first 20,000 characters of a tool result and no more, so for these the search stops there. Everything before the cut is counted; anything after it is not.',
    });
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
          placeholder="Find in this conversation…  (Ctrl+Shift+F searches all of it)"
          className="min-w-56 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 outline-none focus:border-[var(--accent)]"
        />
        <button type="button" onClick={() => p.setWholeWord(!p.wholeWord)} className={`${control} ${p.wholeWord ? on : idle}`} title="Whole words only">
          Aa
        </button>
        <span className={`min-w-24 text-right ${nothing ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>
          {!asked
            ? ''
            : nothing
              ? // "no matches" would be a lie when the scope is what is hiding
                // them; say where you looked instead.
                p.totalEverywhere > 0
                ? `none in ${SCOPE_LABEL[p.scope].toLowerCase()}`
                : 'no matches'
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

      {/* Where it is looking, always, in a sentence — the buttons are two words
          and two of the three scopes are chosen for the reader. Then whatever is
          off its default, and whatever this corpus cannot reach: a panel nobody
          has open must never change the results in silence. */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-2 pt-1 text-[11px] text-[var(--text-dim)]/80">
        <span>{SCOPE_BLURB[p.scope]}</span>
        {held > 0 && (
          <button
            type="button"
            onClick={() => p.setScope('all')}
            title="Search the whole conversation, folded away or not"
            className="cursor-pointer rounded px-1 font-semibold text-[var(--accent)] hover:bg-[var(--bg-hover)]"
          >
            {held} more in the whole conversation →
          </button>
        )}
        {notes.map((n) => (
          <span key={n.text} title={n.title} className={n.title ? 'cursor-help underline decoration-dotted' : undefined}>
            · {n.text}
          </span>
        ))}
      </div>

      {p.panel && (
        <div className="mx-auto mt-2 max-w-5xl space-y-2 border-t border-[var(--border)] pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--text-dim)] uppercase">Look in</span>
            {(['current', 'visible', 'all'] as FindScope[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={s === 'current' && !p.hasSelected}
                onClick={() => p.setScope(s)}
                title={
                  s === 'visible'
                    ? 'Only what is unfolded right now — what the browser’s own Ctrl+F would have reached'
                    : s === 'current'
                      ? p.hasSelected
                        ? 'Only the message or tool call you have selected'
                        : 'Select a message or a tool call by clicking it'
                      : 'The whole conversation, folded or not — the only scope that is never chosen for you'
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
