import type { AppConfig } from './config.ts';
import type { SessionIndex } from './core/index.ts';

export interface AppContext {
  config: AppConfig;
  index: SessionIndex;
}
