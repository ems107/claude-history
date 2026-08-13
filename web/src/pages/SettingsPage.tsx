import {
  type AppSettings,
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  DEFAULT_SETTINGS,
  LOG_LEVEL_CHOICES,
  MIN_CHAT_IDLE_MINUTES,
  MIN_USAGE_INTERVAL_SECONDS,
  MIN_USAGE_RATE_LIMIT_SECONDS,
} from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../api/client.ts';
import { markUsageRead } from '../api/usageReason.ts';
import { RetentionPanel } from '../components/RetentionPanel.tsx';
import { formatDateTime, relativeTime, timeUntil } from '../lib/format.ts';

function Section({
  title,
  children,
  id,
  highlight,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
  /** Just arrived here from an anchor link: flash once, then settle. */
  highlight?: boolean;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] p-4 ${
        highlight ? 'anchor-flash' : ''
      }`}
    >
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
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
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

/** Must match the `anchor-flash` animation in styles.css. */
const ANCHOR_FLASH_MS = 2_500;

const asText = (v: boolean | number | string): string => {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v || 'empty';
  return String(v);
};

const inputClass =
  'w-full rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 disabled:opacity-40 focus:border-[var(--text-dim)] focus:outline-none';

/**
 * A text setting. Unlike the toggles and number inputs above it does NOT save
 * on every keystroke — that would be one request (and one userdata write) per
 * letter typed. It commits when the field loses focus or on Enter, and Escape
 * puts the saved value back.
 */
function TextSetting({
  value,
  onCommit,
  placeholder,
  mono,
  disabled,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') setDraft(value);
      }}
      className={`${inputClass} ${mono ? 'font-mono text-[11px]' : ''}`}
    />
  );
}

/**
 * Shown only next to a setting that no longer holds its default, and clicking
 * it puts the default back. It spells the default value out because that is
 * the question the marker raises ("changed from what?"), which also saves
 * documenting the defaults anywhere else.
 *
 * Must be rendered OUTSIDE the row's <label>: a button inside a label steals
 * the click for the label's own control.
 */
function DefaultBadge<K extends keyof AppSettings>({
  field,
  value,
  save,
}: {
  field: K;
  value: AppSettings[K];
  save: (patch: Partial<AppSettings>) => void;
}) {
  const fallback = DEFAULT_SETTINGS[field];
  if (value === fallback) return null;
  return (
    <button
      type="button"
      onClick={() => save({ [field]: fallback } as Partial<AppSettings>)}
      title={`Changed from the default. Click to restore it (${asText(fallback)}).`}
      className="flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded border border-transparent px-1.5 py-px text-[10px] text-[var(--text-dim)] hover:border-[var(--border)] hover:text-[var(--text)]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
      default {asText(fallback)}
    </button>
  );
}

/**
 * What the auto-reload is actually doing. Its main job is the case the settings
 * above cannot express: switched on, yet unable to ever fire. So it always
 * spells out the reason rather than just showing a state.
 */
function AutoReloadStatusPanel() {
  const queryClient = useQueryClient();
  const { data: st } = useQuery({
    queryKey: ['autoReload'],
    queryFn: api.autoReload,
    // Faster while something is in flight: a send lasts seconds and its
    // read-back about a minute, and both end by changing this very state.
    refetchInterval: (query) => (query.state.data?.sending || query.state.data?.verifying ? 3_000 : 30_000),
    // This is live state that also drives what the button below allows, and the
    // interval does NOT run in a hidden tab. Without a focus refetch (the app
    // turns it off globally) the panel freezes on whatever it last saw — most
    // painfully mid-send, leaving the button stuck disabled after it finished.
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (!st) return <p className="text-[var(--text-dim)]">Loading status…</p>;

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const runTest = () => {
    if (
      !confirm(
        'Send the message now?\n\nThis really sends it: it starts a 5-hour window and leaves a session in your history. ' +
          'It is also the only way to prove the folder, the CLI and the permissions work.',
      )
    ) {
      return;
    }
    setTesting(true);
    setResult(null);
    void api
      .autoReloadRun()
      .then((run) =>
        setResult(
          // The answer comes back as soon as Claude has answered, which is what
          // the button is really testing. Whether a window opened is read back a
          // minute later, in the background, and lands in "last message" above.
          run.ok
            ? `Sent in ${seconds(run.durationMs)} — reading the window back in a minute; the result appears above.`
            : `Failed: ${run.error ?? 'unknown error'}`,
        ),
      )
      .catch((e: unknown) => setResult(`Failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        setTesting(false);
        void queryClient.invalidateQueries({ queryKey: ['autoReload'] });
        // A window may have just started, so this read has a real cause — and
        // one worth naming, since an unlabelled read here is precisely the kind
        // that used to show up in the log as a bare, unexplained 'widget'.
        markUsageRead('widget-auto-reload');
        void queryClient.invalidateQueries({ queryKey: ['usage'] });
      });
  };

  // The server decides this, and it is the same string it would refuse the
  // request with — so the button's disabled state and its explanation cannot
  // disagree. Anything transient in here clears itself in seconds.
  const blocked = st.runBlockedReason;

  let tone = 'text-emerald-400';
  let headline = 'Active.';
  if (st.sending) headline = 'Active — sending a message right now.';
  else if (st.verifying) headline = 'Active — sent; reading the window back.';
  else if (st.running) headline = 'Active — checking right now.';
  if (!st.enabled) {
    tone = 'text-[var(--text-dim)]';
    headline = st.configError
      ? `Off. It will also need this fixed: ${st.configError}`
      : 'Off — nothing is read and nothing is sent.';
  } else if (st.configError) {
    // Switched on but stopped: the scheduler bails out on this before every
    // check, so say "stopped" rather than implying it is merely degraded.
    tone = 'text-amber-400';
    headline = `Switched on, but stopped — ${st.configError}`;
  } else if (st.pausedReason) {
    tone = 'text-amber-400';
    headline = `${st.pausedReason}. Save any setting above to try again.`;
  }

  const run = st.lastRun;
  return (
    <div className="space-y-2 border-t border-[var(--border)] pt-3">
      <p className={tone}>{headline}</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--text-dim)]">
        <span className="opacity-60">5-hour window</span>
        <span>
          {/* A known expiry can already be in the past — a read is due but has
              not succeeded yet. Saying "now left" there reads like a live
              window with no time on it, which is the opposite of the truth. */}
          {!st.resetsAt
            ? 'not started'
            : Date.parse(st.resetsAt) > Date.now()
              ? `resets ${formatDateTime(st.resetsAt)} (${timeUntil(st.resetsAt) ?? '—'} left)`
              : `expired ${formatDateTime(st.resetsAt)} — waiting for a successful reading`}
        </span>
        <span className="opacity-60">next check</span>
        <span>
          {st.nextCheckAt ? `${formatDateTime(st.nextCheckAt)} (in ${timeUntil(st.nextCheckAt) ?? '—'})` : 'not scheduled'}
        </span>
        <span className="opacity-60">last check</span>
        <span>{st.lastCheckAt ? `${formatDateTime(st.lastCheckAt)} (${relativeTime(st.lastCheckAt)})` : 'never'}</span>
        {/* The figures are read once and shared, so most of the time this says
            the widget did the asking. That is the point: this panel and the
            header can no longer disagree about the token or the window — and
            the error belongs here, to the reading, not to the check above. */}
        <span className="opacity-60">shared reading</span>
        <span>
          {st.lastReadAt
            ? `${formatDateTime(st.lastReadAt)} (${relativeTime(st.lastReadAt)})${
                st.lastReadTrigger ? ` · last asked by ${st.lastReadTrigger}` : ''
              }`
            : 'never read'}
          {st.lastError && <span className="ml-2 text-amber-400">{st.lastError}</span>}
        </span>
        <span className="opacity-60">claude cli</span>
        <span className="break-all">{st.cliPath ?? 'not found'}</span>
        {run && (
          <>
            <span className="opacity-60">last message</span>
            <span>
              {formatDateTime(run.at)} ({relativeTime(run.at)}){run.manual ? ', manual' : ''} —{' '}
              {/* Until the read-back has happened, `windowStarted: false` means
                  "not known yet" — saying "no window" there would be a verdict
                  on something nobody has looked at. */}
              {run.windowStarted
                ? run.windowAlreadyRunning
                  ? // It answered and the token is fresh, but the window it found
                    // predates it: claiming it started one would be a lie, and the
                    // reload that window's expiry is owed is still to come.
                    `answered in ${seconds(run.durationMs)} — a window was already running, so a reload is still due at its expiry`
                  : `started a window in ${seconds(run.durationMs)}`
                : !run.verifiedAt
                  ? `answered in ${seconds(run.durationMs)} — reading the window back`
                  : run.ok
                    ? `answered, no window: ${run.error ?? '—'}`
                    : `failed: ${run.error ?? '—'}`}
              {run.reply && <span className="block opacity-60">“{run.reply}”</span>}
            </span>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {/* Two states only: our own request in flight (the label says so), or
            `blocked`, which always carries its reason. Nothing else may disable
            this — no cooldown, no backoff, no scheduled check — because every
            one of those waits guards the automatic side, and this button is the
            user asking. A pause does not block it either: a successful run is
            what clears one. */}
        <button
          type="button"
          className={btn}
          disabled={testing || blocked !== null}
          title={blocked ?? 'Sends the message right now, exactly as the schedule would'}
          onClick={runTest}
        >
          {testing ? 'Sending…' : 'Send it now'}
        </button>
        {/* A disabled button must never be a puzzle: say it here, not just on
            hover. Tied to the same value that disables it, so there is no way to
            end up dead and silent. */}
        {blocked && !testing && <span className="text-[11px] text-[var(--text-dim)]">{blocked}</span>}
        {result && <span className="text-[11px] text-[var(--text-dim)]">{result}</span>}
      </div>
    </div>
  );
}

