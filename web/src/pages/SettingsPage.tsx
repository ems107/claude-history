import type { AppSettings } from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { formatDateTime, relativeTime } from '../lib/format.ts';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-3 text-xs">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[var(--accent)]"
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-[var(--text-dim)]">{hint}</span>}
      </span>
    </label>
  );
}

const btn =
  'cursor-pointer rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const update = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  if (!data) return <div className="p-8 text-[var(--text-dim)]">Loading settings…</div>;

  const save = (patch: Partial<AppSettings>) => {
    void api.saveSettings(patch).then((r) => {
      queryClient.setQueryData(['settings'], { ...data, settings: r.settings });
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    });
  };

  const s = data.settings;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold">Settings</h1>

        <Section title="Updates">
          <Toggle
            checked={s.updateAutoCheck}
            onChange={(v) => save({ updateAutoCheck: v })}
            label="Check for new versions automatically"
            hint="A small request to the GitHub releases API. Updates are never downloaded or installed without your confirmation."
          />
          <label className="flex items-center gap-2">
            <span>Check every</span>
            <input
              type="number"
              min={5}
              max={1440}
              value={s.updateIntervalMinutes}
              disabled={!s.updateAutoCheck}
              onChange={(e) => save({ updateIntervalMinutes: Number(e.target.value) })}
              className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right disabled:opacity-40"
            />
            <span>minutes (minimum 5)</span>
          </label>
          <div className="text-[var(--text-dim)]">
            Last check:{' '}
            {update.data?.lastCheckAt
              ? `${formatDateTime(update.data.lastCheckAt)} (${relativeTime(update.data.lastCheckAt)})`
              : 'never'}
            {update.data && update.data.available.length > 0 && (
              <span className="ml-2 text-amber-400">
                {update.data.available.length} new version{update.data.available.length !== 1 ? 's' : ''} available
              </span>
            )}
          </div>
        </Section>

        <Section title="Claude usage">
          <Toggle
            checked={s.usageWidget}
            onChange={(v) => save({ usageWidget: v })}
            label="Show subscription usage in the header"
            hint="Reads the OAuth token stored by Claude Code (read-only, never refreshed or modified) and asks Anthropic for the same 5-hour and weekly figures /usage shows. Refreshed at most every 5 minutes."
          />
        </Section>

        <Section title="Server & data">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--text-dim)]">
            <span className="opacity-60">version</span>
            <span>{data.version}</span>
            <span className="opacity-60">claude data</span>
            <span className="break-all">{data.paths.dataRoot}</span>
            <span className="opacity-60">cache</span>
            <span className="break-all">{data.paths.cacheDir}</span>
            <span className="opacity-60">your data</span>
            <span className="break-all">{data.paths.userdataFile}</span>
            <span className="opacity-60">installed in</span>
            <span className="break-all">{data.paths.installRoot ?? 'not a managed install (source or portable)'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button type="button" className={btn} onClick={() => void api.openDataFolder()}>
              Open data folder
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() => {
                setBusy('cache');
                void api
                  .clearCache()
                  .then(() => setNote('Cache deleted. It rebuilds itself the next time the server starts.'))
                  .catch((e) => setNote(`Failed: ${String(e)}`))
                  .finally(() => setBusy(null));
              }}
              title="Deletes the derived cache only. Your renames, pins and prices live elsewhere and are kept."
            >
              {busy === 'cache' ? 'Clearing…' : 'Clear cache'}
            </button>
            <button
              type="button"
              className={`${btn} border-red-500/40 text-red-300 hover:border-red-400`}
              disabled={stopped}
              onClick={() => {
                if (!confirm('Stop the claude-history server? This page will stop working until you start it again from the Start Menu shortcut or Task Scheduler.')) return;
                setStopped(true);
                void api.stopServer();
              }}
            >
              {stopped ? 'Stopping…' : 'Stop server'}
            </button>
          </div>
          {stopped && (
            <p className="text-[11px] text-amber-400">
              Server stopping. Start it again with the claude-history shortcut in the Start Menu, or from Task Scheduler
              (task “claude-history” → Run).
            </p>
          )}
          {note && <p className="text-[11px] text-[var(--text-dim)]">{note}</p>}
        </Section>
      </div>
    </div>
  );
}
