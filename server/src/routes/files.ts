import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_STAT_PATHS,
  type FileOpenRequest,
  type FileOpenResponse,
  type FileReadResponse,
  type FileStatEntry,
  type FileStatsRequest,
  type FileStatsResponse,
} from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';
import { UUID_RE } from '../core/scanner.ts';
import { openFile, openFileInVsCode, openInExplorer, revealInExplorer } from '../util/launcher.ts';
import { isSameOrigin } from '../util/sameOrigin.ts';

const log = createLogger('files');

/** Enough for any source file worth reading in a panel; a 300 MB log is not. */
const MAX_BYTES = 2 * 1024 * 1024;
/** A NUL in the head is the classic "this is not text" test. */
const SNIFF_BYTES = 8 * 1024;
/**
 * Generous for a 4K screenshot — the ones in this corpus run from 6 KB to
 * 160 KB. Over it the answer is 413 and never a truncated image: half a PNG
 * draws as a broken one, and a reader reads that as "the file is gone".
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * What `/api/files/image` will serve, and the content type it serves it as.
 *
 * OUR list, keyed on the extension — never the `media_type` the transcript
 * carries. That field is written by another process into a file we only ever
 * read, and echoing it back as a header would turn this into arbitrary content
 * served from our own origin.
 *
 * `svg` is absent deliberately. An SVG is a document that can carry script, and
 * `image/svg+xml` from `127.0.0.1:7433` is same-origin script execution reached
 * from a transcript. The panel shows one as the XML it is, which is also more
 * useful.
 */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

type Resolved = { ok: true; path: string } | { ok: false; code: number; error: string };

/**
 * Turn a reference written in a transcript into an absolute path.
 *
 * The base is the session's project path taken from the INDEX, never from the
 * request — the same model as `/api/sessions/:id/resume`. It is the launch cwd,
 * so a relative reference written after Claude `cd`'d somewhere else resolves to
 * a file that is not there; that is reported as "not found" with the base named,
 * which is all anybody can honestly say about it.
 */
function resolveRef(ctx: AppContext, session: string, ref: string): Resolved {
  if (!UUID_RE.test(session)) return { ok: false, code: 400, error: 'Invalid session id' };
  if (typeof ref !== 'string' || !ref.trim()) return { ok: false, code: 400, error: 'Invalid path' };
  const summary = ctx.index.get(session);
  if (!summary) return { ok: false, code: 404, error: 'Session not found' };
  // A NUL in a path is never anything but an attempt to cut one short.
  if (ref.includes('\0')) return { ok: false, code: 400, error: 'Invalid path' };
  // `~/.claude/settings.json` is written constantly in these transcripts and
  // means the home directory to everyone who reads it. Resolved against the
  // project it becomes `<project>\~\.claude\settings.json`, which exists
  // nowhere — a "not found" for a file that is right there.
  const expanded = /^~[\\/]/.test(ref) ? path.join(os.homedir(), ref.slice(2)) : ref;
  return { ok: true, path: path.resolve(summary.projectPath, expanded) };
}