/** A setting and its "changed from default" marker, aligned on the first line. */
function Row({ children, badge }: { children: React.ReactNode; badge: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">{children}</div>
      {badge}
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const update = useQuery({ queryKey: ['update'], queryFn: api.updateStatus });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [wipeData, setWipeData] = useState(false);
  const [uninstalled, setUninstalled] = useState(false);

  // Arriving from the "change" link at the foot of the session list: this page
  // is long, so land on the block that was asked for and mark it for a moment —
  // scrolling alone leaves you looking at a wall of settings with no clue which
  // one you were sent to. Keyed on whether the settings have loaded (the
  // sections do not exist before that) and on the navigation's own key, so
  // following the same link twice flashes again; never on the settings object
  // itself, which changes on every save and would yank the page back mid-edit.
  const { hash, key: navigationKey } = useLocation();
  const loaded = !!data;
  const [flashed, setFlashed] = useState<string | null>(null);
  useEffect(() => {
    if (!hash || !loaded) return;
    const id = hash.slice(1);
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
    setFlashed(id);
    // Dropped once the animation is over, so the class does not linger and
    // replay on the next unrelated re-render.
    const timer = setTimeout(() => setFlashed(null), ANCHOR_FLASH_MS);
    return () => clearTimeout(timer);
  }, [hash, navigationKey, loaded]);

  if (!data) return <div className="p-8 text-[var(--text-dim)]">Loading settings…</div>;

  const save = (patch: Partial<AppSettings>) => {
    void api.saveSettings(patch).then((r) => {
      queryClient.setQueryData(['settings'], { ...data, settings: r.settings });
      markUsageRead('widget-settings');
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
      void queryClient.invalidateQueries({ queryKey: ['autoReload'] });
      // The hidden-folder option changes what the browsing views contain.
      for (const key of ['sessions', 'projects', 'prompts']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    });
  };

  const s = data.settings;
  // With the feature off, none of its settings do anything — including the
  // hidden-folder one, which the server also ignores. Grey them all out rather
  // than leave controls that look live and are not.
  const autoReloadOff = !s.autoReloadEnabled;
  const dimmed = autoReloadOff ? 'opacity-40' : '';
  const chatOff = s.chatEnabled ? '' : 'opacity-40';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold">Settings</h1>

        <Section title="Updates">
          <Row badge={<DefaultBadge field="updateAutoCheck" value={s.updateAutoCheck} save={save} />}>
            <Toggle
              checked={s.updateAutoCheck}
              onChange={(v) => save({ updateAutoCheck: v })}
              label="Check for new versions automatically"
              hint="A small request to the GitHub releases API. Updates are never downloaded or installed without your confirmation."
            />
          </Row>
          <Row badge={<DefaultBadge field="updateIntervalMinutes" value={s.updateIntervalMinutes} save={save} />}>
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
          </Row>
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
          <Row badge={<DefaultBadge field="usageWidget" value={s.usageWidget} save={save} />}>
            <Toggle
              checked={s.usageWidget}
              onChange={(v) => save({ usageWidget: v })}
              label="Show subscription usage in the header"
              hint="Reads the OAuth token stored by Claude Code (read-only, never refreshed or modified) and asks Anthropic for the same 5-hour and weekly figures /usage shows."
            />
          </Row>
          <Row badge={<DefaultBadge field="usageMinIntervalSeconds" value={s.usageMinIntervalSeconds} save={save} />}>
            <label className="flex items-center gap-2">
              <span>Ask Anthropic at most once every</span>
              <input
                type="number"
                min={MIN_USAGE_INTERVAL_SECONDS}
                max={3600}
                step={5}
                value={s.usageMinIntervalSeconds}
                disabled={!s.usageWidget}
                onChange={(e) => save({ usageMinIntervalSeconds: Number(e.target.value) })}
                className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right disabled:opacity-40"
              />
              <span>seconds (minimum {MIN_USAGE_INTERVAL_SECONDS})</span>
            </label>
            <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">
              The floor for every trigger below and for the 5-hour auto-start, which all share one reading. Anything
              asking sooner is given the figures already in hand, at no cost. The Refresh button is the one exception.
            </p>
          </Row>

          <Row
            badge={
              <DefaultBadge field="usageRateLimitBackoffSeconds" value={s.usageRateLimitBackoffSeconds} save={save} />
            }
          >
            <label className="flex items-center gap-2">
              <span>After a rate limit (HTTP 429), wait</span>
              <input
                type="number"
                min={MIN_USAGE_RATE_LIMIT_SECONDS}
                max={7200}
                step={60}
                value={s.usageRateLimitBackoffSeconds}
                disabled={!s.usageWidget}
                onChange={(e) => save({ usageRateLimitBackoffSeconds: Number(e.target.value) })}
                className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right disabled:opacity-40"
              />
              <span>seconds (minimum {MIN_USAGE_RATE_LIMIT_SECONDS})</span>
            </label>
            <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">
              A 429 is Anthropic saying outright that we ask too often, so it replaces the floor above for as long as it
              lasts and silences every trigger — again, except Refresh. The last figures stay on screen meanwhile.
            </p>
          </Row>

          {/* Each trigger is a switch, and the ones with a number carry it
              inline: a cadence you cannot see next to its own switch is a
              setting you have to go looking for. */}
          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-[var(--text)]">Re-read the figures:</p>

            <Row badge={<DefaultBadge field="usageOnActivity" value={s.usageOnActivity} save={save} />}>
              <Toggle
                checked={s.usageOnActivity}
                onChange={(v) => save({ usageOnActivity: v })}
                disabled={!s.usageWidget}
                label="When Claude answers"
                hint="The trigger that matters: an assistant reply being written is the only local event that means tokens were just spent. Your own prompts, tool results and the bookkeeping lines rewritten every turn are ignored — they move the file, not the figures."
              />
            </Row>

            <Row badge={<DefaultBadge field="usageOnInterval" value={s.usageOnInterval} save={save} />}>
              <Toggle
                checked={s.usageOnInterval}
                onChange={(v) => save({ usageOnInterval: v })}
                disabled={!s.usageWidget}
                label="On a fixed interval while nothing happens here"
                hint="Its one job is catching usage burnt somewhere else — another machine, the web app, your phone."
              />
              {/* The badge sits outside the label on purpose: inside it, a
                  click on "default 300" would also grab the input. */}
              <div className="mt-1 flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <span>every</span>
                  <input
                    type="number"
                    min={MIN_USAGE_INTERVAL_SECONDS}
                    max={3600}
                    step={15}
                    value={s.usageIntervalSeconds}
                    disabled={!s.usageWidget || !s.usageOnInterval}
                    onChange={(e) => save({ usageIntervalSeconds: Number(e.target.value) })}
                    className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right disabled:opacity-40"
                  />
                  <span>seconds</span>
                </label>
                <DefaultBadge field="usageIntervalSeconds" value={s.usageIntervalSeconds} save={save} />
              </div>
            </Row>

            <Row badge={<DefaultBadge field="usageOnFocus" value={s.usageOnFocus} save={save} />}>
              <Toggle
                checked={s.usageOnFocus}
                onChange={(v) => save({ usageOnFocus: v })}
                disabled={!s.usageWidget}
                label="When you come back to this window"
                hint="Fires on every tab switch and every unminimize, which is far more often than it sounds — hence the tolerance below."
              />
              <div className="mt-1 flex items-center gap-2">
                <label className="flex items-center gap-2">
                  <span>but only if the figures are older than</span>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    step={15}
                    value={s.usageFocusMaxAgeSeconds}
                    disabled={!s.usageWidget || !s.usageOnFocus}
                    onChange={(e) => save({ usageFocusMaxAgeSeconds: Number(e.target.value) })}
                    className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right disabled:opacity-40"
                  />
                  <span>seconds (0 = always)</span>
                </label>
                <DefaultBadge field="usageFocusMaxAgeSeconds" value={s.usageFocusMaxAgeSeconds} save={save} />
              </div>
            </Row>

            <Row badge={<DefaultBadge field="usageOnReset" value={s.usageOnReset} save={save} />}>
              <Toggle
                checked={s.usageOnReset}
                onChange={(v) => save({ usageOnReset: v })}
                disabled={!s.usageWidget}
                label="Just after a window resets"
                hint="Nothing here announces a window dropping back to 0%, so without this the widget shows the old percentage until something else asks."
              />
            </Row>
          </div>

          <div className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            <p>
              Two more read on their own and have no switch, because neither can be an unwanted read:{' '}
              <span className="text-[var(--text)]">opening the page</span>, and{' '}
              <span className="text-[var(--text)]">getting your connection back</span> after being offline.
            </p>
            <p className="mt-2">
              <span className="text-[var(--text)]">On demand</span> always works, with the Refresh button inside the
              usage popover — the only read that ignores both waits above, always asking Anthropic.
            </p>
            <p className="mt-2">
              If a read fails, the last figures stay on screen marked as old (amber border) instead of the widget going
              blank. Every read is written to the log with what caused it.
            </p>
          </div>
        </Section>

        <Section title="Auto-start the 5-hour window">
          <Row badge={<DefaultBadge field="autoReloadEnabled" value={s.autoReloadEnabled} save={save} />}>
            <Toggle
              checked={s.autoReloadEnabled}
              onChange={(v) => save({ autoReloadEnabled: v })}
              label="Start the 5-hour window as soon as it is free"
              hint="A window only starts when something is sent, so an idle night leaves it unstarted and pushes the next reset into the middle of your day. This sends one throwaway message to start it right away."
            />
          </Row>
          <Row badge={<DefaultBadge field="autoReloadModel" value={s.autoReloadModel} save={save} />}>
            <label className={`flex items-center gap-2 ${dimmed}`}>
              <span>Model</span>
              <select
                value={s.autoReloadModel}
                disabled={autoReloadOff}
                onChange={(e) => save({ autoReloadModel: e.target.value })}
                className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 disabled:opacity-40"
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-[var(--text-dim)]">the cheapest one is enough — the reply is thrown away</span>
            </label>
          </Row>
          <Row badge={<DefaultBadge field="autoReloadMessage" value={s.autoReloadMessage} save={save} />}>
            <label className={`block ${dimmed}`}>
              <span className="mb-1 block">Message to send</span>
              <TextSetting
                value={s.autoReloadMessage}
                onCommit={(v) => save({ autoReloadMessage: v })}
                placeholder={DEFAULT_SETTINGS.autoReloadMessage}
                disabled={autoReloadOff}
              />
            </label>
          </Row>
          {/* No default marker here: its default is empty, and a one-click
              "restore" would quietly disable the whole feature. */}
          <label className={`block ${dimmed}`}>
            <span className="mb-1 block">
              Folder to run it in <span className="text-[var(--text-dim)]">(required)</span>
            </span>
            <TextSetting
              value={s.autoReloadCwd}
              onCommit={(v) => save({ autoReloadCwd: v })}
              placeholder="C:\\some\\folder"
              mono
              disabled={autoReloadOff}
            />
          </label>
          <Row badge={<DefaultBadge field="autoReloadHideSessions" value={s.autoReloadHideSessions} save={save} />}>
            <Toggle
              checked={s.autoReloadHideSessions}
              onChange={(v) => save({ autoReloadHideSessions: v })}
              disabled={autoReloadOff}
              label="Hide that folder's sessions from this app"
              hint="Everything in the folder above is left out of the session list, the project filters, the counts, search, the stats and the prompts page. Nothing is deleted: the sessions stay on disk and a direct link still opens them."
            />
          </Row>
          <div className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            <span className="text-[var(--text)]">How it works:</span>
            <ul className="mt-1 ml-4 list-disc space-y-1 marker:text-[var(--text-dim)]/50">
              <li>
                <span className="text-[var(--text)]">It does not poll.</span> Every reading says exactly when the window
                expires, so it sleeps until that moment plus a minute and only then asks again — about five reads a day.
              </li>
              <li>
                <span className="text-[var(--text)]">No browser needed.</span> This one runs in the server, unlike the
                usage widget above, so it keeps working with the app closed — as long as the machine is on and you are
                logged in.
              </li>
              <li>
                <span className="text-[var(--text)]">Each message leaves a real session</span> in the folder above, and it
                stays in your history: nothing here ever deletes anything from your Claude data. That is what the option
                above is for.
              </li>
              <li>
                <span className="text-[var(--text)]">It knows when to stop.</span> A failed reading is never mistaken for
                a free window, there is half an hour between messages whatever happens, and after three failed attempts
                in a row it pauses itself and says why.
              </li>
            </ul>
          </div>
          <AutoReloadStatusPanel />
        </Section>

        <Section title="Send prompts from the app">
          <Row badge={<DefaultBadge field="chatEnabled" value={s.chatEnabled} save={save} />}>
            <Toggle
              checked={s.chatEnabled}
              onChange={(v) => save({ chatEnabled: v })}
              label="Show a composer at the foot of every session"
              hint="Continue a conversation without leaving the app. The prompt goes to a Claude Code process the server keeps alive for that session, and the answer appears in the viewer as it is written to the transcript. Sending is blocked while the session is open in a terminal: two processes writing the same transcript corrupt it."
            />
          </Row>
          <Row badge={<DefaultBadge field="chatModel" value={s.chatModel} save={save} />}>
            <label className={`flex items-center gap-2 ${chatOff}`}>
              <span>Model</span>
              <select
                value={s.chatModel}
                disabled={!s.chatEnabled}
                onChange={(e) => save({ chatModel: e.target.value })}
                className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 disabled:opacity-40"
              >
                {CLAUDE_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-[var(--text-dim)]">the starting point — each session's composer can change it</span>
            </label>
          </Row>
          <Row badge={<DefaultBadge field="chatEffort" value={s.chatEffort} save={save} />}>
            <label className={`flex items-center gap-2 ${chatOff}`}>
              <span>Effort</span>
              <select
                value={s.chatEffort}
                disabled={!s.chatEnabled}
                onChange={(e) => save({ chatEffort: e.target.value })}
                className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 disabled:opacity-40"
              >
                {CLAUDE_EFFORTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </Row>
          <Row badge={<DefaultBadge field="chatIdleTimeoutMinutes" value={s.chatIdleTimeoutMinutes} save={save} />}>
            <label className={`flex items-center gap-2 ${chatOff}`}>
              <span>Close an idle process after</span>
              <input
                type="number"
                min={MIN_CHAT_IDLE_MINUTES}
                max={240}
                step={5}
                value={s.chatIdleTimeoutMinutes}
                disabled={!s.chatEnabled}
                onChange={(e) => save({ chatIdleTimeoutMinutes: Number(e.target.value) })}
                className="w-16 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right disabled:opacity-40"
              />
              <span>minutes (minimum {MIN_CHAT_IDLE_MINUTES})</span>
            </label>
          </Row>
          <div className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            Tools run under Claude Code's <span className="text-[var(--text)]">auto</span> permission mode, so nothing
            stops to ask — the same as pressing Shift+Tab into auto mode in a terminal. Your MCP servers are loaded as
            usual, so the first prompt of a session takes a moment longer than the ones after it.
          </div>
        </Section>

        {/* Claude Code's setting, not ours — shown and explained, never written.
            The id is what the session list's "change" link scrolls to. */}
        <Section
          title="How long Claude keeps your history"
          id="claude-retention"
          highlight={flashed === 'claude-retention'}
        >
          <RetentionPanel />
        </Section>

        <Section title="Logs">
          <Row badge={<DefaultBadge field="logLevel" value={s.logLevel} save={save} />}>
            <label className="flex items-center gap-2">
              <span>Write everything from</span>
              <select
                value={s.logLevel}
                onChange={(e) => save({ logLevel: e.target.value as AppSettings['logLevel'] })}
                className="cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5"
              >
                {LOG_LEVEL_CHOICES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <span>upwards</span>
            </label>
          </Row>
          <Row badge={<DefaultBadge field="logRetentionDays" value={s.logRetentionDays} save={save} />}>
            <label className="flex items-center gap-2">
              <span>Keep</span>
              <input
                type="number"
                min={1}
                max={365}
                value={s.logRetentionDays}
                onChange={(e) => save({ logRetentionDays: Number(e.target.value) })}
                className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right"
              />
              <span>days of daily log files</span>
            </label>
          </Row>
          <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            One file per day in <span className="font-mono">{data.paths.logsDir}</span>, written by every way of running
            the app so the trail is never split. <span className="text-[var(--text)]">debug</span> is worth turning on
            while chasing something — it records each decision the background jobs take, not just their outcomes.
          </p>
          <Link
            to="/logs"
            className="inline-block rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] hover:text-[var(--text)]"
          >
            Open the log viewer →
          </Link>
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
            <span className="opacity-60">logs</span>
            <span className="break-all">{data.paths.logsDir}</span>
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
              disabled={!data.paths.installRoot}
              title={data.paths.installRoot ?? 'Not a managed install'}
              onClick={() => void api.openInstallFolder()}
            >
              Open install folder
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
                // The server refuses while an update is being installed:
                // stopping would abort the download and lose it.
                void api.stopServer().catch((e) => {
                  setStopped(false);
                  setNote(String(e instanceof Error ? e.message : e));
                });
              }}
            >
              {stopped ? 'Stopping…' : 'Stop server'}
            </button>
            <button
              type="button"
              className={`${btn} border-red-500/40 text-red-300 hover:border-red-400`}
              disabled={!data.paths.installRoot || stopped}
              title={data.paths.installRoot ?? 'Not a managed install — nothing to uninstall'}
              onClick={() => setUninstalling(true)}
            >
              Uninstall
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

      {uninstalling && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-32">
          <div className="w-[520px] max-w-[92vw] rounded-lg border border-red-500/40 bg-[var(--bg-raised)] p-4 shadow-xl">
            <h2 className="mb-2 text-sm font-semibold text-red-300">Uninstall claude-history</h2>
            {uninstalled ? (
              <p className="text-xs">
                Uninstalling. The server is stopping and the app is being removed — this page will stop responding in a
                few seconds. Nothing in <span className="font-mono">~/.claude</span> is ever touched.
              </p>
            ) : (
              <>
                <p className="text-xs">This removes:</p>
                <ul className="mt-1 list-inside list-disc text-xs text-[var(--text-dim)]">
                  <li>the scheduled task that starts it at logon, and the Start Menu shortcut</li>
                  <li>
                    the install folder <span className="font-mono">{data.paths.installRoot}</span>
                  </li>
                </ul>
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={wipeData}
                    onChange={(e) => setWipeData(e.target.checked)}
                    className="mt-0.5 accent-red-400"
                  />
                  <span>
                    Also delete my data — renames, pins, prices, settings and cache
                    <span className="block font-mono text-[11px] text-[var(--text-dim)]">
                      {data.paths.userdataFile}
                    </span>
                  </span>
                </label>
                <p className="mt-2 text-[11px] text-[var(--text-dim)]">
                  Your Claude conversations are never touched — this tool only ever reads them.
                </p>
              </>
            )}
            <div className="mt-4 flex justify-end gap-1.5">
              {!uninstalled && (
                <button
                  type="button"
                  className={`${btn} border-red-500/50 text-red-300 hover:border-red-400`}
                  onClick={() => {
                    setUninstalled(true);
                    void api.uninstall(wipeData).catch((e) => setNote(`Uninstall failed: ${String(e)}`));
                  }}
                >
                  {wipeData ? 'Uninstall and delete data' : 'Uninstall'}
                </button>
              )}
              <button
                type="button"
                className={btn}
                onClick={() => {
                  setUninstalling(false);
                  setUninstalled(false);
                  setWipeData(false);
                }}
              >
                {uninstalled ? 'Close' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
