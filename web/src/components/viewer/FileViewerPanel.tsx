import { useQuery } from '@tanstack/react-query';
import hljs from 'highlight.js/lib/common';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { type FileRef, isImagePath, languageForPath, refBasename } from '../../lib/fileRefs.ts';
import { formatBytes, formatDateTime } from '../../lib/format.ts';
import { copyPlain } from '../../lib/clipboard.ts';
import { ZoomableImage } from './ZoomableImage.tsx';

/**
 * One constant for the gutter rows, the code and the target stripe. The three
 * are separate elements lined up by arithmetic alone, so the moment two of them
 * disagree the numbers point at the wrong lines — which is worse than no
 * numbers at all.
 */
const LINE_H = 18;
/** Past this, colouring costs more than it gives, and the file is usually cut anyway. */
const HIGHLIGHT_MAX_BYTES = 200_000;
const HIGHLIGHT_MAX_LINES = 5_000;
const FLASH_MS = 1500;

const btn =
  'shrink-0 cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-50';

/**
 * The file a link in the conversation points at.
 *
 * It reads the file over the API rather than from anything in the transcript:
 * what Claude quoted months ago is not what is on disk now, and the panel's job
 * is to show the file, with `modifiedAt` on screen so the difference is
 * answerable. Nothing invalidates it on an SSE event — `sessions-changed` means
 * a transcript grew and says nothing about a file — so the refresh is a button.
 */
