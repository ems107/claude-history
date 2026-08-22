// REST API contract shared between server and web.

import type {
  LiveInfo,
  PlanRecord,
  ProjectInfo,
  SessionDetail,
  SessionSummary,
  StarredMessage,
  SubagentDetail,
} from './types.ts';

export type IndexState = 'scanning' | 'enriching' | 'ready';

export interface MetaResponse {
  dataRoot: string;
  cacheDir: string;
  projectCount: number;
  sessionCount: number;
  indexState: IndexState;
  enrichedCount: number;
  cacheHits: number;
  version: string;
  /** Started with `--dev-instance`: own port, own data folder, beside the release. */
  devInstance: boolean;
  /**
   * This request did NOT come from the machine the server runs on.
   *
   * The single source of truth for it, because only the server can know: it is
   * read from the socket, and a page cannot ask its own browser which address
   * it connected from. Never re-derive it from `window.location.hostname` —
   * that answers a different question and would be wrong the first time anyone
   * reaches the app by a name instead of an address.
   *
   * What it drives in the UI is the set of actions that can only happen where
   * the server is (see `localOnly.ts`).
   */
  remote: boolean;
}

// ---- Remote access ----

/**
 * What an unauthenticated caller is allowed to know. Deliberately four
 * booleans: the username, the version, the paths and the session list are all
 * things a page must log in to see.
 */
export interface AuthStatusResponse {
  /** The request came from another machine. */
  remote: boolean;
  /** `remoteAccessEnabled`, so a remote page can tell "off" from "log in". */
  remoteAccessEnabled: boolean;
  /** Credentials have been set. */
  configured: boolean;
  /** This request carries a valid session, or is local (which needs none). */
  authenticated: boolean;
}

/**
 * Floor on the remote-access password. Shared so the field that refuses to
 * submit and the endpoint that refuses to save agree — a form that lets you
 * type something the server will reject is a form that wasted your time.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Why this process is, or is not, listening on the network.
 *
 * A release only binds every interface once it has been earned: Windows raises
 * its "allow this app?" dialog the moment a program listens on anything but
 * loopback with no firewall rule to decide the matter, and that dialog must
 * never appear on its own. So the reason is a fact worth naming — it is the
 * difference between "you turned it off" and "Windows would have asked".
 *
 * Ordered by where the decision was made: what bypasses the gate, then the
 * switch, then what the firewall said.
 */
export type BindReason =
  /** A checkout: loopback always. Remote access belongs to the release. */
  | 'dev-instance'
  /** `--host` was given by hand, and it wins over all of this — dialog included. */
  | 'explicit-host'
  | 'switch-off'
  /** The switch cannot be on without credentials, but the bind checks anyway. */
  | 'no-credentials'
  /** Nothing in the firewall decides about this port: listening would ask. */
  | 'no-rule'
  /**
   * No rule, and no network for one to apply to. Windows classifies a
   * connection some seconds after logon, so the probe waits before saying this
   * — a machine that answers it is genuinely offline.
   */
  | 'no-network'
  | 'rule-disabled'
  | 'rule-wrong-port'
  /** The rule exists, but not for the network this machine is on right now. */
  | 'rule-other-profile'
  /** A program-scoped rule (what clicking "Allow" leaves) naming another node.exe. */
  | 'rule-other-program'
  /** The firewall could not be read, so the safe answer is loopback. */
  | 'firewall-unreadable'
  /** Our rule covers it: listening on the network. */
  | 'allowed'
  /** This machine permits unsolicited inbound traffic by policy — no rule needed. */
  | 'default-allow'
  /** No Windows firewall to ask; the switch alone decides. */
  | 'not-windows';

/**
 * Why the bind came out the way it did, in the words a person reads.
 *
 * One home, used twice: the Settings panel puts it after "listening on this
 * machine only", and the server puts it in the line it logs at startup. A log
 * that explains the bind differently from the screen would be worse than either
 * on its own — that is the same reason `localOnly.ts` keeps its sentences here.
 * Each one completes "…, because" and only says the cause; what to do about it
 * is the button beside it.
 */
export const BIND_REASONS: Record<BindReason, string> = {
  'explicit-host': '--host was given on the command line, so the firewall was never consulted.',
  'dev-instance': 'this is a dev instance, and remote access belongs to the installed release.',
  'switch-off': 'remote access is switched off.',
  'no-credentials': 'remote access has no username and password yet.',
  'no-rule':
    'no firewall rule allows this port, and listening on the network without one is what makes Windows ask for permission.',
  'no-network': 'Windows has classified no network yet, and there is no firewall rule to fall back on.',
  'rule-disabled': 'the firewall rule exists but is disabled.',
  'rule-wrong-port': 'the firewall rule does not cover this port.',
  'rule-other-profile': 'the firewall rule does not apply to the network this machine is on.',
  'rule-other-program':
    'the only rule found names a different node.exe — which is what answering the Windows dialog leaves behind, and it stops applying at the next update.',
  'firewall-unreadable': 'the firewall could not be read, and listening on this machine only is the safe answer.',
  'default-allow': 'this machine allows unsolicited inbound traffic by policy, so no rule is needed.',
  'not-windows': 'there is no Windows Firewall to ask.',
  allowed: 'remote access is on and the firewall already allows this port.',
};

/**
 * A rule that stops our own traffic even with the port open, because an
 * explicit Block beats an Allow. These are what clicking "Cancel" on the
 * dialog leaves behind, one pair per version, each nailed to the `node.exe`
 * path of the release that asked.
 */
export interface BlockingRule {
  displayName: string;
  /** The node.exe this rule names, as the firewall stored it. */
  program: string;
  protocol: string;
  /**
   * Profiles the block applies to. A Block on `Public` alone stops nothing we
   * want, so the panel must not claim that every block found means nothing gets
   * through — one of the real ones on the development machine is exactly that.
   */
  profiles: string[];
}

/**
 * One network this machine is connected to right now, as Windows sees it.
 *
 * The category alone was not enough to say anything true: a machine with a
 * Hyper-V switch and a VPN adapter is on `Public, Private, Public` at once, and
 * "this machine is on a network Windows calls Public" then reads as a verdict on
 * the LAN it is not about. Naming the connection is what makes the sentence
 * honest.
 */
export interface ActiveConnection {
  /** What Windows calls the network, e.g. the SSID. */
  name: string;
  /** The adapter, e.g. `vEthernet (Puente3)`. Matches Node's interface names. */
  interfaceAlias: string;
  /** `Public`, `Private` or `DomainAuthenticated`. */
  category: string;
}

/** Everything about "can another machine actually reach this one", in one read. */
export interface FirewallStatusResponse {
  /** An inbound rule for this port exists. Null when it could not be read. */
  ruleExists: boolean | null;
  /**
   * How many rules carry our name. More than one is harmless to the verdict but
   * worth offering to tidy: while the read was broken the panel reported the port
   * shut and the button kept creating another, six times over. Without a count
   * the only route back to one rule is closing the port and opening it again —
   * two prompts, and a moment with no rule at all.
   */
  ruleCount: number;
  /** The rule this app manages, by name. */
  ruleName: string;
  port: number;
  /**
   * Network profiles the machine's active connections are on right now,
   * deduplicated. The rule is created for `Private`, so a home network Windows
   * decided to call `Public` stays shut and looks like a broken rule — worth
   * showing. Which connection is which is in `activeConnections`.
   */
  activeProfiles: string[];
  /** Every connected network by name, so a warning can say which one it means. */
  activeConnections: ActiveConnection[];
  /** This machine's own IPv4 addresses, so the URL to type does not have to be hunted for. */
  addresses: string[];
  error: string | null;
  /** Where this process is actually listening — the bind it was granted at startup. */
  listening: 'local' | 'network';
  /**
   * Why it bound that way **when it started**. History, and it stays true as
   * history: it is what the log line says and what a restart is measured
   * against. It is NOT what to tell the user is wrong now — open the port after
   * the server started and this still reads `no-rule`, which was a sentence in
   * the panel claiming there was no rule seconds after one was created.
   */
  bindReason: BindReason;
  /**
   * What stands between this server and the network **right now**, from the
   * live switch and a fresh look at the firewall. `allowed` here beside
   * `listening: 'local'` means nothing is missing but the restart.
   */
  currentReason: BindReason;
  /** The switch is on and credentials exist: a network bind is what the user wants. */
  wantsNetwork: boolean;
  /** Wanted and actual disagree, and only a restart can settle it. */
  restartNeeded: boolean;
  /** The rule that was found covers this port (one for another port is not this one). */
  ruleCoversPort: boolean;
  /** Profiles the rule applies to, so "Private" beside a Public network explains itself. */
  ruleProfiles: string[];
  /** Windows would raise its dialog rather than block in silence. */
  notifyOnListen: boolean;
  /** `DefaultInboundAction` is Allow here: a rule is not needed at all. */
  defaultInboundAllow: boolean;
  /** Leftovers from clicking Cancel on the dialog. They override the rule above. */
  blockingRules: BlockingRule[];
  /**
   * Why the look for blocking rules failed, or null when it succeeded.
   *
   * `blockingRules: []` beside this being non-null means **"could not look"**, not
   * "there are none" — the distinction this panel used to get wrong in the
   * direction that reassures: it reported a clean firewall for months while two
   * Block rules for our own `node.exe` sat in it, because a denied read returned
   * an empty list.
   */
  blockingRulesError: string | null;
}

