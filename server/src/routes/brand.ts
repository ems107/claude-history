import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOGO_DEFAULT_COLOR, tintLogoTile } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { createLogger } from '../core/logger.ts';

/**
 * The two files a browser reads before it reads anything else: the tab's icon
 * and the web manifest. Both ship as files, both are served with one setting
 * substituted into them, and both follow the same three rules.
 *
 * **They shadow the static files rather than living at URLs of their own.** The
 * files stay the one place the mark is drawn and the app is described,
 * `index.html` goes on pointing at the names it always did, and a browser that
 * has never run our JavaScript already gets the right colour and the right name
 * — so there is no flash on load, and a page installed to a home screen asks
 * for the same URLs a tab does.
 *
 * **What is served comes from the index, never from the request.** The `?v=`
 * the page appends when the colour changes is a cache key and nothing else:
 * these handlers do not read it. Nothing about what is served may be decided by
 * a caller.
 *
 * **They answer before anybody signs in**, like the rest of the bundle — they
 * are not `/api/` paths, so `app.ts`'s authentication hook lets them through.
 * What that discloses is a colour and a name, to somebody who can already reach
 * the port and download the whole front-end; the alternative was the flash.
 */
export function registerBrandRoutes(app: FastifyInstance, ctx: AppContext): void {
  const dir = ctx.config.staticDir;
  if (!dir) return;
  const log = createLogger('brand');

  // Read once, both of them. An update replaces the files and restarts the
  // server, so there is no version of this in which a copy in memory outlives
  // the file it came from.
  const shipped = (name: string): string | null => {
    try {
      return readFileSync(join(dir, name), 'utf8');
    } catch (err) {
      // No file, no route: the static handler stays in charge of the name,
      // which is what happens for a build that never had one.
      log.warn(`no ${name} to serve from the settings — the static one stands`, err);
      return null;
    }
  };

  const tile = shipped('favicon.svg');
  if (tile !== null) {
    app.get('/favicon.svg', async (_request, reply) => {
      const color = ctx.index.getSettings().logoColor;
      // The default is served by doing nothing — the same rule the accent follows
      // on the page — so a default instance hands out the file in the
      // repository, byte for byte, and there is one fewer thing to have got
      // subtly wrong.
      const svg = color === LOGO_DEFAULT_COLOR ? tile : tintLogoTile(tile, color);
      return reply
        .header('content-type', 'image/svg+xml; charset=utf-8')
        // The static handler would have said `immutable` for a year, which is
        // exactly what a colour that can change must not be.
        .header('cache-control', 'no-cache')
        .send(svg);
    });
  }

  const manifest = shipped('manifest.webmanifest');
  const parsed = parseManifest(manifest, log);
  if (manifest !== null && parsed !== null) {
    app.get('/manifest.webmanifest', async (_request, reply) => {
      const settings = ctx.index.getSettings();
      const chosen = settings.appName.trim();
      /**
       * A NAMELESS dev instance says so in its name, exactly as its tab title
       * does (`App.tsx`), and for a sharper version of the same reason: two
       * tabs that look alike on two ports is the one way to confuse them, and
       * two INSTALLED apps that look alike would outlive the confusion — an
       * installed window has no address bar to check the port in. So this is
       * the one case where a default instance does not get the file back
       * untouched.
       *
       * **A name somebody typed is taken as given.** Naming it is the clearest
       * way there is to say which instance this is, and marking a name that was
       * chosen is second-guessing whoever chose it — which read as
       * `dev · Claude History dev :7434` the first time somebody did the
       * obvious thing and typed the distinction themselves.
       */
      const mark = ctx.config.devInstance && chosen === '' ? `:${String(ctx.config.port)}` : null;
      const color = settings.logoColor;
      const body =
        chosen === '' && mark === null && color === LOGO_DEFAULT_COLOR
          ? manifest
          : JSON.stringify(tinted(named(parsed, chosen || null, mark), color), null, 2);
      return reply
        .header('content-type', 'application/manifest+json; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(body);
    });
  }
}

/** The shipped manifest as an object, or null if it is missing or unreadable. */
function parseManifest(text: string | null, log: ReturnType<typeof createLogger>): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    // Parsed once, at registration, so a broken file is a line in the log at
    // startup rather than a 500 on the one request that draws the icon.
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    log.warn('manifest.webmanifest is not an object — serving it unchanged');
  } catch (err) {
    log.warn('manifest.webmanifest could not be parsed — serving it unchanged', err);
  }
  return null;
}

/**
 * The manifest under another name, and under nothing else.
 *
 * Only `name` and `short_name` are touched: the description, the colours,
 * `display`, `scope` and the icons stay facts about the file, so there is one
 * copy of them and this cannot drift from it. A chosen name takes BOTH fields,
 * because a person typing one name has not chosen two — the shipped pair
 * differs (`Claude History` / `claude history`) and that difference belongs to
 * the file rather than to anybody's setting.
 */
function named(manifest: Record<string, unknown>, chosen: string | null, devPort: string | null): Record<string, unknown> {
  const shippedName = typeof manifest.name === 'string' ? manifest.name : '';
  const shippedShort = typeof manifest.short_name === 'string' ? manifest.short_name : shippedName;
  const mark = (value: string): string => (devPort === null ? value : `dev · ${value} ${devPort}`);
  return { ...manifest, name: mark(chosen ?? shippedName), short_name: mark(chosen ?? shippedShort) };
}

/**
 * The manifest's own icon, asked for at a URL the browser cannot already have.
 *
 * The bare `/favicon.svg` was served with `immutable` for a year by the static
 * handler for the whole life of this app before the route above existed, so
 * every browser that has ever opened it holds a terracotta copy it will not
 * revalidate — and an install reads the icon by the URL the manifest gives it.
 * `?v=` is a URL that has never been cached, which is the only way past that.
 *
 * Only when the colour is not the default, so a default instance still hands
 * back the file byte for byte: there, a stale copy of the shipped tile is the
 * right tile, and the property is worth keeping.
 */
function tinted(manifest: Record<string, unknown>, color: string): Record<string, unknown> {
  if (color === LOGO_DEFAULT_COLOR || !Array.isArray(manifest.icons)) return manifest;
  const icons = manifest.icons.map((icon: unknown) => {
    if (!icon || typeof icon !== 'object') return icon;
    const entry = icon as Record<string, unknown>;
    return entry.src === '/favicon.svg' ? { ...entry, src: `/favicon.svg?v=${color.slice(1)}` } : entry;
  });
  return { ...manifest, icons };
}
