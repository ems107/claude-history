import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router';
import { GearIcon } from './components/icons.tsx';
import { api } from './api/client.ts';
import { useEvents } from './api/useEvents.ts';
import { UpdateButton } from './components/UpdateButton.tsx';
import { UsageWidget } from './components/UsageWidget.tsx';
import { listUrl } from './lib/listState.ts';
import { LogsPage } from './pages/LogsPage.tsx';
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

export function App() {
  useEvents();
  const navigate = useNavigate();
  // Same query the UpdateButton uses — deduped by TanStack, no extra request.
  const { data: update } = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });
  // Which of the two instances this tab is. Deduped with every other ['meta']
  // reader, and the answer never changes for the life of the server.
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const dev = meta?.devInstance ?? false;
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
          <NavItem to="/prompts" label="Prompts" />
          <NavItem to="/starred" label="Starred" />
          <NavItem to="/plans" label="Plans" />
          <NavItem to="/stats" label="Stats" />
        </nav>
        <span className="ml-auto flex items-center gap-2">
          <UsageWidget />
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
