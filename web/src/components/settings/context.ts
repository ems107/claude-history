import type { AppSettings } from '@claude-history/shared';
import { createContext, useContext } from 'react';
import type { SettingsResponse } from '../../api/client.ts';

/**
 * What every control on the settings page needs, and what none of them should
 * have to be handed.
 *
 * A context rather than props for the reason `StarContext` is one: the six area
 * components sit under the page that knows all of this, and a `save` threaded
 * through each of them would be six signatures to change every time one more
 * thing turns out to be needed. There is exactly one provider, in
 * `pages/SettingsPage.tsx`, and it wraps the whole panel — so unlike the
 * viewer's contexts, absent here is a bug rather than a state.
 */
export interface SettingsContextValue {
  settings: AppSettings;
  /**
   * The defaults THIS server starts from — not the shipped ones.
   *
   * A dev instance's differ (`DEV_SETTING_OVERRIDES` turns the two automatic
   * network calls off), and a marker offering to restore a value the server
   * never had would be a lie.
   */
  defaults: AppSettings;
  /** Everything else `/api/settings` answers: the paths and the version. */
  meta: SettingsResponse;
  /** Whether this page belongs to the dev instance. */
  dev: boolean;
  /**
   * The id of the group or row a deep link or a search result just landed on,
   * for the one pass of `anchor-flash` that says which of them was meant.
   *
   * It lives here rather than being passed down because ANY row in ANY area can
   * be the target, and the alternative was every area component taking a prop it
   * does nothing with but forward. Null the rest of the time, which is nearly
   * always.
   */
  flashed: string | null;
  /**
   * Save a patch. Fire-and-forget by design: it puts the answer straight into
   * the query cache, and the two refusals it can meet — the app running Claude,
   * and anything else — are handled at the one place it lives rather than by
   * every caller.
   */
  save: (patch: Partial<AppSettings>) => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettingsPage(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('A settings control was drawn outside SettingsPage');
  return value;
}
