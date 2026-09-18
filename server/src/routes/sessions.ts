import fsp from 'node:fs/promises';
import path from 'node:path';
import type { LineageResponse, McpLogEntry, McpLogsResponse, McpServerLog } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { pidAlive } from '../core/live.ts';
import { createLogger } from '../core/logger.ts';
import { mcpKey, parseSession } from '../core/parser.ts';
import { UUID_RE } from '../core/scanner.ts';
import { markOurs } from '../util/chatLive.ts';
import { isSameOrigin } from '../util/sameOrigin.ts';

const log = createLogger('sessions');

/** The CLI names one folder per server; the rest of the name is the server. */
const MCP_LOG_PREFIX = 'mcp-logs-';
/** A server's stderr is a whole startup banner; the tail is what explains a failure. */
const MAX_LOG_ENTRIES = 400;
const MAX_LOG_CHARS = 4_000;

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/sessions', async () => {
    const list = ctx.index.list();
    // A prompt sent from the app is answered by a process that never writes a
    // `status`, so the badge would sit on "live" through the whole turn.
    const working = ctx.chat.workingSessions();
    return list.map((s) => {
      const turn = working.get(s.id);
      if (turn !== undefined) return { ...s, live: markOurs(s.live, turn) };
      // And a session whose process has since exited is not live at all: the
      // cached list keeps the entry because nothing writes to that directory
      // on the way out, so the pid is what has to be asked.
      if (s.live && !pidAlive(s.live.pid)) return { ...s, live: null };
      return s;
    });
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    const summary = ctx.index.get(id);
    const scanned = ctx.index.getScanned(id);
    if (!summary || !scanned) return reply.code(404).send({ error: 'Session not found' });
    return parseSession(scanned, summary, ctx.config.projectsDir);
  });

  // Rename a session LOCALLY (override stored in userdata.json — this tool
  // never writes into ~/.claude, so Claude Code's own /resume keeps showing
  // the original title). Empty title removes the override.
  app.put<{ Params: { id: string }; Body: { title?: unknown } }>(
    '/api/sessions/:id/title',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      const raw = request.body?.title;
      if (raw !== undefined && typeof raw !== 'string') {
        return reply.code(400).send({ error: 'title must be a string' });
      }
      const title = (raw ?? '').trim().slice(0, 300);
      await ctx.index.setTitleOverride(id, title || null);
      return { ok: true, summary: ctx.index.get(id) };
    },
  );

  // Full fork lineage graph around a session (transitive closure over
  // `forkedFrom` ancestry + descendants). Referenced-but-deleted sessions
  // appear as exists:false nodes.
  app.get<{ Params: { id: string } }>('/api/sessions/:id/lineage', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });

    const nodes = new Map<string, LineageResponse['nodes'][number]>();
    const edges = new Set<string>();
    const queue = [id];
    while (queue.length > 0 && nodes.size < 200) {
      const current = queue.shift()!;
      if (nodes.has(current)) continue;
      const s = ctx.index.get(current);
      nodes.set(current, {
        id: current,
        exists: s !== undefined,
        title: s?.title ?? null,
        projectKey: s?.projectKey ?? null,
        projectName: s?.projectName ?? null,
        createdAt: s?.createdAt ?? null,
        lastActivityAt: s?.lastActivityAt ?? null,
      });
      if (!s) continue;
      const parent = s.enrichment?.forkedFrom;
      if (parent) {
        edges.add(`${parent}>${current}`);
        queue.push(parent);
      }
      for (const child of s.descendants) {
        edges.add(`${current}>${child}`);
        queue.push(child);
      }
    }
    const response: LineageResponse = {
      nodes: [...nodes.values()],
      edges: [...edges].map((e) => {
        const [from, to] = e.split('>');
        return { from, to };
      }),
    };
    return response;
  });

  /**
   * What the CLI logged about this session's MCP servers — the shape and the
   * reasoning are in `McpLogsResponse`.
   *
   * The strictness is the scratchpad's, and for the same reason: this
   * enumerates directories on the app's own initiative, so **the client sends
   * no path**. The root is composed from `LOCALAPPDATA` and the index's own
   * `encodedDir`, and the only names taken off the disk are the `mcp-logs-*`
   * folders themselves.
   *
   * A GET, so it carries its own `isSameOrigin`; it opens nothing on this
   * desktop, so it is not local-only.
   */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/mcp-logs',
    async (request, reply): Promise<McpLogsResponse | void> => {
      if (!isSameOrigin(request)) {
        log.warn('refused a cross-origin MCP log read', { session: request.params.id });
        return reply.code(403).send({ error: 'Cross-origin requests are not allowed.' });
      }
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      const summary = ctx.index.get(id);
      if (!summary) return reply.code(404).send({ error: 'Session not found' });

      const local = process.env.LOCALAPPDATA;
      if (!local) return { available: false, servers: [] };
      const root = path.join(local, 'claude-cli-nodejs', 'Cache', summary.encodedDir);

      let dirents;
      try {
        dirents = await fsp.readdir(root, { withFileTypes: true });
      } catch {
        // No folder is the ordinary answer for a session older than the logs,
        // or one whose project never had an MCP server. Not a warn.
        return { available: false, servers: [] };
      }

      const servers: McpServerLog[] = [];
      for (const d of dirents) {
        if (!d.isDirectory() || !d.name.startsWith(MCP_LOG_PREFIX)) continue;
        const dir = path.join(root, d.name);
        let files: string[];
        try {
          files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
        } catch (err) {
          log.warn(`could not list ${dir}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const entries: McpLogEntry[] = [];
        let connectMs: number | null = null;
        // The last thing the log SAYS became of it, which is the whole answer for
        // a server the transcript never named. Last wins: a server can connect,
        // be restarted and fail on the next attempt inside one session.
        let status: 'connected' | 'failed' | null = null;
        for (const f of files) {
          let raw: string;
          try {
            raw = await fsp.readFile(path.join(dir, f), 'utf8');
          } catch {
            continue; // a log being rotated under us is not worth a row
          }
          for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            let o: Record<string, unknown>;
            try {
              o = JSON.parse(line) as Record<string, unknown>;
            } catch {
              continue; // half-written lines, same rule as a transcript
            }
            if (o.sessionId !== id) continue;
            const error = typeof o.error === 'string' ? o.error : null;
            const debug = typeof o.debug === 'string' ? o.debug : null;
            const text = error ?? debug;
            if (!text) continue;
            const ms = debug ? /Successfully connected .* in (\d+)ms/.exec(debug) : null;
            if (ms) connectMs = Number(ms[1]);
            if (debug?.startsWith('Successfully connected')) status = 'connected';
            else if (error?.startsWith('Connection failed')) status = 'failed';
            entries.push({
              when: typeof o.timestamp === 'string' ? o.timestamp : null,
              kind: error ? 'error' : 'debug',
              text: text.length > MAX_LOG_CHARS ? `${text.slice(0, MAX_LOG_CHARS)}…` : text,
            });
          }
        }
        if (entries.length === 0) continue;
        // The newest survive the cap: a connection that failed did so at the
        // end, and the chatter before it is what there is too much of.
        const truncated = entries.length > MAX_LOG_ENTRIES;
        servers.push({
          server: d.name.slice(MCP_LOG_PREFIX.length),
          key: mcpKey(d.name.slice(MCP_LOG_PREFIX.length)),
          entries: truncated ? entries.slice(-MAX_LOG_ENTRIES) : entries,
          status,
          connectMs,
          truncated,
        });
      }

      servers.sort((a, b) => a.server.localeCompare(b.server));
      return { available: true, servers };
    },
  );

  // Pin/unpin a session (stored in userdata.json, never in ~/.claude).
  app.put<{ Params: { id: string }; Body: { pinned?: unknown } }>(
    '/api/sessions/:id/pin',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });
      if (typeof request.body?.pinned !== 'boolean') {
        return reply.code(400).send({ error: 'pinned must be a boolean' });
      }
      await ctx.index.setPinned(id, request.body.pinned);
      return { ok: true, summary: ctx.index.get(id) };
    },
  );
}
