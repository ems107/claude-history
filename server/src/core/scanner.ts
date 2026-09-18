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
  /**
   * Bytes across `subagents/*.jsonl`. The session total now includes what those
   * agents spent, and their files grow on their own schedule — an agent runs in
   * the background and keeps writing after the line that launched it — so the
   * session file's own (size, mtime) cannot say whether that figure is stale.
   * This is what tells the enricher to look again.
   */
  subagentBytes: number;
  /**
   * The same bytes, per agent (`agentId` → size), which is the only thing that
   * can say WHICH agent wrote. The total above answers "is this session's spend
   * stale"; a browser watching one agent's transcript needs the narrower answer,
   * and re-reading every agent of a session on every write is what not having it
   * costs. Diffed in `SessionIndex.rescan`.
   */
  subagentSizes: Record<string, number>;
}

interface ScannedSubagents {
  count: number;
  bytes: number;
  sizes: Record<string, number>;
}

const NO_SUBAGENTS: ScannedSubagents = { count: 0, bytes: 0, sizes: {} };

async function scanSubagents(sessionDir: string): Promise<ScannedSubagents> {
  const dir = path.join(sessionDir, 'subagents');
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return NO_SUBAGENTS;
  }
  let bytes = 0;
  const sizes: Record<string, number> = {};
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const size = (await fsp.stat(path.join(dir, name))).size;
      bytes += size;
      // Keyed on the agent id, because that is what the URL, the query key and a
      // notification all call this agent; the filename is where it is written.
      sizes[name.slice('agent-'.length, -'.jsonl'.length)] = size;
    } catch {
      // deleted between readdir and stat
    }
  }
  // Counted by the meta files, as before: a transcript with no meta is not an
  // agent we can name, and a meta with no transcript is still one that ran.
  return { count: entries.filter((e) => e.endsWith('.meta.json')).length, bytes, sizes };
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
      const subagents = sessionDir ? await scanSubagents(sessionDir) : NO_SUBAGENTS;
      result.push({
        id,
        filePath,
        encodedDir: dirName,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sessionDir,
        subagentCount: subagents.count,
        subagentBytes: subagents.bytes,
        subagentSizes: subagents.sizes,
      });
    }
  }
  return result;
}
