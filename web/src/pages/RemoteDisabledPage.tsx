/**
 * What a browser on another machine sees while remote access is off.
 *
 * This page is the reason the server listens on every interface even when the
 * feature is switched off: a socket that refuses the connection outright leaves
 * a browser error page, which cannot explain anything and reads like the app
 * being broken. This can say what is true — it is off, and here is the one
 * place it can be turned on.
 *
 * It names no port, path, version or session: it is served to anyone who can
 * reach the machine, and every one of those would be something learnt without
 * signing in. "Settings" is enough for the only person who can act on it, who
 * by definition has the app in front of them.
 */
export function RemoteDisabledPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm space-y-3">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-[var(--accent)]">claude</span> history
        </h1>
        <p className="text-sm">Remote access is turned off on this machine.</p>
        <p className="text-xs leading-relaxed text-[var(--text-dim)]">
          To use it from here, open claude-history on the machine it runs on and turn on{' '}
          <span className="text-[var(--text)]">Remote access</span> in Settings. It asks for a username and password at
          the same time — they can only be set there.
        </p>
      </div>
    </div>
  );
}
