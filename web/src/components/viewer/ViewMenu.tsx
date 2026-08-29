import { useEffect, useState } from 'react';
import { usePopover } from '../../lib/popover.ts';
import type { FoldState } from '../../lib/folding.ts';
import type { ReadingPrefs } from '../../lib/readingPrefs.ts';
import {
  WIDTH_FULL,
  WIDTH_MAX,
  WIDTH_MIN,
  widthLabel,
  ZOOM_MAX,
  ZOOM_MIN,
  type ViewPrefs,
} from '../../lib/viewPrefs.ts';
import { toggleClass } from '../controlClass.ts';

/**
 * A number you can both step and type. The draft is local so a half-typed "12"
 * is not clamped up to the minimum under the cursor; it commits on Enter or on
 * blur, and Escape puts back what was there.
 */
function NumberField({
  value,
  min,
  max,
  disabled,
  onCommit,
  title,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
  title?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && draft.trim() !== '') onCommit(Math.min(max, Math.max(min, Math.round(n))));
    else setDraft(String(value));
  };

  return (
    <input
      value={disabled ? '' : draft}
      disabled={disabled}
      placeholder={disabled ? '—' : undefined}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        }
        // Not the menu's Escape: putting the number back is what this key does
        // while a field is being typed into, so it must not also close the menu.
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(String(value));
        }
      }}
      className="w-12 rounded border border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-right font-mono text-xs tabular-nums focus:border-[var(--accent-dim)] focus:outline-none disabled:opacity-50"
    />
  );
}