export type SessionsResponse = SessionSummary[];
export type ProjectsResponse = ProjectInfo[];
export type SessionDetailResponse = SessionDetail;
export type SubagentDetailResponse = SubagentDetail;

export interface LiveSessionEntry extends LiveInfo {
  sessionId: string;
  cwd: string;
  entrypoint: string | null;
}
export type LiveResponse = LiveSessionEntry[];

/** 'phrase' is one implicit quoted term; 'words' splits on spaces, quotes kept. */
export type SearchMode = 'phrase' | 'words';
/** Where all the words must meet: one message, or anywhere in the session. */
export type SearchWordScope = 'message' | 'session';

/**
 * A snippet is a run of alternating parts so every term in view can be marked:
 * one line may well contain several of them, and a single `match` could only
 * ever tell the truth about one.
 */
export interface SearchSnippet {
  uuid: string | null;
  role: string;
  parts: { text: string; hit?: true }[];
  /**
   * The tool call this text belongs to, on the deep scan's `call`/`tool`
   * snippets. Only this can open the right tool in the viewer: a line uuid does
   * not identify one (an assistant message carries several calls) and the line
   * carrying a `tool_result` is rendered nowhere at all.
   */
  toolUseId: string | null;
  /**
   * Set on the row that IS a subagent's id: the hit belongs to the parent
   * session, and this is what opens the agent it names — the id is otherwise a
   * string with nothing behind it, which is exactly why it is indexed.
   */
  agentId: string | null;
  /**
   * When the text this row shows was written (ISO-8601), or null on a row that
   * is not a moment — a session's id, its agents' ids, its title. A row is a
   * line lifted out of a conversation, and the clock is what puts it back: a
   * hundred of them all reading TOOL are otherwise the same row a hundred
   * times.
   */
  when: string | null;
}

export interface SearchHit {
  sessionId: string;
  matchCount: number;
  snippets: SearchSnippet[];
}

/** The query as the server understood it, so the results can say what they did. */
export interface SearchQueryEcho {
  terms: string[];
  mode: SearchMode;
  scope: SearchWordScope;
  wholeWord: boolean;
}

/** What the on-demand scan of tool calls and output actually got through. */
export interface DeepScanInfo {
  sessionsRead: number;
  /** Characters of transcript read — near enough to bytes for this corpus. */
  bytesRead: number;
  /** Cancelled, out of time or capped — the results are a partial answer. */
  stoppedEarly: boolean;
}

export interface SearchResponse {
  hits: SearchHit[];
  scannedSessions: number;
  tookMs: number;
  indexComplete: boolean;
  query: SearchQueryEcho;
  /** Present only when the request asked for tool calls and output. */
  deep?: DeepScanInfo;
}

/**
 * Every place one query matched inside ONE session, a page at a time. A hit in
 * the list only ever shows a handful of snippets and then says how many matches
 * it left out; this is how those get looked at.
 *
 * It pages over PLACES, not over occurrences: one window of text can hold
 * several of them, so `total` and `matchCount` are different numbers and both
 * have to be said.
 */
export interface SessionMatchesResponse {
  sessionId: string;
  query: SearchQueryEcho;
  /** This page, in the order the corpus is read. */
  snippets: SearchSnippet[];
  /** Where this page starts in the session's list of places. */
  offset: number;
  /** Places in the whole session — what the pagination counts. */
  total: number;
  /**
   * Term occurrences in the whole session: the figure `SearchHit.matchCount`
   * carries, recomputed here (a live transcript may have grown since).
   */
  matchCount: number;
  /**
   * Occurrences covered by THIS page. Every occurrence is assigned to exactly
   * one place, so the pages add up to `matchCount` once the last one arrives —
   * which is what lets the UI count down to zero and mean it.
   */
  pageMatches: number;
  tookMs: number;
  /** Present only when tool calls and output were read too. */
  deep?: DeepScanInfo;
}

export interface ToolResultFileResponse {
  text: string;
  sizeBytes: number;
}

/**
 * One local file, read for the viewer panel (`GET /api/files/read`).
 *
 * Everything except a malformed request answers 200: a file that is missing, is
 * a folder, or cannot be read is a STATE the panel draws, not an error — the
 * path is still worth showing, and the folder may still be worth opening. Only
 * a bad session id or a cross-origin caller gets a 4xx.
 */
export interface FileReadResponse {
  /** The resolved absolute path. A relative reference is resolved against the
   *  session's launch cwd, so this is what says which file was actually tried. */
  path: string;
  exists: boolean;
  isDirectory: boolean;
  sizeBytes: number;
  /** ISO-8601, or null when there is nothing to stat. */
  modifiedAt: string | null;
  /** Null for a folder, a binary file, or a file that could not be read. */
  text: string | null;
  /** The file is longer than what `text` holds. */
  truncated: boolean;
  /** A NUL byte in the head: not text, and not shown. */
  binary: boolean;
  /** The file exists but could not be read (EACCES, EBUSY…), verbatim. */
  error?: string;
}

/** Ask about a batch of paths at once (`POST /api/files/stats`). */
export interface FileStatsRequest {
  /** Session id: every reference is resolved against ITS project path, from the index. */
  session: string;
  /** The references as written in the transcript. */
  paths: string[];
}

/**
 * Most paths a batch asks about are absolute scratchpad paths of 130–400
 * characters, and a whole delivery history of them would not fit in a query
 * string, so this one read is a POST. That is also what gets it the global
 * same-origin hook for free.
 */
export const MAX_STAT_PATHS = 200;

/**
 * What the disk says about one path — no bytes, no reading, only `stat`.
 *
 * `ref` is the string the caller sent, echoed back verbatim: the resolution rule
 * lives on the server, so the client joins on identity instead of guessing at it
 * a second time. Everything else answers 200 — missing, a folder, unreadable and
 * unresolvable are all STATES, and a bad path in the batch must not take the
 * other 20 down with it.
 */
export interface FileStatEntry {
  ref: string;
  /** The resolved absolute path, or the ref unchanged when it could not resolve. */
  path: string;
  exists: boolean;
  isDirectory: boolean;
  sizeBytes: number;
  /** ISO-8601, or null when there is nothing to stat. */
  modifiedAt: string | null;
  /** Why this one says nothing: an unresolvable ref, or an EACCES/EBUSY stat. */
  error?: string;
}

export interface FileStatsResponse {
  files: FileStatEntry[];
}

/**
 * `GET /api/files/image?session=&path=` has no shape to declare: it answers the
 * bytes of one image with the content type from the server's own extension
 * allowlist, for an `<img src>` to fetch. It is the one endpoint here that
 * returns no JSON on success — 415 (not an image it serves), 413 (over the
 * cap), 404 (gone) and 403 (cross-origin) carry `{ error }` like the rest.
 */

/** Launch a local file, its folder, or an editor at it (`POST /api/files/open`). */
export interface FileOpenRequest {
  /** Session id: the reference is resolved against ITS project path, and that
   *  path comes from the index — never from the request. */
  session: string;
  /** The reference as written in the transcript (relative or absolute). */
  path: string;
  target: 'file' | 'folder' | 'vscode';
  /** For 'vscode' only: the line to land on. */
  line?: number;
}

export interface FileOpenResponse {
  ok: true;
  /**
   * Explorer really did select the file. False means the `/select` launch
   * failed and the folder was opened instead — the button must not claim
   * something the shell did not do.
   */
  selected?: boolean;
}

export interface PromptEntry {
  display: string; // full typed prompt text
  timestamp: number; // epoch ms
  project: string; // real project path
  projectKey: string;
  projectName: string;
  sessionId: string;
  sessionExists: boolean;
}
export type PromptsResponse = PromptEntry[];

/**
 * One plan, as the Plans page lists it: the record from the session's
 * enrichment, plus who it belongs to and what is left of it on disk.
 */
export interface PlanEntry extends PlanRecord {
  sessionId: string;
  sessionTitle: string;
  project: string;
  projectKey: string;
  projectName: string;
  /**
   * Whether `~/.claude/plans/<slug>.md` still holds THIS plan.
   *
   * The file is named after the session slug and overwritten, so a session that
   * planned twice keeps only its latest — and a page that showed a link to
   * every plan would send most of them to somebody else's text. Null when the
   * plan recorded no path at all (every rejection, and any approval by a CLI
   * that did not write one).
   */
  onDisk: boolean | null;
}
export type PlansResponse = PlanEntry[];

