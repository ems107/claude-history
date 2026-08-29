import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { AREAS, type AreaId, changedByArea, groupsOf } from '../../lib/settingsCatalog.ts';
import { useSettingsPage } from './context.ts';

/**
 * The map: six areas down the left, the groups of whichever one is open, and how
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
  scroller,
}: {
  area: AreaId;
  /** The panel that actually scrolls, which is what the spy has to watch. */
  scroller: HTMLElement | null;
}) {
  const { settings, defaults } = useSettingsPage();
  const counts = changedByArea(settings, defaults);
  const groups = groupsOf(area);
  const here = useVisibleGroup(scroller, area);

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] py-3">
      {AREAS.map((a) => {
        const changed = counts.get(a.id) ?? 0;
        const open = a.id === area;
        return (
          <div key={a.id} className={a.danger ? 'mt-auto border-t border-[var(--border)] pt-3' : ''}>
            <NavLink
              to={`/settings/${a.id}`}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                open
                  ? 'text-[var(--text)]'
                  : a.danger
                    ? 'text-red-300/70 hover:text-red-300'
                    : 'text-[var(--text-dim)] hover:text-[var(--text)]'
              }`}
            >
              {/* The bar says which area you are in without indenting the label,
                  so every row starts on the same column and the list reads as a
                  list rather than as a tree. */}
              <span
                aria-hidden="true"
                className={`h-4 w-0.5 shrink-0 rounded ${open ? (a.danger ? 'bg-red-400' : 'bg-[var(--accent)]') : 'bg-transparent'}`}
              />
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
              {changed > 0 && (
                <span
                  title={`${changed} setting${changed === 1 ? '' : 's'} changed from the default`}
                  className="shrink-0 text-[10px] text-[var(--text-dim)]"
                >
                  ●{changed}
                </span>
              )}
            </NavLink>
            {/* Only the open area's groups, and only when it has more than one:
                a single-group area would list its own name back at you. */}
            {open && groups.length > 1 && (
              <div className="mb-1 flex flex-col">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => document.getElementById(g.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                    className={`cursor-pointer truncate py-0.5 pr-3 pl-[1.4rem] text-left text-xs ${
                      here === g.id ? 'text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                    }`}
                  >
                    {g.short ?? g.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Which group is at the top of the panel right now.
 *
 * Scrolling, not clicking, is what this answers — a click already knows where it
 * went. The topmost INTERSECTING heading wins rather than the closest one,
 * because a group taller than the viewport must go on being the answer while you
 * read through it, which "closest to the top edge" stops doing halfway down.
 */
function useVisibleGroup(scroller: HTMLElement | null, area: AreaId): string | null {
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    if (!scroller) return;
    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.getAttribute('data-settings-group');
          if (id) seen.set(id, e.isIntersecting ? e.boundingClientRect.top : Number.POSITIVE_INFINITY);
        }
        let best: string | null = null;
        let top = Number.POSITIVE_INFINITY;
        for (const [id, y] of seen) {
          if (y < top) {
            top = y;
            best = id;
          }
        }
        setHere(best);
      },
      { root: scroller, rootMargin: '0px 0px -70% 0px' },
    );
    for (const el of scroller.querySelectorAll('[data-settings-group]')) observer.observe(el);
    return () => observer.disconnect();
    // Re-armed when the area changes: the groups on screen are different ones.
  }, [scroller, area]);
  return here;
}
