import type { AppSettings, ProjectGroup, ProjectInfo } from '@claude-history/shared';
import { PROJECT_GROUP_NAME_MAX } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { groupOfProject, sortProjectsByName } from '../../lib/projects.ts';
import { entryForField } from '../../lib/settingsCatalog.ts';
import { actionClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';
import { DefaultBadge, Explain, Field, GroupCard, Hint, hintClass, inputClass, selectClass } from './controls.tsx';

/**
 * Which projects this app shows, and how they are grouped in the filters.
 *
 * Two blocks about the same list of projects, and still two settings: one
 * decides what EXISTS as far as the rest of the app is concerned, the other only
 * decides how what exists is arranged in one panel. Nothing here narrows
 * anything by itself — a group is presentation, and the filter selection stays
 * in the URL where it always was.
 *
 * It reads `['projects', 'all']` rather than `['projects']`, which is the only
 * list in the app that includes a hidden project: this page is where a hidden
 * project is brought back from, so it is the one place that has to be able to
 * see one. The prefix is shared on purpose — every `invalidateQueries(['projects'])`
 * already in the app refreshes this list too.
 */
export function ProjectsArea() {
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: api.projectsAll });
  return (
    <>
      <GroupCard id="projects-visible">
        <VisibleProjects projects={projects.data} loading={projects.isLoading} />
      </GroupCard>
      <GroupCard id="projects-groups">
        <Groups projects={projects.data} />
      </GroupCard>
    </>
  );
}

/** A row in the "shown" list: a project, or a hidden key with nothing behind it. */
interface VisibleRow {
  key: string;
  name: string;
  path: string;
  /** Null for a key with no project behind it — there is no tag to colour. */
  color: string | null;
  /** Null for the same reason: nothing on disk to count. */
  count: number | null;
}

/**
 * A checkbox per project, ticked when it is shown.
 *
 * **Ticked means shown, and everything starts ticked.** The setting stores what
 * is HIDDEN, so a project that appears tomorrow appears in the list rather than
 * waiting to be granted — but a list of things to switch OFF reads backwards, so
 * what is drawn is the positive and what is stored is the exception.
 *
 * A hidden key with no project behind it still gets a row, dim and with no
 * count: `~/.claude` sweeps a project's transcripts on its own schedule, and a
 * setting that cannot be edited from the page that owns it is one you have to
 * open `userdata.json` for. Nothing prunes those keys — the folder is still
 * there and the sessions can come back.
 */
function VisibleProjects({ projects, loading }: { projects: ProjectInfo[] | undefined; loading: boolean }) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField('hiddenProjects');
  const hidden = new Set(settings.hiddenProjects);

  const rows: VisibleRow[] = sortProjectsByName(projects ?? []).map((p) => ({
    key: p.key,
    name: p.name,
    path: p.path,
    color: p.color,
    count: p.sessionCount,
  }));
  const known = new Set(rows.map((r) => r.key));
  for (const key of settings.hiddenProjects) {
    if (!known.has(key)) rows.push({ key, name: key, path: key, color: null, count: null });
  }

  const setShown = (key: string, shown: boolean) => {
    save({
      hiddenProjects: shown ? settings.hiddenProjects.filter((k) => k !== key) : [...settings.hiddenProjects, key],
    });
  };

  return (
    <Field id={entry?.id} badge={<DefaultBadge field="hiddenProjects" />}>
      <div className="flex items-baseline gap-2">
        <span>
          {hidden.size === 0
            ? 'Every project is shown.'
            : `${String(hidden.size)} of ${String(rows.length)} projects hidden.`}
          <Hint>Hidden means out of the list, the filters, the counts, search, the stats and the prompts page.</Hint>
        </span>
        {hidden.size > 0 && (
          <button
            type="button"
            className={`${actionClass} ml-auto shrink-0`}
            onClick={() => save({ hiddenProjects: [] })}
          >
            Show all
          </button>
        )}
      </div>

      {loading ? (
        <p className={`mt-2 ${hintClass}`}>Reading the projects…</p>
      ) : rows.length === 0 ? (
        <p className={`mt-2 ${hintClass}`}>No projects yet.</p>
      ) : (
        /* Capped and scrolling: forty rows would make every other block on this
           page something you scroll past to reach. */
        <div className="mt-2 max-h-96 overflow-y-auto rounded border border-[var(--border)]">
          {rows.map((row) => (
            <label
              key={row.key}
              title={row.path}
              className="flex cursor-pointer items-center gap-2 px-2 py-1 select-none hover:bg-[var(--bg-hover)] max-md:min-h-11"
            >
              <input
                type="checkbox"
                checked={!hidden.has(row.key)}
                onChange={(e) => setShown(row.key, e.target.checked)}
                className="accent-[var(--accent)] max-md:size-5"
              />
              <span
                className="size-2 shrink-0 rounded-full"
                style={row.color ? { backgroundColor: row.color } : { border: '1px solid var(--border)' }}
              />
              <span className={`min-w-0 flex-1 truncate ${row.count === null ? 'text-[var(--text-dim)]' : ''}`}>
                {row.name}
              </span>
              <span className="shrink-0 text-[10px] text-[var(--text-dim)]">
                {row.count === null ? 'no sessions on disk' : row.count}
              </span>
            </label>
          ))}
        </div>
      )}

      <Explain>
        <p>
          Nothing is deleted and nothing is refused: a link straight to one of a hidden project&apos;s conversations
          still opens it, and you can still start a session in that folder. What hiding changes is what this app puts in
          front of you when you are browsing — and the bell, which stops announcing stops from a project you asked not
          to see.
        </p>
        <p>
          The auto-reload folder is not in this list. It has a switch of its own under <em>Claude</em>, and a checkbox
          here that another setting silently overrode would be a checkbox that lies.
        </p>
      </Explain>
    </Field>
  );
}

