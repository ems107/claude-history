import { useState } from 'react';
import { api } from '../api/client.ts';

/**
 * The whole app, from another machine, is behind this.
 *
 * Deliberately plain: it is served before anything is known about the caller,
 * so it names no session, no path and no version — everything on this screen is
 * a constant. The one thing it does carry is the reason a failure happened,
 * because "wrong password" and "too many attempts, wait 40 seconds" are
 * different problems and only the second one is solved by waiting.
 */
export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    api
      .login(username, password)
      .then(() => {
        setPassword('');
        onSignedIn();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const field = 'w-full rounded border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm focus:border-[var(--text-dim)] focus:outline-none';

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-3">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-[var(--accent)]">claude</span> history
        </h1>
        <p className="text-xs text-[var(--text-dim)]">
          Sign in to browse this machine&apos;s conversations from here.
        </p>
        {/* autocomplete is what lets the browser's password manager store and
            offer these — on a screen typed into rarely, that is the difference
            between a good password and a memorable one. */}
        <input
          className={field}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          autoFocus
          disabled={busy}
        />
        <input
          className={field}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !username || !password}
          className="w-full cursor-pointer rounded border border-[var(--accent-dim)] px-2 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:cursor-default disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <p className="pt-2 text-[11px] leading-relaxed text-[var(--text-dim)]">
          Forgotten it? There is no reset from here on purpose. Open claude-history on the machine it runs on and set a
          new username and password in Settings — no old password needed.
        </p>
      </form>
    </div>
  );
}
