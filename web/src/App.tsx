import { useQuery } from '@tanstack/react-query';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router';
import { GearIcon } from './components/icons.tsx';
import { api } from './api/client.ts';
import { useEvents } from './api/useEvents.ts';
import { UpdateButton } from './components/UpdateButton.tsx';
import { UsageWidget } from './components/UsageWidget.tsx';
import { listUrl } from './lib/listState.ts';
import { PromptsPage } from './pages/PromptsPage.tsx';
import { SessionListPage } from './pages/SessionListPage.tsx';
import { SessionViewPage } from './pages/SessionViewPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
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
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
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
        {update && (
          <span
            className="font-mono text-[11px] text-[var(--text-dim)]"
            title={
              update.installed
                ? `Installed version ${update.currentVersion} — updates are checked every 10 minutes`
                : 'Running from source (dev build)'
            }
          >
            {update.currentVersion === 'dev' ? 'dev' : `v${update.currentVersion}`}
          </span>
        )}
        <nav className="ml-4 flex items-center gap-1">
          <NavItem to="/prompts" label="Prompts" />
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
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
