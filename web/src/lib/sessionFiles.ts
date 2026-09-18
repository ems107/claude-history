import type { ContentBlock, Turn } from '@claude-history/shared';
import { normalisePath, refBasename } from './fileRefs.ts';
import { parseSentFiles } from './sentFiles.ts';

type ToolBlockType = Extract<ContentBlock, { kind: 'tool' }>;

/** Which way a file left the session. */
export type SessionFileKind = 'sent' | 'artifact' | 'plan';

/** One file the session handed over, wherever it went and however often. */
export interface SessionFileRow {
  kind: SessionFileKind;
  /** Absolute, as the call wrote it — both separators occur. */
  path: string;
  name: string;
  /** `normalisePath(path)`: the dedupe key, and what a stat answer is joined on. */
  key: string;
  /** As sent, not as it is on disk now. Null when nothing recorded it. */
  sizeBytes: number | null;
  mediaType: string | null;
  isImage: boolean;
  /** The clock of the message that carried it — the FIRST one, when it repeats. */
  timestamp: string | null;
  /** The call to jump to (`?tool=`). Null on a plan file: no call delivered it. */
  toolUseId: string | null;
  /** The message to jump to (`?msg=`), which is all a plan-mode line has. */
  messageUuid: string | null;
  /** The delivery's caption, or the artifact's title — what it was, in words. */
  note: string | null;
  /** How many times this exact path was handed over. */
  count: number;
  /** The harness said it could not confirm the path was there. */
  unvalidated: boolean;
  /** The delivery itself failed. */
  failed: boolean;
  /** No result yet — a real state, not a missing one. */
  pending: boolean;
  /** `artifact` only: `publish`, `upload_asset`… */
  action: string | null;
}

export interface SessionFiles {
  /** `SendUserFile`: handed to the user, by path. */
  sent: SessionFileRow[];
  /** `Artifact`: the local file a published page was rendered from. */
  artifacts: SessionFileRow[];
  /** `~/.claude/plans/<slug>.md`: what plan mode wrote. */
  plans: SessionFileRow[];
  /** Distinct paths across all three — what the header button counts. */
  total: number;
}

/**
 * The local file an `Artifact` call published, or null for every other tool.
 *
 * Guarded on the tool name and shaped like `parseSentFiles` for the same reason:
 * one place decides what an artifact publish is, and it reads only the CALL,
 * which is never truncated.
 *
 * `file_path` is the whole test. Of the tool's nine actions only `publish` (the
 * default, so usually absent) and `upload_asset` carry one at all; the rest —
 * `list`, `comments`, `reply`, `resolve`, and the three asset reads — name no
 * local file and must not appear as a row with nothing to open. The action is
 * kept anyway, because "uploaded as an asset" and "published as the page" are
 * different things to have done with a file.
 */
function parseArtifactFile(block: ToolBlockType): { path: string; action: string; note: string | null } | null {
  if (block.toolName !== 'Artifact') return null;
  const input = block.input as { file_path?: unknown; action?: unknown; title?: unknown; description?: unknown } | null;
  const filePath = typeof input?.file_path === 'string' ? input.file_path.trim() : '';
  if (!filePath) return null;
  const action = typeof input?.action === 'string' && input.action ? input.action : 'publish';
  const note = [input?.title, input?.description].find((v): v is string => typeof v === 'string' && !!v.trim());
  return { path: filePath, action, note: note?.trim() ?? null };
}

/** Adds a row, or folds it into the one already there. */
function add(into: Map<string, SessionFileRow>, row: Omit<SessionFileRow, 'key' | 'name' | 'count'>): void {
  const key = normalisePath(row.path);
  const existing = into.get(key);
  if (existing) {
    // First timestamp, first anchor: the row reads as "this file, first handed
    // over here", and the count says the rest. Everything that is a WARNING
    // survives instead of being overwritten by a later clean delivery — a path
    // the harness could not confirm once is worth flagging forever.
    existing.count += 1;
    existing.unvalidated = existing.unvalidated || row.unvalidated;
    existing.failed = existing.failed || row.failed;
    existing.pending = existing.pending || row.pending;
    existing.note ??= row.note;
    existing.sizeBytes ??= row.sizeBytes;
    existing.mediaType ??= row.mediaType;
    return;
  }
  into.set(key, { ...row, key, name: refBasename(row.path), count: 1 });
}

