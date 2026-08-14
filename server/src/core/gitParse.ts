import type {
  GitBranch,
  GitCommit,
  GitDiffLine,
  GitEntryState,
  GitFileDiff,
  GitFileEntry,
  GitHunk,
  GitRef,
  GitRemote,
  GitRemoteBranch,
  GitStash,
  GitTag,
  GitWorktree,
} from '@claude-history/shared';
import path from 'node:path';

/**
 * Turning git's output into data. Pure functions only — nothing here spawns
 * anything, so every format below can be checked against a captured string.
 *
 * Two separators run through the file. `for-each-ref` takes hex escapes
 * directly (`%1f`), while `log` and `stash list` need them written `%x1f`;
 * they are the same bytes, and mixing the two up produces a format string that
 * silently prints itself. Records are 0x1e, fields 0x1f — neither can occur in
 * a subject, a ref name or a path.
 */
export const REC = '\x1e';
export const FLD = '\x1f';

// ---------------------------------------------------------------- status

/** The unmerged combinations, in words. Resolved here so the UI never re-derives them. */
const CONFLICT_KINDS: Record<string, string> = {
  DD: 'both deleted',
  AU: 'added by us',
  UD: 'deleted by them',
  UA: 'added by them',
  DU: 'deleted by us',
  AA: 'both added',
  UU: 'both modified',
};

function stateOf(code: string): GitEntryState | null {
  switch (code) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typechange';
    default:
      return null;
  }
}

export interface ParsedStatus {
  branch: string | null;
  detachedAt: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  headSha: string | null;
  entries: GitFileEntry[];
}

/**
 * `git status --porcelain=v2 --branch -z`.
 *
 * The trap is the rename record. Without `-z` git writes `<new>\t<orig>`; WITH
 * `-z` the original path is a field of its own, NUL-terminated, immediately
 * after the record. Reading it as one field mislabels every rename, so the
 * scan walks fields by index rather than mapping over them.
 */
export function parseStatusV2(stdout: string): ParsedStatus {
  const fields = stdout.split('\0');
  const out: ParsedStatus = {
    branch: null,
    detachedAt: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    headSha: null,
    entries: [],
  };

  for (let i = 0; i < fields.length; i++) {
    const line = fields[i];
    if (!line) continue;

    if (line.startsWith('# ')) {
      const [, key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') out.headSha = value === '(initial)' ? null : value;
      else if (key === 'branch.head') out.branch = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') out.upstream = value || null;
      else if (key === 'branch.ab') {
        // "+2 -1"
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          out.ahead = Number(m[1]);
          out.behind = Number(m[2]);
        }
      }
      continue;
    }

    const kind = line[0];
    if (kind === '1' || kind === '2') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path>  (+ <orig> as the next field)
      const head = kind === '1' ? 8 : 9;
      const parts = splitFirst(line, head);
      if (parts.length < head + 1) continue;
      const xy = parts[1];
      const sub = parts[2];
      const filePath = parts[head];
      const origPath = kind === '2' ? (fields[++i] ?? null) : null;
      out.entries.push({
        path: filePath,
        origPath,
        x: xy[0],
        y: xy[1],
        staged: stateOf(xy[0]),
        unstaged: stateOf(xy[1]),
        conflicted: false,
        conflictKind: null,
        submodule: sub.startsWith('S'),
      });
    } else if (kind === 'u') {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = splitFirst(line, 10);
      if (parts.length < 11) continue;
      const xy = parts[1];
      out.entries.push({
        path: parts[10],
        origPath: null,
        x: xy[0],
        y: xy[1],
        staged: null,
        unstaged: null,
        conflicted: true,
        conflictKind: CONFLICT_KINDS[xy] ?? 'unmerged',
        submodule: parts[2].startsWith('S'),
      });
    } else if (kind === '?' || kind === '!') {
      out.entries.push({
        path: line.slice(2),
        origPath: null,
        x: kind,
        y: kind,
        staged: null,
        unstaged: kind === '?' ? 'untracked' : 'ignored',
        conflicted: false,
        conflictKind: null,
        submodule: false,
      });
    }
  }

  if (!out.branch && out.headSha) out.detachedAt = out.headSha;
  return out;
}

/**
 * Split on spaces, but only `count` times — the rest is one field. A path can
 * contain spaces, and it is always last.
 */
function splitFirst(line: string, count: number): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const at = line.indexOf(' ', start);
    if (at < 0) return parts;
    parts.push(line.slice(start, at));
    start = at + 1;
  }
  parts.push(line.slice(start));
  return parts;
}

