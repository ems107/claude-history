import type { IndexState, ProjectInfo, SessionSummary } from '@claude-history/shared';
import type { AppConfig } from '../config.ts';
import { readHistoryData, type HistoryData } from './history.ts';
import { buildProjects } from './projects.ts';
import { scanSessions, type ScannedSession } from './scanner.ts';
import { summarizeSession } from './summarizer.ts';

/**
 * In-memory index of all sessions. Built from a cheap head/tail scan;
 * enrichment (full parses) is layered on top later.
 */
export class SessionIndex {
  private sessions = new Map<string, SessionSummary>();
  private scanned = new Map<string, ScannedSession>();
  private history: HistoryData = { entries: [], sessionProject: new Map() };
  state: IndexState = 'scanning';
  cacheHits = 0;

  constructor(private readonly config: AppConfig) {}

  async build(): Promise<void> {
    this.state = 'scanning';
    this.history = await readHistoryData(this.config.historyFile);
    const scanned = await scanSessions(this.config.projectsDir);
    for (const s of scanned) {
      this.scanned.set(s.id, s);
      try {
        this.sessions.set(s.id, await summarizeSession(s, this.history.sessionProject));
      } catch (err) {
        console.warn(`[index] failed to summarize ${s.filePath}:`, err);
      }
    }
    this.state = 'ready';
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  get(id: string): SessionSummary | undefined {
    return this.sessions.get(id);
  }

  getScanned(id: string): ScannedSession | undefined {
    return this.scanned.get(id);
  }

  projects(): ProjectInfo[] {
    return buildProjects(this.sessions.values());
  }

  get size(): number {
    return this.sessions.size;
  }

  get historyData(): HistoryData {
    return this.history;
  }
}