/**
 * One starred message, as the Starred page lists it: the stored record plus
 * where it belongs today.
 *
 * The project and the title are on `StarredMessage` as snapshots, and the
 * endpoint overwrites them from the index whenever the session is still there —
 * so a session renamed after the star was set reads by its current name here
 * too, and only a session that has since gone falls back to what was stored.
 */
export interface StarEntry extends StarredMessage {
  /** False once the transcript is gone: the copy stays, the link cannot work. */
  sessionExists: boolean;
  projectKey: string;
  projectName: string;
}
export type StarsResponse = StarEntry[];

export interface StarUpdateResponse {
  ok: boolean;
  /** The record as stored, or null when the star was removed. */
  star: StarEntry | null;
  /**
   * Whether a stored star was actually dropped. A toggle is idempotent, so
   * unstarring something that was not starred is not an error — but it must not
   * report success either: a star is keyed on the message's CANONICAL uuid, and
   * a caller passing one of a streamed answer's aliases would otherwise be told
   * a removal happened that did not. The app always sends the canonical uuid.
   */
  removed: boolean;
}

export interface ResumeResponse {
  ok: boolean;
  method: 'wt' | 'cmd';
  command: string;
}

export interface LineageNode {
  id: string;
  exists: boolean;
  title: string | null;
  projectKey: string | null;
  projectName: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
}

export interface LineageResponse {
  nodes: LineageNode[];
  /** from = the session that was forked, to = the fork (`/branch`) made from it. */
  edges: Array<{ from: string; to: string }>;
}

// ---- Updates (GitHub releases) ----

export type UpdateState = 'idle' | 'checking' | 'downloading' | 'verifying' | 'staging' | 'restarting';

export interface UpdateRelease {
  /** Bare version, e.g. "1.2.0". */
  version: string;
  /** Release tag, e.g. "v1.2.0". */
  tag: string;
  /** Release notes (markdown; the annotated tag message). */
  notes: string;
  publishedAt: string | null;
  /** Size of the win-x64 zip asset, if found. */
  sizeBytes: number | null;
  /** False when the release ships no installable zip + checksums pair. */
  installable: boolean;
}

/**
 * Live progress of the step in flight. Only the download reports it — the
 * other steps are seconds long and `state` says everything about them.
 */
export interface UpdateProgress {
  receivedBytes: number;
  /** Null only if the release did not declare a size and the server sent none. */
  totalBytes: number | null;
  /** 1 on the first try; higher means the transfer stalled and was resumed. */
  attempt: number;
  bytesPerSecond: number | null;
}

export interface UpdateStatusResponse {
  currentVersion: string;
  /** True when running from an installed layout (updates can be applied). */
  installed: boolean;
  updateAvailable: boolean;
  /** Every release newer than the running one, newest first. */
  available: UpdateRelease[];
  lastCheckAt: string | null;
  lastError: string | null;
  state: UpdateState;
  /**
   * The version being installed, or null when nothing is being applied.
   * Applying is fire-and-forget — the POST that starts it answers at once —
   * so this, `state` and `progress` are the ONLY honest way for the UI to
   * follow it. A client-side timer cannot tell a slow download from a dead
   * server, and one that tried reported failures that had not happened.
   */
  applyingVersion: string | null;
  progress: UpdateProgress | null;
  /** Why the last apply failed (prefixed with the step), and when. */
  lastApplyError: string | null;
  lastApplyErrorAt: string | null;
}

// ---- Settings (persisted in userdata.json) ----

/**
 * The two ways of talking to Claude from the app. Exclusive on purpose: both at
 * once would be two writers on one transcript, which is the corruption
 * everything around this feature exists to prevent.
 */
export const CHAT_UI_MODES = ['terminal', 'composer'] as const;
export type ChatUiMode = (typeof CHAT_UI_MODES)[number];

// ---- Notifications: what a stop rings with ----

/**
 * The tones a notification can ring with, and the whole catalogue there is.
 *
 * **Synthesised, not files.** Nothing is embedded in a browser to draw on — the
 * `Notification` API's `sound` option was drafted, never implemented and then
 * dropped from the spec — so a tone is either a file this app ships or a shape it
 * draws itself, and this is the second: six recipes of oscillators and envelopes
 * in `web/src/lib/notificationSound.ts`, which is the one place a frequency is
 * ever written. The ids and the labels are HERE because the server validates the
 * setting against them and the dropdown reads them, and neither of those two has
 * any business knowing a waveform.
 *
 * `none` is a tone like the others, so the general one can be silenced while the
 * narrator goes on talking.
 */
export const NOTIFICATION_TONES = [
  { id: 'chime', label: 'Chime' },
  { id: 'blip', label: 'Blip' },
  { id: 'ping', label: 'Ping' },
  { id: 'arp', label: 'Arpeggio' },
  { id: 'knock', label: 'Knock' },
  { id: 'alert', label: 'Alert' },
  { id: 'none', label: 'Silent' },
] as const;
export type ToneId = (typeof NOTIFICATION_TONES)[number]['id'];

/** Just the ids, derived, for the validators that only need to say yes or no. */
export const NOTIFICATION_TONE_IDS: readonly ToneId[] = NOTIFICATION_TONES.map((t) => t.id);

/**
 * What a per-kind tone says when it has nothing of its own to say: ring whatever
 * `notifyTone` is.
 *
 * Deliberately NOT one of `NOTIFICATION_TONES`: the general tone cannot inherit
 * from itself, and a list that offered it there would be offering a loop.
 */
export const TONE_INHERIT = 'inherit';
export type ToneChoice = ToneId | typeof TONE_INHERIT;

/** Both ends of the one volume, which the tone and the narrator share. */
export const NOTIFY_VOLUME_MIN = 0;
export const NOTIFY_VOLUME_MAX = 100;

/** A voice name is a name Windows gave a voice, not a sentence. */
export const NOTIFY_VOICE_NAME_MAX = 120;

