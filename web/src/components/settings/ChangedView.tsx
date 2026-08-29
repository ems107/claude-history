import type { AppSettings } from '@claude-history/shared';
import { Link } from 'react-router';
import { AREAS, changedSettings, valueText } from '../../lib/settingsCatalog.ts';
import { actionClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';

/**
 * Everything that is not at its default, in one list.
 *
 * `DefaultBadge` has always known this one setting at a time, and one setting at
 * a time was the only way to ask: "what have I changed here?" meant scanning
 * thirty-two rows across six areas. The catalogue already holds the names and
 * the spellings, so the whole view is a filter over it.
 *
 * The two fields marked `noDefault` are absent by the same rule that keeps their
 * marker off: the auto-reload folder and the voice have defaults that cannot be
 * restored by a click, so listing them under a Restore button would be an offer
 * this cannot keep.
 */
export function ChangedView() {
  const { settings, defaults, save } = useSettingsPage();
  const changed = changedSettings(settings, defaults);

  if (changed.length === 0) {
    return (
      <p className="text-xs text-[var(--text-dim)]">
        Every setting is at the value this server starts from. Change one and it appears here.
      </p>
    );
  }

  const restoreAll = () => {
    const patch: Partial<AppSettings> = {};
    for (const c of changed) Object.assign(patch, { [c.field]: c.fallback });
    if (!confirm(`Put all ${changed.length} of these back to their defaults?`)) return;
    // One request, so it is one refusal if the app is running Claude — the
    // chat settings are in here like any other, and the dialog offers to close
    // the sessions and run it again.
    save(patch);
  };

  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--text-dim)]">
          {changed.length} setting{changed.length === 1 ? '' : 's'} differ{changed.length === 1 ? 's' : ''} from the
          default.
        </span>
        <button type="button" className={`${actionClass} ml-auto`} onClick={restoreAll}>
          Restore all
        </button>
      </div>

      {AREAS.map((area) => {
        const rows = changed.filter((c) => c.area === area.id);
        if (rows.length === 0) return null;
        return (
          <section key={area.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4">
            <h2 className="mb-3 text-sm font-semibold">{area.title}</h2>
            <div className="space-y-2 text-xs">
              {rows.map((row) => {
                const spell = row.entry.format ?? valueText;
                return (
                  <div key={row.entry.id} className="flex items-baseline gap-3">
                    <Link
                      to={`/settings/${area.id}#${row.entry.id}`}
                      // The row is a way BACK to the setting, not just a report
                      // of it: the list answers "what did I change", and the
                      // next question is always "where is that".
                      className="min-w-0 flex-1 truncate hover:text-[var(--accent)]"
                      title={`${row.group.title} — go to it`}
                    >
                      {row.entry.label}
                    </Link>
                    <span className="shrink-0 font-mono text-[11px]">
                      <span className="text-[var(--text)]">{spell(row.value)}</span>
                      <span className="text-[var(--text-dim)]"> was {spell(row.fallback)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => save({ [row.field]: row.fallback } as Partial<AppSettings>)}
                      title={`Put ${spell(row.fallback)} back`}
                      className="shrink-0 cursor-pointer rounded border border-transparent px-1.5 py-px text-[10px] text-[var(--text-dim)] hover:border-[var(--border)] hover:text-[var(--text)]"
                    >
                      restore
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
