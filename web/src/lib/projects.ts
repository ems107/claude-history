import type { ProjectInfo } from '@claude-history/shared';

/**
 * Projects in the order every list of them uses: by name, accent-insensitively.
 *
 * Shared rather than written twice because the two lists are read as the same
 * list — the filter sidebar and the new-session picker carry the same names and
 * the same colours, and a corpus sorted one way in one of them and another way
 * in the other reads as a different set of projects. `sensitivity: 'base'` is
 * the part that would have drifted first: without it `Git` and `git` sort apart,
 * which is exactly the case `normalizeProjectKey` exists to merge.
 */
export function sortProjectsByName(projects: ProjectInfo[]): ProjectInfo[] {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
