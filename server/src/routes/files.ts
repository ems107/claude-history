import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FileOpenRequest, FileOpenResponse, FileReadResponse } from '@claude-history/shared';
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
  return { ok: true, path: path.resolve(summary.projectPath, ref) };
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
