import type { PriceTable } from '@claude-history/shared';
import { DEFAULT_PRICES } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';

const COLS: Array<[keyof PriceTable[string], string]> = [
  ['input', 'Input'],
  ['output', 'Output'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write (1h)'],
];

export function PricingEditor({
  prices,
  isDefault,
  modelsInUse,
}: {
  prices: PriceTable;
  isDefault: boolean;
  modelsInUse: string[];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PriceTable>(prices);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(prices);
    setDirty(false);
  }, [prices]);

  const models = [...new Set([...modelsInUse, ...Object.keys(prices), ...Object.keys(DEFAULT_PRICES)])].sort();

  const setCell = (model: string, key: keyof PriceTable[string], value: number) => {
    setDraft((prev) => ({
      ...prev,
      [model]: { ...(prev[model] ?? DEFAULT_PRICES[model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), [key]: value },
    }));
    setDirty(true);
  };

  const persist = (table: PriceTable | null) => {
    setSaving(true);
    void api
      .savePrices(table)
      .then(() => queryClient.invalidateQueries({ queryKey: ['prices'] }))
      .finally(() => setSaving(false));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-sm font-semibold">
          Pricing <span className="font-normal text-[var(--text-dim)]">($ per million tokens)</span>
        </h2>
        {isDefault && !dirty && (
          <span className="rounded bg-zinc-500/15 px-1.5 py-px text-[10px] font-semibold text-zinc-400 uppercase">
            official API defaults
          </span>
        )}
        <span className="ml-auto inline-flex gap-1.5">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => persist(draft)}
            className="cursor-pointer rounded border border-[var(--accent-dim)] px-2 py-0.5 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:cursor-default disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            disabled={saving || (isDefault && !dirty)}
            onClick={() => persist(null)}
            className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40"
          >
            Reset defaults
          </button>
        </span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] tracking-wider text-[var(--text-dim)] uppercase">
            <th className="py-1">Model</th>
            {COLS.map(([key, label]) => (
              <th key={key} className="px-2 text-right">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const row = draft[model] ?? DEFAULT_PRICES[model];
            if (!row) return null;
            return (
              <tr key={model} className="border-t border-[var(--border)]">
                <td className={`py-1 pr-2 font-mono ${modelsInUse.includes(model) ? '' : 'opacity-50'}`}>{model}</td>
                {COLS.map(([key]) => (
                  <td key={key} className="px-2 py-0.5 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={row[key]}
                      onChange={(e) => setCell(model, key, Number(e.target.value))}
                      className="w-20 rounded border border-[var(--border)] bg-transparent px-1 py-0.5 text-right focus:border-[var(--accent-dim)] focus:outline-none"
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-[var(--text-dim)]">
        Costs shown across the app are <b>API-equivalent value</b> (what this usage would cost at Anthropic API list
        prices) — on a subscription this is not actual spend. Cache write defaults to the 1-hour-TTL rate used by
        Claude Code.
      </p>
    </div>
  );
}
