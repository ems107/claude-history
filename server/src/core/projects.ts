import path from 'node:path';
import type { ProjectInfo, SessionSummary } from '@claude-history/shared';

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

export function buildProjects(summaries: Iterable<SessionSummary>): ProjectInfo[] {
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
  const colors = assignColors([...byKey.keys()]);
  return [...byKey.values()]
    .map(({ _latest, ...p }) => ({ ...p, color: colors.get(p.key) ?? 'hsl(0 0% 60%)' }))
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
}
