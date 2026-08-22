import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router';
import { ActiveSessionsGuardProvider } from './components/ActiveSessionsDialog.tsx';
import { GearIcon } from './components/icons.tsx';
import { api, UNAUTHORIZED_EVENT } from './api/client.ts';
import { useEvents } from './api/useEvents.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { RemoteDisabledPage } from './pages/RemoteDisabledPage.tsx';
import { NotificationsButton } from './components/NotificationsButton.tsx';
import { UpdateButton } from './components/UpdateButton.tsx';
import { UsageWidget } from './components/UsageWidget.tsx';
import { listUrl } from './lib/listState.ts';
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
  // Two tabs that look alike on two ports is the one way to confuse them, and
  // the tab strip is where they are told apart before anything is clicked.
  useEffect(() => {
    document.title = dev ? `dev · claude history :${window.location.port}` : 'claude history';
  }, [dev]);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
        {/* Title and version share a baseline, so the small version text sits
            on the title's bottom edge instead of floating at its mid-height. */}
        <span className="flex items-baseline gap-2">
          <Link
            to="/"
            onClick={(e) => {
              e.preventDefault();
              navigate(listUrl()); // computed at click time: restores saved filters
            }}
            className="text-lg font-semibold tracking-tight"
          >
            <span className="text-[var(--accent)]">claude</span> history
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
        <nav className="ml-4 flex items-center gap-1">
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
        <span className="ml-auto flex items-center gap-2">
          <UsageWidget />
          <NotificationsButton />
          <UpdateButton />
          <NavLink
            to="/settings"
            title="Settings"
            aria-label="Settings"
            className={({ isActive }) =>
              `cursor-pointer rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--text-dim)] hover:text-[var(--text)] ${
                isActive ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'
              }`
            }
          >
            <GearIcon />
          </NavLink>
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<SessionListPage />} />
          <Route path="/new" element={<NewSessionPage />} />
          <Route path="/session/:id" element={<SessionViewPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/starred" element={<StarredPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Diagnostics, reached from Settings — deliberately not in the nav. */}
          <Route path="/logs" element={<LogsPage />} />
        </Routes>
      </main>
    </div>
  );
}
