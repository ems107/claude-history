import fsp from 'node:fs/promises';
import path from 'node:path';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ScannedSession {
  id: string;
  filePath: string;
  encodedDir: string;
  sizeBytes: number;
  mtimeMs: number;
  /** `<projectDir>/<sessionUuid>` — holds subagents/ and tool-results/ when present. */
  sessionDir: string | null;
  subagentCount: number;
}

async function countSubagents(sessionDir: string): Promise<number> {
  try {
    const entries = await fsp.readdir(path.join(sessionDir, 'subagents'));
    return entries.filter((e) => e.endsWith('.meta.json')).length;
  } catch {
    return 0;
  }
}

/** Enumerate all top-level session transcripts under ~/.claude/projects. */
export async function scanSessions(projectsDir: string): Promise<ScannedSession[]> {
  let projectDirs: string[];
  try {
    projectDirs = (await fsp.readdir(projectsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return []; // no ~/.claude/projects at all
  }

  const result: ScannedSession[] = [];
  for (const dirName of projectDirs) {
    const dirPath = path.join(projectsDir, dirName);
    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    const subdirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const id = entry.name.slice(0, -'.jsonl'.length);
      if (!UUID_RE.test(id)) continue; // agent-*.jsonl never sit at top level, but be strict anyway
      const filePath = path.join(dirPath, entry.name);
      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        continue; // deleted between readdir and stat
      }
      const sessionDir = subdirs.has(id) ? path.join(dirPath, id) : null;
      result.push({
        id,
        filePath,
        encodedDir: dirName,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sessionDir,
        subagentCount: sessionDir ? await countSubagents(sessionDir) : 0,
      });
    }
  }
  return result;
}
