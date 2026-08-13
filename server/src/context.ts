import type { AppConfig } from './config.ts';
import type { AutoReloadService } from './core/autoReload.ts';
import type { DeepSearchService } from './core/deepSearch.ts';
import type { SessionIndex } from './core/index.ts';
import type { SearchService } from './core/search.ts';
import type { SessionChatService } from './core/sessionChat.ts';
import type { UpdateService } from './core/updates.ts';
import type { UsageService } from './core/usage.ts';

export interface AppContext {
  config: AppConfig;
  index: SessionIndex;
  search: SearchService;
  deepSearch: DeepSearchService;
  updates: UpdateService;
  usage: UsageService;
  autoReload: AutoReloadService;
  chat: SessionChatService;
}
