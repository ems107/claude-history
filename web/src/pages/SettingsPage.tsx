import {
  ACTIVE_SESSIONS_MAX,
  ACTIVE_SESSIONS_MIN,
  type AppSettings,
  CLAUDE_MODELS,
  DEFAULT_SETTINGS,
  defaultSettings,
  LOG_LEVEL_CHOICES,
  CHAT_IDLE_TIMEOUT_MINUTES,
  MIN_USAGE_INTERVAL_SECONDS,
  MIN_USAGE_RATE_LIMIT_SECONDS,
  NOTIFICATION_TONES,
  NOTIFY_VOLUME_MAX,
  NOTIFY_VOLUME_MIN,
  TONE_INHERIT,
  TONE_NONE,
  type ToneChoice,
  type ToneId,
} from '@claude-history/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../api/client.ts';
import { markUsageRead } from '../api/usageReason.ts';
import { useActiveSessions } from '../api/useActiveSessions.ts';
import { useLocalOnly } from '../api/useLocal.ts';
import { useActiveSessionsGuard } from '../components/ActiveSessionsDialog.tsx';
import { BackupsPanel } from '../components/BackupsPanel.tsx';
import { actionClass } from '../components/controlClass.ts';
import { RemoteAccessPanel } from '../components/RemoteAccessPanel.tsx';
import { RetentionPanel } from '../components/RetentionPanel.tsx';
import { formatDateTime, relativeTime, timeUntil } from '../lib/format.ts';
import { localVoices, playTone, primeAudio, resolveTone, speak } from '../lib/notificationSound.ts';

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
 * The defaults THIS server starts from. A dev instance's are not the shipped
 * ones (`DEV_SETTING_OVERRIDES` turns the two automatic network calls off), and
 * a marker offering to restore a value the server never had would be a lie.
 * Read from the `['meta']` query rather than passed down: every badge shares
 * the one cache entry, so nineteen of them still cost one request.
 */
