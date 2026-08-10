import type { SearchMode, SearchWordScope } from '@claude-history/shared';

/**
 * How the search bar is currently tuned. It lives in the URL and nowhere else:
 * sessionStorage restores the querystring when you come back from a session, so
 * the tuning survives the trip, but opening the app fresh starts simple again —
 * which is what makes the advanced options a decision about this piece of work
 * rather than a setting to remember having changed.
 */
export interface SearchTuning {
  mode: SearchMode;
  scope: SearchWordScope;
  wholeWord: boolean;
}

export const DEFAULT_TUNING: SearchTuning = { mode: 'phrase', scope: 'message', wholeWord: false };

/** Every param the search owns, so filter changes stop wiping them. */
export const SEARCH_PARAMS = ['q', 'in', 'mode', 'co', 'w'];

export function parseTuning(params: URLSearchParams): SearchTuning {
  return {
    mode: params.get('mode') === 'words' ? 'words' : 'phrase',
    scope: params.get('co') === 'session' ? 'session' : 'message',
    wholeWord: params.get('w') === '1',
  };
}

/** Only what differs from the default is written, so a plain search keeps a plain URL. */
export function applyTuning(params: URLSearchParams, tuning: SearchTuning): void {
  if (tuning.mode === 'words') params.set('mode', 'words');
  else params.delete('mode');
  if (tuning.mode === 'words' && tuning.scope === 'session') params.set('co', 'session');
  else params.delete('co');
  if (tuning.wholeWord) params.set('w', '1');
  else params.delete('w');
}

/**
 * How many options are away from their default — what the collapsed panel shows,
 * so a tuning left on can never change results without saying so. The scope is
 * part of the match choice, not a count of its own.
 */
export function tuningChanges(tuning: SearchTuning): number {
  return (tuning.mode === 'phrase' ? 0 : 1) + (tuning.wholeWord ? 1 : 0);
}
