import type { LocalOnlyAction } from '@claude-history/shared';
import type { FastifyRequest } from 'fastify';

/**
 * Which endpoints only work where the server is.
 *
 * The list lives here and the REASONS live in `shared/src/localOnly.ts`, so
 * the button that greys out and the 409 that backs it up say the same sentence.
 * Matching happens on the URL rather than inside each handler because it has to
 * be exhaustive: a handler that forgets the check answers `{ ok: true }` and
 * opens a window nobody is looking at, which is the failure this whole set
 * exists to prevent.
 */
interface Rule {
  method: string;
  /** Path only, query stripped. */
  test: (path: string) => boolean;
  action: LocalOnlyAction;
}

const SESSION_OPEN = /^\/api\/sessions\/[^/]+\/open$/;
const SESSION_RESUME = /^\/api\/sessions\/[^/]+\/resume$/;
const GIT_OPEN = /^\/api\/git\/repos\/[^/]+\/open$/;

const RULES: Rule[] = [
  { method: 'POST', test: (p) => SESSION_RESUME.test(p), action: 'resumeTerminal' },
  { method: 'POST', test: (p) => p === '/api/files/open', action: 'openFile' },
  { method: 'POST', test: (p) => p === '/api/pick-folder', action: 'pickFolder' },
  { method: 'POST', test: (p) => p === '/api/retention/open-folder', action: 'openClaudeFolder' },
  { method: 'POST', test: (p) => p === '/api/open-data-folder', action: 'openDataFolder' },
  { method: 'POST', test: (p) => p === '/api/open-install-folder', action: 'openInstallFolder' },
  { method: 'POST', test: (p) => p === '/api/server/stop', action: 'stopServer' },
  { method: 'POST', test: (p) => p === '/api/server/restart', action: 'restartServer' },
  { method: 'POST', test: (p) => p === '/api/uninstall', action: 'uninstall' },
  { method: 'PUT', test: (p) => p === '/api/auth/credentials', action: 'credentials' },
  { method: 'POST', test: (p) => p === '/api/firewall', action: 'firewall' },
  { method: 'DELETE', test: (p) => p === '/api/firewall', action: 'firewall' },
  { method: 'DELETE', test: (p) => p === '/api/firewall/blocks', action: 'firewall' },
];

/**
 * The action this request would perform on the server's own desktop, or null.
 *
 * Two of them need their query, because each opens one of several things and
 * those are worth naming apart in the message a person reads:
 * `/api/sessions/:id/open` and the Git tab's `/api/git/repos/:id/open`.
 *
 * It is also why the Git tab's target travels in the query rather than in the
 * body: this hook runs before any body is parsed, so a target hidden in one
 * could not be read here at all — and this list only means anything if it is
 * exhaustive.
 */
export function localOnlyAction(request: FastifyRequest): LocalOnlyAction | null {
  const path = request.url.split('?')[0];
  if (request.method === 'POST' && SESSION_OPEN.test(path)) {
    return (request.query as { target?: string } | undefined)?.target === 'vscode' ? 'openVsCode' : 'openFolder';
  }
  if (request.method === 'POST' && GIT_OPEN.test(path)) {
    const target = (request.query as { target?: string } | undefined)?.target;
    // A target this does not recognise is refused as the terminal rather than
    // let through: the handler answers 400 to it anyway, and the one thing that
    // must never slip past is a window opening on a desktop nobody is at.
    return target === 'explorer' ? 'openFolder' : target === 'vscode' ? 'openVsCode' : 'openTerminal';
  }
  return RULES.find((r) => r.method === request.method && r.test(path))?.action ?? null;
}
