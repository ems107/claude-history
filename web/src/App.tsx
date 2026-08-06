import { Route, Routes } from 'react-router';

function Placeholder() {
  return (
    <div className="flex h-full items-center justify-center text-[var(--text-dim)]">
      Session list coming soon…
    </div>
  );
}

export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
        <span className="text-lg font-semibold tracking-tight">
          <span className="text-[var(--accent)]">claude</span> history
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Placeholder />} />
        </Routes>
      </main>
    </div>
  );
}