export interface AppSettings {
  /** Poll GitHub for new releases in the background. */
  updateAutoCheck: boolean;
  /** Minutes between automatic update checks (minimum 5). */
  updateIntervalMinutes: number;
  /**
   * Announce a stop: the card that floats in under the header, and the sound.
   *
   * **The bell is not this.** It goes on counting and listing whatever stopped
   * either way, because a list you have to go and look at costs nothing to have
   * been kept — off here means "do not interrupt me", not "do not write it
   * down". Nothing on the server reads this at all: `core/notifications.ts`
   * raises its rows regardless, and this decides only what a page does with
   * them.
   */
  notifyEnabled: boolean;
  /** Announce the sessions with a dialog on screen, waiting for a decision. */
  notifyOnNeedsYou: boolean;
  /** Announce the sessions that finished answering — an error being one of those. */
  notifyOnFinished: boolean;
  /** The tone every stop rings with, unless its own kind overrides it below. */
  notifyTone: ToneId;
  /**
   * The tone for a `needs-you` stop, overridden by default rather than
   * inherited. That asymmetry with the field below is the whole point: two tones
   * nobody had to configure are two tones you learn, and `needs-you` is the kind
   * that wants something from you — the same fact the bell states by listing it
   * first and the card by drawing it in amber.
   */
  notifyToneNeedsYou: ToneChoice;
  /** The tone for a `finished` stop. Inherits, so `notifyTone` is the common one. */
  notifyToneFinished: ToneChoice;
  /** 0-100, for the tone and the narrator alike. 0 is silence, which is not off. */
  notifyVolume: number;
  /**
   * Say which of the two kinds it was, out loud, once the tone has finished.
   *
   * OFF by default, unlike `notifyEnabled`, and the difference is what each does
   * to a room: a machine that dings at you unasked is a notification, and one
   * that talks at you unasked is a fright.
   */
  notifyVoice: boolean;
  /**
   * Which installed voice speaks. Empty means whichever the browser picks.
   *
   * Only LOCAL voices are ever offered (`SpeechSynthesisVoice.localService`), and
   * that is a network rule rather than a taste: Edge's "Natural" voices are
   * synthesised on Microsoft's servers, so speaking with one would be a third
   * automatic network call — see the rule in CLAUDE.md.
   */
  notifyVoiceName: string;
  /**
   * Show the Claude subscription usage widget. It reads the OAuth token from
   * ~/.claude/.credentials.json (read-only, never refreshed) and calls
   * Anthropic's usage endpoint.
   */
  usageWidget: boolean;
  /**
   * IDLE cadence for the usage widget, in seconds (minimum 15). Usage is
   * normally refreshed by session activity; this is only the fallback for when
   * nothing happens locally — Claude may still be used from another device.
   */
  usageIntervalSeconds: number;
  /**
   * Floor between two REAL reads, in seconds (minimum MIN_USAGE_INTERVAL_SECONDS).
   * Anything asking sooner is served the figures already in hand. This is the
   * one knob that bounds how often the (rate-limited) endpoint is called, so it
   * applies to every trigger and to the server's own readers, not just the
   * widget. The manual Refresh button is the sole exception.
   */
  usageMinIntervalSeconds: number;
  /**
   * How long to stop asking after Anthropic answers HTTP 429, in seconds
   * (minimum MIN_USAGE_RATE_LIMIT_SECONDS). A 429 is the endpoint saying in so
   * many words that we asked too often, and the normal floor is far too short
   * an answer to that — so it takes over from the floor entirely, for every
   * trigger and both readers. The manual Refresh button still gets through:
   * asking for it explicitly is a deliberate act, and the cost of it failing
   * is one more 429.
   */
  usageRateLimitBackoffSeconds: number;
  /**
   * Coming back to the window re-reads only if the figures are older than this
   * (seconds). Focus fires far more often than people expect — every tab
   * switch and every unminimize — and most of those land on figures that are
   * seconds old. 0 means "always re-read".
   */
  usageFocusMaxAgeSeconds: number;
  /**
   * Re-read when Claude answers in any session. This is the trigger that
   * matters: an `assistant` line being appended is the only local event that
   * means tokens were just spent.
   */
  usageOnActivity: boolean;
  /** Re-read on the idle interval (`usageIntervalSeconds`). */
  usageOnInterval: boolean;
  /** Re-read just after a window's `resetsAt`, to catch it dropping to 0%. */
  usageOnReset: boolean;
  /** Re-read when this window regains focus (see `usageFocusMaxAgeSeconds`). */
  usageOnFocus: boolean;
  /**
   * Keep the 5-hour usage window rolling: whenever the window is found NOT to
   * have started, run one throwaway Claude Code prompt to start it, so windows
   * follow each other instead of leaving dead hours. Driven by the server, so
   * it works with no browser open.
   */
  autoReloadEnabled: boolean;
  /** Model alias for that prompt (one of CLAUDE_MODELS). */
  autoReloadModel: string;
  /** The prompt itself. Anything non-empty works; it is thrown away. */
  autoReloadMessage: string;
  /**
   * Folder the reload session runs in. Required — there is no sane default,
   * and Claude Code needs a real working directory.
   */
  autoReloadCwd: string;
  /** Leave that folder's sessions out of the list, the filters and the counts. */
  autoReloadHideSessions: boolean;
  /**
   * Offer a way to talk to Claude at the foot of a session — which of the two is
   * `chatMode`.
   *
   * ON by default, unlike `autoReloadEnabled`, and the difference is what each
   * one does when nobody is looking. The auto-reload spawns sessions on a timer
   * and had to be asked for; this spawns nothing at all until somebody presses
   * a button or types a prompt. What it costs switched on is a row at the foot
   * of the page, and what it buys is the app being somewhere you can answer
   * from rather than only read.
   */
  chatEnabled: boolean;
  /**
   * WHICH of the two ways of talking to Claude the app offers, once
   * `chatEnabled` is on. Meaningless while it is off -- nothing is drawn at the
   * foot of a session either way, so this is never read there.
   *
   * `terminal` (the default): the real Claude Code CLI in a pseudo-terminal,
   * drawn in the page. Everything the TUI can do, and none of the panels the
   * SDK's control channel is what makes possible.
   * `composer`: the bubble driven by the Agent SDK. Structured questions, plan
   * review, the model and effort pickers -- and a different client for the same
   * CLI, which is why it is the one marked experimental on screen: everything
   * it draws, it draws itself.
   */
  chatMode: ChatUiMode;
  /**
   * How many Claude Code processes this app may have alive at once, counting
   * BOTH doors together.
   *
   * One number rather than one per door, because it is one machine either way:
   * each of them is a `claude` with its MCP servers loaded. And it is the same
   * number the refusals count against -- nothing that ends this server or
   * changes how prompts are sent may run while any of them is alive -- so two
   * caps would have meant the tally in the dialog disagreeing with the tally
   * that produced it.
   *
   * Lowering it never kills anything: what is already running goes on running,
   * and the next one to ask is the one refused.
   */
  maxActiveSessions: number;
  /**
   * Let browsers on OTHER machines use this app, after logging in.
   *
   * Off by default, and the only thing standing between the LAN and a composer
   * that runs Claude with auto-approved tools — which is why turning it on
   * requires credentials in the same gesture. The server listens on every
   * interface regardless (see `config.ts`); this decides whether a request from
   * one of them is offered a login or an explanation.
   */
  remoteAccessEnabled: boolean;
  /** Lowest level actually written to the log files. */
  logLevel: LogLevel;
  /** Daily log files older than this are deleted (minimum 1). */
  logRetentionDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  updateAutoCheck: true,
  updateIntervalMinutes: 10,
  notifyEnabled: true,
  notifyOnNeedsYou: true,
  notifyOnFinished: true,
  notifyTone: 'chime',
  notifyToneNeedsYou: 'alert',
  notifyToneFinished: TONE_INHERIT,
  notifyVolume: 70,
  notifyVoice: false,
  notifyVoiceName: '',
  usageWidget: true,
  usageIntervalSeconds: 300,
  usageMinIntervalSeconds: 60,
  usageRateLimitBackoffSeconds: 300,
  usageFocusMaxAgeSeconds: 60,
  usageOnActivity: true,
  usageOnInterval: true,
  usageOnReset: true,
  usageOnFocus: true,
  autoReloadEnabled: false,
  autoReloadModel: 'haiku',
  autoReloadMessage: 'Hi, Claude!',
  autoReloadCwd: '',
  autoReloadHideSessions: false,
  chatEnabled: true,
  chatMode: 'terminal',
  maxActiveSessions: 10,
  remoteAccessEnabled: false,
  logLevel: 'info',
  logRetentionDays: 14,
};

/**
 * What a dev instance starts with instead, on its own fresh `userdata.json`.
 *
 * The two automatic network calls belong to the installed release. A second
 * instance polling beside it doubles the update checks — pointless there, since
 * a source run can never apply one — and, the half that actually bites, the
 * usage reads: those rate-limit per account, so a 429 earned here silences the
 * release's widget too. Both are ordinary settings and can be switched on when
 * the dev instance is what you are testing.
 */
export const DEV_SETTING_OVERRIDES: Partial<AppSettings> = {
  updateAutoCheck: false,
  usageOnInterval: false,
};

/** The defaults this instance actually starts from, and the ones its UI offers back. */
export function defaultSettings(devInstance: boolean): AppSettings {
  return devInstance ? { ...DEFAULT_SETTINGS, ...DEV_SETTING_OVERRIDES } : DEFAULT_SETTINGS;
}

/** Floor on log retention: keeping zero days would mean keeping nothing. */
export const MIN_LOG_RETENTION_DAYS = 1;

/**
 * Hard floor between usage reads. `usageMinIntervalSeconds` is configurable
 * above this and never below it: the endpoint is undocumented and rate limits
 * harder than its numbers suggest (429 observed after a dozen reads in fifteen
 * minutes), so no setting may open the tap wider than this.
 */
export const MIN_USAGE_INTERVAL_SECONDS = 15;

/**
 * Hard floor on the 429 cooldown. Backing off for less than a minute after
 * being told outright that we ask too much is not backing off at all.
 */
export const MIN_USAGE_RATE_LIMIT_SECONDS = 60;

/**
 * Aliases `claude --model` accepts (verified against CC 2.1.224). One list, not
 * one per feature: both the auto-reload and the composer pass these straight to
 * the CLI, and two copies of the same set are two chances to disagree with it.
 */
export const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const;

/** Levels `claude --effort` accepts. */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Floor on the chat idle timeout. Below a minute the process would be torn down
 * and rebuilt between two prompts of the same conversation, paying the whole
 * startup — MCP servers included — for nothing.
 */
/**
 * Silence before the composer's process is closed. Fixed, and the number is the
 * cache's.
 *
 * A restarted CLI does not lose the prompt cache — that lives at Anthropic and
 * survives the process — but it does rebuild its prompt, and when the rebuilt
 * one differs the whole prefix is written again. Measured over this corpus: a
 * request that follows a restart re-caches **38.7% of the time (36 of 93)**
 * against **0.3%** for every other request. So while the cache is alive, killing
 * an idle process is a bet; once the hour is up there is nothing left to lose,
 * and that is exactly when it costs nothing to close.
 *
 * Which is why a shorter timeout would be WORSE, not more careful: it would kill
 * processes whose cache is still warm. Not configurable for the same reason —
 * there is no better answer than the TTL, and offering the choice would invite
 * a worse one.
 */
export const CHAT_IDLE_TIMEOUT_MINUTES = 60;

/**
 * Floor and ceiling on `maxActiveSessions`.
 *
 * One is the floor because zero would switch the feature off through the back
 * door, and `chatEnabled` is the switch for that. The ceiling is the machine
 * talking rather than a rule: every slot is a CLI with its MCP servers loaded,
 * and anybody who really wants more of those at once has a terminal.
 */
