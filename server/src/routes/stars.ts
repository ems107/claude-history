import path from 'node:path';
import {
  STAR_TEXT_MAX,
  type MessageItem,
  type StarEntry,
  type StarredMessage,
  type StarsResponse,
  type StarUpdateResponse,
} from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { parseSession } from '../core/parser.ts';
import { normalizeProjectKey } from '../core/projects.ts';
import { UUID_RE } from '../core/scanner.ts';

/**
 * What a star keeps of a message: what the bubble shows as the message itself.
 *
 * Thinking is left out (the viewer hides it by default and it is not the
 * answer), images are left out (megabytes of base64), and so are the tool calls
 * — they are lifted out of the bubble on screen too, and a starred message is
 * the thing said, not the traffic around it.
 */
function messageText(item: MessageItem): string {
  return item.blocks
    .filter((b) => b.kind === 'text' || b.kind === 'command')
    .map((b) => (b.kind === 'text' || b.kind === 'command' ? b.text : ''))
    .join('\n\n')
    .trim();
}

/**
 * Where a star belongs today. The stored project and title are snapshots, taken
 * so an orphaned star still says where it came from; while the session is still
 * in the index those are the stale copies and the index is the truth — which is
 * also what makes a local rename show up on the Starred page.
 */
function toEntry(ctx: AppContext, record: StarredMessage): StarEntry {
  const summary = ctx.index.get(record.sessionId);
  // `?? ''` and not `record.project`: the type says that field is always there
  // and the endpoint always writes it, but this file can now arrive from a
  // restored backup — one taken by an older version, or edited by hand — and
  // `path.basename(undefined)` threw a 500 that took the whole page down
  // instead of one row. An orphaned star is exactly the one that must still show.
  const project = summary?.projectPath ?? record.project ?? '';
  return {
    ...record,
    sessionTitle: summary?.title ?? record.sessionTitle ?? 'untitled',
    project,
    sessionExists: summary !== undefined,
    projectKey: summary?.projectKey ?? (project ? normalizeProjectKey(project) : ''),
    projectName: summary?.projectName ?? (project ? path.basename(project) : 'unknown project'),
  };
}

/** The message's own clock, or failing that the moment it was starred. */
function orderKey(record: StarredMessage): string {
  return record.timestamp ?? record.starredAt;
}

export function registerStarRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Every starred message, newest first. Reads userdata and the index only:
  // this is the whole reason the text is stored rather than re-read, since
  // otherwise the page would parse one transcript per starred session.
  app.get('/api/starred', async (): Promise<StarsResponse> => {
    return ctx.index
      .listStars()
      .map((record) => toEntry(ctx, record))
      .sort((a, b) => orderKey(b).localeCompare(orderKey(a)));
  });

  app.put<{ Params: { id: string; uuid: string }; Body: { starred?: unknown } }>(
    '/api/sessions/:id/messages/:uuid/star',
    async (request, reply) => {
      const { id, uuid } = request.params;
      if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid session id' });
      if (!UUID_RE.test(uuid)) return reply.code(400).send({ error: 'Invalid message uuid' });
      if (typeof request.body?.starred !== 'boolean') {
        return reply.code(400).send({ error: 'starred must be a boolean' });
      }

      // Unstarring asks nothing about the session: a star whose transcript has
      // since gone is exactly the one that has to stay removable.
      if (!request.body.starred) {
        const removed = await ctx.index.removeStar(id, uuid);
        return { ok: true, star: null, removed } satisfies StarUpdateResponse;
      }

      const summary = ctx.index.get(id);
      const scanned = ctx.index.getScanned(id);
      if (!summary || !scanned) return reply.code(404).send({ error: 'Session not found' });

      // The same parse the viewer already ran to show the message. Paid once,
      // here, so that opening the Starred page never pays it again.
      const detail = await parseSession(scanned, summary, ctx.config.projectsDir);
      const item = detail.turns
        .flatMap((t) => t.items)
        // A streamed answer merges its chunks, so the uuid a link carries can be
        // any of the aliases while the canonical one is the first chunk's.
        .find((i) => i.uuid === uuid || i.aliasUuids.includes(uuid));
      if (!item) return reply.code(404).send({ error: 'Message not found in this session' });
      if (item.role !== 'user' && item.role !== 'assistant') {
        return reply.code(400).send({ error: 'Only a prompt or an answer can be starred' });
      }

      const text = messageText(item);
      if (!text) return reply.code(400).send({ error: 'This message has no text to keep' });

      const record: StarredMessage = {
        sessionId: id,
        // The canonical uuid, never the alias that was clicked: `?msg=` resolves
        // either, and the bubble carries this one as its DOM id.
        uuid: item.uuid,
        role: item.role,
        timestamp: item.timestamp,
        starredAt: new Date().toISOString(),
        text: text.slice(0, STAR_TEXT_MAX),
        chars: text.length,
        truncated: text.length > STAR_TEXT_MAX,
        sessionTitle: summary.title,
        project: summary.projectPath,
      };
      await ctx.index.setStar(record);
      return { ok: true, star: toEntry(ctx, record), removed: false } satisfies StarUpdateResponse;
    },
  );
}
