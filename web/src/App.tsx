import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { ActiveSessionsGuardProvider } from './components/ActiveSessionsDialog.tsx';
import { Brandmark } from './components/Brandmark.tsx';
import { controlRow } from './components/controlClass.ts';
import { GearIcon } from './components/icons.tsx';
import { api, UNAUTHORIZED_EVENT } from './api/client.ts';
import { useEvents } from './api/useEvents.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { RemoteDisabledPage } from './pages/RemoteDisabledPage.tsx';
import { MobileTabBar } from './components/MobileTabBar.tsx';
import { NotificationsButton } from './components/NotificationsButton.tsx';
import { NotificationToasts } from './components/NotificationToasts.tsx';
import { UpdateButton } from './components/UpdateButton.tsx';
import { UsageWidget } from './components/UsageWidget.tsx';
import { listUrl } from './lib/listState.ts';
import { useAppIdentity } from './lib/appIdentity.ts';
import { useIsMobile, useIsShort, useKeyboardInset } from './lib/mobile.ts';
import { LogsPage } from './pages/LogsPage.tsx';
import { NewSessionPage } from './pages/NewSessionPage.tsx';
import { PlansPage } from './pages/PlansPage.tsx';
import { PromptsPage } from './pages/PromptsPage.tsx';
import { SessionListPage } from './pages/SessionListPage.tsx';
import { SessionViewPage } from './pages/SessionViewPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { StarredPage } from './pages/StarredPage.tsx';
import { StatsPage } from './pages/StatsPage.tsx';

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded px-2 py-0.5 text-sm ${
          isActive ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

/**
 * Which of the three screens this browser gets, before anything else runs.
 *
 * Everything below this gate — the SSE connection, the usage widget, the update
 * poller — talks to endpoints that answer 401 to a stranger, so mounting them
 * first would mean a burst of failing requests behind a login form. Hence a
 * component of its own: `App` itself only exists once the answer is "in".
 */
export function AppGate() {
  const queryClient = useQueryClient();
  const { data: auth, isPending } = useQuery({
    queryKey: ['auth'],
    queryFn: api.authStatus,
    // Keep asking while it cannot be reached, and come back on its own when it
    // can. This gate is above everything, so a failure here is a blank page —
    // and the moment it happens is a server that is restarting, which is
    // exactly what applying an update from another machine does. Without this,
    // a tab loaded a second too early would stay blank until someone reloaded
    // it by hand, on the one screen that cannot be reached by hand.
    refetchInterval: (query) => (query.state.error ? 2_000 : false),
    retry: 3,
  });

  // A session that dies while the app is open (the key was rotated, the cookie
  // expired) is announced once by the API client; re-reading the status is what
  // swaps this back to the login form without a reload.
  useEffect(() => {
    const onUnauthorized = () => void queryClient.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

  // Nothing at all while it is being asked: this resolves in a millisecond on
  // loopback, and a spinner would be a flash of layout for no information.
  if (isPending) return null;
  // Asked and could not be answered — the server is down or restarting. Say so
  // rather than show an empty page; the poll above brings it back by itself.
  if (!auth) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-dim)]">
        Cannot reach the claude-history server. Retrying…
      </div>
    );
  }
  // The guard's dialog is mounted here rather than inside `App` so it is above
  // the routes AND above the header: the update button raises it too, and the
  // page underneath must be able to go on drawing while it is up.
  if (auth.authenticated) {
    return (
      <ActiveSessionsGuardProvider>
        <App />
      </ActiveSessionsGuardProvider>
    );
  }
  if (!auth.remoteAccessEnabled || !auth.configured) return <RemoteDisabledPage />;
  return (
    <LoginPage
      onSignedIn={() => {
        // Everything is stale by definition: this page has been answering 401
        // to every query it made until a moment ago.
        void queryClient.invalidateQueries();
      }}
    />
  );
}

