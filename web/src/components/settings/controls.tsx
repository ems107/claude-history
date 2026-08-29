import type { AppSettings } from '@claude-history/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { entryForField, findGroup } from '../../lib/settingsCatalog.ts';
import { Fold } from '../Fold.tsx';
import { useSettingsPage } from './context.ts';

/**
 * The shapes every settings row is built from.
 *
 * All of them read the page's context rather than taking `settings` and `save`,
 * which is what keeps an area file a list of what exists instead of a list of
 * what has to be threaded through. A preference row takes ONE prop — the field —
 * and finds its own id and its own name in `lib/settingsCatalog.ts`.
 */

/** Classes three kinds of input share, so a rework touches one line. */
export const inputClass =
  'rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 disabled:opacity-40 focus:border-[var(--text-dim)] focus:outline-none';
export const numberClass = `w-20 text-right ${inputClass}`;
export const selectClass =
  'cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 disabled:opacity-40';

/**
 * One group of settings, as a card with its heading.
 *
 * The heading comes from the catalogue, not from a prop: the rail draws the same
 * words to navigate by, and two copies would be two chances to disagree about
 * what this block is called. The `id` is what a deep link and a search hit land
 * on, and `scroll-mt` keeps the heading clear of the panel's top edge.
 */
export function GroupCard({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  const { flashed } = useSettingsPage();
  const group = findGroup(id);
  return (
    <section
      id={id}
      data-settings-group={id}
      className={`scroll-mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4 ${
        flashed === id ? 'anchor-flash' : ''
      }`}
    >
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{group?.title ?? id}</h2>
        {aside}
      </div>
      <div className="space-y-3 text-xs">{children}</div>
    </section>
  );
}

/**
 * A run of rows under a line of their own, inside a group.
 *
 * For the one case a group cannot express: the usage triggers, which are four
 * switches that only mean anything under the sentence "Re-read the figures:".
 * Anything that needed a heading AND an anchor became a group instead.
 */
export function Subgroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-t border-[var(--border)] pt-3">
      <p className="text-[var(--text)]">{title}</p>
      {children}
    </div>
  );
}

/**
 * A row: whatever control it holds, its "changed from default" marker aligned on
 * the first line, and the id search and the anchors aim at.
 *
 * The marker is a sibling of the control rather than a child, because a button
 * inside a `<label>` has its click taken by the label's own input.
 */
export function Field({ id, badge, children }: { id?: string; badge?: ReactNode; children: ReactNode }) {
  const { flashed } = useSettingsPage();
  return (
    <div
      id={id}
      className={`flex scroll-mt-16 items-start justify-between gap-3 rounded ${
        flashed === id ? 'anchor-flash' : ''
      }`}
    >
      <div className="min-w-0">{children}</div>
      {badge}
    </div>
  );
}

const asText = (v: boolean | number | string): string => {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v || 'empty';
  return String(v);
};

/**
 * Shown only beside a setting that no longer holds its default, and clicking it
 * puts the default back. It spells the default out because that is the question
 * the marker raises ("changed from what?"), which also saves documenting the
 * defaults anywhere else.
 */
export function DefaultBadge<K extends keyof AppSettings>({
  field,
  format,
}: {
  field: K;
  /**
   * For a field whose STORED value is not what the UI calls it. `asText` spells
   * the default out, which is the whole job of this badge — but `inherit` is a
   * word the settings page shows nowhere else, and "default inherit" would be
   * the same jargon that had to come out of the tone dropdown.
   */
  format?: (v: AppSettings[K]) => string;
}) {
  const { settings, defaults, save } = useSettingsPage();
  const value = settings[field];
  const fallback = defaults[field];
  // The two fields whose default cannot be restored by a click say so in the
  // catalogue, and the marker is the thing that must not appear for them.
  if (entryForField(field)?.noDefault) return null;
  if (value === fallback) return null;
  const shown = format ? format(fallback) : asText(fallback);
  return (
    <button
      type="button"
      onClick={() => save({ [field]: fallback } as Partial<AppSettings>)}
      title={`Changed from the default. Click to restore it (${shown}).`}
      className="flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded border border-transparent px-1.5 py-px text-[10px] text-[var(--text-dim)] hover:border-[var(--border)] hover:text-[var(--text)]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
      default {shown}
    </button>
  );
}

/** The label and hint of a preference, in the shape a checkbox wants them. */
function LabelText({ label, hint }: { label: string; hint?: string }) {
  return (
    <span>
      {label}
      {hint && <span className="block text-[11px] text-[var(--text-dim)]">{hint}</span>}
    </span>
  );
}

/**
 * A boolean preference. One prop names it; the label and the id come from the
 * catalogue, and the marker draws itself.
 *
 * `children` is for what belongs UNDER a switch and inside its row — the tone
 * that goes with a kind of notification, the cadence that goes with a trigger.
 * Indented to where the label starts, and outside the `<label>` so its own
 * clicks are its own.
 */
