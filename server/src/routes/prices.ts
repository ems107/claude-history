import type { ModelPrices, PriceTable } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { fetchOfficialPrices } from '../core/officialPrices.ts';

function isValidPrices(value: unknown): value is ModelPrices {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  // cacheWrite5m is optional: tables saved before it existed must still load,
  // and the rate is derived from the input one when it is missing.
  if (p.cacheWrite5m !== undefined && !positive(p.cacheWrite5m)) return false;
  return (['input', 'output', 'cacheRead', 'cacheWrite'] as const).every((k) => positive(p[k]));
}

export function registerPriceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/prices', async () => ({
    prices: ctx.index.priceTable,
    isDefault: !ctx.index.hasCustomPrices,
  }));

  // Replace the whole table; `prices: null` resets to the built-in defaults.
  app.put<{ Body: { prices?: unknown } }>('/api/prices', async (request, reply) => {
    const raw = request.body?.prices;
    if (raw === null) {
      await ctx.index.setPriceTable(null);
      return { ok: true, prices: ctx.index.priceTable, isDefault: true };
    }
    if (typeof raw !== 'object' || raw === undefined || Array.isArray(raw)) {
      return reply.code(400).send({ error: 'prices must be an object or null' });
    }
    const table: PriceTable = {};
    for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^[\w.-]{1,64}$/.test(model) || !isValidPrices(value)) {
        return reply.code(400).send({ error: `Invalid price entry: ${model}` });
      }
      table[model] = value;
    }
    await ctx.index.setPriceTable(table);
    return { ok: true, prices: ctx.index.priceTable, isDefault: false };
  });

  // Fetch the current official prices from Anthropic's public pricing docs
  // (served as markdown). Returns a PREVIEW — nothing is saved; the client
  // reviews and persists via PUT /api/prices. This is the app's only
  // outbound network call and it only runs when the user clicks the button.
  app.post('/api/prices/fetch', async (_request, reply) => {
    try {
      return await fetchOfficialPrices();
    } catch (err) {
      return reply.code(502).send({
        error: `Could not fetch official prices: ${err instanceof Error ? err.message : String(err)}. ` +
          'The docs format may have changed — edit prices manually instead.',
      });
    }
  });
}
