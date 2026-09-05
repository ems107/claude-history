import { NavLink, useLocation } from 'react-router';
import { useIsShort, useIsTyping } from '../lib/mobile.ts';

/**
 * The navigation, on a phone.
 *
 * The header it replaces needs about 900px: a brandmark, a version chip, five
 * destinations, the usage widget, the bell, the update button and a gear, in one
 * row with no wrap. At 360px that row simply ran off the screen, taking the
 * whole document with it — and what ran off first was the navigation.
 *
 * So the destinations come down here, where a thumb is. Four of them plus a
 * `More` that is a PAGE rather than a popover ([MorePage]), which is the whole
 * of how the hardware Back button works on this: every layer of the navigation
 * is a real route, so Back is the browser's own and there is no history to fake.
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

/** A caret and a line — something you typed. */
function PromptsIcon() {
  return (
    <svg {...base}>
      <path d="M3 4.5 6 8l-3 3.5" />
      <path d="M8 11.5h5" />
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

function StarIcon() {
  return (
    <svg {...base}>
      <path d="M8 2.2l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 11.2l-3.52 1.85.67-3.92L2.3 6.34l3.94-.57z" />
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

function Tab({ to, label, icon, accent }: { to: string; label: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <NavLink
      to={to}
      // `end` on the root alone: every other route is a prefix of nothing, and
      // without it "/" would light up on every page in the app.
      end={to === '/'}
      className={({ isActive }) =>
        `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] ${
          isActive
            ? 'text-[var(--accent)]'
            : accent
              ? 'text-[var(--text)]'
              : 'text-[var(--text-dim)]'
        }`
      }
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </NavLink>
  );
}

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
  if (typing || short || coversTheBar(pathname)) return null;
  return (
    <nav
      // The gesture bar is under this, so the padding is the bar's own rather
      // than something the page below has to know about.
      className="flex shrink-0 items-stretch border-t border-[var(--border)] bg-[var(--bg-raised)] pb-[var(--safe-bottom)] md:hidden"
      aria-label="Sections"
    >
      <Tab to="/" label="Sessions" icon={<SessionsIcon />} />
      <Tab to="/prompts" label="Prompts" icon={<PromptsIcon />} />
      {chatEnabled && <Tab to="/new" label="New" icon={<NewIcon />} accent />}
      <Tab to="/starred" label="Starred" icon={<StarIcon />} />
      <Tab to="/more" label="More" icon={<MoreIcon />} />
    </nav>
  );
}
