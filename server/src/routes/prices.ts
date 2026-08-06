import type { ModelPrices, PriceTable } from '@claude-history/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

function isValidPrices(value: unknown): value is ModelPrices {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (['input', 'output', 'cacheRead', 'cacheWrite'] as const).every(
    (k) => typeof p[k] === 'number' && Number.isFinite(p[k]) && (p[k] as number) >= 0,
  );
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
}
