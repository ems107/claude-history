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

const RULES: Rule[] = [
  { method: 'POST', test: (p) => SESSION_RESUME.test(p), action: 'resumeTerminal' },
  { method: 'POST', test: (p) => p === '/api/files/open', action: 'openFile' },
  { method: 'POST', test: (p) => p === '/api/retention/open-folder', action: 'openClaudeFolder' },
  { method: 'POST', test: (p) => p === '/api/open-data-folder', action: 'openDataFolder' },
  { method: 'POST', test: (p) => p === '/api/open-install-folder', action: 'openInstallFolder' },
  { method: 'POST', test: (p) => p === '/api/server/stop', action: 'stopServer' },
  { method: 'POST', test: (p) => p === '/api/uninstall', action: 'uninstall' },
  { method: 'PUT', test: (p) => p === '/api/auth/credentials', action: 'credentials' },
  { method: 'POST', test: (p) => p === '/api/firewall', action: 'firewall' },
  { method: 'DELETE', test: (p) => p === '/api/firewall', action: 'firewall' },
];

/**
 * The action this request would perform on the server's own desktop, or null.
 *
 * `/api/sessions/:id/open` is the one that needs its query: the same endpoint
 * opens Explorer or VS Code, and the two are worth naming apart in the message
 * a person reads.
 */
export function localOnlyAction(request: FastifyRequest): LocalOnlyAction | null {
  const path = request.url.split('?')[0];
  if (request.method === 'POST' && SESSION_OPEN.test(path)) {
    return (request.query as { target?: string } | undefined)?.target === 'vscode' ? 'openVsCode' : 'openFolder';
  }
  return RULES.find((r) => r.method === request.method && r.test(path))?.action ?? null;
}