// ---------------------------------------------------------------- refs

/** `%(upstream:track,nobracket)` — "ahead 2, behind 1", "gone", or empty. */
function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (!track) return { ahead: 0, behind: 0, gone: false };
  if (/^gone$/i.test(track.trim())) return { ahead: 0, behind: 0, gone: true };
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: false };
}

export const BRANCH_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(committerdate:iso-strict)',
  '%(contents:subject)',
].join('%1f');

export function parseLocalBranches(stdout: string, worktreeBranches: Map<string, string>): GitBranch[] {
  const out: GitBranch[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [fullRef, sha, head, upstream, track, date, subject] = line.split(FLD);
    if (!fullRef) continue;
    const name = fullRef.replace(/^refs\/heads\//, '');
    const t = parseTrack(track ?? '');
    out.push({
      name,
      fullRef,
      sha: sha ?? '',
      current: head === '*',
      upstream: upstream || null,
      upstreamGone: t.gone,
      ahead: t.ahead,
      behind: t.behind,
      lastCommitAt: date || null,
      lastSubject: subject ?? null,
      worktreePath: worktreeBranches.get(fullRef) ?? null,
    });
  }
  return out;
}

export const REMOTE_BRANCH_FORMAT = ['%(refname)', '%(objectname)', '%(committerdate:iso-strict)'].join('%1f');

export function parseRemoteBranches(stdout: string, localNames: Set<string>): GitRemoteBranch[] {
  const out: GitRemoteBranch[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [fullRef, sha, date] = line.split(FLD);
    if (!fullRef) continue;
    const short = fullRef.replace(/^refs\/remotes\//, '');
    // origin/HEAD is a symbolic pointer, not a branch anyone works on.
    if (/\/HEAD$/.test(short)) continue;
    const slash = short.indexOf('/');
    const remote = slash > 0 ? short.slice(0, slash) : '';
    const name = slash > 0 ? short.slice(slash + 1) : short;
    out.push({
      name,
      remote,
      fullRef,
      sha: sha ?? '',
      lastCommitAt: date || null,
      localMissing: !localNames.has(name),
    });
  }
  return out;
}

export const TAG_FORMAT = [
  '%(refname:short)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(contents:subject)',
  '%(creatordate:iso-strict)',
].join('%1f');

export function parseTags(stdout: string): GitTag[] {
  const out: GitTag[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, type, objectName, peeled, subject, date] = line.split(FLD);
    if (!name) continue;
    const annotated = type === 'tag';
    out.push({
      name,
      // An annotated tag is its own object; what it points AT is the commit.
      sha: annotated ? (peeled || objectName) : objectName,
      annotated,
      subject: subject || null,
      at: date || null,
    });
  }
  return out;
}

export function parseRemotes(stdout: string): GitRemote[] {
  const byName = new Map<string, GitRemote>();
  for (const line of stdout.split('\n')) {
    const m = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const [, name, url, kind] = m;
    const existing = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
    if (kind === 'fetch') existing.fetchUrl = url;
    else existing.pushUrl = url;
    byName.set(name, existing);
  }
  return [...byName.values()];
}

export const STASH_FORMAT = ['%gd', '%H', '%gs', '%aI'].join('%x1f');

export function parseStashList(stdout: string): GitStash[] {
  const out: GitStash[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [ref, sha, message, at] = line.split(FLD);
    if (!ref) continue;
    const index = Number(/stash@\{(\d+)\}/.exec(ref)?.[1] ?? out.length);
    // "On main: wip: something" / "WIP on main: 1a2b3c message"
    const on = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(message ?? '');
    out.push({
      index,
      ref,
      sha: sha ?? '',
      message: on ? on[2] : (message ?? ''),
      branch: on ? on[1] : null,
      at: at ?? '',
    });
  }
  return out;
}

/** `git worktree list --porcelain` — stanzas separated by a blank line. */
export function parseWorktreeList(stdout: string): GitWorktree[] {
  const out: GitWorktree[] = [];
  for (const block of stdout.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) continue;
    const first = lines.find((l) => l.startsWith('worktree '));
    if (!first) continue;
    // git answers with forward slashes here as it does for rev-parse.
    const wtPath = path.normalize(first.slice('worktree '.length));
    const branchLine = lines.find((l) => l.startsWith('branch '));
    out.push({
      path: wtPath,
      head: lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? '',
      branch: branchLine ? branchLine.slice('branch '.length) : null,
      bare: lines.includes('bare'),
      detached: lines.includes('detached'),
      locked: lines.some((l) => l === 'locked' || l.startsWith('locked ')),
      isMain: out.length === 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------- commits

/** Note `%x1e`/`%x1f`, not `%1e`/`%1f`: `log` and `for-each-ref` spell hex escapes differently. */
export const LOG_FORMAT = '%x1e%H%x1f%P%x1f%D%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s';

/**
 * `%D` with `--decorate=full`: "HEAD -> refs/heads/main, tag: refs/tags/v1.0.0,
 * refs/remotes/origin/main". Full refnames are the point — local, remote and
 * tag are then read off the namespace instead of guessed from the short form.
 */
export function parseDecoration(decoration: string): GitRef[] {
  if (!decoration.trim()) return [];
  const refs: GitRef[] = [];
  for (const raw of decoration.split(', ')) {
    let text = raw.trim();
    if (!text) continue;
    let isHead = false;
    if (text.startsWith('HEAD -> ')) {
      isHead = true;
      text = text.slice('HEAD -> '.length);
    } else if (text === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD', fullRef: 'HEAD', isHead: true });
      continue;
    }
    if (text.startsWith('tag: ')) {
      const fullRef = text.slice('tag: '.length);
      refs.push({ kind: 'tag', name: fullRef.replace(/^refs\/tags\//, ''), fullRef, isHead: false });
    } else if (text.startsWith('refs/heads/')) {
      refs.push({ kind: 'branch', name: text.slice('refs/heads/'.length), fullRef: text, isHead });
    } else if (text.startsWith('refs/remotes/')) {
      const name = text.slice('refs/remotes/'.length);
      // origin/HEAD duplicates whatever it points at; it is noise on a row.
      if (/\/HEAD$/.test(name)) continue;
      refs.push({ kind: 'remote', name, fullRef: text, isHead: false });
    } else if (text.startsWith('refs/tags/')) {
      refs.push({ kind: 'tag', name: text.slice('refs/tags/'.length), fullRef: text, isHead: false });
    }
  }
  return refs;
}

export function parseLogRecords(stdout: string): GitCommit[] {
  const out: GitCommit[] = [];
  for (const record of stdout.split(REC)) {
    if (!record.trim()) continue;
    // Each record but the first is preceded by the previous one's newline.
    const fields = record.replace(/^\r?\n/, '').split(FLD);
    if (fields.length < 8) continue;
    const [sha, parents, decoration, authorName, authorEmail, authoredAt, committedAt, subject] = fields;
    if (!sha) continue;
    out.push({
      sha,
      shortSha: sha.slice(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      refs: parseDecoration(decoration ?? ''),
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authoredAt: authoredAt ?? '',
      committedAt: committedAt ?? '',
      // A subject cannot contain the separators, but it can end with the
      // newline that precedes the next record.
      subject: (subject ?? '').replace(/\r?\n$/, ''),
    });
  }
  return out;
}

// ---------------------------------------------------------------- diffs

/**
 * A unified diff, per file, into hunks with both line numbers resolved.
 *
 * Paths come from the `--- a/` and `+++ b/` lines rather than from the
 * `diff --git a/x b/x` header: that header is genuinely ambiguous when a path
 * contains a space, and with `core.quotepath=false` the `---`/`+++` lines carry
 * the raw name with nothing after it.
 */
export function parseDiff(text: string, maxLines: number): GitFileDiff[] {
  const files: GitFileDiff[] = [];
  if (!text.trim()) return files;

  // Split into per-file blocks, keeping the header line with its block.
  const blocks = text.split(/\r?\n(?=diff --git )/);
  for (const block of blocks) {
    if (!block.startsWith('diff --git ')) continue;
    const lines = block.split(/\r?\n/);

    let filePath = '';
    let origPath: string | null = null;
    let status = 'M';
    let binary = false;
    let additions = 0;
    let deletions = 0;
    const hunks: GitHunk[] = [];
    let current: GitHunk | null = null;
    let oldNo = 0;
    let newNo = 0;
    let lastOldEnd = 0;
    let total = 0;
    let tooLarge = false;

    for (const line of lines) {
      if (current) {
        const kind = line[0];
        if (kind === '+' || kind === '-' || kind === ' ' || line === '') {
          if (total >= maxLines) {
            tooLarge = true;
            current = null;
            continue;
          }
          total++;
          if (kind === '+') {
            current.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) });
            additions++;
          } else if (kind === '-') {
            current.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) });
            deletions++;
          } else {
            const body = line === '' ? '' : line.slice(1);
            // A conflicted file is diffed with its markers still in it; they
            // are context lines as far as git is concerned, and the reader
            // needs them to stand out.
            const isMarker = /^(<{7}|\|{7}|={7}|>{7})/.test(body);
            current.lines.push({
              kind: isMarker ? 'conflict' : 'ctx',
              oldNo: oldNo++,
              newNo: newNo++,
              text: body,
            });
          }
          continue;
        }
        if (kind === '\\') {
          // "\ No newline at end of file" belongs to the line before it.
          current.lines.push({ kind: 'meta', oldNo: null, newNo: null, text: line.slice(2) });
          continue;
        }
        current = null; // anything else ends the hunk
      }

      const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
      if (hunkHeader) {
        const oldStart = Number(hunkHeader[1]);
        const oldLines = hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2]);
        const newStart = Number(hunkHeader[3]);
        const newLines = hunkHeader[4] === undefined ? 1 : Number(hunkHeader[4]);
        current = {
          header: line,
          oldStart,
          oldLines,
          newStart,
          newLines,
          gapBefore: lastOldEnd > 0 ? Math.max(0, oldStart - lastOldEnd) : Math.max(0, oldStart - 1),
          lines: [],
        };
        lastOldEnd = oldStart + oldLines;
        oldNo = oldStart;
        newNo = newStart;
        hunks.push(current);
        continue;
      }

      if (line.startsWith('rename from ')) {
        origPath = line.slice('rename from '.length);
        status = 'R';
      } else if (line.startsWith('rename to ')) {
        filePath = line.slice('rename to '.length);
      } else if (line.startsWith('copy from ')) {
        origPath = line.slice('copy from '.length);
        status = 'C';
      } else if (line.startsWith('copy to ')) {
        filePath = line.slice('copy to '.length);
      } else if (line.startsWith('new file mode')) {
        status = 'A';
      } else if (line.startsWith('deleted file mode')) {
        status = 'D';
      } else if (line.startsWith('--- ')) {
        const p = line.slice(4);
        if (p !== '/dev/null' && !filePath) filePath = stripPrefix(p);
      } else if (line.startsWith('+++ ')) {
        const p = line.slice(4);
        if (p !== '/dev/null') filePath = stripPrefix(p);
      } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        binary = true;
      }
    }

    if (!filePath) {
      // Everything else failed: fall back to the header, ambiguity and all.
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[0]);
      if (m) filePath = m[2];
    }
    if (!filePath) continue;

    files.push({
      path: filePath,
      origPath,
      status,
      binary,
      additions,
      deletions,
      tooLarge,
      hunks: tooLarge ? [] : hunks,
    });
  }
  return files;
}

