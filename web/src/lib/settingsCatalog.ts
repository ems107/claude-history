import type { AppSettings } from '@claude-history/shared';
import { foldText, TONE_INHERIT } from '@claude-history/shared';

/**
 * What settings exist, and where each one lives.
 *
 * The page used to be ten `<Section>`s in one scroll, and every question about
 * it — which area is this in, how many of these have I changed, where does
 * `#backups` land, what does "volume" match — was answered by reading the JSX or
 * by not being answerable at all. Three deep links had already been hand-carved
 * into that page one at a time; this is the list they should have come from.
 *
 * **Data only, no JSX.** What a row LOOKS like belongs to its area component;
 * what it is CALLED and where it sits belongs here, because four different
 * things read it: the rail, the search box, the changed-from-default tally and
 * the anchor resolver. Same shape `lib/inspector.ts` uses for the rail beside a
 * conversation.
 *
 * **Adding a setting is three edits**: the field in `AppSettings`, an `Entry`
 * here, and the row in its area file. Miss the middle one and the setting still
 * works — it is simply unfindable and uncounted, which is the failure mode worth
 * having rather than a crash.
 */

export type AreaId = 'notifications' | 'claude' | 'access' | 'data' | 'system' | 'danger';

export interface Area {
  id: AreaId;
  /** In the rail, and as the panel's heading. Short: the rail is 224 px. */
  title: string;
  /** One line under that heading, saying what the area is for. */
  blurb: string;
  /** Drawn apart and in red. Only the things that cannot be undone. */
  danger?: true;
}

export interface Group {
  /**
   * The DOM id of the group's heading, and the hash in a deep link to it.
   *
   * `remote-access`, `backups` and `claude-retention` are load-bearing: they are
   * the anchors the old page carved by hand, they are in the README, and
   * `components/list/RetentionFooter.tsx` links to the third. They must keep
   * these exact strings.
   */
  id: string;
  area: AreaId;
  title: string;
  /**
   * What the rail calls it, where a title has to fit in 224 px minus its indent.
   *
   * Only where the heading is a sentence: "Which stops, and what each one sounds
   * like" is the right heading over those switches and the wrong label to
   * navigate by, and truncating it to "Which stops, and what each one s…" is
   * neither. Same split `PanelItem.short` makes for the inspector rail.
   */
  short?: string;
}

export interface Entry {
  /** The DOM id of the row, which is what search and the anchors scroll to. */
  id: string;
  group: string;
  /**
   * The name to search for, and the name the changed-list shows.
   *
   * NOT necessarily the text on screen. Half these rows are sentences with a box
   * in the middle ("Ask Anthropic at most once every `[60]` seconds"), and a
   * sentence is not a name — so the row renders its sentence and the catalogue
   * holds what somebody would call the thing. Where the row really is "label +
   * control", the row reads its label from here and there is only one copy.
   */
  label: string;
  /** The preference it edits. Absent on a row that is a button or a panel. */
  field?: keyof AppSettings;
  /** Words somebody would plausibly type that are not in the label. */
  keywords?: string;
  /**
   * No "changed from default" marker, and no place in the changed-list.
   *
   * Two fields have a default that cannot be restored by a click: the auto-reload
   * folder, whose default is empty and would quietly disable the feature, and the
   * voice, whose default is "whichever the browser picks" — un-choosing your
   * voice is not a restore. Both already had this exception written into the old
   * page as a comment; here it is a fact the tally reads.
   */
  noDefault?: true;
  /**
   * How this field's value is SPELLED, where the stored value is not what the UI
   * calls it.
   *
   * Here rather than at the call site because two things say a value out loud —
   * the "changed from default" marker and the changed-list — and `inherit` is a
   * word the settings page shows nowhere else. "default inherit" would be the
   * same jargon that had to come out of the tone dropdown in the first place.
   */
  format?: (value: unknown) => string;
}

/** The plain spelling of a stored value, for the two places that show one. */
export function valueText(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v || 'empty';
  return String(v);
}

/** A tone that defers to the general one, said in words rather than in a key. */
const toneChoice = (v: unknown): string => (v === TONE_INHERIT ? 'general tone' : valueText(v));

