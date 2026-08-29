import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import {
  type Area,
  AREAS,
  type AreaId,
  CHANGED_VIEW,
  changedByArea,
  groupsOf,
  searchSettings,
} from '../../lib/settingsCatalog.ts';
import { useSettingsPage } from './context.ts';

/**
 * The map: a search box, six areas, the groups of whichever one is open, and how
 * many settings in each are no longer at their default.
 *
 * The rail is what the old page had no equivalent of. Ten sections in one scroll
 * with no index is a page you have to READ to navigate, which is why three deep
 * links had been carved into it by hand — each one a small admission that
 * finding a thing here was hard.
 *
 * Labels rather than icons, deliberately. Six abstract categories cannot be told
 * apart at 16 px — `InspectorRail` gets away with icons because its six are
 * concrete nouns (files, agents, tokens) and these are not.
 */
export function SettingsNav({
  area,
}: {
  /** Null on the changed-list, which is a route but not an area. */
  area: AreaId | null;
}) {
  const { settings, defaults, selected, select } = useSettingsPage();
  const [query, setQuery] = useState('');
  const counts = changedByArea(settings, defaults);
  const totalChanged = [...counts.values()].reduce((a, b) => a + b, 0);
  const groups = area ? groupsOf(area) : [];

  const item = (a: Area) => {
    const changed = counts.get(a.id) ?? 0;
    const open = a.id === area;
    return (
      <div key={a.id} className={a.danger ? 'mt-auto border-t border-[var(--border)] pt-3' : ''}>
        <RailLink to={`/settings/${a.id}`} open={open} danger={a.danger} label={a.title} count={changed} />
        {/* Only the open area's groups, and only when it has more than one: a
            single-group area would list its own name back at you. */}
        {open && groups.length > 1 && (
          <div className="mb-1 flex flex-col">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                // Go there AND mark it. Scrolling alone was what the rail did
                // before, and with a scroll-spy deciding the mark it meant
                // clicking an item lit whatever you happened to land beside.
                onClick={() => {
                  select(g.id);
                  document.getElementById(g.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }}
                className={`cursor-pointer truncate py-0.5 pr-3 pl-[1.4rem] text-left text-xs ${
                  selected === g.id ? 'text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                {g.short ?? g.title}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] py-3">
      <SearchBox query={query} setQuery={setQuery} />
      {query.trim() ? (
        <SearchResults query={query} clear={() => setQuery('')} />
      ) : (
        <>
          {AREAS.filter((a) => !a.danger).map(item)}
          {/* After the areas it summarises and before the danger zone, and only
              when there is anything to summarise. A rail item that comes and
              goes must not be the first one, or the list moves under the
              pointer as you change a setting. */}
          {totalChanged > 0 && (
            <RailLink
              to={`/settings/${CHANGED_VIEW.id}`}
              open={area === null}
              label={CHANGED_VIEW.title}
              count={totalChanged}
            />
          )}
          {AREAS.filter((a) => a.danger).map(item)}
        </>
      )}
    </nav>
  );
}

/** One row of the rail: the bar that says you are here, a label, and a tally. */
function RailLink({
  to,
  open,
  danger,
  label,
  count,
}: {
  to: string;
  open: boolean;
  danger?: true;
  label: string;
  count: number;
}) {
  return (
    <NavLink
      to={to}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
        open
          ? 'text-[var(--text)]'
          : danger
            ? 'text-red-300/70 hover:text-red-300'
            : 'text-[var(--text-dim)] hover:text-[var(--text)]'
      }`}
    >
      {/* The bar says where you are without indenting the label, so every row
          starts on the same column and the list reads as a list, not a tree. */}
      <span
        aria-hidden="true"
        className={`h-4 w-0.5 shrink-0 rounded ${open ? (danger ? 'bg-red-400' : 'bg-[var(--accent)]') : 'bg-transparent'}`}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          title={`${count} setting${count === 1 ? '' : 's'} changed from the default`}
          className="shrink-0 text-[10px] text-[var(--text-dim)]"
        >
          ●{count}
        </span>
      )}
    </NavLink>
  );
}

/**
 * The box, and the one key that reaches it from anywhere on the page.
 *
 * `/` is the shortcut every list with a filter on it uses, and the guard is the
 * whole of what makes it safe: a slash typed into the auto-reload folder is a
 * path separator, so the key is only taken when nothing is being typed into.
 */
function SearchBox({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const at = e.target as HTMLElement | null;
      if (at && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="mb-2 px-3">
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Search settings  /"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('');
            e.currentTarget.blur();
          }
        }}
        className="w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs placeholder:text-[var(--text-dim)] focus:border-[var(--accent-dim)] focus:outline-none"
      />
    </div>
  );
}

/**
 * What matches, and what picking one does.
 *
 * A hit is a ROW, not an area, so following one has to say which of the forty-six
 * it meant — hence `/settings/<area>#<row>`, which the page's own anchor
 * handling then scrolls to and flashes. That is the same route a bookmark takes,
 * so there is one way in and one thing to keep working.
 *
 * The breadcrumb is not decoration: two rows here are called "Tone", and three
 * are about seconds. Without "Notifications · Which stops" under it, picking the
 * right one would be a guess.
 */
function SearchResults({ query, clear }: { query: string; clear: () => void }) {
  const navigate = useNavigate();
  const hits = useMemo(() => searchSettings(query), [query]);
  const [cursor, setCursor] = useState(0);
  // A new query is a new list, and holding position in it would leave the
  // highlight on whatever happens to be nth — which is not what anyone meant.
  useEffect(() => setCursor(0), [query]);

  const go = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    clear();
    void navigate(`/settings/${hit.area.id}#${hit.entry.id}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, hits.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        go(cursor);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (hits.length === 0) {
    return <p className="px-3 py-2 text-xs text-[var(--text-dim)]">Nothing here matches that.</p>;
  }

  return (
    <div className="flex flex-col">
      {hits.map((hit, i) => (
        <button
          key={hit.entry.id}
          type="button"
          onMouseEnter={() => setCursor(i)}
          onClick={() => go(i)}
          className={`cursor-pointer px-3 py-1.5 text-left ${i === cursor ? 'bg-[var(--bg-hover)]' : ''}`}
        >
          <span className="block text-xs text-[var(--text)]">{hit.entry.label}</span>
          <span className="block truncate text-[10px] text-[var(--text-dim)]">
            {hit.area.title} · {hit.group.short ?? hit.group.title}
          </span>
        </button>
      ))}
    </div>
  );
}