/**
 * A new group's id.
 *
 * NOT `crypto.randomUUID()`, which is secure-context only and therefore
 * undefined the moment this page is opened from another machine over plain HTTP
 * — the same trap `navigator.clipboard` sets, and the reason `copyPlain` exists.
 * The id is never shown and never parsed; it only has to be unlike the others.
 */
function newGroupId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** "New group", then "New group 2" — a name you can find in order to change it. */
function newGroupName(groups: ProjectGroup[]): string {
  const taken = new Set(groups.map((g) => g.name));
  if (!taken.has('New group')) return 'New group';
  for (let n = 2; ; n++) {
    const name = `New group ${String(n)}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * The groups, in the order they were made.
 *
 * **Authoring order here, alphabetical in the filters**, and the difference is
 * not an oversight: a list sorted by name re-sorts itself while the name is
 * being typed, which unmounts the input in the middle of a word. This is also
 * the whole of what `ProjectGroup.id` is for — the rows are keyed on it, so a
 * rename is a value changing rather than a row being replaced.
 */
function Groups({ projects }: { projects: ProjectInfo[] | undefined }) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField('projectGroups');
  const groups = settings.projectGroups;
  const byKey = new Map((projects ?? []).map((p) => [p.key, p]));
  const hidden = new Set(settings.hiddenProjects);

  const write = (next: ProjectGroup[]) => save({ projectGroups: next } as Partial<AppSettings>);
  const rename = (id: string, name: string) => write(groups.map((g) => (g.id === id ? { ...g, name } : g)));
  const take = (key: string) => write(groups.map((g) => ({ ...g, projects: g.projects.filter((k) => k !== key) })));
  const remove = (group: ProjectGroup) => {
    if (group.projects.length > 0 && !confirm(`Delete "${group.name}"? Its projects go back to being ungrouped.`)) {
      return;
    }
    write(groups.filter((g) => g.id !== group.id));
  };
  /** One project, one group: joining a group is also leaving whichever it was in. */
  const assign = (key: string, groupId: string) =>
    write(
      groups.map((g) => ({
        ...g,
        projects: g.id === groupId ? [...g.projects.filter((k) => k !== key), key] : g.projects.filter((k) => k !== key),
      })),
    );

  const ungrouped = sortProjectsByName((projects ?? []).filter((p) => !groupOfProject(groups, p.key)));

  return (
    <Field id={entry?.id} badge={<DefaultBadge field="projectGroups" />}>
      <div className="flex items-baseline gap-2">
        <span>
          {groups.length === 0 ? 'No groups.' : `${String(groups.length)} group${groups.length === 1 ? '' : 's'}.`}
          <Hint>
            In the filters a group is one checkbox that ticks every project under it. It narrows nothing itself.
          </Hint>
        </span>
        <button
          type="button"
          className={`${actionClass} ml-auto shrink-0`}
          onClick={() => write([...groups, { id: newGroupId(), name: newGroupName(groups), projects: [] }])}
        >
          New group
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.id} className="mt-2 rounded border border-[var(--border)] p-2">
          <div className="flex items-center gap-2">
            <GroupName value={group.name} onCommit={(name) => rename(group.id, name)} />
            <span className="shrink-0 text-[10px] text-[var(--text-dim)]">
              {group.projects.length === 1 ? '1 project' : `${String(group.projects.length)} projects`}
            </span>
            <button
              type="button"
              onClick={() => remove(group)}
              title={`Delete "${group.name}"`}
              className="shrink-0 cursor-pointer rounded border border-transparent px-1.5 py-px text-[10px] text-[var(--text-dim)] hover:border-red-500/40 hover:text-red-300"
            >
              Delete
            </button>
          </div>
          {group.projects.length === 0 ? (
            <p className={`mt-1 pl-1 ${hintClass}`}>Empty — add a project from the list below.</p>
          ) : (
            <div className="mt-1">
              {group.projects.map((key) => {
                const project = byKey.get(key);
                return (
                  <div
                    key={key}
                    title={project?.path ?? key}
                    className="flex items-center gap-2 py-0.5 pl-4 max-md:min-h-9"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={project ? { backgroundColor: project.color } : { border: '1px solid var(--border)' }}
                    />
                    <span className={`min-w-0 flex-1 truncate ${project ? '' : 'text-[var(--text-dim)]'}`}>
                      {project?.name ?? key}
                    </span>
                    {/* Both reasons a member is not drawn in the filters, said
                        where it can be acted on rather than left to be found. */}
                    {!project && (
                      <span className="shrink-0 text-[10px] text-[var(--text-dim)]">no sessions on disk</span>
                    )}
                    {project && hidden.has(key) && (
                      <span className="shrink-0 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--text-dim)]">
                        hidden
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => take(key)}
                      title="Take it out of this group"
                      className="shrink-0 cursor-pointer rounded border border-transparent px-1.5 text-[11px] text-[var(--text-dim)] hover:border-[var(--border)] hover:text-[var(--text)]"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <p className="text-[var(--text)]">Not in a group</p>
        {ungrouped.length === 0 ? (
          <p className={`mt-1 ${hintClass}`}>
            {projects === undefined ? 'Reading the projects…' : 'Every project is in a group.'}
          </p>
        ) : (
          <div className="mt-1 max-h-72 overflow-y-auto">
            {ungrouped.map((p) => (
              <div key={p.key} title={p.path} className="flex items-center gap-2 py-0.5 max-md:min-h-11">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {hidden.has(p.key) && (
                  <span className="shrink-0 rounded border border-[var(--border)] px-1 text-[10px] text-[var(--text-dim)]">
                    hidden
                  </span>
                )}
                {/* A select rather than a drag: there is no ordering to express,
                    only which of a handful of groups this belongs to. Its value
                    stays empty because it is an ACTION and not a state — the row
                    leaves this list the moment it is used. */}
                <select
                  value=""
                  disabled={groups.length === 0}
                  onChange={(e) => assign(p.key, e.target.value)}
                  aria-label={`Add ${p.name} to a group`}
                  className={`${selectClass} shrink-0 text-[11px]`}
                >
                  <option value="">{groups.length === 0 ? 'no groups yet' : 'add to…'}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      <Explain>
        <p>
          A group exists to make one gesture out of several projects that are always read together — the clones of one
          repository, or the repositories of one product. In the filter panel it is drawn as a checkbox with its
          projects indented under it: ticking it ticks all of them, and each of them can still be ticked on its own.
        </p>
        <p>
          <strong>A project belongs to one group at most.</strong> Adding it to a group takes it out of whichever it was
          in, which is what lets the panel read as it does: every group with its own projects, then everything left
          over. Groups are alphabetical there and in the order you made them here, so a rename does not move the row
          you are typing in.
        </p>
        <p>
          Nothing here changes what a URL means. The filters carry project keys exactly as they always did, so a link
          you copied still selects the same projects after the group behind it is renamed or deleted. A group with
          nothing left in it — every member hidden, or swept from disk — is not drawn in the filters at all, and stays
          here so it can be deleted.
        </p>
      </Explain>
    </Field>
  );
}

/**
 * A group's name, committed on blur or Enter and reverted by Escape.
 *
 * Saving per keystroke would be one request and one `userdata.json` write per
 * letter, which is the rule `TextField` exists to state. It cannot BE a
 * `TextField`: that one is bound to a whole settings field, and this edits one
 * name inside an array.
 */
function GroupName({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const name = draft.trim();
    // An empty name would be a row with nothing to click, and the server drops
    // such a group rather than storing it — so the box goes back to the name it
    // had instead of pretending the edit landed.
    if (!name) {
      setDraft(value);
      return;
    }
    if (name !== value) onCommit(name);
  };
  return (
    <input
      type="text"
      value={draft}
      maxLength={PROJECT_GROUP_NAME_MAX}
      spellCheck={false}
      aria-label="Group name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') setDraft(value);
      }}
      className={`min-w-0 flex-1 ${inputClass}`}
    />
  );
}