export function App() {
  useEvents();
  // One listener for the whole app: how much of the window the on-screen
  // keyboard is covering, published as `--kb-inset` for whatever has to sit
  // above it. Nothing writes it on a desktop, where it stays 0.
  useKeyboardInset();
  /**
   * A phone on its side, on a screen that is a detail rather than a place.
   *
   * 284px of window, and the app header, the session's own header and its panel
   * strip were taking 62% of it before a word of conversation. The app header is
   * the one of the three that says nothing about what is on screen — it is a
   * mark, a badge and a menu — and the session under it already has its own way
   * back. So on a short window it stands aside for the thing somebody turned the
   * phone sideways to read. It is one Back away, on the list.
   */
  const mobile = useIsMobile();
  const short = useIsShort();
  const { pathname } = useLocation();
  const bareDetail = mobile && short && (pathname.startsWith('/session/') || pathname === '/new');
  const navigate = useNavigate();
  // Same query the UpdateButton uses — deduped by TanStack, no extra request.
  const { data: update } = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });
  // Which of the two instances this tab is. Deduped with every other ['meta']
  // reader, and the answer never changes for the life of the server.
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const dev = meta?.devInstance ?? false;
  // Starting a session is the composer under another name — same process, same
  // quota — so it appears exactly where the composer does. Free to read here:
  // the usage widget keeps ['settings'] mounted for the life of the page.
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const chatEnabled = settings?.settings.chatEnabled ?? false;
  // The colour of the mark and the name of the app, published to the browser's
  // own chrome: the CSS properties the glyph paints from, the tab's icon, and
  // the manifest an install reads. Here rather than in `AppGate`: the two
  // screens above this one cannot read settings, and are right to wear the
  // shipped colour and the shipped name.
  useAppIdentity(settings?.settings.logoColor, settings?.settings.appName);
  // Two tabs that look alike on two ports is the one way to confuse them, and
  // the tab strip is where they are told apart before anything is clicked — so
  // the dev marker is not the name's to lose, whatever the name is.
  //
  // An empty setting is the shipped name rather than an empty tab, which is the
  // same thing the served manifest does with it: the two shipped spellings
  // differ, so the fallback is spelled here and the other one in the file.
  const appName = settings?.settings.appName || 'claude history';
  useEffect(() => {
    document.title = dev ? `dev · ${appName} :${window.location.port}` : appName;
  }, [dev, appName]);
  return (
    <div className="flex h-full flex-col">
      {/* The one row that had to give. It needs about 900px and a phone has
          360, so the destinations and the gear go to the bottom bar and what is
          left is this: who this is on the left, and on the right the three
          readings — what Claude has spent, what is waiting, and whether there is
          a new version. The last of those is drawn only when there IS one; the
          rest of the time it is a button that answers a question nobody asks
          from a phone, and Settings › Updates is where it is asked from. */}
      <header
        className={`flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 max-md:gap-2 max-md:px-3 max-md:py-1 ${
          bareDetail ? 'hidden' : ''
        }`}
      >
        {/* Title and version share a baseline, so the small version text sits
            on the title's bottom edge instead of floating at its mid-height. */}
        <span className="flex items-baseline gap-2">
          {/* The mark is INSIDE the link — the mark and the words are one
              thing, so they are one target — but it stays OUT of the baseline
              group that carries the version text: it has no baseline of its
              own, so left to participate it would hand the group its own
              bottom edge and drop the version text with it. self-center keeps
              it out of that group, and centres it on the title exactly where
              it already sat. The link's gap is tighter than the header's own:
              the nav beside it is another thing. */}
          <Link
            to="/"
            onClick={(e) => {
              e.preventDefault();
              navigate(listUrl()); // computed at click time: restores saved filters
            }}
            className="flex items-baseline gap-1.5 text-lg font-semibold tracking-tight max-md:gap-1 max-md:text-sm"
          >
            <Brandmark className="h-5 w-auto shrink-0 self-center max-md:h-4" />
            <span>
              <span className="text-[var(--logo)]">claude</span> history
            </span>
          </Link>
          {dev ? (
            <span
              className="rounded border border-amber-500/40 px-1 font-mono text-[11px] text-amber-400"
              title={`Development instance on port ${window.location.port} — its own data folder, beside the installed release on 7433, which it never touches.`}
            >
              dev
            </span>
          ) : (
            update && (
              <span
                className="font-mono text-[11px] text-[var(--text-dim)]"
                title={
                  update.installed
                    ? `Installed version ${update.currentVersion}`
                    : 'Running from source (not an installed release)'
                }
              >
                {update.currentVersion === 'dev' ? 'dev' : `v${update.currentVersion}`}
              </span>
            )
          )}
        </span>
        <nav className="ml-4 flex items-center gap-1 max-md:hidden">
          {/* Not a NavItem: everything else in this bar goes to a list of things
              that already exist, and this one makes something. The border says
              so before the label is read. */}
          {chatEnabled && (
            <NavLink
              to="/new"
              title="Start a new Claude Code session in any project"
              className={({ isActive }) =>
                `mr-2 rounded border px-2 py-0.5 text-sm ${
                  isActive
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]'
                }`
              }
            >
              + New
            </NavLink>
          )}
          <NavItem to="/prompts" label="Prompts" />
          <NavItem to="/starred" label="Starred" />
          <NavItem to="/plans" label="Plans" />
          <NavItem to="/stats" label="Stats" />
        </nav>
        <span className={`ml-auto ${controlRow}`}>
          {/* Upright bars on a phone, the full pills above 48rem — one widget,
              swapped inside itself. */}
          <UsageWidget />
          <NotificationsButton />
          {/* A phone only ever reaches this app from another machine, so a
              button whose whole job is "check, and tell me there is nothing" is
              a button that is right 99 days out of 100. It appears when there is
              something to install, and Settings › Updates opens the same window
              the rest of the time. */}
          <span className={update?.updateAvailable ? '' : 'max-md:hidden'}>
            <UpdateButton />
          </span>
          <NavLink
            to="/settings"
            title="Settings"
            aria-label="Settings"
            className={({ isActive }) =>
              `inline-flex cursor-pointer items-center rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--text-dim)] hover:text-[var(--text)] max-md:hidden ${
                isActive ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'
              }`
            }
          >
            <GearIcon />
          </NavLink>
        </span>
      </header>
      {/* Above the routes and outside `main`: the cards are `fixed`, they
          outlive any one page, and nothing in the layout may shift for them. */}
      <NotificationToasts />
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<SessionListPage />} />
          <Route path="/new" element={<NewSessionPage />} />
          <Route path="/session/:id" element={<SessionViewPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/starred" element={<StarredPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/stats" element={<StatsPage />} />
          {/* Both, rather than an optional segment: `/settings` is in the README
              and in every bookmark, and it goes on landing on the first area. */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:area" element={<SettingsPage />} />
          {/* Diagnostics, reached from Settings — deliberately not in the nav. */}
          <Route path="/logs" element={<LogsPage />} />
        </Routes>
      </main>
      <MobileTabBar chatEnabled={chatEnabled} />
    </div>
  );
}
