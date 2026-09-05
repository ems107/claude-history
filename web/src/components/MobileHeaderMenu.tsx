import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { api } from '../api/client.ts';
import { usePopover } from '../lib/popover.ts';

/**
 * Everything the header used to hold, on a phone, behind three dots.
 *
 * The header is the one row that is on screen on every single page, so every
 * pixel it takes is a pixel taken from all of them — and on the session view,
 * stacked above that screen's own header and its panel strip, it was helping to
 * spend nearly half the window on chrome before a word of conversation.
 *
 * So the gear, the update button and the usage readout come off the row and go
 * in here. The bell stays outside, and that is the one judgement in this
 * component: a count you cannot see is a count that is not telling you
 * anything, and the whole point of the bell is being seen without being opened.
 *
 * Plain links only, deliberately. The obvious thing to put in here was the
 * `UpdateButton` and `UsageWidget` components themselves — but both open
 * overlays of their own, and an overlay opened from inside a popover dies the
 * moment the popover's own click-outside fires. They live on `/more`, which is
 * where the rows below point.
 */
export function MobileHeaderMenu() {
  const pop = usePopover<HTMLDivElement>();
  const { data: update } = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });
  const available = update?.updateAvailable ? (update.available[0]?.version ?? null) : null;

  const row =
    'flex min-h-11 items-center gap-2 rounded px-2 text-sm text-[var(--text)] active:bg-[var(--bg-hover)]';

  return (
    <div ref={pop.ref} className="relative md:hidden">
      <button
        type="button"
        onClick={pop.toggle}
        aria-label="More"
        aria-expanded={pop.open}
        className={`inline-flex min-h-9 cursor-pointer items-center rounded border px-2.5 ${
          available
            ? 'border-[var(--accent)] text-[var(--accent)]'
            : 'border-[var(--border)] text-[var(--text-dim)]'
        }`}
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="12.5" cy="8" r="1.4" />
        </svg>
      </button>
      {pop.open && (
        <div className="absolute right-0 z-50 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-1.5 shadow-xl">
          <NavLink to="/settings" onClick={pop.close} className={row}>
            Settings
          </NavLink>
          <NavLink to="/stats" onClick={pop.close} className={row}>
            Stats
          </NavLink>
          <NavLink to="/plans" onClick={pop.close} className={row}>
            Plans
          </NavLink>
          <NavLink to="/logs" onClick={pop.close} className={row}>
            Logs
          </NavLink>
          {/* Only when there is one, and it points at the page that holds the
              button rather than pretending to be it: applying an update is a
              confirmation and a restart, not a menu entry. */}
          {available && (
            <NavLink to="/more" onClick={pop.close} className={`${row} text-[var(--accent)]`}>
              Update to {available}
            </NavLink>
          )}
        </div>
      )}
    </div>
  );
}
