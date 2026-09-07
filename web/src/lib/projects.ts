import type { ProjectGroup, ProjectInfo } from '@claude-history/shared';

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

/**
 * One row of the project filter: a group's own checkbox, or a project's.
 *
 * `indented` rather than a nesting depth, because there is exactly one level and
 * there is not going to be a second — a group of groups is a tree, and a tree of
 * checkboxes in a 256px column is the thing this replaced.
 */
export type ProjectFilterRow =
  | { kind: 'group'; id: string; name: string; count: number; keys: string[] }
  | { kind: 'project'; project: ProjectInfo; indented: boolean };

/**
 * The project filter, in the order it is drawn: every group alphabetically with
 * its own projects indented under it, then every project in no group.
 *
 * One home for that order, and it is a pure function of two lists — the sidebar
 * and the sheet on a phone are the same component, but the rule is worth being
 * able to reason about without a render.
 *
 * **Membership is resolved through `projects`, never read off the group.** One
 * lookup answers three different situations at once, and all three are ordinary:
 * a member whose transcripts `~/.claude` has swept, a member hidden in Settings,
 * and a member that is the auto-reload folder. None of them is drawn, and none
 * of them is removed from the stored group either — a project can come back, and
 * the group is the user's to edit.
 *
 * Two consequences worth stating because getting either wrong is invisible:
 *
 * - **The count is the surviving members' count**, not the stored list's length,
 *   or a group would advertise sessions that are not in the list below it.
 * - **A group with nothing left in it is not drawn at all.** Its checkbox would
 *   be one whose "everything is ticked" is vacuously true — so it would render
 *   as CHECKED while nothing is selected — and whose click did nothing. It stays
 *   in Settings, which is where it can be deleted.
 */
export function projectFilterRows(projects: ProjectInfo[], groups: ProjectGroup[]): ProjectFilterRow[] {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const grouped = new Set<string>();
  const rows: ProjectFilterRow[] = [];

  const sortedGroups = [...groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  for (const group of sortedGroups) {
    const members: ProjectInfo[] = [];
    for (const key of group.projects) {
      // `grouped` is marked for every stored member, present or not: the key
      // belongs to this group whether or not there is a project behind it today,
      // and marking only the survivors would put a project that comes back into
      // the ungrouped list instead of into its group.
      grouped.add(key);
      const project = byKey.get(key);
      if (project) members.push(project);
    }
    if (members.length === 0) continue;
    const sorted = sortProjectsByName(members);
    rows.push({
      kind: 'group',
      id: group.id,
      name: group.name,
      count: sorted.reduce((n, p) => n + p.sessionCount, 0),
      keys: sorted.map((p) => p.key),
    });
    for (const project of sorted) rows.push({ kind: 'project', project, indented: true });
  }

  for (const project of sortProjectsByName(projects)) {
    if (grouped.has(project.key)) continue;
    rows.push({ kind: 'project', project, indented: false });
  }
  return rows;
}

/**
 * Which group a project is in, for the editor in Settings.
 *
 * Reads the same way round as `projectFilterRows` — the groups are the authority
 * on membership, a project knows nothing about it — so the two cannot disagree
 * about who owns a key.
 */
export function groupOfProject(groups: ProjectGroup[], key: string): ProjectGroup | undefined {
  return groups.find((g) => g.projects.includes(key));
}
