import type { FoldState } from '../../lib/folding.ts';
import type { InspectorState } from '../../lib/inspector.ts';
import type { ReadingPrefs } from '../../lib/readingPrefs.ts';
import type { ViewPrefs } from '../../lib/viewPrefs.ts';
import { CountBadge } from '../CountBadge.tsx';
import { PANEL_ICONS } from './InspectorRail.tsx';
import { ViewMenuBody } from './ViewMenu.tsx';

/**
 * Everything the session page owns that has no room in a phone's title row.
 *
 * Three things lived beside the title on a desktop and a fourth down the right
 * edge of the window: find, the view menu, the session's own actions, and the
 * inspector panels. At 360px that came to a strip of chips under the
 * header — which is a list you cannot see the end of — plus a row of controls
 * that left the title about a third of its own line.
 *
 * So they are sections of one sheet, opened by the ⋮ beside the title
 * ([SessionMenu]). This is the part the page owns; the session's own actions are
 * the sheet's own, drawn under these.
 *
 * Every row closes the sheet, because every one of them is a thing you do TO the
 * conversation and then want to look at — except the view controls, which are
 * the conversation being adjusted while you watch, and would be unusable if the
 * first tap put the screen away.
 */
export function SessionSheetSections({
  inspector,
  onFind,
  view,
  reading,
  fold,
  counts,
  close,
}: {
  inspector: InspectorState;
  /** Opens the find bar over the conversation. */
  onFind: () => void;
  view: ViewPrefs;
  reading: ReadingPrefs;
  fold: FoldState;
  counts: { thinking: number; tools: number; compactions: number };
  close: () => void;
}) {
  return (
    <>
      <Heading>Panels</Heading>
      <div className="grid grid-cols-2 gap-1.5">
        {inspector.items.map((item) => {
          const Icon = PANEL_ICONS[item.key];
          const active = inspector.open === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                inspector.toggle(item.key);
                close();
              }}
              className={`relative flex min-h-12 items-center gap-2 rounded border px-2.5 text-left text-sm ${
                active
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text)]'
              }`}
            >
              <Icon />
              <span className="min-w-0 flex-1 truncate">{item.short}</span>
              {item.count !== null && (
                <span className="shrink-0 font-mono text-[11px] text-[var(--text-dim)]">{item.count}</span>
              )}
              {/* The phone has no rail, so this is the ONLY place a warning can
                  reach it — and a `title` it cannot hover would be no warning
                  at all. Same badge, same amber, same silence to a screen
                  reader as on the rail. */}
              <CountBadge count={item.alert} />
            </button>
          );
        })}
      </div>

      <Heading>In this conversation</Heading>
      <button
        type="button"
        onClick={() => {
          onFind();
          close();
        }}
        className="flex min-h-12 w-full items-center gap-2 rounded border border-[var(--border)] px-2.5 text-left text-sm"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          aria-hidden
          className="size-4 shrink-0"
        >
          <circle cx="7" cy="7" r="4.3" />
          <path d="m10.3 10.3 3.2 3.2" />
        </svg>
        Find in this conversation
      </button>

      {/* The view menu's own contents, flat — its three sections name
          themselves, so this needs no heading of its own. A popover opened from
          inside a sheet would be a second layer for Back to disagree about, and
          these are switches and steppers rather than destinations: nothing here
          closes the sheet, because you watch the conversation change. */}
      <div className="mt-3 border-t border-[var(--border)] pt-1 text-xs">
        <ViewMenuBody view={view} reading={reading} fold={fold} counts={counts} />
      </div>
    </>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-3 mb-1.5 px-1 text-[10px] font-semibold tracking-wider text-[var(--text-dim)]/60 uppercase">
      {children}
    </h3>
  );
}
