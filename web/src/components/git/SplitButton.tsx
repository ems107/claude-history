import { useEffect, useRef, useState, type ReactNode } from 'react';
import { btn } from '../../lib/ui.ts';

export interface SplitOption {
  key: string;
  /** What the menu entry says. */
  label: string;
  /** The exact git command it runs, shown under the label — the panel's honesty, in advance. */
  command: string;
  /** The consequence, where it is not obvious from the command. */
  hint?: string;
  /** Two words for the main button when this is what it does — only shown when that is not the shipped answer. */
  short?: string;
  danger?: boolean;
  /** Why this one cannot be pressed right now. Never a disabled control with nothing to say. */
  blocked?: string | null;
  run: () => void;
}

/**
 * A button whose main click does what the settings say, with everything else
 * one click further in.
 *
 * The alternatives to fetch, pull and merge are not rare cases — they are the
 * same job done differently, and which one is right depends on the repository
 * and the day. Hiding them behind a refusal (the shape this started as) means
 * you only find them after being told no; hiding them in Settings means
 * changing a preference to do something once. So: the default is a preference,
 * and the rest are here.
 *
 * The dropdown recipe is the app's own (ViewButton / RepoPicker): click outside
 * to close, and NO keyboard handlers — everything in this tab can change a
 * repository, and that rule has no exceptions.
 *
 * Every entry carries the exact command it runs. That is the same contract as
 * the command panel, moved to before the click instead of after it.
 */
export function SplitButton({
  label,
  options,
  defaultKey,
  busy,
  title,
}: {
  /** What the main button says: "Pull", "Push ↑2". */
  label: ReactNode;
  options: SplitOption[];
  defaultKey: string;
  busy?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const main = options.find((o) => o.key === defaultKey) ?? options[0];
  if (!main) return null;
  // The first option is the shipped answer, so a suffix appears exactly when
  // the button does something other than what it would out of the box.
  const changed = main.key !== options[0].key;

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        disabled={busy || !!main.blocked}
        onClick={() => {
          setOpen(false);
          main.run();
        }}
        title={main.blocked ?? `${title ? `${title}\n` : ''}${main.command}`}
        className={`${btn} rounded-r-none border-r-0`}
      >
        {busy ? '…' : label}
        {changed && main.short && <span className="ml-1 text-[var(--text-dim)]">({main.short})</span>}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        title="The other ways to do this"
        className={`${btn} rounded-l-none px-1`}
        aria-label="More options"
      >
        ▾
      </button>
      {open && <OptionMenu options={options} mainKey={main.key} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The list itself. Its own component because the sidebar's merge action wants
 * the same menu without the same button, and a second copy of these rows would
 * be a second place for the command line under each entry to go stale.
 *
 * Positioned against the nearest positioned ancestor, so whatever opens it must
 * be `relative`.
 */
export function OptionMenu({
  options,
  mainKey,
  onClose,
}: {
  options: SplitOption[];
  /** The one the settings point at, marked so the menu says which is which. */
  mainKey: string;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-full right-0 z-30 mt-1 w-80 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-1 text-xs shadow-xl">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          disabled={!!option.blocked}
          onClick={() => {
            onClose();
            option.run();
          }}
          className={`block w-full cursor-pointer rounded px-2 py-1.5 text-left hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent ${
            option.danger ? 'text-red-300' : ''
          }`}
        >
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.key === mainKey && <span className="shrink-0 text-[10px] text-[var(--text-dim)]">default</span>}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-dim)]" title={option.command}>
            {option.command}
          </span>
          {(option.blocked ?? option.hint) && (
            <span className={`mt-0.5 block text-[10px] ${option.blocked ? 'text-amber-400' : 'text-[var(--text-dim)]'}`}>
              {option.blocked ?? option.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The caret on its own, for places where the main action already has a button
 * of its own — the branch rows, where merging is one small glyph and the three
 * ways of doing it belong next to it rather than in a dialog.
 */
export function MenuButton({
  label,
  className,
  title,
  options,
  mainKey,
  disabled,
}: {
  label: string;
  className: string;
  title: string;
  options: SplitOption[];
  mainKey: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" disabled={disabled} title={title} className={className} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && <OptionMenu options={options} mainKey={mainKey} onClose={() => setOpen(false)} />}
    </span>
  );
}