function Stepper({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-5 shrink-0 cursor-pointer rounded border border-[var(--border)] text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function Section({ label }: { label: string }) {
  return (
    <div className="mt-1 mb-0.5 px-1.5 text-[10px] font-semibold tracking-wider text-[var(--text-dim)]/60 uppercase">
      {label}
    </div>
  );
}

/** The state of a switch, drawn rather than a checkbox: this is a mode, not a form. */
function Switch({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative h-3.5 w-6 shrink-0 rounded-full border ${
        disabled
          ? 'border-[var(--border)] opacity-50'
          : on
            ? 'border-[var(--accent)] bg-[var(--accent)]/15'
            : 'border-[var(--border)]'
      }`}
    >
      <span
        className={`absolute top-0.5 size-2 rounded-full ${
          on ? 'right-0.5 bg-[var(--accent)]' : 'left-0.5 bg-[var(--text-dim)]'
        }`}
      />
    </span>
  );
}

function Item({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: import('react').ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:text-[var(--text-dim)]/55 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const arrow = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'size-3.5 shrink-0',
};

/** Both arrows pointing AT the line: everything comes together. */
function FoldIcon() {
  return (
    <svg {...arrow}>
      <path d="M2.5 8h11" />
      <path d="M5.5 4.2 8 6.7 10.5 4.2" />
      <path d="M5.5 11.8 8 9.3 10.5 11.8" />
    </svg>
  );
}

/** And away from it. */
function UnfoldIcon() {
  return (
    <svg {...arrow}>
      <path d="M2.5 8h11" />
      <path d="M5.5 6 8 3.5 10.5 6" />
      <path d="M5.5 10 8 12.5 10.5 10" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg {...arrow}>
      <circle cx="8" cy="8" r="1.9" />
      <path d="M1.6 8S4 3.8 8 3.8 14.4 8 14.4 8 12 12.2 8 12.2 1.6 8 1.6 8Z" />
    </svg>
  );
}

/**
 * Everything about how the conversation is DRAWN, in one menu: which of its
 * parts are shown, what is folded, and how big it all is.
 *
 * It grew out of the button that held only the last of those three. The header
 * carried five separate toggles beside it — `Thinking`, `Tools`, `Hide
 * responses`, `Show responses`, `Compactions` — which were five of the eighteen
 * controls that made the row unreadable, and every one of them answers the same
 * question as zoom and width do. `reading` and `fold` are optional because the
 * new-session page has a thread with no transcript behind it: there, this is
 * exactly the size control it always was.
 */
export function ViewMenu({
  view,
  reading,
  fold,
  counts,
}: {
  view: ViewPrefs;
  reading?: ReadingPrefs;
  fold?: FoldState;
  counts?: { thinking: number; tools: number; compactions: number };
}) {
  const pop = usePopover<HTMLDivElement>();
  const full = view.width === WIDTH_FULL;
  // Lit when ANYTHING in here is off its default — a menu nobody can see must
  // never change what is on screen in silence. The hint in the label stays the
  // size, which is the part a number can say in three characters.
  const lit = !view.isDefault || (reading ? !reading.isDefault : false);

  return (
    <div ref={pop.ref} className="relative inline-block">
      <button
        type="button"
        onClick={pop.toggle}
        className={toggleClass(lit)}
        title="What is shown in the conversation, what is folded, and how big it is drawn"
      >
        <EyeIcon />
        View{view.isDefault ? '' : ` (${view.zoom}%${full ? ' · full' : ''})`}
        <span aria-hidden className="text-[9px] opacity-70">
          ▾
        </span>
      </button>
      {pop.open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded border border-[var(--border)] bg-[var(--bg-raised)] p-2 text-xs shadow-xl">
          {reading && counts && (
            <>
              <Section label="Shown in the conversation" />
              <Item
                onClick={reading.toggleThinking}
                disabled={counts.thinking === 0}
                title={
                  counts.thinking > 0
                    ? 'Show/hide the model’s thinking blocks'
                    : 'No visible thinking in this conversation (recent Claude Code versions store thinking encrypted)'
                }
              >
                <Switch on={reading.showThinking} disabled={counts.thinking === 0} />
                Thinking
                <span className="ml-auto text-[11px] tabular-nums text-[var(--text-dim)]/70">
                  {counts.thinking || ''}
                </span>
              </Item>
              <Item
                onClick={reading.toggleTools}
                disabled={counts.tools === 0}
                title={
                  counts.tools > 0
                    ? 'Expand or collapse every group of tool calls (they start collapsed so prompts and answers read cleanly)'
                    : 'This conversation has no tool calls'
                }
              >
                <Switch on={reading.expandTools} disabled={counts.tools === 0} />
                Tool calls
                <span className="ml-auto text-[11px] tabular-nums text-[var(--text-dim)]/70">{counts.tools || ''}</span>
              </Item>
              {counts.compactions > 0 && (
                <Item
                  onClick={reading.toggleSegments}
                  title="Unfold every stretch of conversation that was compacted away (they start folded — only the current context is open)"
                >
                  <Switch on={reading.expandSegments} />
                  Compacted stretches
                  <span className="ml-auto text-[11px] tabular-nums text-[var(--text-dim)]/70">
                    {counts.compactions}
                  </span>
                </Item>
              )}
            </>
          )}

          {fold && (
            <>
              <div className="my-1.5 -mx-2 h-px bg-[var(--border)]" />
              <Section label="Folding" />
              <Item
                onClick={fold.hideAll}
                disabled={!fold.canHide}
                title={
                  fold.canHide
                    ? 'Fold every answer away and leave the prompts — click any prompt to bring its own back'
                    : 'Every answer is already folded'
                }
              >
                <FoldIcon />
                Fold every answer
              </Item>
              <Item
                onClick={fold.showAll}
                disabled={!fold.canShow}
                title={fold.canShow ? 'Unfold every answer' : 'Nothing is folded'}
              >
                <UnfoldIcon />
                Unfold everything
              </Item>
            </>
          )}

          <div className="my-1.5 -mx-2 h-px bg-[var(--border)]" />
          <Section label="Size of the thread" />
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-12 shrink-0 text-[var(--text-dim)]">Zoom</span>
            <Stepper label="−" onClick={() => view.stepZoomBy(-1)} disabled={view.zoom <= ZOOM_MIN} />
            <NumberField
              value={view.zoom}
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              onCommit={view.setZoom}
              title={`${ZOOM_MIN}–${ZOOM_MAX}%`}
            />
            <span className="text-[var(--text-dim)]">%</span>
            <Stepper label="+" onClick={() => view.stepZoomBy(1)} disabled={view.zoom >= ZOOM_MAX} />
          </div>

          <div className="flex items-center gap-1.5 py-1">
            <span className="w-12 shrink-0 text-[var(--text-dim)]">Width</span>
            <Stepper label="−" onClick={() => view.stepWidthBy(-1)} disabled={!full && view.width <= WIDTH_MIN} />
            <NumberField
              value={view.width}
              min={WIDTH_MIN}
              max={WIDTH_MAX}
              disabled={full}
              onCommit={view.setWidth}
              title={`${WIDTH_MIN}–${WIDTH_MAX} px`}
            />
            <span className="text-[var(--text-dim)]">px</span>
            <Stepper label="+" onClick={() => view.stepWidthBy(1)} disabled={full} />
            <span className="ml-auto shrink-0 font-semibold text-[var(--text-dim)]">{widthLabel(view.width)}</span>
          </div>

          <button
            type="button"
            onClick={view.reset}
            disabled={view.isDefault}
            className="mt-1 w-full cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
