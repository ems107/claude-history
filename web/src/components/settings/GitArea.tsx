import type { AppSettings, GitModeLabel } from '@claude-history/shared';
import {
  GIT_FETCH_LABELS,
  GIT_FETCH_MODES,
  GIT_MERGE_LABELS,
  GIT_MERGE_MODES,
  GIT_PULL_LABELS,
  GIT_PULL_MODES,
  GIT_PUSH_LABELS,
  GIT_PUSH_MODES,
} from '@claude-history/shared';
import { Link } from 'react-router';
import { selectClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';
import { DefaultBadge, Field, GroupCard, Hint } from './controls.tsx';
import { GitReposPanel } from './GitReposPanel.tsx';

/**
 * One row per git button, and the command each choice runs written into the
 * option itself.
 *
 * `SelectField` is not used here, and that is the one thing worth explaining:
 * it spells an option with its stored value, which for these is `all-prune` —
 * a key, and the one thing nobody comes to this page to read. The question is
 * "what happens when I press Fetch", so the option says `git fetch --prune
 * --all — every remote, and drop the branches somebody deleted`. The same
 * escape hatch `ProjectsArea` takes for its own select, and the text comes from
 * `shared/src/git.ts` so this page and the `▾` beside the button cannot come to
 * disagree about what a mode means.
 */
function ModeRow({
  id,
  field,
  verb,
  modes,
  labels,
}: {
  id: string;
  field: keyof AppSettings;
  verb: string;
  modes: readonly string[];
  labels: Record<string, GitModeLabel>;
}) {
  const { settings, save } = useSettingsPage();
  return (
    <Field id={id} badge={<DefaultBadge field={field} />}>
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[var(--text-dim)]">{verb}</span>
        <select
          value={settings[field] as string}
          onChange={(e) => save({ [field]: e.target.value } as Partial<AppSettings>)}
          className={`${selectClass} min-w-0 flex-1`}
        >
          {modes.map((mode) => (
            <option key={mode} value={mode}>
              {labels[mode].command} — {labels[mode].gist}
            </option>
          ))}
        </select>
      </label>
    </Field>
  );
}

/**
 * The Git tab's two settings: what its buttons do, and what they do it to.
 *
 * They are one area because they are the same question asked twice — which
 * repositories, and what happens when you press something in them — and
 * because everything else about the tab is decided in the tab itself.
 */
export function GitArea() {
  return (
    <>
      <GroupCard id="git-buttons">
        <ModeRow id="set-gitFetchDefault" field="gitFetchDefault" verb="Fetch" modes={GIT_FETCH_MODES} labels={GIT_FETCH_LABELS} />
        <ModeRow id="set-gitPullDefault" field="gitPullDefault" verb="Pull" modes={GIT_PULL_MODES} labels={GIT_PULL_LABELS} />
        <ModeRow id="set-gitPushDefault" field="gitPushDefault" verb="Push" modes={GIT_PUSH_MODES} labels={GIT_PUSH_LABELS} />
        <ModeRow id="set-gitMergeDefault" field="gitMergeDefault" verb="Merge" modes={GIT_MERGE_MODES} labels={GIT_MERGE_LABELS} />
        <Hint>
          Only the main click. Every one of those buttons carries a <span className="text-[var(--text)]">▾</span> that
          offers the others without changing anything here, each showing the exact command it runs. The server applies
          the choice above whenever a request names no mode, so there is one answer to what Pull does in this app rather
          than one per button. Force pushing and deleting a remote branch are deliberately absent: they live in that
          menu, behind their confirmation, and nothing that cannot be undone may become what a button does by default.
        </Hint>
      </GroupCard>

      <GroupCard id="git-repos">
        <GitReposPanel />
        <Hint>
          Nothing here reaches the network on its own:{' '}
          <Link to="/git" className="text-[var(--accent)] hover:underline">
            the Git tab
          </Link>{' '}
          fetches, pulls and pushes only when you press one of those buttons.
        </Hint>
      </GroupCard>
    </>
  );
}
