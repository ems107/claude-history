import { Link, Route, Routes } from 'react-router';
import { SessionListPage } from './pages/SessionListPage.tsx';

function SessionViewStub() {
  return (
    <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
      Conversation viewer coming soon…
    </div>
  );
}

export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          <span className="text-[var(--accent)]">claude</span> history
        </Link>
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<SessionListPage />} />
          <Route path="/session/:id" element={<SessionViewStub />} />
        </Routes>
      </main>
    </div>
  );
}
