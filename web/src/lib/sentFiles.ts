import type { ContentBlock } from '@claude-history/shared';
import { isImagePath, normalisePath, refBasename } from './fileRefs.ts';

type ToolBlockType = Extract<ContentBlock, { kind: 'tool' }>;

/** One file the assistant handed over, as much as the transcript says about it. */
export interface SentFile {
  /** Absolute, as the call wrote it — both separators occur. */
  path: string;
  name: string;
  /** As sent, not as it is on disk now. Null when nothing recorded it. */
  sizeBytes: number | null;
  mediaType: string | null;
  isImage: boolean;
  /** The result recorded nothing about this file: no size, no media type. */
  unrecorded: boolean;
  /** The harness said it could not confirm the path was there. */
  unvalidated: boolean;
}

export interface SentFiles {
  files: SentFile[];
  /** The sentence explaining what the files are — often the caption of a set of screenshots. */
  caption: string | null;
  /** `attach` means the model asked for a download card rather than an inline render. */
  display: 'render' | 'attach' | null;
  /** `status: 'proactive'`: offered rather than asked for. */
  proactive: boolean;
  /** The delivery itself failed. */
  failed: boolean;
  /** No result yet — a real state, not a missing one. */
  pending: boolean;
}

/**
 * The files a `SendUserFile` call handed to the user, or null for every other
 * tool.
 *
 * Pure and free of the DOM for the reason `parsePlan` is: the card and the
 * markdown export read a delivery the same way, and the two must never disagree
 * about what was sent.
 *
 * The two halves live apart, as they do for a question and a plan. The CALL
 * carries the authoritative list — `files`, plus `caption`, `status` and
 * `display` — and it is never truncated. The RESULT carries the only copy of
 * each file's size, media type and `pathValidated`, and is joined on the path.
 *
 * What is deliberately NOT read is the result's prose. It spells the same list
 * as `<path> → file_uuid: <uuid>`, and recovering a path from that is the very
 * mistake the structured fields exist to avoid — one filename containing ` → `
 * or a newline and the reader has a path that opens nothing. The upload id it
 * offers in exchange means nothing on this machine.
 */
export function parseSentFiles(block: ToolBlockType): SentFiles | null {
  if (block.toolName !== 'SendUserFile') return null;
  const input = block.input as
    | { files?: unknown; caption?: unknown; display?: unknown; status?: unknown }
    | null;
  const raw = input?.files;
  if (!Array.isArray(raw)) return null;
  const paths = raw.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
  if (paths.length === 0) return null;

  const recorded = block.result?.attachments ?? [];
  const byPath = new Map(recorded.map((a) => [normalisePath(a.path), a]));
  const files: SentFile[] = paths.map((path, i) => {
    // By path first. Positionally only as a fallback, and only when the two
    // lists are the same length: the harness writes the attachments in the order
    // it was given the files, so that is the one case where position means
    // something. A future version normalising the paths it echoes would land
    // here rather than silently losing every size.
    const match =
      byPath.get(normalisePath(path)) ?? (recorded.length === paths.length ? recorded[i] : undefined);
    return {
      path,
      name: refBasename(path),
      sizeBytes: match?.sizeBytes ?? null,
      mediaType: match?.mediaType ?? null,
      // The result's word when there is one, the extension otherwise — an old
      // transcript, or a delivery still in flight, still knows a screenshot when
      // it sees one.
      isImage: match ? match.isImage : isImagePath(path),
      unrecorded: !match,
      unvalidated: match?.pathValidated === false,
    };
  });

  const display = input?.display;
  return {
    files,
    caption: typeof input?.caption === 'string' && input.caption.trim() ? input.caption.trim() : null,
    // Absent in 3 of the 10 calls here — older transcripts, whose files were
    // screenshots to look at. Left null rather than assumed: the card only
    // speaks up for `attach`, which is the one that changes what happened.
    display: display === 'render' || display === 'attach' ? display : null,
    proactive: input?.status === 'proactive',
    failed: block.result?.isError === true,
    pending: block.result === null,
  };
}