export function registerFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Read one local file for the viewer panel.
   *
   * This is the one place the app reads outside `~/.claude`, so it carries its
   * own same-origin check: the global hook in app.ts guards only the methods
   * that change state, and a GET that can read any file the user can read has
   * no business answering a page that is not ours. (A cross-origin fetch could
   * not read the reply anyway — this is about not doing the work at all.)
   */
  app.get<{ Querystring: { session?: string; path?: string } }>(
    '/api/files/read',
    async (request, reply): Promise<FileReadResponse | void> => {
      if (!isSameOrigin(request)) {
        log.warn('refused a cross-origin file read', { path: request.query.path });
        return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
      }
      const resolved = resolveRef(ctx, request.query.session ?? '', request.query.path ?? '');
      if (!resolved.ok) return reply.code(resolved.code).send({ error: resolved.error });
      const file = resolved.path;

      let stat: Awaited<ReturnType<typeof fsp.stat>>;
      try {
        stat = await fsp.stat(file);
      } catch (err) {
        // Missing is a state the panel draws (it still offers the folder), not
        // an error: 200 with `exists: false`.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          log.debug(`file not found: ${file}`);
          return {
            path: file,
            exists: false,
            isDirectory: false,
            sizeBytes: 0,
            modifiedAt: null,
            text: null,
            truncated: false,
            binary: false,
          };
        }
        log.warn(`could not stat ${file}: ${String(err)}`);
        return {
          path: file,
          exists: true,
          isDirectory: false,
          sizeBytes: 0,
          modifiedAt: null,
          text: null,
          truncated: false,
          binary: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const base: FileReadResponse = {
        path: file,
        exists: true,
        isDirectory: stat.isDirectory(),
        sizeBytes: stat.size,
        modifiedAt: new Date(stat.mtimeMs).toISOString(),
        text: null,
        truncated: false,
        binary: false,
      };
      if (base.isDirectory) return base;

      try {
        const fh = await fsp.open(file, 'r');
        try {
          const len = Math.min(stat.size, MAX_BYTES);
          const buf = Buffer.alloc(len);
          if (len > 0) await fh.read(buf, 0, len, 0);
          if (buf.subarray(0, SNIFF_BYTES).includes(0)) {
            log.debug(`binary file: ${file} (${stat.size} bytes)`);
            return { ...base, binary: true };
          }
          const truncated = stat.size > len;
          let text = buf.toString('utf8');
          // The cut lands wherever MAX_BYTES falls, which is usually inside a
          // character; the decoder leaves a replacement mark there and it is
          // the one place it cannot be part of the file.
          if (truncated) text = text.replace(/\uFFFD+$/, '');
          if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
          log.debug(`read ${file} (${stat.size} bytes${truncated ? ', truncated' : ''})`);
          return { ...base, text, truncated };
        } finally {
          await fh.close();
        }
      } catch (err) {
        log.warn(`could not read ${file}: ${String(err)}`);
        return { ...base, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  /**
   * The bytes of one image, for an `<img src>`.
   *
   * `/api/files/read` cannot do this and could not be made to: a PNG has NUL
   * bytes in its signature, so it is structurally a `binary: true` with no bytes
   * — and an `<img>` needs a URL the browser fetches itself, not a field in a
   * JSON reply. Nor can the bytes ride along in the conversation: `SendUserFile`
   * keeps none of them in the transcript, so the payload would have to read disk
   * on every parse, and a live session re-parses on every SSE event.
   *
   * Same `resolveRef` and same own `isSameOrigin` as the read route above, for
   * the same reason. It holds for an `<img>` too, which is what makes this safe
   * to point one at: a subresource of our own page sends
   * `Sec-Fetch-Site: same-origin`, and a foreign page embedding the same URL
   * sends `cross-site` and gets 403.
   *
   * **On a page served over plain HTTP that last sentence stops being true** —
   * `Sec-Fetch-*` only reaches trustworthy origins, and an `<img>` sends no
   * `Origin`, so neither embed can be told from the other. What is left is that
   * a foreign page cannot read the pixels (a cross-origin image taints the
   * canvas), only learn that a path exists. Named in
   * [AI_REMOTE_ACCESS.md](../../../docs/AI_REMOTE_ACCESS.md) rather than fixed:
   * the fix is HTTPS.
   *
   * Unlike the read route this answers 404 for a missing file rather than a 200
   * saying so. The consumer is an `<img>`: it has no state to draw, only
   * `onError`. The scratchpad these files live in is swept, so that is an
   * ordinary answer here and not a failure.
   */
  app.get<{ Querystring: { session?: string; path?: string } }>(
    '/api/files/image',
    async (request, reply): Promise<void> => {
      if (!isSameOrigin(request)) {
        log.warn('refused a cross-origin image read', { path: request.query.path });
        return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
      }
      const resolved = resolveRef(ctx, request.query.session ?? '', request.query.path ?? '');
      if (!resolved.ok) return reply.code(resolved.code).send({ error: resolved.error });
      const file = resolved.path;

      const ext = /\.([A-Za-z0-9]+)$/.exec(file)?.[1].toLowerCase() ?? '';
      const contentType = IMAGE_TYPES[ext];
      if (!contentType) {
        // Not 404: the file may be right there. "We do not serve this" is a
        // different fact, and the panel says which one it got.
        return reply.code(415).send({ error: `Not an image this app will serve: .${ext || '(no extension)'}` });
      }

      let stat: Awaited<ReturnType<typeof fsp.stat>>;
      try {
        stat = await fsp.stat(file);
      } catch {
        log.debug(`image not found: ${file}`);
        return reply.code(404).send({ error: `File no longer exists: ${file}` });
      }
      if (stat.isDirectory()) return reply.code(404).send({ error: `Not a file: ${file}` });
      if (stat.size > MAX_IMAGE_BYTES) {
        return reply.code(413).send({ error: `Image is ${String(stat.size)} bytes, over the ${String(MAX_IMAGE_BYTES)} limit.` });
      }

      // Revalidated rather than cached: the scratchpad is temporary and
      // rewritable, which is the same reason the panel puts `modifiedAt` on
      // screen. The tag makes the zoom overlay free — it mounts a SECOND `<img>`
      // on the same src.
      const etag = `"${String(stat.size)}-${String(Math.floor(stat.mtimeMs))}"`;
      reply.header('Cache-Control', 'no-cache').header('ETag', etag).header('X-Content-Type-Options', 'nosniff');
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();

      try {
        const buf = await fsp.readFile(file);
        log.debug(`served ${file} (${String(buf.length)} bytes, ${contentType})`);
        return reply.type(contentType).send(buf);
      } catch (err) {
        log.warn(`could not read image ${file}: ${String(err)}`);
        return reply.code(500).send({ error: `Failed to read: ${String(err)}` });
      }
    },
  );

  /**
   * What the disk says about a batch of paths: `stat` and nothing else.
   *
   * It exists for one question the transcript cannot answer. A delivery's files
   * live in the session's temp scratchpad, which Windows sweeps, so a panel
   * listing everything a session ever handed over is mostly a list of paths that
   * may or may not still be there — and a list of dead links that does not say
   * so is worse than no list. `size` and `media_type` in the transcript are what
   * was SENT; only this says what is there now.
   *
   * One request for the whole panel, deliberately. Per row it would be a fetch
   * per file every time the panel opened, which is the same trade the delivery
   * card refuses when it declines to draw thumbnails.
   *
   * A POST for a pure read, also deliberately: these are absolute scratchpad
   * paths of 130–400 characters, and a session's worth of them in a query string
   * runs at Node's request-line limit, whose failure is an opaque 431. The method
   * is what earns it the global same-origin hook (`app.ts`) instead of the
   * private `isSameOrigin` the two GETs above need — on a GET the absence of
   * `Origin` means nothing, on a POST it means plenty. It opens nothing on the
   * server's desktop, so it is NOT in `localOnlyRoutes` and works from a signed-in
   * browser elsewhere, like every other read.
   */
  app.post<{ Body: FileStatsRequest }>(
    '/api/files/stats',
    async (request, reply): Promise<FileStatsResponse | void> => {
      const body = request.body ?? ({} as FileStatsRequest);
      const session = body.session ?? '';
      const refs = body.paths;
      if (!Array.isArray(refs)) return reply.code(400).send({ error: 'paths must be an array' });
      // The cap is what keeps this from being a filesystem scanner. No panel is
      // anywhere near it — the busiest session in this corpus delivered 5 files.
      if (refs.length > MAX_STAT_PATHS) {
        return reply.code(400).send({ error: `At most ${String(MAX_STAT_PATHS)} paths per request.` });
      }
      // The session is the only thing worth refusing the whole batch over: it is
      // what every path is resolved against, so a bad one makes every answer
      // meaningless rather than one of them wrong.
      if (!UUID_RE.test(session)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(session)) return reply.code(404).send({ error: 'Session not found' });

      // Statted once per distinct REF, answered once per path asked about: a
      // panel that lists the same file in two sections must still get two rows
      // it can join by identity. Keyed on the raw string rather than on a
      // normalised one, because the key has to be what the answer is stamped
      // with — two spellings of one path is two stats, and that is cheap.
      const seen = new Map<string, Promise<Omit<FileStatEntry, 'ref'>>>();
      const stat = async (ref: string): Promise<Omit<FileStatEntry, 'ref'>> => {
        const resolved = resolveRef(ctx, session, ref);
        if (!resolved.ok) {
          return { path: ref, exists: false, isDirectory: false, sizeBytes: 0, modifiedAt: null, error: resolved.error };
        }
        const file = resolved.path;
        try {
          const s = await fsp.stat(file);
          return {
            path: file,
            exists: true,
            isDirectory: s.isDirectory(),
            sizeBytes: s.size,
            modifiedAt: new Date(s.mtimeMs).toISOString(),
          };
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const gone = code === 'ENOENT' || code === 'ENOTDIR';
          return {
            path: file,
            exists: false,
            isDirectory: false,
            sizeBytes: 0,
            modifiedAt: null,
            // Missing is the ordinary answer here and says nothing worth
            // repeating; anything else is a finding and keeps its own words.
            ...(gone ? {} : { error: err instanceof Error ? err.message : String(err) }),
          };
        }
      };

      const files = await Promise.all(
        refs.map(async (ref): Promise<FileStatEntry> => {
          const key = typeof ref === 'string' ? ref : String(ref);
          let pending = seen.get(key);
          if (!pending) {
            pending = stat(key);
            seen.set(key, pending);
          }
          return { ref: key, ...(await pending) };
        }),
      );
      // One line for the batch, not one per file: this runs every time a panel
      // opens and the interesting number is how much of it is still there.
      log.debug(`statted ${String(files.length)} path(s), ${String(files.filter((f) => f.exists).length)} present`);
      return { files };
    },
  );

  /**
   * Hand a file to the shell: its own association, Explorer with it selected,
   * or VS Code at a line. State-changing, so the global same-origin hook
   * already covers it — a page that is not ours must not be able to launch
   * anything on this machine.
   */
  app.post<{ Body: FileOpenRequest }>(
    '/api/files/open',
    async (request, reply): Promise<FileOpenResponse | void> => {
      const body = request.body ?? ({} as FileOpenRequest);
      const target = body.target;
      if (target !== 'file' && target !== 'folder' && target !== 'vscode') {
        return reply.code(400).send({ error: 'target must be file, folder or vscode' });
      }
      const resolved = resolveRef(ctx, body.session ?? '', body.path ?? '');
      if (!resolved.ok) return reply.code(resolved.code).send({ error: resolved.error });
      const file = resolved.path;

      try {
        await fsp.stat(file);
      } catch {
        return reply.code(404).send({ error: `File no longer exists: ${file}` });
      }

      try {
        if (target === 'file') {
          await openFile(file);
          log.info(`opened ${file}`);
          return { ok: true };
        }
        if (target === 'vscode') {
          await openFileInVsCode(file, body.line);
          log.info(`opened ${file} in VS Code${body.line ? ` at line ${body.line}` : ''}`);
          return { ok: true };
        }
        // A folder reference has nothing to select; a file does.
        const stat = await fsp.stat(file);
        if (stat.isDirectory()) {
          await openInExplorer(file);
          log.info(`opened folder ${file}`);
          return { ok: true };
        }
        const selected = await revealInExplorer(file);
        log.info(`revealed ${file}${selected ? '' : ' (folder only — /select failed)'}`);
        return { ok: true, selected };
      } catch (err) {
        log.warn(`could not open ${file}: ${String(err)}`);
        return reply.code(500).send({ error: `Failed to open: ${String(err)}` });
      }
    },
  );
}
