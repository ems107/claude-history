import type { AppConfig } from './config.ts';
import type { BindDecision } from './core/bind.ts';
import type { AutoReloadService } from './core/autoReload.ts';
import type { DeepSearchService } from './core/deepSearch.ts';
import type { SessionIndex } from './core/index.ts';
import type { NotificationsService } from './core/notifications.ts';
import type { ReadMarksService } from './core/readMarks.ts';
import type { SearchService } from './core/search.ts';
import type { SessionChatService } from './core/sessionChat.ts';
import type { SessionTerminalService } from './core/sessionTerminal.ts';
import type { UpdateService } from './core/updates.ts';
import type { UsageService } from './core/usage.ts';

export interface AppContext {
  config: AppConfig;
  /**
   * Where this process listens and why, decided before `listen()` and immutable
   * after it — a socket's address cannot be changed under it, which is why
   * switching remote access asks for a restart.
   */
  bind: BindDecision;
  index: SessionIndex;
  search: SearchService;
  deepSearch: DeepSearchService;
  updates: UpdateService;
  usage: UsageService;
  autoReload: AutoReloadService;
  chat: SessionChatService;
  /** Which sessions have stopped, and why — the header's bell. */
  notifications: NotificationsService;
  /** How much of each session has been read — the count on a list row. */
  readMarks: ReadMarksService;
  /** The embedded terminals — the other half of `chatMode`. */
  terminals: SessionTerminalService;
}
