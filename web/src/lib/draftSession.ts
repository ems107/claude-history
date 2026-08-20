import type { SessionDetailResponse } from '@claude-history/shared';

/**
 * What a session looks like before it has a transcript.
 *
 * Claude Code writes the `.jsonl` on the FIRST TURN, not when the process
 * starts, so there is a window in which the id exists, a CLI of ours is running
 * in it, and there is no file to read: `GET /api/sessions/:id` answers 404,
 * because the index only knows files. The session view is a reader of that file
 * and used to show "Failed to load session" for the whole window — for a
 * session the app itself was running.
 *
 * Nothing else could be reached from there, and two things now lead there: the
 * row in the active-sessions dialog (which offers to take you to the session so
 * you can close it) and a plain reload of that URL. So the page treats
 * `draft: true` from `GET /api/sessions/:id/chat` as *a session about to be
 * born* rather than a session that does not exist, and this is the shape it
 * draws it with: real folder, real id, no turns, nothing invented that could be
 * mistaken for history.
 *
 * **The 404 stays the server's answer** and is not softened there, because it is
 * load-bearing elsewhere: `/new` waits for exactly that request to succeed
 * before handing over to the session view, and a 200 for a reservation would
 * make it jump out of the picker the moment a CLI opened to read the model list.
 * Which is why this shape is built here, for one page, rather than by the index.
 *
 * Everything is empty or null rather than zero where the field allows it, so
 * every consumer takes its "nothing to show" path: the header draws no counts
 * row (no `enrichment`), no badges, no dates, and the toolbar's buttons grey
 * themselves out on their own counts. The moment the file appears, the real
 * detail arrives on the same query key and this is never rendered again.
 */
export function draftSessionDetail(id: string, cwd: string | null): SessionDetailResponse {
  const path = cwd ?? '';
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
  return {
    summary: {
      id,
      // Where the transcript WILL be written; nothing reads it in the viewer,
      // and guessing the encoded directory here would be inventing a fact.
      encodedDir: '',
      projectKey: path.toLowerCase(),
      projectPath: path,
      projectName: name,
      title: 'New session',
      // Not 'local': that one wears the "renamed here" badge, and nobody named
      // this. `uuid` is the honest source — the id is all there is.
      titleSource: 'uuid',
      originalTitle: null,
      createdAt: null,
      lastActivityAt: null,
      mtimeMs: 0,
      sizeBytes: 0,
      gitBranch: null,
      slug: null,
      entrypoint: null,
      model: null,
      claudeVersion: null,
      messageCount: null,
      firstPromptPreview: null,
      lastPromptPreview: null,
      // Not `isEmpty`: that means a throwaway stub the list hides on purpose,
      // and this is the opposite — a session somebody is starting right now.
      isEmpty: false,
      isBackground: false,
      pinned: false,
      subagentCount: 0,
      enrichment: null,
      live: null,
      descendants: [],
    },
    turns: [],
    subagents: [],
    ancestry: { forkedFrom: null, descendants: [] },
    prLinks: [],
    fileChanges: [],
  };
}
