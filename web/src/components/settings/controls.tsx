import type { AppSettings } from '@claude-history/shared';
import { type ReactNode, useEffect, useState } from 'react';
import { entryForField, findGroup, valueText } from '../../lib/settingsCatalog.ts';
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
 * A switch, for the one setting a whole block hangs off.
 *
 * A checkbox is what every OTHER setting here wears, and that was the problem:
 * the control that turns a feature off looked exactly like the eight controls it
 * turns off with it. This one is a different shape, so the hierarchy is visible
 * before a word of it is read.
 *
 * `role="switch"` and not a checkbox, because that is what it is: a screen
 * reader says "on/off" rather than "checked", which is the same distinction the
 * shape is making.
 */
export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-[15px] w-[26px] shrink-0 rounded-full border transition-colors disabled:cursor-default disabled:opacity-40 ${
        checked ? 'cursor-pointer border-[var(--accent-dim)] bg-[var(--accent)]/25' : 'cursor-pointer border-[var(--border)] bg-[var(--bg)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] h-[9px] w-[9px] rounded-full transition-all ${
          checked ? 'left-[14px] bg-[var(--accent)]' : 'left-[2px] bg-[var(--text-dim)]'
        }`}
      />
    </button>
  );
}

/**
 * One group of settings, as a card with its heading — and, where the group is a
 * FEATURE, the switch that turns it on.
 *
 * The heading comes from the catalogue, not from a prop: the rail draws the same
 * words to navigate by, and two copies would be two chances to disagree about
 * what this block is called. The `id` is what a deep link and a search hit land
 * on, and `scroll-mt` keeps the heading clear of the panel's top edge.
 *
 * **`master` is what stops a dead block from being a mystery.** Before it, the
 * switch was the first of nine identical checkboxes and the other eight simply
 * went pale — a wall of unreadable grey with nothing saying why. Now the switch
 * is a switch, a rule separates it from what it governs, and `offNote` says in
 * one line what "off" actually means. Nothing is hidden: everything stays
 * readable and stays findable, which is what a deep link and the search box need
 * of it.
 */
export function GroupCard({
  id,
  children,
  aside,
  master,
  masterHint,
  offNote,
  inactive,
}: {
  id: string;
  children: ReactNode;
  aside?: ReactNode;
  /** The boolean this whole group hangs off, drawn as a switch above the rule. */
  master?: keyof AppSettings & string;
  /** The master's own line of explanation. */
  masterHint?: string;
  /** What "off" means, in one line. Shown only while it is off. */
  offNote?: string;
  /**
   * This group is governed by a switch in ANOTHER group, and that switch is off.
   *
   * A boolean and not a sentence, deliberately: the sentence belongs beside the
   * switch, once. Repeating it over every group it governs was the first cut of
   * this and it read worse than the wall it replaced — three identical boxes
   * saying the same thing, none of them next to the control that would fix it.
   * What a governed group needs is a MARK, and the explanation is one group up.
   */
  inactive?: boolean;
}) {
  const { settings, save, flashed, selected } = useSettingsPage();
  const group = findGroup(id);
  const entry = master ? entryForField(master) : undefined;
  const on = master ? settings[master] === true : true;
  const dead = inactive || (master !== undefined && !on);
  return (
    <section
      id={id}
      data-settings-group={id}
      // `data-selected` is the viewer's own ring, from `styles.css`, and it is an
      // OUTLINE where the flash is a box-shadow — deliberately, so a link's
      // flash fades to reveal the steady ring underneath instead of taking it
      // away with it.
      {...(selected === id ? { 'data-selected': '' } : {})}
      className={`scroll-mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4 ${
        flashed === id ? 'anchor-flash' : ''
      }`}
    >
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className={`text-sm font-semibold ${dead ? 'text-[var(--text-dim)]' : ''}`}>{group?.title ?? id}</h2>
        {/* Only where the switch is somewhere else. A group holding its own
            master says "off" three times otherwise — the switch, this chip and
            the note under it — and the switch is the one that can be acted on. */}
        {inactive && (
          <span className="rounded border border-[var(--border)] px-1 text-[10px] tracking-wider text-[var(--text-dim)] uppercase">
            off
          </span>
        )}
        {aside}
      </div>

      {master && (
        <div className="mb-3 border-b border-[var(--border)] pb-3 text-xs">
          <Field id={entry?.id} badge={<DefaultBadge field={master} />}>
            <div className="flex items-start gap-2.5">
              <Switch checked={on} onChange={(v) => save({ [master]: v } as Partial<AppSettings>)} />
              <span>
                <span className={on ? 'text-[var(--text)]' : ''}>{entry?.label ?? master}</span>
                {masterHint && <Hint>{masterHint}</Hint>}
              </span>
            </div>
          </Field>
        </div>
      )}

      {/* Said once, beside the switch that would change it — never repeated over
          the other groups the same switch happens to govern.

          The BOX takes the sentence's width rather than the card's. Capping the
          text inside a full-width box was tried first and read worse than
          either: three wrapped lines with 600 px of empty border beside them. */}
      {master && !on && offNote && (
        <p className="mb-3 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--text-dim)]">
          {offNote}
        </p>
      )}

      <div className="space-y-4 text-xs">{children}</div>
    </section>
  );
}

/**
 * A run of rows under a line of their own, inside a group.
 *
 * For what a group cannot express: the usage triggers, which are four switches
 * that only mean anything under the sentence "Re-read the figures:", and the two
 * buttons at the foot of *This instance* that do not undo themselves. Anything
 * that needed a heading AND an anchor became a group instead.
 *
 * `tone="danger"` is the second of those: a red rule and a red heading, which is
 * the separation *Stop server* and *Uninstall* were always after. They spent a
 * while as a whole area of their own and that was too much — a destination in
 * the rail for two buttons, exiled from the block naming the install they
 * remove.
 */
export function Subgroup({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: 'danger';
  children: ReactNode;
}) {
  const danger = tone === 'danger';
  return (
    <div className={`space-y-2 border-t pt-3 ${danger ? 'border-red-500/30' : 'border-[var(--border)]'}`}>
      <p className={danger ? 'font-semibold text-red-300' : 'text-[var(--text)]'}>{title}</p>
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
      {/* `flex-1`, or a `w-full` input inside shrinks to its own content: the
          text fields came out 160 px wide the first time this was written. The
          badge still sits at the right edge — that is `justify-between`'s job
          and it does not need this side to be content-sized to do it. */}
      <div className="min-w-0 flex-1">{children}</div>
      {badge}
    </div>
  );
}

/**
 * A block that is not a preference row but can still be linked to — the
 * credentials form, the firewall rule, the list of copies, the paths.
 *
 * `Field` would have done the job and brought a flex row and a badge slot with
 * it, neither of which any of these wants. What they share with a row is only
 * this: an id search can aim at, and the flash that says it arrived.
 */
export function Anchored({
  id,
  className = '',
  children,
}: {
  id: string;
  /** Takes the box's own classes over, so anchoring one adds no wrapper. */
  className?: string;
  children: ReactNode;
}) {
  const { flashed } = useSettingsPage();
  return (
    <div id={id} className={`scroll-mt-16 rounded ${className} ${flashed === id ? 'anchor-flash' : ''}`}>
      {children}
    </div>
  );
}

/**
 * Shown only beside a setting that no longer holds its default, and clicking it
 * puts the default back. It spells the default out because that is the question
 * the marker raises ("changed from what?"), which also saves documenting the
 * defaults anywhere else.
 *
 * How the value is spelled comes from the catalogue rather than from a prop, so
 * this and the changed-list cannot disagree about what `inherit` is called.
 */
export function DefaultBadge<K extends keyof AppSettings>({ field }: { field: K }) {
  const { settings, defaults, save } = useSettingsPage();
  const entry = entryForField(field);
  const value = settings[field];
  const fallback = defaults[field];
  // The two fields whose default cannot be restored by a click say so in the
  // catalogue, and the marker is the thing that must not appear for them.
  if (entry?.noDefault) return null;
  if (value === fallback) return null;
  const shown = (entry?.format ?? valueText)(fallback);
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

/**
 * A setting's line of explanation.
 *
 * **One line is the rule.** They were paragraphs — two and three sentences each
 * — and ten paragraphs of small grey text under ten switches is a wall you read
 * past rather than read. What was cut is not gone: it moved into the group's own
 * `Explain`, one click away and no longer standing in front of the control you
 * **And it is NOT capped to a reading measure.** It was, at 65 characters, and
 * that is what makes a one-line hint wrap at a third of a 976 px card with the
 * rest of the row empty beside it — the cap and the wide column were pulling in
 * opposite directions, and the cap was the one that had to go. A hint that still
 * wraps at this width is a hint that broke the one-line rule and wants cutting,
 * not wrapping.
 */
export function Hint({ children }: { children: ReactNode }) {
  return <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-dim)]">{children}</span>;
}

/** The label and hint of a preference, in the shape a checkbox wants them. */
function LabelText({ label, hint }: { label: string; hint?: ReactNode }) {
  return (
    <span>
      {label}
      {hint && <Hint>{hint}</Hint>}
    </span>
  );
}

/**
 * What a row wears while the switch above it is off.
 *
 * `opacity-40` was the old answer and it was the wrong one: at 40 % the label
 * text lands near the background and a block of them reads as broken rather than
 * as inactive. At 70 % it is plainly not active and still plainly readable —
 * which matters, because this is a settings page and knowing what a switch would
 * turn on is the reason to turn it on. The controls read as dead on their own —
 * the boxes and selects through the `disabled:` variants in `inputClass` and
 * `selectClass`, a checkbox through the browser's native disabled rendering,
 * which is why it carries none — so the CONTROLS look dead and the WORDS do not.
 */
const inactiveRow = 'opacity-70';

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
      <label className={`flex items-start gap-2 ${disabled ? inactiveRow : 'cursor-pointer'}`}>
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
  /** A node, not a string: one of these ends with a live count of what is running. */
  after?: ReactNode;
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
      <label className={`flex items-center gap-2 ${disabled ? inactiveRow : ''}`}>
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

/**
 * A number you set by FEEL rather than by typing: the volume, and nothing else
 * on this page.
 *
 * Every other number here is a threshold with a right answer somewhere — a
 * cadence in seconds, a count of days — and typing one is how you set those.
 * Loudness is not that: it is the only setting whose value you judge by hearing
 * it, so it gets the control you can sweep while the tone plays, with the figure
 * beside it because "70 %" is still worth being able to read and to restore.
 */
export function RangeField({
  field,
  min,
  max,
  step,
  unit,
  hint,
  disabled,
  after,
}: {
  field: keyof AppSettings & string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  hint?: ReactNode;
  disabled?: boolean;
  /** Something to try it with — the play button, for the volume. */
  after?: ReactNode;
}) {
  const { settings, save } = useSettingsPage();
  const entry = entryForField(field);
  const value = settings[field] as number;
  return (
    <Field id={entry?.id} badge={<DefaultBadge field={field} />}>
      <div className={disabled ? inactiveRow : ''}>
        <div className="flex items-center gap-2.5">
          <label className="flex items-center gap-2.5">
            <span className="w-14 shrink-0">{entry?.label ?? field}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              disabled={disabled}
              onChange={(e) => save({ [field]: Number(e.target.value) } as Partial<AppSettings>)}
              className="h-1 w-40 cursor-pointer accent-[var(--accent)] disabled:cursor-default disabled:opacity-40"
            />
            <span className="w-10 shrink-0 text-right font-mono text-[11px] text-[var(--text-dim)]">
              {value}
              {unit}
            </span>
          </label>
          {after}
        </div>
        {hint && <Hint>{hint}</Hint>}
      </div>
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
      <label className={`flex items-center gap-2 ${disabled ? inactiveRow : ''}`}>
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
  hint,
  after,
}: {
  field: keyof AppSettings & string;
  /** Overrides the catalogue's name, for the one row whose label carries a note. */
  label?: ReactNode;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  /**
   * A row under the box — the folder browser, for the one field that names a
   * place on disk. A SIBLING of the label rather than a child of it: a button
   * inside a `<label>` has its click taken by the label's own control.
   */
  after?: ReactNode;
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
      <label className={`block ${disabled ? inactiveRow : ''}`}>
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
      {(after || hint) && (
        <div className={`mt-1.5 flex flex-wrap items-center gap-2 ${disabled ? inactiveRow : ''}`}>
          {after}
          {hint && <span className="text-[11px] leading-relaxed text-[var(--text-dim)]">{hint}</span>}
        </div>
      )}
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
      <div className={disabled ? inactiveRow : ''}>
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

/**
 * `break-words` and not `break-all`: half these values are paths that must be
 * allowed to break somewhere, and the other half are sentences with clocks in
 * them that must not be broken mid-figure. The first only breaks what would
 * otherwise overflow.
 */
export function ReadoutRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="opacity-60">{label}</span>
      <span className="break-words">{children}</span>
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
