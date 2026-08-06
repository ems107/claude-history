import { Link, Route, Routes, useNavigate } from 'react-router';
import { useEvents } from './api/useEvents.ts';
import { listUrl } from './lib/listState.ts';
import { SessionListPage } from './pages/SessionListPage.tsx';
import { SessionViewPage } from './pages/SessionViewPage.tsx';

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
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<SessionListPage />} />
          <Route path="/session/:id" element={<SessionViewPage />} />
        </Routes>
      </main>
    </div>
  );
}