function useDefaults(): AppSettings {
  const { data } = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  return defaultSettings(data?.devInstance ?? false);
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
  format,
}: {
  field: K;
  value: AppSettings[K];
  save: (patch: Partial<AppSettings>) => void;
  /**
   * For a field whose STORED value is not what the UI calls it. `asText` spells
   * the default out, which is the whole job of this badge — but `inherit` is a
   * word the settings page shows nowhere else, and "default inherit" would be
   * the same jargon that had to come out of the tone dropdown.
   */
  format?: (v: AppSettings[K]) => string;
}) {
  const fallback = useDefaults()[field];
  if (value === fallback) return null;
  const shown = format ? format(fallback) : asText(fallback);
  return (
    <button
      type="button"
      onClick={() => save({ [field]: fallback } as Partial<AppSettings>)}
      title={`Changed from the default. Click to restore it (${shown}).`}
      className="flex shrink-0 cursor-pointer items-center gap-1.5 self-start rounded border border-transparent px-1.5 py-px text-[10px] text-[var(--text-dim)] hover:border-[var(--border)] hover:text-[var(--text)]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
      default {shown}
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
          className={actionClass}
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

/**
 * A group of mutually exclusive choices, each with a line of explanation.
 *
 * A `<select>` would have been fewer pixels and the wrong shape: these two are
 * not values of one thing, they are two different features, and what separates
 * them is the sentence underneath — which a dropdown cannot show until it is
 * open, and then only one at a time.
 */
function RadioGroup<T extends string>({
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex items-baseline gap-2 rounded px-1 py-0.5 select-none ${
            disabled ? '' : 'cursor-pointer hover:bg-[var(--bg-hover)]'
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="accent-[var(--accent)]"
          />
          <span>
            {option.label}
            <span className="block text-[11px] text-[var(--text-dim)]">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** The catalogue's own word for a tone — what the "general tone" option shows. */
const toneLabel = (id: ToneId): string => NOTIFICATION_TONES.find((t) => t.id === id)?.label ?? id;

/** The same, for a value that may be the deferral rather than a tone. */
const toneChoiceText = (v: ToneChoice): string => (v === TONE_INHERIT ? 'general tone' : v);

/** The class the page's other dropdowns already wear. */
const selectClass = 'cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-raised)] px-1.5 py-0.5 disabled:opacity-40';

/**
 * A notification tone, with something that plays it.
 *
 * **The play button is not decoration.** A list of names for sounds nobody has
 * heard is not a choice, and these are drawn by an oscillator rather than taken
 * from a folder, so there is nowhere else to go and listen to them. It earns its
 * place twice over: a browser refuses to make a noise until something on the
 * page has been clicked, and a session stopping is not a click — so this is also
 * the gesture that unlocks the audio for the whole page (see `primeAudio`).
 *
 * `inherit` is offered only where a kind can defer to the general tone, and it
 * names the tone it currently resolves to rather than a position on the page.
 * "Same as above" was both unclear and a lie the moment anything moved between
 * the two — and the general tone has nothing above it to defer to anyway.
 *
 * **`Silent` is drawn apart from the sounds**, because it is not one and a list
 * of seven names says it is. It says so in words — `No tone (Silent)`, which
 * reads the same open or closed — and in italics, the typographic convention for
 * an entry that is an annotation rather than one of the things being listed.
 *
 * **Two styles inside one line is not on the table**: an `<option>`'s content
 * model is text, so no `<strong>` or `<em>` survives inside it, and a bold "No
 * tone" beside a light "(Silent)" would mean replacing the native `<select>`
 * with a listbox of our own — keyboard, focus, escape and ARIA included — and
 * this one dropdown then looking unlike the page's other two. The italic is what
 * a native option will actually honour; where a browser will not, the words are
 * still the words, which is why they carry the meaning and the style only
 * underlines it. An `<optgroup>` was tried here first and read worse: a lone
 * group heading under six bare options is a break in the list rather than a mark
 * on one entry, and it is invisible in the closed select anyway.
 */
function ToneSelect({
  label,
  value,
  general,
  volume,
  disabled,
  inherit,
  hint,
  onChange,
}: {
  label: string;
  value: ToneChoice;
  /** The general tone, which is what `inherit` resolves to — and plays as. */
  general: ToneId;
  volume: number;
  disabled?: boolean;
  inherit?: boolean;
  hint?: string;
  onChange: (v: ToneChoice) => void;
}) {
  const resolved = resolveTone(value, general);
  const silent = resolved === TONE_NONE || volume <= 0;
  return (
    <div className={disabled ? 'opacity-40' : ''}>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <span>{label}</span>
          <select
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value as ToneChoice)}
            className={selectClass}
          >
            {inherit && <option value={TONE_INHERIT}>General tone ({toneLabel(general)})</option>}
            {NOTIFICATION_TONES.filter((t) => t.id !== TONE_NONE).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value={TONE_NONE} className="italic">
              No tone (Silent)
            </option>
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || silent}
          onClick={() => {
            primeAudio();
            playTone(resolved, volume);
          }}
          // A disabled button that does not say why is a button that looks broken.
          title={volume <= 0 ? 'The volume is 0' : silent ? 'Silent — there is nothing to play' : 'Play it'}
          aria-label="Play the tone"
          className={actionClass}
        >
          ▶
        </button>
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">{hint}</p>}
    </div>
  );
}

/**
 * Which installed voice speaks, and a button to hear it.
 *
 * **Only local voices are listed, and that is a network rule rather than a
 * taste**: Edge offers "Natural" voices that are synthesised on Microsoft's
 * servers, so speaking with one would be a third automatic network call. The
 * filter itself lives in `localVoices`; this only draws what it answers.
 *
 * The list is asked for once, on the way in, because `getVoices()` comes back
 * empty on the first call and fills asynchronously — so an empty dropdown here
 * would be the normal case rather than the broken one. A saved voice that is no
 * longer installed is still listed, said so: it is what the setting holds, and
 * hiding it would leave the field looking empty and the sound unexplained.
 */
function VoiceSelect({
  value,
  volume,
  disabled,
  onChange,
}: {
  value: string;
  volume: number;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  useEffect(() => {
    let alive = true;
    void localVoices().then((list) => {
      if (alive) setVoices(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  const missing = value !== '' && voices !== null && !voices.some((v) => v.name === value);
  return (
    <div className={`space-y-1 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <span>Voice</span>
          <select
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={selectClass}
          >
            <option value="">System default</option>
            {missing && <option value={value}>{value} (not installed)</option>}
            {(voices ?? []).map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || volume <= 0}
          onClick={() => speak('Claude needs you', value, volume)}
          title={volume <= 0 ? 'The volume is 0' : 'Say it'}
          className={actionClass}
        >
          Test
        </button>
      </div>
      {voices !== null && voices.length === 0 && (
        <p className="text-[11px] text-[var(--text-dim)]">
          No voices are installed on this machine, so nothing here can speak. Windows adds them under Time &amp;
          language → Speech.
        </p>
      )}
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
  const meta = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  const dev = meta.data?.devInstance ?? false;
  const guard = useActiveSessionsGuard();
  // Only to SAY how many are running, beside the cap. Nothing on this page is
  // disabled from it: the server is what refuses, and its refusal is the dialog.
  const { data: active } = useActiveSessions();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [wipeData, setWipeData] = useState(false);
  const [uninstalled, setUninstalled] = useState(false);
  // Four of the buttons on this page act on the machine the server runs on.
  const dataFolder = useLocalOnly('openDataFolder');
  const installFolder = useLocalOnly('openInstallFolder');
  const stopServer = useLocalOnly('stopServer');
  const uninstall = useLocalOnly('uninstall');

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
    void api
      .saveSettings(patch)
      .then((r) => {
        queryClient.setQueryData(['settings'], { ...data, settings: r.settings });
        markUsageRead('widget-settings');
        void queryClient.invalidateQueries({ queryKey: ['usage'] });
        void queryClient.invalidateQueries({ queryKey: ['autoReload'] });
        // The hidden-folder option changes what the browsing views contain.
        for (const key of ['sessions', 'projects', 'prompts']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      })
      .catch((e: unknown) => {
        // Two of these can be refused — `chatEnabled` and `chatMode`, while the
        // app is running Claude — and the refusal is a dialog with the sessions
        // in it. Saving again is what happens if they are closed from there.
        if (guard.refused(e, () => save(patch))) return;
        setNote(e instanceof Error ? e.message : String(e));
      });
  };

  /**
   * Stop the server, and be able to do it again.
   *
   * Named rather than written into the button because both refusals it can meet
   * are worth retrying: an update finishing, or the sessions in the dialog being
   * closed from it — and the dialog needs the same closure to run again.
   */
  const stopNow = () => {
    setStopped(true);
    void api.stopServer().catch((e: unknown) => {
      setStopped(false);
      if (guard.refused(e, stopNow)) return;
      setNote(String(e instanceof Error ? e.message : e));
    });
  };

  const clearCacheNow = () => {
    setBusy('cache');
    void api
      .clearCache()
      .then(() => setNote('Cache deleted. It rebuilds itself the next time the server starts.'))
      .catch((e: unknown) => {
        if (guard.refused(e, clearCacheNow)) return;
        setNote(`Failed: ${String(e)}`);
      })
      .finally(() => setBusy(null));
  };

  const s = data.settings;
  // With the feature off, none of its settings do anything — including the
  // hidden-folder one, which the server also ignores. Grey them all out rather
  // than leave controls that look live and are not.
  const notifyOff = !s.notifyEnabled;
  const autoReloadOff = !s.autoReloadEnabled;
  const dimmed = autoReloadOff ? 'opacity-40' : '';

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

        <Section title="Notifications">
          <Row badge={<DefaultBadge field="notifyEnabled" value={s.notifyEnabled} save={save} />}>
            <Toggle
              checked={s.notifyEnabled}
              onChange={(v) => save({ notifyEnabled: v })}
              label="Announce when a session stops"
              hint="The card that floats in under the header, and the sound. The bell keeps its list either way — this switch is about being interrupted, not about being told."
            />
          </Row>

          <Row badge={<DefaultBadge field="notifyInFront" value={s.notifyInFront} save={save} />}>
            <Toggle
              checked={s.notifyInFront}
              onChange={(v) => save({ notifyInFront: v })}
              disabled={notifyOff}
              label="Announce the session on screen too"
              hint="By default the session in front of you is never announced — the page is already saying it. This makes it ring and raise its card like any other."
            />
          </Row>

          {/* The general tone comes FIRST, because everything under it refers to
              it by name: a per-kind tone reading "General tone (Chime)" only
              means anything once you have met the thing it defers to. */}
          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-[var(--text)]">Sound:</p>

            <Row badge={<DefaultBadge field="notifyTone" value={s.notifyTone} save={save} />}>
              <ToneSelect
                label="General tone"
                value={s.notifyTone}
                general={s.notifyTone}
                volume={s.notifyVolume}
                disabled={notifyOff}
                hint="What a notification rings with unless it is given a tone of its own below."
                onChange={(v) => save({ notifyTone: v as ToneId })}
              />
            </Row>

            <Row badge={<DefaultBadge field="notifyVolume" value={s.notifyVolume} save={save} />}>
              <label className={`flex items-center gap-2 ${notifyOff ? 'opacity-40' : ''}`}>
                <span>Volume</span>
                <input
                  type="number"
                  min={NOTIFY_VOLUME_MIN}
                  max={NOTIFY_VOLUME_MAX}
                  step={5}
                  value={s.notifyVolume}
                  disabled={notifyOff}
                  onChange={(e) => save({ notifyVolume: Number(e.target.value) })}
                  className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right disabled:opacity-40"
                />
                <span>%</span>
                <span className="text-[var(--text-dim)]">0 is silence, and it silences the voice with it</span>
              </label>
            </Row>
          </div>

          {/* A kind's tone belongs UNDER that kind's own switch. As two separate
              lists — which stops, then a list of tones — no row of the second one
              owned anything, and the reader had to hold both orders in their head
              to see that they matched. */}
          <div className="space-y-3 border-t border-[var(--border)] pt-3">
            <p className="text-[var(--text)]">Which stops, and what each one sounds like:</p>

            <Row badge={<DefaultBadge field="notifyOnNeedsYou" value={s.notifyOnNeedsYou} save={save} />}>
              <Toggle
                checked={s.notifyOnNeedsYou}
                onChange={(v) => save({ notifyOnNeedsYou: v })}
                disabled={notifyOff}
                label="Sessions waiting for your decision"
                hint="A permission prompt, a question, a plan to approve — whatever the CLI put on screen and is now sitting on."
              />
              {/* Outside the Toggle's own <label>, and indented to where its text
                  starts: a control inside a label has its clicks taken by the
                  label's checkbox. Same reason the badge sits out here. */}
              <div className="mt-1 ml-6 flex items-start gap-2">
                <ToneSelect
                  label="Tone"
                  inherit
                  value={s.notifyToneNeedsYou}
                  general={s.notifyTone}
                  volume={s.notifyVolume}
                  disabled={notifyOff || !s.notifyOnNeedsYou}
                  onChange={(v) => save({ notifyToneNeedsYou: v })}
                />
                <DefaultBadge
                  field="notifyToneNeedsYou"
                  value={s.notifyToneNeedsYou}
                  save={save}
                  format={toneChoiceText}
                />
              </div>
            </Row>

            <Row badge={<DefaultBadge field="notifyOnFinished" value={s.notifyOnFinished} save={save} />}>
              <Toggle
                checked={s.notifyOnFinished}
                onChange={(v) => save({ notifyOnFinished: v })}
                disabled={notifyOff}
                label="Sessions that finished answering"
                hint="The turn is over — whether it ended well or with an error."
              />
              <div className="mt-1 ml-6 flex items-start gap-2">
                <ToneSelect
                  label="Tone"
                  inherit
                  value={s.notifyToneFinished}
                  general={s.notifyTone}
                  volume={s.notifyVolume}
                  disabled={notifyOff || !s.notifyOnFinished}
                  onChange={(v) => save({ notifyToneFinished: v })}
                />
                <DefaultBadge
                  field="notifyToneFinished"
                  value={s.notifyToneFinished}
                  save={save}
                  format={toneChoiceText}
                />
              </div>
            </Row>
          </div>

          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <Row badge={<DefaultBadge field="notifyVoice" value={s.notifyVoice} save={save} />}>
              <Toggle
                checked={s.notifyVoice}
                onChange={(v) => save({ notifyVoice: v })}
                disabled={notifyOff}
                label="Say what it was, out loud"
                hint="Once the tone has finished, a voice says which of the two it was. Only voices installed on this machine are offered: the “Natural” ones Edge lists are synthesised on Microsoft's servers, and this app makes no network call it was not asked to."
              />
            </Row>
            {/* No default marker on the voice, for the reason autoReloadCwd has
                none: its default is "whichever the browser picks", and a click
                that quietly un-chooses your voice is not a restore. */}
            <div className="ml-6">
              <VoiceSelect
                value={s.notifyVoiceName}
                volume={s.notifyVolume}
                disabled={notifyOff || !s.notifyVoice}
                onChange={(v) => save({ notifyVoiceName: v })}
              />
            </div>
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
              label="Talk to Claude from inside a session"
              hint="Continue a conversation without leaving the app, in whichever of the two ways you pick below. Either way it runs Claude Code on this machine, in that session's own folder, and the answer appears in the viewer as it is written to the transcript. It is blocked while that conversation is already open somewhere else — a terminal, or the app's other mode — since only one Claude at a time can answer in a session."
            />
          </Row>
          <Row badge={<DefaultBadge field="chatMode" value={s.chatMode} save={save} />}>
            <RadioGroup
              name="chat-mode"
              value={s.chatMode}
              disabled={!s.chatEnabled}
              onChange={(chatMode) => save({ chatMode })}
              options={[
                {
                  value: 'terminal',
                  label: 'An embedded terminal running the Claude Code CLI',
                  hint: 'The real CLI, drawn in the page where the box would be — resizable by dragging its top edge, and collapsible to a single line when you want the conversation back. Everything the terminal can do and nothing the app adds, and it keeps running while you read other sessions.',
                },
                {
                  value: 'composer',
                  label: 'A composer at the foot of the conversation (experimental)',
                  hint: 'A box you type a prompt into. Questions arrive as buttons, plans can be read full screen and commented passage by passage, and the model, effort and plan mode are pickers beside Send — all of it drawn by this app rather than by Claude Code, which is what makes it the experimental one.',
                },
              ]}
            />
          </Row>
          <Row badge={<DefaultBadge field="maxActiveSessions" value={s.maxActiveSessions} save={save} />}>
            <label className="flex items-center gap-2">
              <span>Run at most</span>
              <input
                type="number"
                min={ACTIVE_SESSIONS_MIN}
                max={ACTIVE_SESSIONS_MAX}
                value={s.maxActiveSessions}
                onChange={(e) => save({ maxActiveSessions: Number(e.target.value) })}
                className="w-20 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5 text-right"
              />
              <span>
                sessions at once
                {active && active.sessions.length > 0 && (
                  <span className="text-[var(--text)]">
                    {' '}
                    — {active.sessions.length} running right now
                  </span>
                )}
              </span>
            </label>
          </Row>
          <div className="text-[11px] leading-relaxed text-[var(--text-dim)]">
            The model and effort are not set here: the composer starts each session from whatever that conversation was
            last answered with, and you change them per session there; a terminal is asked inside the CLI, with{' '}
            <span className="text-[var(--text)]">/model</span>. The composer runs tools under Claude Code's{' '}
            <span className="text-[var(--text)]">auto</span> permission mode, so it only stops when it genuinely needs
            you — and then it asks in the conversation, above the box; a terminal asks exactly as it would anywhere
            else. Your MCP servers are loaded as usual either way, so the first prompt of a session takes a moment
            longer than the ones after it. A terminal is never closed by a timer, and it survives closing the tab: it
            belongs to the server, so you come back to it still running.
            <br />
            <br />
            An idle composer process closes itself after{' '}
            <span className="text-[var(--text)]">{CHAT_IDLE_TIMEOUT_MINUTES} minutes</span>, and that number is not a
            preference. Claude's prompt cache lives for an hour, and a CLI that restarts while it is still warm has to
            rewrite the whole prompt often enough to matter — so a shorter timeout would cost you money rather than save
            it, and once the hour is up there is nothing left to lose. Either mode can also be closed by hand, and that
            asks first only while there is something to lose — a warm cache, or an answer in flight; otherwise it just
            closes.
            <br />
            <br />
            While the app is running Claude, the two settings above are <span className="text-[var(--text)]">locked</span>
            {' '}— and so are stopping the server, restarting it, installing an update, clearing the cache and restoring a
            copy of your data. Each of those would end a session that is still holding its transcript, so each of them
            says how many are running, which they are, and offers to close them for you. The number above is not one of
            them: lowering it never closes anything, it only refuses the next one to ask.
          </div>
        </Section>

        <Section title="Remote access" id="remote-access" highlight={flashed === 'remote-access'}>
          <RemoteAccessPanel settings={s} save={save} dev={dev} />
        </Section>

        <Section title="Your data, and how to get it back" id="backups" highlight={flashed === 'backups'}>
          <BackupsPanel />
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
            {dev && (
              <>
                <span className="opacity-60">instance</span>
                <span className="text-amber-400">
                  dev on port {window.location.port} — every path above is its own. The installed release on 7433 keeps
                  its own data and is never touched from here.
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              className={actionClass}
              disabled={dataFolder.disabled}
              title={dataFolder.reason ?? undefined}
              onClick={() => void api.openDataFolder()}
            >
              Open data folder
            </button>
            <button
              type="button"
              className={actionClass}
              disabled={!data.paths.installRoot || installFolder.disabled}
              title={installFolder.reason ?? data.paths.installRoot ?? 'Not a managed install'}
              onClick={() => void api.openInstallFolder()}
            >
              Open install folder
            </button>
            <button
              type="button"
              className={actionClass}
              disabled={busy !== null}
              onClick={clearCacheNow}
              title="Deletes the derived cache only. Your renames, pins, starred messages and prices live elsewhere and are kept."
            >
              {busy === 'cache' ? 'Clearing…' : 'Clear cache'}
            </button>
            <button
              type="button"
              className={`${actionClass} border-red-500/40 text-red-300 hover:border-red-400`}
              disabled={stopped || stopServer.disabled}
              title={stopServer.reason ?? undefined}
              onClick={() => {
                // Whichever instance this page belongs to is the one that
                // exits — the request goes to the port it was served from —
                // so the way back differs: the release has a shortcut and a
                // task, the dev instance has dev.ps1 and nothing else.
                const question = dev
                  ? 'Stop the dev server? This page will stop working until you start it again with dev.ps1. The installed release on 7433 is not affected.'
                  : 'Stop the claude-history server? This page will stop working until you start it again from the Start Menu shortcut or Task Scheduler.';
                if (!confirm(question)) return;
                // The server refuses while an update is being installed —
                // stopping would abort the download and lose it — and while it
                // is running Claude, which answers with a dialog.
                stopNow();
              }}
            >
              {stopped ? 'Stopping…' : 'Stop server'}
            </button>
            <button
              type="button"
              className={`${actionClass} border-red-500/40 text-red-300 hover:border-red-400`}
              disabled={!data.paths.installRoot || stopped || uninstall.disabled}
              title={uninstall.reason ?? data.paths.installRoot ?? 'Not a managed install — nothing to uninstall'}
              onClick={() => setUninstalling(true)}
            >
              Uninstall
            </button>
          </div>
          {stopped && (
            <p className="text-[11px] text-amber-400">
              {dev ? (
                <>
                  Dev server stopping. Start it again with <span className="font-mono">.\dev.ps1</span> in the repo. The
                  installed release on 7433 goes on running.
                </>
              ) : (
                <>
                  Server stopping. Start it again with the claude-history shortcut in the Start Menu, or from Task
                  Scheduler (task “claude-history” → Run).
                </>
              )}
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
                    Also delete my data — renames, pins, starred messages, prices, settings and cache
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
                  className={`${actionClass} border-red-500/50 text-red-300 hover:border-red-400`}
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
                className={actionClass}
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