/**
 * Every file the session handed over: delivered, published, or written as a plan.
 *
 * Pure, and in the same room as `parseSentFiles` rather than on the server, for
 * the reason that parser is pure at all: the card in the conversation, the
 * markdown export and this index must never disagree about what a delivery is,
 * and they cannot while all three read it through the same function. Nothing
 * here needs the server — the calls, their results and the plan-mode lines are
 * all already in `turns` — so the only thing the panel asks the server for is
 * the one thing this cannot know: whether the file is still on disk.
 *
 * Rows come out in the order the session produced them, deduplicated by
 * normalised path. The deduplication is not theoretical: a session writes the
 * SAME precomputed `planFilePath` on every plan-mode line it holds (up to 60 of
 * them in this corpus), and one delivery can spell a path `C:/…` where another
 * spells it `C:\…`.
 */
export function collectSessionFiles(turns: Turn[]): SessionFiles {
  const sent = new Map<string, SessionFileRow>();
  const artifacts = new Map<string, SessionFileRow>();
  const plans = new Map<string, SessionFileRow>();

  for (const turn of turns) {
    for (const item of turn.items) {
      for (const block of item.blocks) {
        if (block.kind === 'plan-mode') {
          // Not `planExists`: it says what was true when the line was written,
          // and the panel asks the disk itself. A path is worth a row either way
          // — that a plan file is gone is exactly what the panel is for.
          if (block.planFilePath) {
            add(plans, {
              kind: 'plan',
              path: block.planFilePath,
              sizeBytes: null,
              mediaType: 'text/markdown',
              isImage: false,
              timestamp: item.timestamp,
              toolUseId: null,
              messageUuid: item.uuid,
              note: null,
              unvalidated: false,
              failed: false,
              pending: false,
              action: null,
            });
          }
          continue;
        }
        if (block.kind !== 'tool') continue;

        const delivery = parseSentFiles(block);
        if (delivery) {
          for (const file of delivery.files) {
            add(sent, {
              kind: 'sent',
              path: file.path,
              sizeBytes: file.sizeBytes,
              mediaType: file.mediaType,
              isImage: file.isImage,
              timestamp: item.timestamp,
              toolUseId: block.toolUseId,
              messageUuid: item.uuid,
              note: delivery.caption,
              unvalidated: file.unvalidated,
              failed: delivery.failed,
              pending: delivery.pending,
              action: null,
            });
          }
          continue;
        }

        const artifact = parseArtifactFile(block);
        if (artifact) {
          add(artifacts, {
            kind: 'artifact',
            path: artifact.path,
            sizeBytes: null,
            mediaType: null,
            isImage: false,
            timestamp: item.timestamp,
            toolUseId: block.toolUseId,
            messageUuid: item.uuid,
            note: artifact.note,
            unvalidated: false,
            failed: block.result?.isError === true,
            pending: block.result === null,
            action: artifact.action,
          });
          continue;
        }

        // The plan file again, from the other end: the approval carries the path
        // it was saved to even in a transcript with no plan-mode line to read.
        const planFile = block.result?.plan?.filePath;
        if (planFile) {
          add(plans, {
            kind: 'plan',
            path: planFile,
            sizeBytes: null,
            mediaType: 'text/markdown',
            isImage: false,
            timestamp: item.timestamp,
            toolUseId: block.toolUseId,
            messageUuid: item.uuid,
            note: null,
            unvalidated: false,
            failed: false,
            pending: false,
            action: null,
          });
        }
      }
    }
  }

  // Counted as FILES and not as rows: the same path can be both delivered and a
  // plan, and the button beside "Changed Files (12)" has to mean the same kind
  // of thing that one does.
  const total = new Set([...sent.keys(), ...artifacts.keys(), ...plans.keys()]).size;
  return { sent: [...sent.values()], artifacts: [...artifacts.values()], plans: [...plans.values()], total };
}

/** Every path in one index, in the order the panel draws them. */
export function sessionFilePaths(files: SessionFiles): string[] {
  return [...files.sent, ...files.artifacts, ...files.plans].map((r) => r.path);
}
