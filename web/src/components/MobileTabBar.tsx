import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { GearIcon } from './icons.tsx';
import { useBackDismiss, useIsShort, useIsTyping } from '../lib/mobile.ts';

/**
 * The navigation, on a phone.
 *
 * The header it replaces needs about 900px: a brandmark, a version chip, five
 * destinations, the usage widget, the bell, the update button and a gear, in one
 * row with no wrap. At 360px that row simply ran off the screen, taking the
 * whole document with it — and what ran off first was the navigation.
 *
 * So the destinations come down here, where a thumb is. Five of them, and the
 * middle one is the one that MAKES something. `More` is a menu rather than a
 * page: a page of four links is a screen you have to leave again, and every one
 * of those links is a place you were trying to get to in one tap.
 *
 * **In the flow, not `fixed`.** The app root is already a full-height flex
 * column, so a `shrink-0` row at the end of it is a bar the content cannot slide
 * under and nothing has to reserve padding for. It also means the keyboard
 * cannot cover it — and `interactive-widget=resizes-content` means the window
 * shrinks around it instead, which is why it hides itself while anything is
 * being typed: with the keys up there are barely 300px left, and a row of
 * navigation between the field and the keyboard is 56px spent on the one thing
 * nobody wants mid-sentence.
 *
 * Labels under every icon, deliberately. Five unexplained glyphs is five things
 * to learn, and this app has no tooltips to fall back on: `title=` does not
 * exist on Android. The words cost 12px once.
 */

const base = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'size-5 shrink-0',
};

/** Stacked lines — a list of conversations. */
function SessionsIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 4h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 12h7" />
    </svg>
  );
}

/** Bars of different heights — what the conversations cost. */
function StatsIcon() {
  return (
    <svg {...base}>
      <path d="M3 13V7.5" />
      <path d="M8 13V3" />
      <path d="M13 13V9.5" />
    </svg>
  );
}

/** A plus in a circle — the one control here that MAKES something. */
function NewIcon() {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.5v5" />
      <path d="M5.5 8h5" />
    </svg>
  );
}

/** Three dots — everything that did not fit. */
function MoreIcon() {
  return (
    <svg {...base} fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  );
}

const tabClass = (active: boolean, accent?: boolean) =>
  `flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] ${
    active ? 'text-[var(--accent)]' : accent ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'
  }`;

function Tab({ to, label, icon, accent }: { to: string; label: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <NavLink
      to={to}
      // `end` on the root alone: every other route is a prefix of nothing, and
      // without it "/" would light up on every page in the app.
      end={to === '/'}
      className={({ isActive }) => tabClass(isActive, accent)}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </NavLink>
  );
}

/** The three places that did not earn a tab of their own. */
const MORE: Array<[string, string, string]> = [
  ['/prompts', 'Prompts', 'Every prompt you have typed, across all sessions'],
  ['/plans', 'Plans', 'Every plan written in a session, newest first'],
  ['/starred', 'Starred messages', 'The messages you kept'],
];

/**
 * The two screens the bar does not appear on. Both are a DETAIL pushed over the
 * list rather than a place in it, both have their own way back, and both end in
 * a composer anchored to the bottom of the window — which is the row the bar
 * would be sitting in. A tab bar under a message box is a tab bar you hit by
 * accident while reaching for Send.
 */
function coversTheBar(pathname: string): boolean {
  return pathname.startsWith('/session/') || pathname === '/new';
}

export function MobileTabBar({ chatEnabled }: { chatEnabled: boolean }) {
  const typing = useIsTyping();
  // A phone on its side is 284px tall. A 56px bar there is a fifth of the
  // window spent on navigation, on the orientation somebody turned to in order
  // to see MORE of something.
  const short = useIsShort();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  // Android's Back closes the menu instead of leaving the page. A menu and not
  // a route, so it needs the marker; the destinations inside it are routes and
  // Back handles those itself.
  useBackDismiss(more, () => setMore(false));
  if (typing || short || coversTheBar(pathname)) return null;
  const inMore = MORE.some(([to]) => pathname === to);
  return (
    <nav
      // The gesture bar is under this, so the padding is the bar's own rather
      // than something the page below has to know about.
      className="relative flex shrink-0 items-stretch border-t border-[var(--border)] bg-[var(--bg-raised)] pb-[var(--safe-bottom)] md:hidden"
      aria-label="Sections"
    >
      <Tab to="/" label="Sessions" icon={<SessionsIcon />} />
      <Tab to="/stats" label="Stats" icon={<StatsIcon />} />
      {chatEnabled && <Tab to="/new" label="New" icon={<NewIcon />} accent />}
      <button type="button" onClick={() => setMore((v) => !v)} className={tabClass(more || inMore)} aria-expanded={more}>
        <MoreIcon />
        <span className="max-w-full truncate">More</span>
      </button>
      <Tab to="/settings" label="Settings" icon={<GearIcon className="size-5" />} />

      {more && (
        <>
          {/* A tap anywhere else closes it, and it must sit UNDER the menu but
              over the page: the same two-layer shape the usage popover uses. */}
          <div className="fixed inset-0 z-40" onClick={() => setMore(false)} />
          <div className="absolute inset-x-2 bottom-full z-50 mb-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] shadow-xl">
            {MORE.map(([to, label, hint]) => (
              <button
                key={to}
                type="button"
                onClick={() => {
                  setMore(false);
                  void navigate(to);
                }}
                className={`flex min-h-14 w-full cursor-pointer items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-left last:border-b-0 ${
                  pathname === to ? 'text-[var(--accent)]' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{label}</span>
                  <span className="block text-xs text-[var(--text-dim)]">{hint}</span>
                </span>
                <span aria-hidden className="shrink-0 text-[var(--text-dim)]">
                  ›
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </nav>
  );
}
