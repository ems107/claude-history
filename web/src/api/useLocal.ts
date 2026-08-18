import { useQuery } from '@tanstack/react-query';
import { LOCAL_ONLY_ACTIONS, type LocalOnlyAction } from '@claude-history/shared';
import { api } from './client.ts';

/**
 * Is this page being viewed on the machine the server runs on?
 *
 * From `/api/meta`, which is the only thing that can answer it — the server
 * reads it off the socket. Deliberately NOT derived from
 * `window.location.hostname`: that answers "what did I type", which is a
 * different question and stops being the same answer the first time the app is
 * reached by a hostname.
 *
 * Deduped by TanStack with every other `['meta']` reader, so this costs no
 * extra request wherever it is used.
 */
export function useIsRemote(): boolean {
  const { data } = useQuery({ queryKey: ['meta'], queryFn: api.meta });
  // Assume local until told otherwise: `meta` resolves in milliseconds, and
  // flashing every button from disabled to enabled on load is worse than the
  // other way round — the server refuses these anyway (409).
  return data?.remote ?? false;
}

/**
 * What to put on a button that cannot work from here: `disabled` and the
 * sentence explaining why, or nothing at all when we are on the machine.
 *
 * The reason text comes from `shared/src/localOnly.ts`, the same string the
 * server puts in the 409 — one fact, one home.
 */
export function useLocalOnly(action: LocalOnlyAction): { disabled: boolean; reason: string | null } {
  const remote = useIsRemote();
  return { disabled: remote, reason: remote ? LOCAL_ONLY_ACTIONS[action] : null };
}
