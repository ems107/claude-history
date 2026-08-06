import type { AppConfig } from './config.ts';
import type { SessionIndex } from './core/index.ts';
import type { SearchService } from './core/search.ts';
import type { UpdateService } from './core/updates.ts';

export interface AppContext {
  config: AppConfig;
  index: SessionIndex;
  search: SearchService;
  updates: UpdateService;
}