export const ACTIVE_SESSIONS_MIN = 1;
export const ACTIVE_SESSIONS_MAX = 25;

// ---- Auto-reload of the 5-hour window ----

/** Longest prompt we store; the reload message is meant to be a one-liner. */
export const AUTO_RELOAD_MESSAGE_MAX = 500;

/**
 * Config problems detectable without touching the filesystem, shared so the
 * server and the settings UI cannot disagree about them. Filesystem and CLI
 * checks are added on top by the server (see AutoReloadStatus.configError).
 */
export function validateAutoReload(s: AppSettings): string | null {
  if (!s.autoReloadMessage.trim()) return 'The message to send is empty.';
  if (!(CLAUDE_MODELS as readonly string[]).includes(s.autoReloadModel)) {
    return `Unknown model "${s.autoReloadModel}".`;
  }
  const cwd = s.autoReloadCwd.trim();
  if (!cwd) return 'No folder set — the session needs a folder to run in.';
  if (!/^([A-Za-z]:[\\/]|\\\\)/.test(cwd)) return `"${cwd}" is not an absolute path.`;
  return null;
}

export interface AutoReloadRun {
  at: string;
  /** The prompt ran and Claude answered. Says nothing about the window yet. */
  ok: boolean;
  model: string;
  cwd: string;
  durationMs: number;
  exitCode: number | null;
  /** Start of Claude's reply, kept only so the UI can prove it answered. */
  reply: string | null;
  error: string | null;
  /** A live 5-hour window was confirmed after the run. This is the real goal. */
  windowStarted: boolean;
  /**
   * The window found afterwards had begun BEFORE this run, so the run did not
   * open it — the usual case for a send triggered by a stale token, which
   * refreshes the token while a window happens to be running already. It
   * matters because the reload that window's expiry is owed is still pending:
   * saying "started a window" there would be a plain lie, and it is also why no
   * cooldown may stand between this run and that expiry.
   */
  windowAlreadyRunning: boolean;
  /**
   * When the read-back that checks `windowStarted` happened. Null means it is
   * still pending: the prompt answers in seconds but the figures need a minute
   * to settle, so until this is set `windowStarted: false` means "not yet
   * known", not "no window". The run is handed to the UI before this exists.
   */
  verifiedAt: string | null;
  /** True when started from the Test button rather than by the schedule. */
  manual: boolean;
}

export interface AutoReloadStatus {
  enabled: boolean;
  /** Enabled, correctly configured and not paused — i.e. it will really fire. */
  active: boolean;
  /** Why it cannot run despite being enabled (bad folder, empty message, no CLI). */
  configError: string | null;
  /** Why it stopped itself (repeated failures). Cleared by saving a setting. */
  pausedReason: string | null;
  /** A scheduled check is in flight right now. Never blocks a manual send. */
  running: boolean;
  /** A prompt is being sent right now — seconds, not minutes. */
  sending: boolean;
  /** A send has happened and its read-back is still pending (about a minute). */
  verifying: boolean;
  /**
   * Why "Send it now" would be refused right now, null when it would go
   * through. The server computes it once and both consumers use it: the POST
   * refuses with this exact string, and the button is disabled by it and shows
   * it. That is the point of it living here — a button disabled by one thing
   * while explaining another is how it came to be disabled with no reason at
   * all. It only ever holds a validation failure or a send genuinely in flight:
   * the cooldowns and backoffs exist to stop an automatic loop, and have no
   * business stopping a person who is asking.
   */
  runBlockedReason: string | null;
  /** Known expiry of the current 5-hour window; null when none is running. */
  resetsAt: string | null;
  /** When the server will next ask Anthropic for the figures. */
  nextCheckAt: string | null;
  /**
   * When the scheduler last learned the state of the window — including from a
   * reading the widget paid for, which is the usual case while the app is open.
   */
  lastCheckAt: string | null;
  /**
   * Last usage-read failure, from the SHARED read state: if anything has read
   * the figures successfully since, this is null. It is not a private tally of
   * this feature's own reads — that is how the panel used to claim the token
   * had expired while the header widget was showing perfectly good figures.
   */
  lastError: string | null;
  /** When the shared figures were last read successfully, by anyone. */
  lastReadAt: string | null;
  /** Which trigger made the last read attempt, whoever it belonged to. */
  lastReadTrigger: UsageTrigger | null;
  lastRun: AutoReloadRun | null;
  /** Resolved claude executable; null when it could not be found. */
  cliPath: string | null;
}

// ---- Sending prompts to a live Claude Code process ----

/**
 * Longest prompt the composer accepts. Generous, because a pasted stack trace
 * or a spec is a perfectly ordinary prompt; the cap only exists so a runaway
 * paste cannot be written into a pipe one line at a time.
 */
export const CHAT_MESSAGE_MAX = 20_000;

/**
 * What the server's process for one session is doing.
 *
 * `starting` is its own state rather than a flavour of `working` because the
 * first turn pays for the whole CLI startup — MCP servers included — and a
 * composer that said "working" through several seconds of that would be
 * describing something that has not begun.
 */
export type ChatState = 'idle' | 'starting' | 'working' | 'asking' | 'error';

/** One of Claude's multiple-choice questions, as `AskUserQuestion` states it. */
export interface ChatQuestionItem {
  question: string;
  /** Short label the UI puts on the chip. Meant to be ≤12 characters; one in this corpus is 16. */
  header: string;
  options: {
    label: string;
    description: string;
    /**
     * A mockup of what this option leads to, drawn by Claude. It reaches the
     * browser because `canUseTool` hands the tool's own array over, and it has
     * to be in the contract rather than surviving by accident: choosing between
     * three layouts without seeing them is the terminal experience this app
     * would otherwise fail to reproduce. Absent on most options, and never on a
     * `multiSelect` question.
     */
    preview?: string;
  }[];
  multiSelect: boolean;
}

/**
 * Something Claude needs a person for, held open until the browser answers.
 *
 * Two shapes arrive here and the UI tells them apart by `questions`:
 * `AskUserQuestion` carries the multiple-choice list, and anything the auto
 * classifier will not approve carries the raw tool input instead, to be allowed
 * or refused. Both exist only because the SDK's control channel surfaces them
 * — a plain `--print` run is not offered `AskUserQuestion` at all.
 */
export interface ChatQuestion {
  toolName: string;
  questions: ChatQuestionItem[] | null;
  /** The tool's own input, when this is a permission rather than a question. */
  input?: unknown;
  askedAt: string;
  /**
   * `ExitPlanMode` only: the plan awaiting approval, in markdown.
   *
   * Read from the call's own input when it has one, and otherwise from
   * `~/.claude/plans/<slug>.md` — newer Claude Code has the model write the plan
   * file itself and sends the tool no input at all, so without that fallback the
   * one thing the user has to judge would not be on screen.
   */
  plan?: string | null;
  planFilePath?: string | null;
}

/**
 * The three answers Claude Code itself offers to a plan. The first two allow
 * the tool and set the mode the session continues in; the third denies it, and
 * the note goes back as the reason — which is exactly what the transcript then
 * records as `userFeedback`.
 */
export type ChatPlanDecision = 'approve-auto' | 'approve-manual' | 'keep-planning';

/**
 * The permission modes the composer offers. Deliberately two of the six the SDK
 * accepts: `auto` is how this app has always sent prompts, and `plan` is the
 * point of the picker. `bypassPermissions` and friends are not something a
 * browser button should be able to reach.
 */
export type ChatPermissionMode = 'auto' | 'plan';

export interface ChatStatus {
  sessionId: string;
  state: ChatState;
  /** A process exists for this session (it may be idle between turns). */
  running: boolean;
  /**
   * This id has been reserved but has no transcript yet — the session is about
   * to be born, rather than missing. It is what lets the composer answer for an
   * id `/api/sessions/:id` still 404s on, and it goes false by itself as soon as
   * Claude Code has written the file and the index has picked it up.
   */
  draft: boolean;
  /**
   * The folder this session runs in — known even for a reservation, which is
   * the whole reason it is here: a session with no transcript has no summary to
   * read a path off, and its own page has to be able to name where it lives.
   * `TerminalStatus` carries it for the same reason.
   */
  cwd: string | null;
  /** Start of the turn in flight — what the working indicator counts from. */
  turnStartedAt: string | null;
  /**
   * When an idle process will be closed on its own. Null while a turn runs
   * (nothing is counting down) and when there is no process. The composer
   * counts down to it, because a process quietly holding a slot with no way to
   * see it or end it is the kind of thing that gets discovered by accident.
   */
  idleClosesAt: string | null;
  /** Prompts accepted while a turn was in flight, waiting their turn. */
  queued: number;
  /**
   * The model and effort of the RUNNING process, or null when there is none.
   * Deliberately not a configured default: the composer starts from whatever
   * the session was last answered with, which is what continuing a
   * conversation means — a setting would silently change the model of a
   * session you only meant to reply to.
   */
  model: string | null;
  effort: string | null;
  /**
   * The mode the RUNNING process is in, or null when there is none — same rule
   * as model and effort. It is tracked live: `setPermissionMode` changes it
   * without a restart, and Claude Code changes it by itself when a plan is
   * approved, which the SDK reports on its `system`/`status` messages.
   */
  permissionMode: ChatPermissionMode | null;
  lastError: string | null;
  /**
   * Why a prompt cannot be sent right now, in the words the UI shows. One
   * string for the endpoint and the composer both, so a disabled control can
   * never be silent about why — the lesson of `AutoReloadStatus.configError`.
   */
  blockedReason: string | null;
  /** What Claude is waiting on, if anything. Null the rest of the time. */
  question: ChatQuestion | null;
  /**
   * What this CLI really offers, read from the running session rather than
   * hard-coded: the model list it accepts and its slash commands. Empty until a
   * process exists, which is why the composer falls back to the shared lists.
   */
  availableModels: ChatModelInfo[];
  availableCommands: string[];
}
export type ChatStatusResponse = ChatStatus;