export const AREAS: Area[] = [
  {
    id: 'notifications',
    title: 'Notifications',
    blurb: 'What happens when a session stops — the card, the sound and the narrator.',
  },
  {
    id: 'claude',
    title: 'Claude',
    blurb: 'Everything that reads your subscription or runs Claude Code on this machine.',
  },
  {
    id: 'access',
    title: 'Remote access',
    blurb: 'Letting other machines on this network use claude-history, and what it takes.',
  },
  {
    id: 'data',
    title: 'Your data',
    blurb: 'The one file that cannot be rebuilt, and how long anything survives.',
  },
  {
    id: 'system',
    title: 'System',
    blurb: 'Updates, logs, and where this instance keeps everything.',
  },
  {
    id: 'danger',
    title: 'Danger zone',
    blurb: 'Ends this server, or removes the app. Neither undoes itself.',
    danger: true,
  },
];

export const GROUPS: Group[] = [
  { id: 'notify-announce', area: 'notifications', title: 'Announcing a stop' },
  { id: 'notify-sound', area: 'notifications', title: 'Sound' },
  { id: 'notify-kinds', area: 'notifications', title: 'Which stops, and what each one sounds like', short: 'Which stops' },
  { id: 'notify-voice', area: 'notifications', title: 'The narrator' },

  { id: 'usage', area: 'claude', title: 'Subscription usage' },
  { id: 'auto-reload', area: 'claude', title: 'The 5-hour window' },
  { id: 'chat', area: 'claude', title: 'Sending prompts from the app', short: 'Sending prompts' },

  { id: 'remote-access', area: 'access', title: 'Remote access' },

  { id: 'backups', area: 'data', title: 'Your data, and how to get it back', short: 'Backups' },
  { id: 'prices', area: 'data', title: 'Prices' },
  { id: 'claude-retention', area: 'data', title: 'How long Claude keeps your history', short: "Claude's retention" },

  { id: 'updates', area: 'system', title: 'Updates' },
  { id: 'logs', area: 'system', title: 'Logs' },
  { id: 'paths', area: 'system', title: 'This instance' },

  { id: 'danger', area: 'danger', title: 'Danger zone' },
];

/**
 * Every row worth finding, in the order it is drawn.
 *
 * Rows with no `field` are here because search is the point: "uninstall",
 * "firewall" and "clear cache" are things people come to this page looking for,
 * and none of them is a preference.
 */