function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

// ---------------------------------------------------------------- numstat

export interface NumStatEntry {
  path: string;
  origPath: string | null;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

/**
 * `git diff --numstat -z`. Binary files answer `-\t-`, and a rename spends
 * TWO extra NUL fields (source then destination) instead of the tab-separated
 * pair it uses without `-z`.
 */
export function parseNumstatZ(stdout: string): NumStatEntry[] {
  const fields = stdout.split('\0');
  const out: NumStatEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (!record) continue;
    const parts = record.split('\t');
    if (parts.length < 2) continue;
    const [addRaw, delRaw, maybePath] = parts;
    const binary = addRaw === '-' || delRaw === '-';
    if (maybePath) {
      out.push({
        path: maybePath,
        origPath: null,
        additions: binary ? null : Number(addRaw),
        deletions: binary ? null : Number(delRaw),
        binary,
      });
    } else {
      // Rename or copy: the two paths follow as their own fields.
      const origPath = fields[++i] ?? '';
      const newPath = fields[++i] ?? '';
      out.push({
        path: newPath,
        origPath,
        additions: binary ? null : Number(addRaw),
        deletions: binary ? null : Number(delRaw),
        binary,
      });
    }
  }
  return out;
}

/** `git diff --name-status -z`, same rename caveat. */
export function parseNameStatusZ(stdout: string): { status: string; path: string; origPath: string | null }[] {
  const fields = stdout.split('\0');
  const out: { status: string; path: string; origPath: string | null }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i];
    if (!status) continue;
    if (/^[RC]\d*$/.test(status)) {
      const origPath = fields[++i] ?? '';
      const newPath = fields[++i] ?? '';
      out.push({ status: status[0], path: newPath, origPath });
    } else {
      const p = fields[++i] ?? '';
      if (!p) continue;
      out.push({ status: status[0], path: p, origPath: null });
    }
  }
  return out;
}
