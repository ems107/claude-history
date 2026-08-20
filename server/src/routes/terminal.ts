import type { TerminalClientMessage, TerminalStartRequest, TerminalStatus } from '@claude-history/shared';
import { TERMINAL_MIN_COLS, TERMINAL_MIN_ROWS } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';
import { UUID_RE } from '../core/scanner.ts';
import { isSameOrigin } from '../util/sameOrigin.ts';

const log = createLogger('terminal');

/**
 * A frame larger than this is not a keystroke and not a paste anyone made — it
 * is something wrong at the other end. Bounded so one socket cannot make the
 * server hold an arbitrary string.
 */
const MAX_INPUT_BYTES = 64 * 1024;

export function registerTerminalRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Unknown to BOTH the index and the chat service, and only then a 404 — the
   * same rule `routes/chat.ts` keeps, and for the same reason: a session being
   * started from the app has a reserved id and a folder long before it has a
   * transcript, and that is exactly when its terminal is opened.
   */
  const missing = (id: string): boolean => !ctx.index.get(id) && !ctx.chat.knows(id);

  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/terminal',
    async (request, reply): Promise<TerminalStatus | void> => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (missing(id)) return reply.code(404).send({ error: 'Session not found' });
      return ctx.terminals.status(id);
    },
  );

  app.post<{ Params: { id: string }; Body: TerminalStartRequest }>(
    '/api/sessions/:id/terminal',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (missing(id)) return reply.code(404).send({ error: 'Session not found' });
      const cols = Number(request.body?.cols ?? TERMINAL_MIN_COLS);
      const rows = Number(request.body?.rows ?? TERMINAL_MIN_ROWS);
      try {
        ctx.terminals.open(id, cols, rows);
        return { ok: true };
      } catch (err) {
        // 409 like the composer's: every refusal here is a state of the machine
        // — the feature is off, the folder is gone, a terminal already holds it
        // — and the message IS `blockedReason`, so the button and the endpoint
        // never disagree about why.
        return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Closing something that is not open is not an error, exactly as with
  // `/chat/stop`: the button may have been pressed twice, or the CLI may have
  // exited between the render and the click.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/terminal/stop', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    ctx.terminals.close(id);
    return { ok: true };
  });

  /**
   * The socket. It only ever ATTACHES: starting is the POST above, so a refusal
   * arrives as a status code with a sentence rather than as a socket that opens
   * and immediately closes for reasons nobody can read.
   *
   * Three things guard it, and the third is the one that is easy to miss:
   *
   * - the session hook in `app.ts` runs on an upgrade like on any other GET, so
   *   a remote browser without a cookie never gets here;
   * - the id is validated and must be one the index or a reservation knows;
   * - **same-origin is checked HERE**, because the global hook deliberately
   *   exempts GET — a plain-HTTP page sends neither `Sec-Fetch-Site` nor
   *   `Origin` on an ordinary same-origin GET, so asking there would refuse our
   *   own reads. A WebSocket upgrade is different: a browser always sends
   *   `Origin` on one, so its absence is meaningful and `isSameOrigin` gives the
   *   right answer for exactly this shape of request.
   */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/terminal/ws',
    { websocket: true },
    (socket, request) => {
      const { id } = request.params;
      const close = (code: number, reason: string): void => {
        try {
          socket.send(JSON.stringify({ t: 'error', message: reason }));
        } catch {
          // Already gone.
        }
        socket.close(code, reason.slice(0, 120));
      };

      if (!isSameOrigin(request)) {
        log.warn(`refused a cross-origin terminal socket for ${id}`, {
          origin: request.headers.origin ?? null,
        });
        close(1008, 'Cross-origin requests are not allowed.');
        return;
      }
      if (!UUID_RE.test(id) || missing(id)) {
        close(1008, 'Session not found.');
        return;
      }

      const detach = ctx.terminals.attach(id, {
        sendBytes: (data) => {
          if (socket.readyState === socket.OPEN) socket.send(data, { binary: true });
        },
        sendJson: (message) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
        },
      });

      socket.on('message', (raw: Buffer) => {
        if (raw.length > MAX_INPUT_BYTES) return;
        let msg: TerminalClientMessage;
        try {
          msg = JSON.parse(raw.toString('utf8')) as TerminalClientMessage;
        } catch {
          return; // a frame we cannot read is a frame we ignore
        }
        if (msg.t === 'i' && typeof msg.d === 'string') ctx.terminals.write(id, msg.d);
        else if (msg.t === 'r') ctx.terminals.resize(id, Number(msg.cols), Number(msg.rows));
      });

      // Detaching is NOT closing: the PTY outlives the browser on purpose, so a
      // closed tab loses the view and nothing else.
      socket.on('close', detach);
      socket.on('error', detach);
    },
  );
}