export const ENTRIES: Entry[] = [
  // Notifications
  {
    id: 'set-notifyEnabled',
    group: 'notify-announce',
    field: 'notifyEnabled',
    label: 'Announce when a session stops',
    keywords: 'notification toast card popup interrupt bell',
  },
  {
    id: 'set-notifyInFront',
    group: 'notify-announce',
    field: 'notifyInFront',
    label: 'Announce the session on screen too',
    keywords: 'current open foreground front',
  },
  {
    id: 'set-notifyTone',
    group: 'notify-sound',
    field: 'notifyTone',
    label: 'General tone',
    keywords: 'sound chime beep audio ring',
  },
  {
    id: 'set-notifyVolume',
    group: 'notify-sound',
    field: 'notifyVolume',
    label: 'Volume',
    keywords: 'loud quiet silence mute sound',
  },
  {
    id: 'set-notifyOnNeedsYou',
    group: 'notify-kinds',
    field: 'notifyOnNeedsYou',
    label: 'Announce sessions waiting for your decision',
    keywords: 'permission question plan approve needs you blocked',
  },
  {
    id: 'set-notifyToneNeedsYou',
    group: 'notify-kinds',
    field: 'notifyToneNeedsYou',
    label: 'Tone for a session waiting for you',
    keywords: 'sound chime alert',
    format: toneChoice,
  },
  {
    id: 'set-notifyOnFinished',
    group: 'notify-kinds',
    field: 'notifyOnFinished',
    label: 'Announce sessions that finished answering',
    keywords: 'done complete finished error',
  },
  {
    id: 'set-notifyToneFinished',
    group: 'notify-kinds',
    field: 'notifyToneFinished',
    label: 'Tone for a session that finished',
    keywords: 'sound chime',
    format: toneChoice,
  },
  {
    id: 'set-notifyVoice',
    group: 'notify-voice',
    field: 'notifyVoice',
    label: 'Say what it was, out loud',
    keywords: 'speak speech narrator tts talk',
  },
  {
    id: 'set-notifyVoiceName',
    group: 'notify-voice',
    field: 'notifyVoiceName',
    noDefault: true,
    label: 'Voice',
    keywords: 'speech synthesis narrator language',
  },

  // Claude — subscription usage
  {
    id: 'set-usageWidget',
    group: 'usage',
    field: 'usageWidget',
    label: 'Show subscription usage in the header',
    keywords: 'widget quota limit percentage weekly 5-hour plan',
  },
  {
    id: 'set-usageMinIntervalSeconds',
    group: 'usage',
    field: 'usageMinIntervalSeconds',
    label: 'Minimum time between reads',
    keywords: 'floor throttle rate anthropic seconds cadence',
  },
  {
    id: 'set-usageRateLimitBackoffSeconds',
    group: 'usage',
    field: 'usageRateLimitBackoffSeconds',
    label: 'Wait after a rate limit',
    keywords: '429 backoff throttle too many requests',
  },
  {
    id: 'set-usageOnActivity',
    group: 'usage',
    field: 'usageOnActivity',
    label: 'Re-read when Claude answers',
    keywords: 'trigger activity assistant reply',
  },
  {
    id: 'set-usageOnInterval',
    group: 'usage',
    field: 'usageOnInterval',
    label: 'Re-read on a fixed interval',
    keywords: 'trigger idle timer poll',
  },
  {
    id: 'set-usageIntervalSeconds',
    group: 'usage',
    field: 'usageIntervalSeconds',
    label: 'The idle interval',
    keywords: 'seconds cadence timer',
  },
  {
    id: 'set-usageOnFocus',
    group: 'usage',
    field: 'usageOnFocus',
    label: 'Re-read when you come back to this window',
    keywords: 'trigger focus tab switch unminimize',
  },
  {
    id: 'set-usageFocusMaxAgeSeconds',
    group: 'usage',
    field: 'usageFocusMaxAgeSeconds',
    label: 'How stale the figures must be to re-read on focus',
    keywords: 'seconds tolerance age',
  },
  {
    id: 'set-usageOnReset',
    group: 'usage',
    field: 'usageOnReset',
    label: 'Re-read just after a window resets',
    keywords: 'trigger reset zero',
  },

  // Claude — the 5-hour window
  {
    id: 'set-autoReloadEnabled',
    group: 'auto-reload',
    field: 'autoReloadEnabled',
    label: 'Start the 5-hour window as soon as it is free',
    keywords: 'auto reload rolling window throwaway keep alive',
  },
  {
    id: 'set-autoReloadModel',
    group: 'auto-reload',
    field: 'autoReloadModel',
    label: 'Model for the throwaway message',
    keywords: 'haiku sonnet opus cheap',
  },
  {
    id: 'set-autoReloadMessage',
    group: 'auto-reload',
    field: 'autoReloadMessage',
    label: 'Message to send',
    keywords: 'prompt text throwaway',
  },
  {
    id: 'set-autoReloadCwd',
    group: 'auto-reload',
    field: 'autoReloadCwd',
    noDefault: true,
    label: 'Folder to run it in',
    keywords: 'cwd directory path working folder',
  },
  {
    id: 'set-autoReloadHideSessions',
    group: 'auto-reload',
    field: 'autoReloadHideSessions',
    label: "Hide that folder's sessions from this app",
    keywords: 'hide exclude filter list counts',
  },

  // Claude — sending prompts
  {
    id: 'set-chatEnabled',
    group: 'chat',
    field: 'chatEnabled',
    label: 'Talk to Claude from inside a session',
    keywords: 'composer terminal chat prompt send reply',
  },
  {
    id: 'set-chatMode',
    group: 'chat',
    field: 'chatMode',
    label: 'How prompts are sent',
    keywords: 'composer terminal embedded cli experimental mode',
  },
  {
    id: 'set-maxActiveSessions',
    group: 'chat',
    field: 'maxActiveSessions',
    label: 'How many sessions may run at once',
    keywords: 'cap limit concurrent processes active',
  },

  // Remote access
  {
    id: 'set-remoteAccessEnabled',
    group: 'remote-access',
    field: 'remoteAccessEnabled',
    label: 'Let other machines on this network use claude-history',
    keywords: 'lan network remote phone tablet another machine',
  },
  {
    id: 'act-credentials',
    group: 'remote-access',
    label: 'Username and password',
    keywords: 'credentials login sign in password change',
  },
  {
    id: 'act-firewall',
    group: 'remote-access',
    label: 'The Windows Firewall rule',
    keywords: 'firewall port open close windows blocked public private',
  },
  {
    id: 'act-sign-out',
    group: 'remote-access',
    label: 'Sign out everywhere',
    keywords: 'logout devices sessions cookie',
  },

  // Your data
  {
    id: 'act-backup-now',
    group: 'backups',
    label: 'Back up your data now',
    keywords: 'backup copy userdata save',
  },
  {
    id: 'act-restore',
    group: 'backups',
    label: 'Restore a copy of your data',
    keywords: 'restore undo revert renames pins stars recover',
  },
  {
    id: 'info-prices',
    group: 'prices',
    label: 'Your price table',
    keywords: 'prices pricing cost tokens dollars models',
  },
  {
    id: 'info-retention',
    group: 'claude-retention',
    label: 'How long Claude keeps your history',
    keywords: 'cleanupPeriodDays retention delete expire sweep cutoff',
  },

  // System
  {
    id: 'set-updateAutoCheck',
    group: 'updates',
    field: 'updateAutoCheck',
    label: 'Check for new versions automatically',
    keywords: 'update github release upgrade',
  },
  {
    id: 'set-updateIntervalMinutes',
    group: 'updates',
    field: 'updateIntervalMinutes',
    label: 'How often to check for versions',
    keywords: 'minutes interval update',
  },
  {
    id: 'set-logLevel',
    group: 'logs',
    field: 'logLevel',
    label: 'Log level',
    keywords: 'debug info warn error trace verbose',
  },
  {
    id: 'set-logRetentionDays',
    group: 'logs',
    field: 'logRetentionDays',
    label: 'How many days of log files to keep',
    keywords: 'retention prune delete days',
  },
  {
    id: 'act-log-viewer',
    group: 'logs',
    label: 'Open the log viewer',
    keywords: 'logs viewer diagnostics update.log',
  },
  {
    id: 'info-paths',
    group: 'paths',
    label: 'Where everything lives',
    keywords: 'path folder cache userdata data root version install directory',
  },
  {
    id: 'act-open-data',
    group: 'paths',
    label: 'Open the data folder',
    keywords: 'explorer folder cache userdata',
  },
  {
    id: 'act-open-install',
    group: 'paths',
    label: 'Open the install folder',
    keywords: 'explorer folder install program',
  },
  {
    id: 'act-clear-cache',
    group: 'paths',
    label: 'Clear the cache',
    keywords: 'cache rebuild delete derived rescan',
  },

  // Danger zone
  {
    id: 'act-stop-server',
    group: 'danger',
    label: 'Stop the server',
    keywords: 'stop shutdown quit exit kill',
  },
  {
    id: 'act-uninstall',
    group: 'danger',
    label: 'Uninstall claude-history',
    keywords: 'uninstall remove delete wipe',
  },
];