/**
 * A model as the running CLI describes it. Worth carrying whole rather than as
 * a bare alias: `haiku` accepts no effort at all while everything else takes
 * five levels, and only this says so — offering the same five for every model
 * was both wrong on screen and wrong on the wire.
 */
export interface ChatModelInfo {
  /** What `--model` takes: `sonnet`, `opus[1m]`, `default`… */
  value: string;
  /** `Sonnet`, `Opus (1M context)`, `Default (recommended)`. */
  displayName: string;
  /** `Sonnet 5 · Efficient for routine tasks` — carries the version, and 1M when it applies. */
  description: string;
  /** The id this alias resolves to, which is what a transcript records. */
  resolvedModel: string | null;
  /** Empty when the model takes no effort setting. */
  efforts: string[];
}

export interface ChatAnswerRequest {
  /** Question text -> chosen label(s). Null declines the tool instead. */
  answers: Record<string, string | string[]> | null;
  /**
   * Question text -> the note written beside that answer, which Claude Code
   * records as `annotations[q].notes`. A different thing from a free-text
   * answer and recorded in a different place: the answer is what was chosen,
   * the note is the condition put on it ("this one, but explain why").
   *
   * Only `notes` travels. The other half of an annotation is the drawing of the
   * option taken, and the server already holds it — making the browser echo
   * kilobytes of box-drawing back would be asking it to prove something we know.
   */
  annotations?: Record<string, { notes?: string }> | null;
  /** `ExitPlanMode` only: which of the three answers to a plan was given. */
  decision?: ChatPlanDecision;
  /** What to tell Claude when the plan is sent back for more work. */
  note?: string;
}

export interface ChatSendRequest {
  text: string;
  /** Overrides the session's current model; starts a new process if it differs. */
  model?: string;
  /** Null for a model with no effort levels — nothing is passed to the CLI. */
  effort?: string | null;
  /** Switched live, with no restart — unlike effort. */
  permissionMode?: ChatPermissionMode;
}

/**
 * Reserve a session id for a conversation that does not exist yet.
 *
 * Claude Code mints the id itself when it starts, which is too late for a
 * browser that has to show a composer and then land on the transcript: the SDK
 * takes `sessionId` instead (`Options.sessionId`, "use a specific session ID …
 * cannot be used with `continue` or `resume`"), so the id is minted here and the
 * page knows where it is going before the first prompt is typed.
 *
 * One of the two fields, and they are not equivalent. `projectKey` is the
 * ordinary road — the server looks the path up in the index, so nothing about
 * the filesystem comes from the request. `cwd` is the documented exception to
 * that rule (see AI_ARCHITECTURE.md): a folder Claude Code has never been run in
 * is in no index by definition, and refusing to start there would mean the app
 * can only ever continue what a terminal began. It is validated rather than
 * trusted — absolute, existing, a directory — and it is still only reachable
 * from our own pages, and only from a browser that has signed in.
 */
export interface ChatCreateRequest {
  /** A key from `GET /api/projects`; the path is resolved from the index. */
  projectKey?: string;
  /** An absolute folder typed by the user. Ignored when `projectKey` is given. */
  cwd?: string;
}

export interface ChatCreateResponse {
  /** The id the session WILL have. There is no transcript behind it yet. */
  sessionId: string;
  /** The folder it will run in, as the server resolved it. */
  cwd: string;
}

// ---- The embedded terminal (chatMode: 'terminal') ----

/** Lower bound on the pseudo-terminal, so a collapsed panel cannot ask for 0x0. */
export const TERMINAL_MIN_COLS = 20;
export const TERMINAL_MIN_ROWS = 4;
/**
 * Upper bound, so a hostile or broken client cannot ask for a million-column
 * console — and high enough that no real screen can reach it, which is the half
 * the first numbers got wrong.
 *
 * 500x200 was a tope put in passing, and it was BELOW what an honest client
 * asks for. Measured, terminal filling the window, at the full column width:
 * 2560x1600 gives 358x103 at 12 px but 501x132 at 10 px and 626x161 at 8 px,
 * and a 3840-wide window clamps at 12 px already (540x143). What that looks
 * like is not a crash — the CLI lays out for the console it was given and
 * everything it draws to the full width stops there, so the right fifth of the
 * panel goes dead and the status line's right edge sits in the middle of
 * nowhere. It reads as a design decision, which is why it went unreported.
 *
 * 2000x500 leaves an 8K screen at the smallest text (~1900x480) inside the
 * bound and still refuses the absurd. Nothing the SERVER pays for is at stake
 * either way: what is behind this is a ConPTY buffer of `cols × rows` cells,
 * and a million of them is noise. The memory that really grows is the browser's
 * — xterm's scrollback is 5000 lines times these columns — and a clamp here
 * cannot govern that, because by the time the frame arrives the client has
 * already allocated. So a bound that bites is one that makes the view and the
 * pty disagree, which is the one thing it exists to prevent.
 */
export const TERMINAL_MAX_COLS = 2000;
export const TERMINAL_MAX_ROWS = 500;

/** How the CLI inside a terminal ended. Kept after the process is gone: the last screen is the diagnosis. */
export interface TerminalExit {
  /** Process exit code. `null` when it was killed by a signal rather than exiting. */
  code: number | null;
  /** Local ISO-8601 with offset, like every other date crossing this API. */
  at: string;
}

export interface TerminalStatus {
  sessionId: string;
  /** A pseudo-terminal exists for this session -- whether or not the CLI inside it is still alive. */
  open: boolean;
  /** The CLI is still running. `open && !running` is a terminal holding a dead process's last screen. */
  running: boolean;
  /**
   * The pid of the `claude.exe` inside, or null before ConPTY has reported it
   * (~100 ms) and after it exits. This is the pid the two-writers guard excludes,
   * which is the whole reason the CLI is spawned with no shell around it.
   */
  pid: number | null;
  /** Local ISO-8601 with offset. */
  startedAt: string | null;
  exit: TerminalExit | null;
  /** The folder it runs in — the strip's own subtitle, and known before anything is spawned. */
  cwd: string | null;
  /**
   * Why it cannot be started, in the words shown to the user. Null when it can.
   * ONE string for the endpoint and the button, exactly like `sendBlockedReason`.
   */
  blockedReason: string | null;
}

export interface TerminalStartRequest {
  cols: number;
  rows: number;
}

/**
 * What the browser sends up the socket. Output comes back the other way as raw
 * binary -- it is 99% of the traffic and wrapping it in JSON would cost a parse
 * per keystroke echoed.
 */
export type TerminalClientMessage =
  | { t: 'i'; d: string }
  | { t: 'r'; cols: number; rows: number };

/** What the server sends as JSON (text frames). Anything binary is PTY output. */
export type TerminalServerMessage =
  | { t: 'exit'; code: number | null }
  /**
   * Sent once, after the scrollback replay, so the client knows the backlog has
   * ended. `enhancedKeys` is here because a reconnecting browser cannot work it
   * out for itself: the sequence that asks for modifier-aware keys is sent once,
   * at startup, and the replayed backlog is bounded — so a long-lived terminal
   * has long since trimmed it away.
   */
  | { t: 'ready'; pid: number | null; running: boolean; enhancedKeys: boolean }
  /**
   * The program inside has turned modifier-aware key reporting on or off — the
   * one thing that decides whether Shift+Enter may be encoded as a key of its
   * own rather than as the bare CR every terminal sends for Enter.
   */
  | { t: 'keys'; enhanced: boolean }
  | { t: 'error'; message: string };

// ---- What the app is running, and what may not happen while it is ----

/**
 * One `claude` this app has alive right now.
 *
 * The shape a refusal is built from, which is why it carries the words as well
 * as the ids: whoever reads that dialog is looking for the session to go and
 * close, and "the composer, in claude-history — Folding a replayed turn" is
 * what lets them find it. `busy` is the one field that changes what closing
 * costs.
 */
