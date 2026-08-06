import fsp from 'node:fs/promises';
import { num, safeParse, str } from './jsonl.ts';

// ~/.claude/history.jsonl — global log of every typed prompt:
// {"display":"...","pastedContents":{},"timestamp":<epoch ms>,"project":"C:\\real\\path","sessionId":"..."}

export interface HistoryEntry {
  display: string;
  timestamp: number; // epoch ms (NOT ISO like transcripts)
  project: string;
  sessionId: string;
}

export interface HistoryData {
  entries: HistoryEntry[];
  /** sessionId → real project path (last entry wins). */
  sessionProject: Map<string, string>;
}

export async function readHistoryData(historyFile: string): Promise<HistoryData> {
  const entries: HistoryEntry[] = [];
  const sessionProject = new Map<string, string>();
  let text: string;
  try {
    text = await fsp.readFile(historyFile, 'utf8');
  } catch {
    return { entries, sessionProject };
  }
  for (const line of text.split('\n')) {
    const o = safeParse(line);
    if (!o) continue;
    const display = str(o.display);
    const project = str(o.project);
    const sessionId = str(o.sessionId);
    const timestamp = num(o.timestamp);
    if (display === null || !project || !sessionId || timestamp === null) continue;
    entries.push({ display, timestamp, project, sessionId });
    sessionProject.set(sessionId, project);
  }
  return { entries, sessionProject };
}