const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));
const ENTRY_BY_ID = new Map(ENTRIES.map((e) => [e.id, e]));
const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));

/** The area `/settings` with nothing after it lands on. */
export const DEFAULT_AREA: AreaId = 'notifications';

/**
 * The one view in the rail that is not an area: a list of what you have changed,
 * computed rather than housed.
 *
 * Not an `AreaId`, because it holds no settings of its own — every row in it
 * lives somewhere else and links back there. It is a route and a rail item, and
 * that is all, so it appears here as its own small thing rather than as a
 * seventh member of a list whose every other member has groups.
 */
export const CHANGED_VIEW = {
  id: 'changed',
  title: 'Changed',
  blurb: 'Every setting that no longer holds the value this server starts from.',
} as const;

export const findArea = (id: string): Area | undefined => AREA_BY_ID.get(id as AreaId);
export const findGroup = (id: string): Group | undefined => GROUP_BY_ID.get(id);
export const findEntry = (id: string): Entry | undefined => ENTRY_BY_ID.get(id);

export const groupsOf = (area: AreaId): Group[] => GROUPS.filter((g) => g.area === area);
export const entriesOf = (group: string): Entry[] => ENTRIES.filter((e) => e.group === group);

const ENTRY_BY_FIELD = new Map<keyof AppSettings, Entry>(
  ENTRIES.flatMap((e) => (e.field ? [[e.field, e] as const] : [])),
);

/**
 * The row that edits a given preference.
 *
 * This is what lets a control be declared with one prop — `field="notifyVolume"`
 * and nothing else — and still know its own DOM id and its own name. Without it
 * every row would carry all three, and the label would have two homes: here and
 * in the JSX, drifting apart the first time one of them was reworded.
 */
export const entryForField = (field: keyof AppSettings): Entry | undefined => ENTRY_BY_FIELD.get(field);

/**
 * Where a `#hash` in a settings URL points.
 *
 * It takes group ids and entry ids alike, so `/settings#backups` (a bookmark, or
 * the README) and a search result's `#set-notifyVolume` are resolved by one
 * function — and both answer with the area that has to be showing before the
 * scroll can find anything.
 */