export interface ActiveAppSession {
  sessionId: string;
  /** Which of the two doors holds it. */
  kind: ChatUiMode;
  /** Its name in a sentence: "the composer", "the embedded terminal". */
  what: string;
  /** From the index. Null for a session being born, which has no transcript yet. */
  projectName: string | null;
  title: string | null;
  /** Where it runs. Known even for a session the index has never seen. */
  cwd: string | null;
  /** A turn in flight right now — closing this one cuts an answer off. */
  busy: boolean;
  /** Local ISO-8601 with offset, like every other date crossing this API. */
  startedAt: string | null;
}

export interface ActiveSessionsResponse {
  sessions: ActiveAppSession[];
  /** `maxActiveSessions`, so a UI can say "3 of 10" without a second read. */
  max: number;
}

// ---- Sessions that have stopped ----

/**
 * Why a session stopped, which is the only classification the bell makes.
 *
 * The two are not a guess: a CLI writes `LIVE_WAITING` the moment a dialog goes
 * up and one of `LIVE_STOPPED` the moment a turn ends, so `needs-you` and
 * `finished` are read off the same field rather than inferred from a transcript.
 */
export type StopKind = 'needs-you' | 'finished';

/**
 * One session that stopped while we were watching.
 *
 * **A stop is a transition, not a state**, and that is the whole reason this is
 * kept server-side instead of computed from `/api/live`: `idle` is the resting
 * state of every open session, so a list of idle sessions is a list of every
 * terminal you have open. Only a session seen to LEAVE `busy` is here.
 */
export interface StoppedSession {
  sessionId: string;
  kind: StopKind;
  /**
   * What it is waiting for, in the CLI's own words ("permission prompt",
   * "input needed"). Null on a `finished` stop, which waits for nothing.
   */
  waitingFor: string | null;
  /**
   * When it stopped, epoch ms — like every field of `LiveInfo`, and unlike the
   * ISO strings elsewhere in this file, because that is what it is copied from
   * (`statusUpdatedAt`, the instant the CLI stamped the flip).
   */
  at: number;
  /**
   * Which half saw it: `cli` from `~/.claude/sessions`, `app` from a composer
   * process of ours, which registers no status of its own. It decides one thing
   * — whether the notification outlives the process (see `stillOpen`).
   */
  source: 'cli' | 'app';
}

/** A row of the panel: the stop, plus what it takes to draw it without a second read. */
export interface StoppedSessionEntry extends StoppedSession {
  /** From the index. Null for a session with no transcript yet. */
  title: string | null;
  projectName: string | null;
  /** What a project tag's colour is keyed by. */
  projectKey: string | null;
  cwd: string | null;
  /**
   * Whether a `claude` still has this session open. Always true for `cli`,
   * whose notification is dropped when the process goes: the bell is about
   * sessions that are OPEN and have stopped. A composer stop can be false —
   * its `--print` process exiting is not the session closing.
   */
  stillOpen: boolean;
}

export interface NotificationsResponse {
  /** Newest stop first. */
  stopped: StoppedSessionEntry[];
}

/**
 * The things that may not happen while the app is running Claude.
 *
 * All six either kill this process or pull the ground from under a live CLI,
 * and a CLI of ours is a writer on somebody's transcript with a warm prompt
 * cache behind it. Refusing only while a turn is IN FLIGHT was the narrower
 * reading of the same worry, and it let an idle-but-alive session be destroyed
 * by a button two pages away.
 */
export type GuardedAction =
  | 'chatSettings'
  | 'update'
  | 'stopServer'
  | 'restartServer'
  | 'clearCache'
  | 'restoreUserdata';

/**
 * What each one would do, as the subject of the refusal sentence. Written once
 * so the 409 and the dialog cannot drift apart: the server builds the sentence,
 * the browser only shows it.
 */
export const GUARDED_ACTION_LABELS: Record<GuardedAction, string> = {
  chatSettings: 'Changing how prompts are sent from the app',
  update: 'Installing an update',
  stopServer: 'Stopping the server',
  restartServer: 'Restarting the server',
  clearCache: 'Clearing the cache',
  restoreUserdata: 'Restoring a copy of your data',
};

/**
 * Why a new session cannot be started: the cap is full. One sentence for both
 * doors, because a composer and a terminal fill the same slots and would
 * otherwise have said it two slightly different ways.
 */
export function activeSessionLimitMessage(max: number): string {
  const n = max === 1 ? 'session' : 'sessions';
  return `The app is already running ${max} Claude Code ${n}, which is the most it is allowed (Settings).`;
}

/** The sentence itself. The plural lives here, so neither side counts twice. */
export function activeSessionsRefusal(action: GuardedAction, count: number): string {
  const what = count === 1 ? 'a Claude Code session' : count + ' Claude Code sessions';
  const it = count === 1 ? 'it' : 'them';
  return GUARDED_ACTION_LABELS[action] + ' would end ' + what + ' this app is running. Close ' + it + ' first.';
}

/**
 * The body every guarded action answers 409 with. `error` is the sentence above;
 * `activeSessions` is what the dialog lists, and its presence is how the browser
 * tells this refusal from every other 409 those endpoints can produce.
 */
export interface ActiveSessionsRefusal {
  error: string;
  activeSessions: ActiveAppSession[];
}

// ---- Claude Code's own history retention (cleanupPeriodDays) ----

/**
 * What Claude Code deletes when nothing sets `cleanupPeriodDays`. Verified in
 * the CLI bundle (2.1.228) and in the docs: 30 days, minimum 1, and a literal 0
 * fails validation rather than meaning "never".
 */
export const CLAUDE_RETENTION_DEFAULT_DAYS = 30;
export const CLAUDE_RETENTION_MIN_DAYS = 1;

/**
 * The sweep runs at startup at most once a day: `~/.claude/.last-cleanup` is
 * the sentinel, and a mtime younger than this means it is skipped outright.
 */
export const CLAUDE_SWEEP_INTERVAL_HOURS = 24;

/** Where a value came from. Precedence: policy > local > project > user. */
export type RetentionScope = 'policy' | 'user' | 'project' | 'local';

/** One settings file, and what it has to say about `cleanupPeriodDays`. */
export interface RetentionSource {
  scope: RetentionScope;
  path: string;
  exists: boolean;
  /** null when the file does not set the key at all. */
  days: number | null;
  /**
   * The file exists but could not be read or parsed. This is a finding, not a
   * failure of ours: Claude Code PAUSES the whole retention sweep while any of
   * its settings files is in that state.
   */
  unreadable: string | null;
  /** The key is there but is not an integer >= 1, so Claude Code rejects it. */
  invalidValue: string | null;
  /** Only on project-scoped sources: whose settings file this is. */
  project: { name: string; path: string } | null;
}

export interface RetentionResponse {
  /** Effective days outside any project that overrides it. */
  days: number;
  /** Nothing sets it, so the built-in default applies. */
  usedDefault: boolean;
  effectiveScope: RetentionScope | 'default';
  defaultDays: number;
  minDays: number;
  /** The file to edit — always the user one, whatever won above. */
  userSettingsFile: string;
  /** Folder holding it; what the "open the folder" button opens. */
  settingsDir: string;
  /** The global chain: managed policy and user settings, in precedence order. */
  sources: RetentionSource[];
  /**
   * Project `.claude` settings that set the key or cannot be read. They only
   * apply when Claude Code is started in that project — but then they win over
   * the user file, so a number shown without them can be a lie.
   */
  projectOverrides: RetentionSource[];
  /** Why Claude Code is not cleaning up at all right now, when that is the case. */
  sweepBlocked: string | null;
  /** True when a managed-settings file was found (its values outrank everything). */
  policyPresent: boolean;
  /** `.last-cleanup`: when the sweep last ran. */
  lastSweepAt: string | null;
  /** Files whose mtime is older than this are deleted by the next sweep. */
  cutoff: string;
  /**
   * Sessions this app lists whose transcript is ALREADY past the cutoff — the
   * next sweep deletes them. Counted here rather than in the browser so the
   * footer of the list and the settings page cannot end up disagreeing, and
   * against `mtimeMs`, which is exactly what the sweep compares.
   */
  expiredCount: number;
  /** How many sessions that count was taken over. */
  countedSessions: number;
  /** mtime (epoch ms) of the oldest session NOT past the cutoff: the margin. */
  oldestKeptMtimeMs: number | null;
  readAt: string;
}

// ---- Subscription usage ----

/**
 * Why a usage read happened. Recorded on every one, because six unrelated
 * things ask for these figures and "the widget asked" says almost nothing: a
 * read caused by Claude answering means the numbers really moved, while one
 * caused by refocusing a tab means nothing did. The browser is the only place
 * that knows which, so it says so in the request.
 */
