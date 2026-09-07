import path from 'node:path';
import type { ProjectGroup, ProjectInfo, SessionSummary } from '@claude-history/shared';
import { PROJECT_GROUP_NAME_MAX, PROJECT_GROUPS_MAX, PROJECT_KEYS_MAX } from '@claude-history/shared';

/**
 * Grouping key for a real project path. The same project can be recorded with
 * different drive-letter casing (observed: `C:\...` vs `c:\...`), so keys are
 * normalized and lowercased.
 */
export function normalizeProjectKey(realPath: string): string {
  return path.normalize(realPath).replace(/[\\/]+$/, '').toLowerCase();
}

/** Deterministic base hue from the project key (FNV-1a + golden-angle spread). */
export function projectHue(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return Math.floor(((h * 0.61803398875) % 1) * 360);
}

const MIN_HUE_GAP = 22;

/**
 * Assign visually distinct tag colors. Base hue is hash-derived (stable per
 * project); collisions are resolved deterministically by walking the golden
 * angle, processing projects in sorted-key order so results don't depend on
 * activity order.
 */
function assignColors(keys: string[]): Map<string, string> {
  const used: number[] = [];
  const colors = new Map<string, string>();
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  for (const key of [...keys].sort()) {
    let hue = projectHue(key);
    let attempts = 0;
    while (used.some((u) => gap(u, hue) < MIN_HUE_GAP) && attempts < 32) {
      hue = (hue + 137) % 360;
      attempts++;
    }
    used.push(hue);
    colors.set(key, `hsl(${hue} 60% 62%)`);
  }
  return colors;
}

/**
 * Fold sessions into projects.
 *
 * `colorBasis` is every project key that EXISTS, and it is separate from the
 * sessions for one reason: `assignColors` resolves hue collisions by walking the
 * golden angle over the set it is given, so the colour a project gets depends on
 * which OTHER projects are in the list. With the set varying — the browsing list
 * has hidden projects taken out of it, the settings list does not — the same
 * project came out two different colours in two query caches, and hiding one
 * project quietly recoloured the tags of unrelated ones all over the app.
 *
 * Passing the full key set makes a tag's colour a property of the project rather
 * than of whatever happens to be visible. Omitting it keeps the old behaviour,
 * which is right for a caller that really is looking at everything.
 */
export function buildProjects(summaries: Iterable<SessionSummary>, colorBasis?: Iterable<string>): ProjectInfo[] {
  const byKey = new Map<string, ProjectInfo & { _latest: number }>();
  for (const s of summaries) {
    const existing = byKey.get(s.projectKey);
    if (!existing) {
      byKey.set(s.projectKey, {
        key: s.projectKey,
        path: s.projectPath,
        name: s.projectName,
        color: '', // assigned below once all keys are known
        sessionCount: 1,
        lastActivityMs: s.mtimeMs,
        _latest: s.mtimeMs,
      });
    } else {
      existing.sessionCount++;
      existing.lastActivityMs = Math.max(existing.lastActivityMs, s.mtimeMs);
      // Display path/name from the most recently active session (freshest casing).
      if (s.mtimeMs > existing._latest) {
        existing._latest = s.mtimeMs;
        existing.path = s.projectPath;
        existing.name = s.projectName;
      }
    }
  }
  const colors = assignColors([...(colorBasis ?? byKey.keys())]);
  return [...byKey.values()]
    .map(({ _latest, ...p }) => ({ ...p, color: colors.get(p.key) ?? 'hsl(0 0% 60%)' }))
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
}

/**
 * A project key as the settings may name one.
 *
 * The values that arrive here are `ProjectInfo.key`s the UI read back from us,
 * so normalizing again is idempotent — but this is also what a hand-edited
 * `userdata.json` or a `PUT /api/settings` from anything else goes through, and
 * one written as `C:/Users/...` has to end up matching the key the index built.
 *
 * The `encoded:` keys are left alone beyond the trim and the lowercase:
 * `normalizeProjectKey` is a path function, and those are not paths — they are
 * the fallback identity of a session whose real `cwd` was never recorded
 * (`summarizer.ts`).
 */
function projectKeyOf(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('encoded:') ? trimmed.toLowerCase() : normalizeProjectKey(trimmed);
}

/** Whatever arrived, as a deduplicated list of at most `PROJECT_KEYS_MAX` keys. */
function keyList(value: unknown, taken?: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const key = projectKeyOf(entry);
    if (!key || seen.has(key) || taken?.has(key)) continue;
    seen.add(key);
    taken?.add(key);
    out.push(key);
    if (out.length >= PROJECT_KEYS_MAX) break;
  }
  return out;
}

/**
 * The hidden-projects setting, from anything at all.
 *
 * Called on the way IN as well as on the way out — `applyUserdata` merges the
 * saved settings without checking a single type, so a `hiddenProjects: "foo"`
 * put there by hand would be served by `/api/settings` and reach the filter
 * sidebar, where `.includes` on a string answers about letters. Everything that
 * is not a usable key simply goes.
 */
export function sanitizeHiddenProjects(value: unknown): string[] {
  return keyList(value);
}

/**
 * The groups setting, from anything at all.
 *
 * **This is where "a project belongs to at most one group" is enforced**, and it
 * is enforced here rather than trusted to the editor because the settings page
 * is not the only thing that can PUT to `/api/settings`. A key that appears in
 * two groups is kept by the first and dropped from the second, so the sidebar's
 * order — every group with its own members, then everything left over — can
 * never be asked to draw one project twice.
 *
 * A group with no members survives: creating one and then filling it is the
 * order anybody does this in. One with no name does not — it would be a row
 * with nothing to click.
 */
export function sanitizeProjectGroups(value: unknown): ProjectGroup[] {
  if (!Array.isArray(value)) return [];
  const out: ProjectGroup[] = [];
  const ids = new Set<string>();
  const claimed = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, projects } = entry as { id?: unknown; name?: unknown; projects?: unknown };
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    const trimmedId = id.trim();
    const trimmedName = name.trim().slice(0, PROJECT_GROUP_NAME_MAX);
    if (!trimmedId || !trimmedName || ids.has(trimmedId)) continue;
    ids.add(trimmedId);
    out.push({ id: trimmedId, name: trimmedName, projects: keyList(projects, claimed) });
    if (out.length >= PROJECT_GROUPS_MAX) break;
  }
  return out;
}
