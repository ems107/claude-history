/**
 * The actions that only work where the server is, and why.
 *
 * Two kinds live here, and both are refused to a remote browser:
 *
 *  - Ones that open a WINDOW on the server's desktop — Explorer, VS Code, a
 *    terminal. Over the network they do not fail: they answer `{ ok: true }`
 *    and open something in an empty room. Silent success is the worst failure
 *    mode there is, which is why these are refused rather than left to try.
 *  - Ones that would CUT THE CONNECTION they arrived through, leaving no way
 *    back in. Stopping the server, restarting it and uninstalling are the whole
 *    list; applying an update is deliberately NOT here, because it comes back
 *    on its own AND comes back reachable. A restart only manages the first
 *    half: the bind is decided at startup from the switch and the firewall, so
 *    a restart asked for from another machine can perfectly well come back
 *    listening on loopback alone — which is a locked door from the outside.
 *
 * The text is the same in both places it appears — the disabled button's
 * tooltip and the body of the 409 — because they are the same fact, and two
 * copies of it would disagree the first time one was reworded. It answers
 * "why is this grey", and nothing else: the reasoning above is for whoever
 * maintains the list, not for the person hovering the button.
 */
export type LocalOnlyAction =
  | 'openFolder'
  | 'openVsCode'
  | 'resumeTerminal'
  | 'openFile'
  | 'pickFolder'
  | 'openClaudeFolder'
  | 'openDataFolder'
  | 'openInstallFolder'
  | 'stopServer'
  | 'restartServer'
  | 'uninstall'
  | 'credentials'
  | 'firewall';

/**
 * What almost all of them say, and the shape the rest follow: the REASON this
 * one is dead, which is the remote connection — never a description of what the
 * button does. Someone hovering a greyed-out button already knows what it does;
 * what they cannot see is why it is grey, and "it would do nothing here" tells
 * them the outcome instead of the cause.
 */
const NOT_REMOTELY = 'Not available over remote access — only on the machine claude-history runs on.';

export const LOCAL_ONLY_ACTIONS: Record<LocalOnlyAction, string> = {
  openFolder: NOT_REMOTELY,
  openVsCode: NOT_REMOTELY,
  resumeTerminal: NOT_REMOTELY,
  openFile: NOT_REMOTELY,
  // The dialog would open on the server's desktop and the folder it browses is
  // that machine's disk, so from here there is nothing it could pick that this
  // browser meant. Typing the path stays available, which is the point: only the
  // convenience is refused, never the action.
  pickFolder: 'Not available over remote access — the folder browser opens on the machine claude-history runs on. Type the path instead.',
  openClaudeFolder: NOT_REMOTELY,
  openDataFolder: NOT_REMOTELY,
  openInstallFolder: NOT_REMOTELY,
  uninstall: NOT_REMOTELY,
  // The three that are refused for a reason of their own rather than for being
  // somewhere else, and it is worth one clause each.
  stopServer: 'Not available over remote access — it would end this connection with no way back in.',
  restartServer:
    'Not available over remote access — a restart can come back listening on that machine only, with no way back in.',
  credentials: 'Not available over remote access — the username and password can only be changed on the machine itself.',
  firewall: 'Not available over remote access — Windows asks for administrator approval on the machine itself.',
};