export function FileViewerPanel({
  sessionId,
  projectPath,
  fileRef,
  onClose,
}: {
  sessionId: string;
  /** The launch cwd a relative reference was resolved against, for the not-found case. */
  projectPath: string;
  fileRef: FileRef;
  onClose: () => void;
}) {
  // The PATH, never the formatted reference: the line number is the viewer's
  // business and would otherwise be resolved as part of the filename. Keying on
  // it as well means two links into the same file at different lines share one
  // read.
  const refPath = fileRef.path;
  const query = useQuery({
    queryKey: ['file', sessionId, refPath],
    queryFn: () => api.fileRead(sessionId, refPath),
  });
  const data = query.data;

  const scroller = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');
  /**
   * The endpoint refused the picture, or it went away between the read and the
   * fetch. Reset whenever the panel points somewhere else or the file changes
   * underneath — otherwise one failure sticks to every image opened after it.
   */
  const [imageFailed, setImageFailed] = useState(false);

  /**
   * Drawn as a picture, decided on the PATH and not on the text sniff.
   *
   * `binary` would be the tempting test and it is the wrong one: it means "there
   * is a NUL in the first 8 KB", which a small GIF can miss — and then the panel
   * would draw a picture's bytes as mojibake instead. What the extension names
   * is what the app can show, and it is the same list the endpoint serves.
   */
  const isPicture = !!data?.exists && !data.isDirectory && isImagePath(data.path);
  const showAsImage = isPicture && !data.error && data.sizeBytes > 0 && !imageFailed;

  const lines = useMemo(() => (data?.text ? data.text.split('\n') : []), [data?.text]);
  const language = useMemo(() => (data ? languageForPath(data.path) : null), [data]);
  const highlightSkipped =
    !!data?.text && (data.text.length > HIGHLIGHT_MAX_BYTES || lines.length > HIGHLIGHT_MAX_LINES);
  /**
   * The whole text at once, never line by line: a hljs span crosses newlines
   * (block comments, template literals), so splitting the markup produces
   * unbalanced HTML. The gutter is a separate column for exactly that reason.
   */
  const html = useMemo(() => {
    if (!data?.text || !language || highlightSkipped) return null;
    try {
      return hljs.highlight(data.text, { language }).value;
    } catch {
      // An unregistered language in the common bundle: plain text is fine.
      return null;
    }
  }, [data?.text, language, highlightSkipped]);

  const target = data?.text && fileRef.line && fileRef.line <= lines.length ? fileRef.line : null;
  const targetEnd = target ? Math.min(fileRef.endLine ?? target, lines.length) : null;

  useEffect(() => setImageFailed(false), [refPath, data?.modifiedAt]);

  // After the body is in the DOM, and again if the file is reloaded. The fixed
  // line height is what makes this arithmetic rather than a ref per line.
  useEffect(() => {
    const el = scroller.current;
    if (!el || target === null) return;
    el.scrollTop = Math.max(0, (target - 1) * LINE_H - el.clientHeight / 2 + LINE_H / 2);
  }, [target, html, data?.text]);

  const canOpen = !!data?.exists && !data.error;
  const openWhy = !data
    ? 'still reading the file'
    : !data.exists
      ? 'the file does not exist'
      : data.error
        ? data.error
        : '';

  const open = (target_: 'file' | 'folder' | 'vscode') => {
    setOpening(target_);
    setOpenError('');
    api
      .fileOpen({ session: sessionId, path: refPath, target: target_, line: fileRef.line })
      .then((r) => {
        // Explorer was asked to select the file and could not; say so rather
        // than let the button imply it did.
        if (target_ === 'folder' && r.selected === false) {
          setOpenError('Explorer opened the folder without selecting the file.');
        }
      })
      .catch((e: unknown) => setOpenError(String(e instanceof Error ? e.message : e)))
      .finally(() => setOpening(null));
  };

  const copyPath = () => {
    void copyPlain(data?.path ?? fileRef.path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), FLASH_MS);
    });
  };

  return (
    // Above the subagent drawer (z-20): a path is often clicked from inside a
    // subagent report, and closing that to read the file would lose the reader's
    // place in it. They overlap; closing this reveals the transcript untouched.
    <div className="fixed inset-y-0 right-0 z-30 flex w-[52rem] max-w-[92vw] flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-semibold text-amber-300">
          {isImagePath(fileRef.path) ? '🖼' : '📄'} {refBasename(fileRef.path)}
          {fileRef.line ? `:${fileRef.line}` : ''}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--text-dim)]"
          title={data?.path ?? fileRef.path}
        >
          {data?.path ?? fileRef.path}
        </span>
        {data?.exists && (
          <span className="shrink-0 text-[11px] text-[var(--text-dim)]">
            {formatBytes(data.sizeBytes)}
            {data.modifiedAt ? ` · ${formatDateTime(data.modifiedAt)}` : ''}
          </span>
        )}
        <button
          type="button"
          onClick={() => void query.refetch()}
          className={btn}
          title="Read the file again"
          disabled={query.isFetching}
        >
          ↻
        </button>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded px-2 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-4 py-1.5">
        {data?.isDirectory ? (
          <button
            type="button"
            onClick={() => open('folder')}
            className={btn}
            disabled={opening !== null}
            title={`Open ${data.path} in Explorer`}
          >
            📁 Open folder
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => open('file')}
              className={btn}
              disabled={!canOpen || opening !== null}
              title={canOpen ? 'Open the file with its default program' : openWhy}
            >
              {opening === 'file' ? 'Opening…' : '↗ Open file'}
            </button>
            <button
              type="button"
              onClick={() => open('folder')}
              className={btn}
              disabled={!canOpen || opening !== null}
              title={canOpen ? 'Show the file in Explorer, selected in its folder' : openWhy}
            >
              {opening === 'folder' ? 'Opening…' : '📁 Show in Explorer'}
            </button>
            <button
              type="button"
              onClick={() => open('vscode')}
              className={btn}
              disabled={!canOpen || opening !== null}
              title={canOpen ? `Open in VS Code${fileRef.line ? ` at line ${fileRef.line}` : ''}` : openWhy}
            >
              {opening === 'vscode' ? 'Opening…' : `{ } VS Code${fileRef.line ? ` :${fileRef.line}` : ''}`}
            </button>
          </>
        )}
        <button type="button" onClick={copyPath} className={btn} title={data?.path ?? fileRef.path}>
          {copied ? 'Copied ✓' : '📋 Copy path'}
        </button>
        {openError && <span className="text-xs text-red-400">{openError}</span>}
      </div>

      {data?.truncated && (
        <div className="border-b border-[var(--border)] px-4 py-1 text-[11px] text-amber-400">
          truncated — {formatBytes(data.sizeBytes)} total
          {fileRef.line && fileRef.line > lines.length
            ? ` · line ${fileRef.line.toLocaleString()} is past the truncation — open the file to see it`
            : ''}
        </div>
      )}
      {!data?.truncated && data?.text && fileRef.line && fileRef.line > lines.length && (
        <div className="border-b border-[var(--border)] px-4 py-1 text-[11px] text-[var(--text-dim)]">
          the file has only {lines.length.toLocaleString()} lines
        </div>
      )}
      {highlightSkipped && (
        <div className="border-b border-[var(--border)] px-4 py-1 text-[11px] text-[var(--text-dim)]">
          syntax highlighting skipped — {formatBytes(data?.text?.length ?? 0)} of text
        </div>
      )}

      {query.isLoading && <div className="p-4 text-[var(--text-dim)]">Reading {refBasename(fileRef.path)}…</div>}
      {query.isError && <div className="p-4 text-red-400">Failed: {String(query.error)}</div>}

      {data && !data.exists && (
        <div className="p-4 text-sm">
          <div className="mb-2 font-semibold text-amber-300">Not found</div>
          <div className="mb-2 font-mono text-xs break-all text-[var(--text-dim)]">{data.path}</div>
          {fileRef.kind === 'relative' && (
            <p className="text-xs text-[var(--text-dim)]">
              <span className="font-mono">{fileRef.path}</span> was resolved against this session's launch
              folder, <span className="font-mono">{projectPath}</span>. That is the only folder a transcript
              records — if Claude moved somewhere else before writing this path, the folder it was relative to
              cannot be recovered.
            </p>
          )}
        </div>
      )}
      {data?.error && (
        <div className="p-4 text-sm text-red-400">
          Could not read it — <span className="font-mono text-xs">{data.error}</span>
        </div>
      )}
      {data?.isDirectory && <div className="p-4 text-sm text-[var(--text-dim)]">This is a folder, not a file.</div>}
      {/* The picture itself, off the image endpoint — the read above answered
          `binary` and carries no bytes, which is what it is for. It is a second
          request, made only for the files this panel can draw. */}
      {showAsImage && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <ZoomableImage
            src={api.fileImageUrl(sessionId, refPath)}
            alt={refBasename(data.path)}
            label="click to view full size"
            onError={() => setImageFailed(true)}
            size="fill"
          />
        </div>
      )}
      {imageFailed && data?.exists && (
        <div className="p-4 text-sm text-[var(--text-dim)]">
          The image could not be loaded — it may be larger than this app will serve, or it may have gone since
          the file was read. The buttons above still open it.
        </div>
      )}
      {data?.binary && !isPicture && (
        <div className="p-4 text-sm text-[var(--text-dim)]">
          Binary file — {formatBytes(data.sizeBytes)}. Not shown.
        </div>
      )}
      {data?.exists && !data.isDirectory && !data.binary && !data.error && data.sizeBytes === 0 && (
        <div className="p-4 text-sm text-[var(--text-dim)]">Empty file.</div>
      )}

      {/* `!isPicture`, not `!showAsImage`: a small GIF can carry no NUL in its
          first 8 KB, come back as `text`, and be drawn as mojibake under the
          picture that failed to load. */}
      {data?.text && data.text.length > 0 && !isPicture && (
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto bg-black/40 font-mono text-xs">
          {/* min-w-max so the row grows to the longest line: otherwise the stripe
              would stop at the viewport edge instead of running the whole line. */}
          <div className="flex min-w-max">
            <div
              aria-hidden
              className="sticky left-0 z-10 shrink-0 border-r border-[var(--border)] bg-[var(--bg-raised)] px-2 text-right text-[var(--text-dim)] select-none"
            >
              {lines.map((_, i) => (
                <div
                  // The line number IS the identity here, and the list only
                  // changes when the whole file does.
                  key={i}
                  style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}
                  className={target !== null && i + 1 >= target && i + 1 <= (targetEnd ?? target) ? 'text-amber-300' : undefined}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            {/* `min-w-max` and not `flex-1` alone: with a zero basis the box
                collapses to nothing while the <pre> paints past it, and the
                stripe — which spans this box — became a sliver at the gutter. */}
            <div className="relative min-w-max flex-1">
              {target !== null && (
                <div
                  className="pointer-events-none absolute inset-x-0 bg-amber-400/10 ring-1 ring-amber-400/30 ring-inset"
                  style={{ top: (target - 1) * LINE_H, height: LINE_H * ((targetEnd ?? target) - target + 1) }}
                />
              )}
              {/* whitespace-pre, never pre-wrap: one wrapped line puts the gutter
                  and the stripe out of step with every line below it. */}
              <pre className="relative m-0 bg-transparent p-0 pl-3 whitespace-pre" style={{ lineHeight: `${LINE_H}px` }}>
                {html ? (
                  // Markup produced by hljs from text we read, not from
                  // anything a transcript wrote — hljs escapes its input.
                  //
                  // These are STYLES and not classes because `github-dark.css`
                  // loads after Tailwind and `.hljs` wins every tie. Its
                  // background covered the target stripe; its `padding: 1em`
                  // then pushed the text 12 px below its own line number and
                  // the stripe, so the highlight sat two thirds of a line off —
                  // and only in files that got highlighted at all, which is
                  // what made it look intermittent. Its `overflow-x: auto`
                  // would make this a second scroll container inside the one
                  // that already scrolls.
                  <code
                    className="hljs"
                    style={{ background: 'transparent', padding: 0, overflow: 'visible' }}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                ) : (
                  <code className="bg-transparent p-0">{data.text}</code>
                )}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
