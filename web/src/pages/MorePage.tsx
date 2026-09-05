import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import { api } from '../api/client.ts';
import { UpdateButton } from '../components/UpdateButton.tsx';
import { UsageWidget } from '../components/UsageWidget.tsx';
import { useIsMobile } from '../lib/mobile.ts';

/**
 * Everything the bottom bar could not hold, as a PAGE.
 *
 * A page rather than a sheet, and that is the decision worth writing down: the
 * hardware Back button is the one control on an Android device that every app
 * shares, and the only way to be certain it does the right thing is to have
 * nothing to undo. A route is Back's native business. A popover would have meant
 * pushing a history entry of our own and taking it off again when the sheet
 * closes — which is fine until somebody taps a destination inside it, at which
 * point the entry has to come off and a navigation has to go on, in that order,
 * through an API where neither is synchronous.
 *
 * Its destinations navigate with `replace`, so the menu is not a step in the
 * history: Back from Stats goes where you were before you opened the menu, not
 * back into the menu.
 *
 * Only ever drawn on a phone. On a desktop every one of these is in the header,
 * so a bookmark landing here is sent home rather than shown a stranded list.
 */

function Row({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link
      to={to}
      replace
      className="flex min-h-14 items-center gap-3 border-b border-[var(--border)] px-4 py-2 active:bg-[var(--bg-hover)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[var(--text)]">{label}</span>
        <span className="block text-xs text-[var(--text-dim)]">{hint}</span>
      </span>
      <span aria-hidden className="shrink-0 text-[var(--text-dim)]">
        ›
      </span>
    </Link>
  );
}

export function MorePage() {
  const mobile = useIsMobile();
  const { data: meta } = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const { data: update } = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });
  if (!mobile) return <Navigate to="/" replace />;
  return (
    <div className="h-full overflow-y-auto">
      <h1 className="px-4 pt-4 pb-2 text-lg font-semibold">More</h1>
      <Row to="/plans" label="Plans" hint="Every plan written in a session, newest first" />
      <Row to="/stats" label="Stats" hint="What the conversations cost, by day and by model" />
      <Row to="/settings" label="Settings" hint="Notifications, Claude, remote access, data" />
      <Row to="/logs" label="Logs" hint="What this server has been doing" />

      {/* The two header widgets that have nowhere else to go on a phone. They
          bring their own popovers, so the row they sit in is `relative`. */}
      <div className="relative flex flex-wrap items-center gap-3 px-4 py-4">
        <UsageWidget />
        <UpdateButton />
      </div>

      <p className="px-4 pb-6 text-xs text-[var(--text-dim)]">
        {meta?.devInstance ? (
          <>
            Development instance on port {window.location.port}, with its own data folder. The installed release on
            7433 is untouched by it.
          </>
        ) : (
          <>
            {update?.installed ? `Version ${update.currentVersion}` : 'Running from source'} ·{' '}
            {meta?.sessionCount ?? 0} sessions in {meta?.projectCount ?? 0} projects
          </>
        )}
      </p>
    </div>
  );
}
