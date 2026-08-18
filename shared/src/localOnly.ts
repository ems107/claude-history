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
 * copies of it would disagree the first time one was reworded.
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

export const LOCAL_ONLY_ACTIONS: Record<LocalOnlyAction, string> = {
  openFolder: 'Opens Explorer on the machine running claude-history — nothing would happen on this screen.',
  openVsCode: 'Opens VS Code on the machine running claude-history — nothing would happen on this screen.',
  resumeTerminal:
    'Opens a terminal on the machine running claude-history — nothing would happen on this screen. Copy the command instead.',
  openFile: 'Opens the file on the machine running claude-history — nothing would happen on this screen.',
  openClaudeFolder: 'Opens Explorer on the machine running claude-history — nothing would happen on this screen.',
  openDataFolder: 'Opens Explorer on the machine running claude-history — nothing would happen on this screen.',
  openInstallFolder: 'Opens Explorer on the machine running claude-history — nothing would happen on this screen.',
  stopServer:
    'Stopping the server from here would end this connection with no way to start it again remotely. Do it on the machine itself.',
  uninstall: 'Uninstalling is only possible on the machine running claude-history.',
  credentials:
    'The username and password can only be changed on the machine running claude-history — that is what makes it possible to get back in after forgetting them.',
  firewall:
    'Windows asks for administrator approval on the machine itself, so this can only be done there.',
};
