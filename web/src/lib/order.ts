import { useCallback, useState } from 'react';

// How the two cross-session pages (Starred, Plans) are ordered: one date field,
// a direction, and an optional grouping by session. The sessions list has its
// own machinery in `filters.ts` — five sort fields, day/project grouping, all of
// it in the URL — and shares nothing with this but the look of the controls.

export type OrderDir = 'asc' | 'desc';
export type OrderGroup = 'none' | 'session';

export interface OrderState {
  group: OrderGroup;
  dir: OrderDir;
}

export const DEFAULT_ORDER: OrderState = { group: 'none', dir: 'desc' };

/**
 * The page's own choice, persisted like the reading preferences in
 * `viewPrefs.ts`: it belongs to the reader, not to a visit. Not in the URL,
 * because the nav link carries no parameters and would reset it on every click.
 */
export function useOrder(storageKey: string): [OrderState, (next: OrderState) => void] {
  const [order, setOrderState] = useState<OrderState>(() => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_ORDER;
    try {
      const parsed = JSON.parse(raw) as Partial<OrderState>;
      return {
        group: parsed.group === 'session' ? 'session' : 'none',
        dir: parsed.dir === 'asc' ? 'asc' : 'desc',
      };
    } catch {
      return DEFAULT_ORDER;
    }
  });
  const setOrder = useCallback(
    (next: OrderState) => {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setOrderState(next);
    },
    [storageKey],
  );
  return [order, setOrder];
}

/** An absent or unparseable date sorts oldest, rather than as "now". */
function ms(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortByDate<T>(items: readonly T[], at: (item: T) => string | null, dir: OrderDir): T[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => mul * (ms(at(a)) - ms(at(b))));
}

export interface SessionGroup<T> {
  sessionId: string;
  sessionTitle: string;
  /** The NEWEST date in the group, which is what the group is ordered by. */
  newestMs: number;
  items: T[];
}

/**
 * The same items bucketed by session.
 *
 * A group is ordered by its **newest** member in both directions — that is the
 * date a session was last worth reading, and it is what makes descending order
 * read as "the sessions I starred something in most recently". Inside a group
 * the members follow the chosen direction like anywhere else.
 *
 * Nested groups rather than the flat `ListRow[]` of `filters.ts`: neither of
 * these pages is virtualized, so nothing here needs a single flat array.
 */
export function groupBySession<T>(
  items: readonly T[],
  at: (item: T) => string | null,
  of: (item: T) => { sessionId: string; sessionTitle: string },
  dir: OrderDir,
): SessionGroup<T>[] {
  const buckets = new Map<string, SessionGroup<T>>();
  for (const item of items) {
    const { sessionId, sessionTitle } = of(item);
    const bucket = buckets.get(sessionId);
    if (bucket) {
      bucket.items.push(item);
      bucket.newestMs = Math.max(bucket.newestMs, ms(at(item)));
    } else {
      buckets.set(sessionId, { sessionId, sessionTitle, newestMs: ms(at(item)), items: [item] });
    }
  }
  const mul = dir === 'asc' ? 1 : -1;
  const groups = [...buckets.values()].sort((a, b) => mul * (a.newestMs - b.newestMs));
  for (const group of groups) group.items = sortByDate(group.items, at, dir);
  return groups;
}
