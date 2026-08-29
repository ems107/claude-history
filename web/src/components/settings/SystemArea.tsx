import { LOG_LEVEL_CHOICES } from '@claude-history/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client.ts';
import { useLocalOnly } from '../../api/useLocal.ts';
import { formatDateTime, relativeTime } from '../../lib/format.ts';
import { useActiveSessionsGuard } from '../ActiveSessionsDialog.tsx';
import { actionClass } from '../controlClass.ts';
import { useSettingsPage } from './context.ts';
import { DangerZone } from './DangerZone.tsx';
import { Anchored, Explain, GroupCard, NumberField, Readout, ReadoutRow, SelectField } from './controls.tsx';

/**
 * The instance itself: what it checks for, what it writes down, and where.
 *
 * Everything here is about the copy of claude-history you are looking at rather
 * than about Claude — which is the line that finally separated the update check
 * (it was the first thing on the old page for no reason but age) from the things
 * people actually come here to change.
 */
export function SystemArea() {
  const { settings, meta, dev } = useSettingsPage();
  const update = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });
  const guard = useActiveSessionsGuard();
  const dataFolder = useLocalOnly('openDataFolder');
  const installFolder = useLocalOnly('openInstallFolder');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const clearCacheNow = () => {
    setBusy(true);
    void api
      .clearCache()
      .then(() => setNote('Cache deleted. It rebuilds itself the next time the server starts.'))
      .catch((e: unknown) => {
        // Refused while the app is running Claude: the dialog lists what to
        // close and clears once it is closed.
        if (guard.refused(e, clearCacheNow)) return;
        setNote(`Failed: ${String(e)}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <GroupCard
        id="updates"
        master="updateAutoCheck"
        masterHint="A small conditional request to the GitHub releases API — one of this app's only two automatic network calls."
        offNote="Nothing is checked and nothing is offered. The Check now button in the header still works whenever you press it."
      >
        <NumberField
          field="updateIntervalMinutes"
          before="Check every"
          after="minutes (minimum 5)"
          min={5}
          max={1440}
          disabled={!settings.updateAutoCheck}
          note="An update is never downloaded or installed without your confirmation."
        />
        <Readout>
          <ReadoutRow label="last check">
            {update.data?.lastCheckAt
              ? `${formatDateTime(update.data.lastCheckAt)} (${relativeTime(update.data.lastCheckAt)})`
              : 'never'}
            {update.data && update.data.available.length > 0 && (
              <span className="ml-2 text-amber-400">
                {update.data.available.length} new version{update.data.available.length !== 1 ? 's' : ''} available
              </span>
            )}
          </ReadoutRow>
        </Readout>
      </GroupCard>

      <GroupCard id="logs">
        <SelectField
          field="logLevel"
          before="Write everything from"
          options={LOG_LEVEL_CHOICES}
          after={<span>upwards</span>}
        />
        <NumberField
          field="logRetentionDays"
          before="Keep"
          after="days of daily log files"
          min={1}
          max={365}
          note="Anything older is deleted automatically."
        />
        {/* The folder is a fact about this instance, so it is a readout — the
            same shape the paths below use — rather than a path buried in a
            sentence, which is where it was and where nothing could be read off
            it at a glance. */}
        <Readout>
          <ReadoutRow label="folder">{meta.paths.logsDir}</ReadoutRow>
        </Readout>
        <Anchored id="act-log-viewer">
          <Link to="/logs" className={`inline-block ${actionClass}`}>
            Open the log viewer →
          </Link>
        </Anchored>
        <Explain label="When debug is worth turning on">
          <p>
            One file per day, written by every way of running the app — installed, from source, portable — so the trail
            is never split across builds.
          </p>
          <p>
            <span className="text-[var(--text)]">debug</span> records each decision the background jobs take rather than
            just their outcomes: which trigger asked for a usage read, why the auto-reload slept until a given moment,
            what the scanner decided about a file. It is what to turn on while chasing something, and to turn back down
            afterwards — the files are bigger, not slower.
          </p>
        </Explain>
      </GroupCard>

      <GroupCard id="paths">
        <Anchored id="info-paths">
          <Readout>
            <ReadoutRow label="version">{meta.version}</ReadoutRow>
            <ReadoutRow label="claude data">{meta.paths.dataRoot}</ReadoutRow>
            <ReadoutRow label="cache">{meta.paths.cacheDir}</ReadoutRow>
            <ReadoutRow label="your data">{meta.paths.userdataFile}</ReadoutRow>
            <ReadoutRow label="logs">{meta.paths.logsDir}</ReadoutRow>
            <ReadoutRow label="installed in">
              {meta.paths.installRoot ?? 'not a managed install (source or portable)'}
            </ReadoutRow>
            {dev && (
              <ReadoutRow label="instance">
                <span className="text-amber-400">
                  dev on port {window.location.port} — every path above is its own. The installed release on 7433 keeps
                  its own data and is never touched from here.
                </span>
              </ReadoutRow>
            )}
          </Readout>
        </Anchored>

        <div className="flex flex-wrap gap-1.5 pt-1">
          <Anchored id="act-open-data">
            <button
              type="button"
              className={actionClass}
              disabled={dataFolder.disabled}
              title={dataFolder.reason ?? undefined}
              onClick={() => void api.openDataFolder()}
            >
              Open data folder
            </button>
          </Anchored>
          <Anchored id="act-open-install">
            <button
              type="button"
              className={actionClass}
              disabled={!meta.paths.installRoot || installFolder.disabled}
              title={installFolder.reason ?? meta.paths.installRoot ?? 'Not a managed install'}
              onClick={() => void api.openInstallFolder()}
            >
              Open install folder
            </button>
          </Anchored>
          <Anchored id="act-clear-cache">
            <button
              type="button"
              className={actionClass}
              disabled={busy}
              onClick={clearCacheNow}
              title="Deletes the derived cache only. Your renames, pins, starred messages and prices live elsewhere and are kept."
            >
              {busy ? 'Clearing…' : 'Clear cache'}
            </button>
          </Anchored>
        </div>
        {note && <p className="text-[11px] text-[var(--text-dim)]">{note}</p>}

        <Explain label="What is safe to delete here">
          <p>
            The <span className="text-[var(--text)]">cache</span> is derived: every figure in it can be read again from{' '}
            <span className="font-mono">~/.claude</span>, so clearing it costs a rescan and nothing else.{' '}
            <span className="text-[var(--text)]">Your data</span> is the opposite — renames, pins, starred messages,
            prices and these settings — and it is the one file that cannot be rebuilt, which is what the copies under
            Your data are for.
          </p>
        </Explain>

        {/* Last in the group that names what they act on, and marked off from
            the benign buttons above rather than moved out of their reach. */}
        <DangerZone />
      </GroupCard>
    </>
  );
}
