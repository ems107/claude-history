import type { LogDayResponse, LogsResponse, UpdateLogResponse } from '@claude-history/shared';
import { LOG_PAGE_SIZE } from '@claude-history/shared';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { listDays, LOG_DATE_RE, queryDay, readDay } from '../core/logReader.ts';
import { clearLogs, logFilePath } from '../core/logger.ts';

/** update.log is written by the installer's PowerShell, and can grow. */
const UPDATE_LOG_MAX_BYTES = 512 * 1024;

const asSet = (value: string | undefined): Set<string> | null => {
  if (!value) return null;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
};

export function registerLogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const updateLogPath = (): string | null =>
    ctx.updates.install ? path.join(ctx.updates.install.root, 'update.log') : null;

  app.get('/api/logs', async (): Promise<LogsResponse> => {
    const settings = ctx.index.getSettings();
    const update = updateLogPath();
    return {
      logsDir: ctx.config.logsDir,
      days: listDays(ctx.config.logsDir),
      level: settings.logLevel,
      retentionDays: settings.logRetentionDays,
      updateLog: { available: update !== null && fs.existsSync(update), path: update },
    };
  });

  app.get<{ Params: { date: string }; Querystring: { level?: string; src?: string; q?: string; limit?: string } }>(
    '/api/logs/day/:date',
    async (request, reply) => {
      const { date } = request.params;
      // Validated, and then checked again after resolving: the date becomes a
      // file name, so nothing may escape the logs dir.
      if (!LOG_DATE_RE.test(date)) return reply.code(400).send({ error: 'Invalid date' });
      const file = path.resolve(logFilePath(ctx.config.logsDir, date));
      if (path.dirname(file) !== path.resolve(ctx.config.logsDir)) {
        return reply.code(400).send({ error: 'Invalid date' });
      }
      const limit = Math.min(LOG_PAGE_SIZE, Math.max(1, Number(request.query.limit) || LOG_PAGE_SIZE));
      const all = await readDay(ctx.config.logsDir, date);
      const result = queryDay(all, {
        levels: asSet(request.query.level),
        sources: asSet(request.query.src),
        query: request.query.q?.trim() || null,
        limit,
      });
      return { date, ...result } satisfies LogDayResponse;
    },
  );

  // The installer's own log, shown raw: it is PowerShell-written plain text in
  // the install folder, nothing to do with our JSONL, but it is what you read
  // when an update goes wrong.
  app.get('/api/logs/update-log', async (): Promise<UpdateLogResponse> => {
    const file = updateLogPath();
    const empty = { available: false, path: file, text: '', sizeBytes: 0, modifiedAt: null };
    if (!file) return empty;
    try {
      const stat = await fs.promises.stat(file);
      const handle = await fs.promises.open(file, 'r');
      try {
        // Only the tail matters, and it must not be able to blow up the response.
        const start = Math.max(0, stat.size - UPDATE_LOG_MAX_BYTES);
        const buffer = Buffer.alloc(stat.size - start);
        await handle.read(buffer, 0, buffer.length, start);
        // The file is UTF-8 now (it was ASCII, which could not be cut wrong):
        // an offset landing mid-character decodes to a leading U+FFFD, so drop
        // whatever the truncation itself broke.
        const tail = start > 0 ? buffer.toString('utf8').replace(/^\uFFFD+/, '') : buffer.toString('utf8');
        const text = (start > 0 ? `[... ${start} earlier bytes not shown ...]\n` : '') + tail;
        return { available: true, path: file, text, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      } finally {
        await handle.close();
      }
    } catch {
      return empty;
    }
  });

  app.post('/api/logs/clear', async (_request, reply) => {
    try {
      return { ok: true, deleted: clearLogs() };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