export const USAGE_TRIGGERS = [
  /**
   * The header widget with NO cause attributed. Every known cause below is
   * labelled at its source, so this one means the browser really could not say
   * why — an unexpected refetch from inside TanStack, or a read that reached
   * the server without passing through `markUsageRead`. It is logged as such,
   * in those words: a log that guesses is worse than one that admits it.
   */
  'widget',
  /** First read after the page loads (the widget mounting). */
  'widget-mount',
  /** Claude answered — an `assistant` line was appended to some transcript. */
  'widget-activity',
  /** The idle fallback poll (`usageIntervalSeconds`). */
  'widget-interval',
  /** Came back to the tab (subject to `usageFocusMaxAgeSeconds`). */
  'widget-focus',
  /** One-shot just after a window's `resetsAt`: nothing else announces a 0%. */
  'widget-reset',
  /** A settings save, which can enable or disable the widget. */
  'widget-settings',
  /** Retrying a read that failed — TanStack's `retry`, not a new cause. */
  'widget-retry',
  /** The browser regained its network connection. */
  'widget-reconnect',
  /** After the auto-reload's "Send it now": a window may have just started. */
  'widget-auto-reload',
  /** The Refresh button inside the usage popover. */
  'manual-refresh',
  /** The auto-reload asking whether the 5-hour window is free. */
  'auto-reload-check',
  /** The auto-reload reading back the new expiry after sending its prompt. */
  'auto-reload-verify',
] as const;

export type UsageTrigger = (typeof USAGE_TRIGGERS)[number];

export interface UsageWindow {
  key: string;
  label: string;
  /** Percentage used, 0-100. */
  utilization: number;
  resetsAt: string | null;
}

export interface UsageResponse {
  available: boolean;
  /** Set when usage could not be read (no credentials, expired token, HTTP error). */
  error: string | null;
  windows: UsageWindow[];
  fetchedAt: string | null;
  subscriptionType: string | null;
  /** These figures come from an earlier read that could not be renewed. */
  stale: boolean;
}

// ---- Logs ----

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Levels selectable as the write threshold — 'fatal' as a floor would mute everything. */
export const LOG_LEVEL_CHOICES = ['debug', 'info', 'warn', 'error'] as const;

/** Known subsystems. The writer accepts any string; this only feeds the UI. */
export const LOG_SOURCES = [
  'server',
  'config',
  'index',
  'enricher',
  'cache',
  'watcher',
  'usage',
  'auto-reload',
  /** The Claude Code processes the composer talks to. */
  'chat',
  /** The Claude Code processes running inside an embedded terminal. */
  'terminal',
  /** Reading Claude Code's own `cleanupPeriodDays` out of its settings files. */
  'retention',
  /** Reading and launching the local files a transcript names. */
  'files',
  'updates',
  /** Imported from the installer's update.log so an update reads as one timeline. */
  'update-helper',
  'http',
  'console',
  'log',
] as const;

/**
 * One line of a daily log file (JSONL). Short keys: these are written by the
 * thousand and read by a viewer, not by eye.
 */
export interface LogRecord {
  /** Local ISO-8601 with offset — sortable, Date.parse-able, and readable as-is. */
  t: string;
  lvl: LogLevel;
  src: string;
  /**
   * Always written. Two instances sharing a day's file is not supposed to
   * happen (one port), but if it ever does this is what makes it obvious.
   * The version is not repeated per record — the 'started' message carries it,
   * and this pid is what ties the rest of the lines to it.
   */
  pid: number;
  msg: string;
  /** Structured extra, when there is something worth reading separately. */
  data?: unknown;
  /** Stack trace, when the call carried an Error. */
  err?: string;
}

export interface LogDay {
  /** Local date, YYYY-MM-DD — also the file name. */
  date: string;
  sizeBytes: number;
}

export interface LogsResponse {
  logsDir: string;
  /** Newest day first. */
  days: LogDay[];
  level: LogLevel;
  retentionDays: number;
  /** The installer's own update.log, only present in a managed install. */
  updateLog: { available: boolean; path: string | null };
}

export interface LogDayResponse {
  date: string;
  /** Newest first, capped at LOG_PAGE_SIZE. */
  records: LogRecord[];
  /** Matching records before the cap. */
  total: number;
  truncated: boolean;
  /** Counts for the facet chips, over everything the text search matched. */
  levels: Record<string, number>;
  sources: Record<string, number>;
}

export const LOG_PAGE_SIZE = 2_000;

export interface UpdateLogResponse {
  available: boolean;
  path: string | null;
  /** Raw text — this one is written by the PowerShell installer, not by us. */
  text: string;
  sizeBytes: number;
  modifiedAt: string | null;
}

// ---- dated copies of userdata.json ----

/**
 * One stored copy. `name` is a file NAME and never a path: it is what the
 * restore request sends back, and a path from a request is the thing this app
 * does not do.
 */
export interface UserdataBackup {
  name: string;
  at: string;
  /** `initial`, `daily`, `manual`, `pre-loss`, `pre-restore`, `version-X`, `pre-update-X`. */
  reason: string;
  sizeBytes: number;
  /** What restoring it would bring back, or null when the copy itself does not parse. */
  contents: {
    titleOverrides: number;
    pins: number;
    stars: number;
    hasPrices: boolean;
    hasSettings: boolean;
  } | null;
}

export interface UserdataBackupsResponse {
  backupsDir: string;
  backups: UserdataBackup[];
  /** Set when this start-up found the file unreadable and put a copy back. */
  recovered: { from: string; at: string } | null;
}

export interface UserdataRestoreResponse {
  ok: true;
  restoredFrom: string;
  /** The copy taken of what was replaced, so a wrong restore is undoable. */
  backedUpTo: string | null;
}

// ---- SSE events on /api/events ----

export type ServerEvent =
  /**
   * Transcripts changed on disk. `assistantIds` is the subset where the bytes
   * appended contain a real `assistant` line — i.e. Claude answered and tokens
   * were spent. Every other write (your prompt, a tool result, the sidecar
   * lines re-appended each turn) moves the file without moving the figures, so
   * only this subset is worth a usage read.
   *
   * `agents` classifies the same change one level down: the subagent
   * transcripts that grew, each with the session it belongs to. Those are
   * separate conversations of 350-500 KB apiece behind their own query key, so
   * a panel or a drawer reading one of them refetches only when that one moved.
   */
  | {
      type: 'sessions-changed';
      ids: string[];
      assistantIds: string[];
      agents: { sessionId: string; agentId: string }[];
    }
  | { type: 'session-updated'; id: string }
  /**
   * The set of `claude` processes registered under `~/.claude/sessions`
   * changed. `ids` names the sessions that ENTERED or LEFT that set, and
   * nothing else: a busy/idle flip writes to the same directory and carries no
   * ids at all. Those are exactly the sessions whose `blockedReason` can have
   * changed, and no other event can speak for them — a CLI in a real terminal
   * is not ours to hear from.
   */
  | { type: 'live-changed'; ids: string[] }
  | { type: 'index-progress'; enriched: number; total: number }
  | { type: 'update-status' }
  /**
   * A session's chat process changed state. Separate from `live-changed`
   * because that one is driven by `~/.claude/sessions`, where a `--print` run
   * does not register: the server's own processes have no other way to say
   * they started a turn or finished one.
   */
  | { type: 'chat-changed'; id: string }
  /**
   * A session's embedded terminal started, exited or was closed. Its own event
   * for the reason `chat-changed` is one, and one more: the PTY lives in this
   * process, and `~/.claude/sessions` only ever hears about the CLI inside it --
   * never about the terminal around it, which outlives the CLI so its last
   * screen stays readable.
   */
  | { type: 'terminal-changed'; id: string }
  /**
   * A message was starred or unstarred. Its own event rather than
   * `session-updated`, which invalidates `['session', id]` — and that is a full
   * re-parse of the transcript, in every open tab, for a write that changed
   * nothing in it.
   */
  | { type: 'stars-changed' }
  /**
   * Settings were saved. Its own event because a window has no other way to
   * hear about a save it did not make: `['settings']` is mounted for the life of
   * the page by the usage widget in the header, so it never remounts, and
   * `refetchOnWindowFocus` is off — a second window kept its copy for as long as
   * it stayed open, **including the switches that decide whether this app talks
   * to the network at all**. Turning the usage read off in one window left every
   * other one reading.
   */
  | { type: 'settings-changed' }
  /** The price table was saved. The list, the stats page and three panels in the viewer all cost tokens in the browser from it. */
  | { type: 'prices-changed' }
  /**
   * A session stopped, came back, or was cleared from the bell. Its own event
   * and not `live-changed`, which fires on every write under
   * `~/.claude/sessions` — most of them nothing to do with a stop — and which
   * cannot speak for the composer at all. Payload-free on purpose: the list is
   * a handful of rows and is refetched whole.
   */
  | { type: 'notifications-changed' }
  | { type: 'logs-appended' };
