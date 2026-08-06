import { Link, NavLink, Route, Routes, useNavigate } from 'react-router';
import { useEvents } from './api/useEvents.ts';
import { UpdateButton } from './components/UpdateButton.tsx';
import { listUrl } from './lib/listState.ts';
import { PromptsPage } from './pages/PromptsPage.tsx';
import { SessionListPage } from './pages/SessionListPage.tsx';
import { SessionViewPage } from './pages/SessionViewPage.tsx';
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
        <nav className="ml-4 flex items-center gap-1">
          <NavItem to="/prompts" label="Prompts" />
          <NavItem to="/stats" label="Stats" />
        </nav>
        <UpdateButton />
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<SessionListPage />} />
          <Route path="/session/:id" element={<SessionViewPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
    </div>
  );
}
