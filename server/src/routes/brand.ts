import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOGO_DEFAULT_COLOR, tintLogoTile } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';

/**
 * The tab's icon, in the colour the logo is set to.
 *
 * It shadows the static `favicon.svg` rather than living at a URL of its own,
 * and that is the whole design: the file stays the one place the mark is drawn,
 * `index.html` and the web manifest go on pointing at the name they always did,
 * and a browser that has never run our JavaScript still gets the right colour —
 * so there is no terracotta flash on every load, and a page installed to a home
 * screen asks for the same URL as a tab.
 *
 * **The colour comes from the index, never from the request.** The `?v=` the
 * page appends when the setting changes is a cache key and nothing else: it is
 * what makes a browser ask again for a file it already has, and this handler
 * does not read it. Nothing about what is served may be decided by a caller.
 *
 * It answers before anybody signs in, like the rest of the bundle — it is not
 * an `/api/` path, so `app.ts`'s authentication hook lets it through. What that
 * discloses is one colour, to somebody who can already reach the port and
 * download the whole front-end; the alternative was the flash.
 */
export function registerBrandRoutes(app: FastifyInstance, ctx: AppContext): void {
  const dir = ctx.config.staticDir;
  if (!dir) return;
  let tile: string;
  try {
    // Read once. An update replaces the file and restarts the server, so there
    // is no version of this in which the copy in memory outlives the file.
    tile = readFileSync(join(dir, 'favicon.svg'), 'utf8');
  } catch (err) {
    // No file, no route: the static handler stays in charge of the name, which
    // is what happens for a build that never had one.
    createLogger('brand').warn('no favicon.svg to tint — serving the static one', err);
    return;
  }

  app.get('/favicon.svg', async (_request, reply) => {
    const color = ctx.index.getSettings().logoColor;
    // The default is served by doing nothing — the same rule `--logo` follows on
    // the page — so a default instance hands out the file in the repository,
    // byte for byte, and there is one fewer thing to have got subtly wrong.
    const svg = color === LOGO_DEFAULT_COLOR ? tile : tintLogoTile(tile, color);
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      // The static handler would have said `immutable` for a year, which is
      // exactly what a colour that can change must not be.
      .header('cache-control', 'no-cache')
      .send(svg);
  });
}