export function ToggleField({
  field,
  hint,
  disabled,
  children,
}: {
  field: keyof AppSettings & string;
  hint?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField(field);
  const checked = settings[field] === true;
  return (
    <Field id={entry?.id} badge={<DefaultBadge field={field} />}>
      <label className={`flex items-start gap-2 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => save({ [field]: e.target.checked } as Partial<AppSettings>)}
          className="mt-0.5 accent-[var(--accent)]"
        />
        <LabelText label={entry?.label ?? field} hint={hint} />
      </label>
      {children && <div className="mt-1 ml-6 flex items-start gap-2">{children}</div>}
    </Field>
  );
}

/**
 * A number inside a sentence — "Check every `[10]` minutes (minimum 5)".
 *
 * The sentence is the row's own, and the catalogue holds the NAME of the setting
 * for the search and the changed-list to use. They are two different facts about
 * the same row, which is why neither is derived from the other.
 */
export function NumberField({
  field,
  before,
  after,
  min,
  max,
  step,
  disabled,
  note,
}: {
  field: keyof AppSettings & string;
  before: string;
  after?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** A line under the sentence, for a number whose consequences are not obvious. */
  note?: ReactNode;
}) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField(field);
  return (
    <Field id={entry?.id} badge={<DefaultBadge field={field} />}>
      <label className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
        <span>{before}</span>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={settings[field] as number}
          disabled={disabled}
          onChange={(e) => save({ [field]: Number(e.target.value) } as Partial<AppSettings>)}
          className={numberClass}
        />
        {after && <span>{after}</span>}
      </label>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-dim)]">{note}</p>}
    </Field>
  );
}

/** A preference chosen from a short, fixed list, also inside a sentence. */
export function SelectField({
  field,
  before,
  after,
  options,
  disabled,
}: {
  field: keyof AppSettings & string;
  before: string;
  after?: ReactNode;
  options: readonly string[];
  disabled?: boolean;
}) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField(field);
  return (
    <Field id={entry?.id} badge={<DefaultBadge field={field} />}>
      <label className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
        <span>{before}</span>
        <select
          value={settings[field] as string}
          disabled={disabled}
          onChange={(e) => save({ [field]: e.target.value } as Partial<AppSettings>)}
          className={selectClass}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {after}
      </label>
    </Field>
  );
}

/**
 * A text preference. Unlike everything above it does NOT save on every
 * keystroke — that would be one request, and one `userdata.json` write, per
 * letter typed. It commits on blur or on Enter, and Escape puts the saved value
 * back.
 */
export function TextField({
  field,
  label,
  placeholder,
  mono,
  disabled,
}: {
  field: keyof AppSettings & string;
  /** Overrides the catalogue's name, for the one row whose label carries a note. */
  label?: ReactNode;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField(field);
  const value = settings[field] as string;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) save({ [field]: draft } as Partial<AppSettings>);
  };
  return (
    <Field id={entry?.id} badge={<DefaultBadge field={field} />}>
      <label className={`block ${disabled ? 'opacity-40' : ''}`}>
        <span className="mb-1 block">{label ?? entry?.label ?? field}</span>
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') setDraft(value);
          }}
          className={`w-full ${inputClass} ${mono ? 'font-mono text-[11px]' : ''}`}
        />
      </label>
    </Field>
  );
}

/**
 * A group of mutually exclusive choices, each with a line of explanation.
 *
 * A `<select>` would have been fewer pixels and the wrong shape: these are not
 * values of one thing, they are different features, and what separates them is
 * the sentence underneath — which a dropdown cannot show until it is open, and
 * then only one at a time.
 */
export function RadioField<T extends string>({
  field,
  name,
  options,
  disabled,
}: {
  field: keyof AppSettings & string;
  name: string;
  options: { value: T; label: string; hint: string }[];
  disabled?: boolean;
}) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField(field);
  const value = settings[field] as T;
  return (
    <Field id={entry?.id} badge={<DefaultBadge field={field} />}>
      <div className={disabled ? 'opacity-40' : ''}>
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex items-baseline gap-2 rounded px-1 py-0.5 select-none ${
              disabled ? '' : 'cursor-pointer hover:bg-[var(--bg-hover)]'
            }`}
          >
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => save({ [field]: option.value } as Partial<AppSettings>)}
              className="accent-[var(--accent)]"
            />
            <LabelText label={option.label} hint={option.hint} />
          </label>
        ))}
      </div>
    </Field>
  );
}

/**
 * State rather than preference: what something IS doing, in the two columns the
 * page already used for it in three places before this existed.
 *
 * Monospace and dim on purpose. A readout that looked like a setting was half of
 * what made the old page unreadable — ten cards in one column, and no way to
 * tell what you could change from what you were merely being told.
 */
export function Readout({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--text-dim)]">{children}</div>;
}

export function ReadoutRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="opacity-60">{label}</span>
      <span className="break-all">{children}</span>
    </>
  );
}

/**
 * The long explanation, folded away at the foot of its group.
 *
 * Every one of these used to sit in the flow, so reading a page of switches
 * meant reading four essays about prompt caches and rate limits on the way. The
 * words are unchanged and one click away — what changed is that they no longer
 * stand between you and the volume slider.
 */
export function Explain({ label = 'How it works', children }: { label?: string; children: ReactNode }) {
  return (
    <div className="pt-1">
      <Fold label={label}>
        <div className="space-y-2 text-[11px] leading-relaxed text-[var(--text-dim)]">{children}</div>
      </Fold>
    </div>
  );
}
