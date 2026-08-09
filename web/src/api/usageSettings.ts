import { DEFAULT_SETTINGS, type AppSettings } from '@claude-history/shared';
import type { QueryClient } from '@tanstack/react-query';

/**
 * The usage settings as of right now, straight from the query cache.
 *
 * Read at fire time rather than closed over: the triggers live inside timers
 * and event handlers that must not be torn down and rebuilt every time an
 * unrelated setting changes, and a stale closure here would mean a switch the
 * user just turned off keeps firing until something else re-renders.
 *
 * Falls back to the defaults before the settings have loaded, which is only
 * ever the first instant after the page opens.
 */
export function readUsageSettings(queryClient: QueryClient): AppSettings {
  return queryClient.getQueryData<{ settings: AppSettings }>(['settings'])?.settings ?? DEFAULT_SETTINGS;
}
