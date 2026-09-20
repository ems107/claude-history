import type {
  FileCommentRecord,
  FileReviewResponse,
  FileReviewUpdateResponse,
} from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { UUID_RE } from '../core/scanner.ts';
import { isSameOrigin } from '../util/sameOrigin.ts';

/**
 * The remarks somebody left on files of a session's project.
 *
 * `planReviews.ts` without the `:planKey` segment, and that absence is the
 * whole shape of the feature: a session has several plans and each carries its
 * own stack, but it browses ONE project. So a basket IS a session, and the file
 * a remark is about travels inside the record rather than in the URL — which
 * also keeps a Windows path, with its drive letters and backslashes, out of a
 * path segment it would have had to be escaped into.
 */

/** Ids are minted by the web's `newId`; the server only refuses what a path segment must not carry. */
const COMMENT_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
/** Enough for any remark worth reading; a pasted log is not one. */
const COMMENT_TEXT_MAX = 10_000;
/** What a quote is cut to, matching the web's own `QUOTE_MAX`. */
const QUOTE_MAX = 240;
/** Long enough for any real path, short enough not to be a payload. */
const PATH_MAX = 1024;

/**
 * Take a remark off the wire.
 *
 * Everything is bounded and nothing is trusted: this endpoint is reachable from
 * a phone on the far end of remote access, and a record written here is one
 * `userdata.json` will carry for as long as the session exists.
 */
function readComment(id: string, body: unknown): FileCommentRecord | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const path = typeof b.path === 'string' ? b.path.trim() : '';
  const quote = typeof b.quote === 'string' ? b.quote.trim() : '';
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!path) return 'A comment must name the file it is about';
  // A NUL in a path is never anything but an attempt to cut one short, and this
  // string is printed back into the prose somebody pastes into a terminal.
  if (path.includes('\0') || path.length > PATH_MAX) return 'That is not a usable path';
  if (!quote) return 'A comment must quote a passage of the file';
  if (!text) return 'A comment must say something';
  if (text.length > COMMENT_TEXT_MAX) return `A comment is at most ${String(COMMENT_TEXT_MAX)} characters`;
  const line = Number(b.line);
  const endLine = Number(b.endLine);
  const start = Number(b.start);
  const end = Number(b.end);
  // A line number is 1-based and nonsense collapses to 1: the remark stands
  // either way, and `[L1]` is wrong in a way a reader can see, where a `[L0]`
  // or a `[LNaN]` would read as a bug in the app rather than in the data.
  const first = Number.isFinite(line) && line >= 1 ? Math.floor(line) : 1;
  return {
    id,
    path,
    quote: quote.slice(0, QUOTE_MAX),
    line: first,
    endLine: Number.isFinite(endLine) && endLine >= first ? Math.floor(endLine) : first,
    text,
    // `-1` is the honest answer for a selection that cannot be painted, and it
    // is also what any nonsense off the wire collapses to: the remark stands,
    // it just goes unpainted, which is the same degradation.
    start: Number.isFinite(start) && start >= 0 ? Math.floor(start) : -1,
    end: Number.isFinite(end) && end >= 0 ? Math.floor(end) : -1,
    // Both clocks belong to the store, which is the only thing that knows
    // whether this id was already there.
    createdAt: '',
    editedAt: null,
  };
}

export function registerFileReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  // The basket, or null. Reads userdata only — nothing here has to find a file.
  app.get<{ Params: { id: string } }>('/api/sessions/:id/file-comments', async (request, reply) => {
    if (!isSameOrigin(request)) return reply.code(403).send({ error: 'Cross-origin request refused' });
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    return (ctx.index.getFileReview(id) ?? null) satisfies FileReviewResponse;
  });

  app.put<{ Params: { id: string; commentId: string }; Body: unknown }>(
    '/api/sessions/:id/file-comments/:commentId',
    async (request, reply) => {
      const { id, commentId } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!COMMENT_ID_RE.test(commentId)) return reply.code(400).send({ error: 'Invalid comment id' });
      // The session has to exist — it is what the basket is filed under, and
      // what the project path was resolved from. The FILE deliberately is not
      // checked: it was read a moment ago to be selected from, and a remark is
      // frozen prose the instant it is written.
      if (!ctx.index.get(id)) return reply.code(404).send({ error: 'Session not found' });

      const comment = readComment(commentId, request.body);
      if (typeof comment === 'string') return reply.code(400).send({ error: comment });
      const review = await ctx.index.setFileComment(id, comment);
      return { ok: true, review, removed: false } satisfies FileReviewUpdateResponse;
    },
  );

  app.delete<{ Params: { id: string; commentId: string } }>(
    '/api/sessions/:id/file-comments/:commentId',
    async (request, reply) => {
      const { id, commentId } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!COMMENT_ID_RE.test(commentId)) return reply.code(400).send({ error: 'Invalid comment id' });
      // Asks nothing about the session, for the star's reason: a remark on a
      // project whose transcript has since been swept is exactly the one that
      // has to stay removable.
      const { removed, review } = await ctx.index.removeFileComment(id, commentId);
      return { ok: true, review, removed } satisfies FileReviewUpdateResponse;
    },
  );

  // Clear all — one write and one event rather than N deletes racing each other.
  app.delete<{ Params: { id: string } }>('/api/sessions/:id/file-comments', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    const removed = await ctx.index.clearFileReview(id);
    return { ok: true, review: null, removed } satisfies FileReviewUpdateResponse;
  });

  // The basket left, the only way it can: onto the clipboard, and from there
  // into whichever terminal is running this project.
  app.post<{ Params: { id: string } }>('/api/sessions/:id/file-comments/copied', async (request, reply) => {
    const { id } = request.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
    const review = await ctx.index.markFileReviewCopied(id);
    if (!review) return reply.code(404).send({ error: 'No comments on any file of this session' });
    return { ok: true, review, removed: false } satisfies FileReviewUpdateResponse;
  });
}
