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
 *    back in. Stopping the server and uninstalling are the whole list; applying
 *    an update is deliberately NOT here, because it comes back on its own.
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
  | 'openClaudeFolder'
  | 'openDataFolder'
  | 'openInstallFolder'
  | 'stopServer'
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
  openClaudeFolder: NOT_REMOTELY,
  openDataFolder: NOT_REMOTELY,
  openInstallFolder: NOT_REMOTELY,
  uninstall: NOT_REMOTELY,
  // The three that are refused for a reason of their own rather than for being
  // somewhere else, and it is worth one clause each.
  stopServer: 'Not available over remote access — it would end this connection with no way back in.',
  credentials: 'Not available over remote access — the username and password can only be changed on the machine itself.',
  firewall: 'Not available over remote access — Windows asks for administrator approval on the machine itself.',
};