export function resolveAnchor(hash: string): { area: AreaId; id: string } | null {
  const id = hash.replace(/^#/, '');
  if (!id) return null;
  const group = GROUP_BY_ID.get(id);
  if (group) return { area: group.area, id };
  const entry = ENTRY_BY_ID.get(id);
  const entryGroup = entry && GROUP_BY_ID.get(entry.group);
  return entryGroup ? { area: entryGroup.area, id } : null;
}

/**
 * Which group an anchor id belongs to — it may BE a group, or a row inside one.
 *
 * What a deep link and a search hit need in order to leave the block they landed
 * in SELECTED: the flash says "this row" for two seconds, and the ring says
 * "this block" until you click somewhere else.
 */
export function groupIdOf(id: string): string | null {
  if (GROUP_BY_ID.has(id)) return id;
  return ENTRY_BY_ID.get(id)?.group ?? null;
}

export interface ChangedSetting {
  entry: Entry;
  field: keyof AppSettings;
  area: AreaId;
  group: Group;
  value: AppSettings[keyof AppSettings];
  fallback: AppSettings[keyof AppSettings];
}

/**
 * Every preference that no longer holds the value this server starts from.
 *
 * The defaults are passed in rather than imported: a dev instance's are not the
 * shipped ones (`DEV_SETTING_OVERRIDES` turns the two automatic network calls
 * off), and counting against the wrong set would report changes nobody made.
 */
export function changedSettings(settings: AppSettings, defaults: AppSettings): ChangedSetting[] {
  const out: ChangedSetting[] = [];
  for (const entry of ENTRIES) {
    if (!entry.field || entry.noDefault) continue;
    const value = settings[entry.field];
    const fallback = defaults[entry.field];
    if (value === fallback) continue;
    const group = GROUP_BY_ID.get(entry.group);
    if (!group) continue;
    out.push({ entry, field: entry.field, area: group.area, group, value, fallback });
  }
  return out;
}

/** How many of the above sit in each area, for the count beside its rail item. */
export function changedByArea(settings: AppSettings, defaults: AppSettings): Map<AreaId, number> {
  const counts = new Map<AreaId, number>();
  for (const changed of changedSettings(settings, defaults)) {
    counts.set(changed.area, (counts.get(changed.area) ?? 0) + 1);
  }
  return counts;
}

export interface SearchHit {
  entry: Entry;
  group: Group;
  area: Area;
}

/** Does the query start a word in this text? */
const startsWord = (text: string, query: string) => text.startsWith(query) || text.includes(` ${query}`);

/**
 * The rank a hit gets, lowest first — or `null` for no hit at all.
 *
 * Deliberately a handful of tiers rather than a score: with forty-six entries
 * the only thing that has to be true is that a word in the NAME beats the same
 * word buried in somebody's keywords.
 *
 * **A word at the START of a label is NOT its own tier**, and that is the one
 * decision here worth stating. It was, and typing "tone" then answered with
 * `Tone for a session waiting for you` ahead of `General tone` — the setting the
 * other two defer to, and the one anybody typing that word means. Both are the
 * same kind of hit; what separates them is the page's own order, which is what
 * breaks every tie below and is a rule that can be explained: the answers come
 * back in the order you would meet them reading the page.
 *
 * Folded with `foldText`, the same folding the transcript search uses on both
 * sides of the wire — so "tono" and "tonó" behave here exactly as they do there.
 */
function rank(entry: Entry, group: Group, area: Area, query: string): number | null {
  const label = foldText(entry.label);
  if (label === query) return 0;
  if (startsWord(label, query)) return 1;
  if (label.includes(query)) return 2;
  const keywords = entry.keywords ? foldText(entry.keywords) : '';
  if (startsWord(keywords, query)) return 3;
  if (keywords.includes(query)) return 4;
  if (foldText(group.title).includes(query)) return 5;
  if (foldText(area.title).includes(query)) return 6;
  return null;
}

/**
 * What matches, best first, with the catalogue's own order breaking every tie —
 * so two equally good hits appear in the order the page draws them.
 */
export function searchSettings(query: string): SearchHit[] {
  const folded = foldText(query).trim();
  if (!folded) return [];
  const scored: Array<{ hit: SearchHit; score: number; order: number }> = [];
  ENTRIES.forEach((entry, order) => {
    const group = GROUP_BY_ID.get(entry.group);
    const area = group && AREA_BY_ID.get(group.area);
    if (!group || !area) return;
    const score = rank(entry, group, area, folded);
    if (score === null) return;
    scored.push({ hit: { entry, group, area }, score, order });
  });
  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.map((s) => s.hit);
}
