import type { PriceTable } from '@claude-history/shared';
import { DEFAULT_PRICES, cacheWrite5mRate, priceKey } from '@claude-history/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.ts';

const COLS: Array<[keyof PriceTable[string], string]> = [
  ['input', 'Input'],
  ['output', 'Output'],
  ['cacheRead', 'Cache read'],
  ['cacheWrite', 'Cache write (1h)'],
  ['cacheWrite5m', 'Cache write (5m)'],
];

const NO_PRICE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0 };

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
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ changed: string[]; added: string[]; fetchedAt: string } | null>(
    null,
  );
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(prices);
    setDirty(false);
  }, [prices]);

  const fetchOfficial = () => {
    setFetching(true);
    setFetchError(null);
    setFetchResult(null);
    void api
      .fetchOfficialPrices()
      .then(({ prices: fetched, fetchedAt }) => {
        const changed: string[] = [];
        const added: string[] = [];
        for (const [model, next] of Object.entries(fetched)) {
          const cur = draft[model];
          if (!cur) {
            added.push(`${model} (${next.input}/${next.output}/${next.cacheRead}/${next.cacheWrite})`);
            continue;
          }
          for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite5m'] as const) {
            // A table saved before the 5m rate existed has no value to compare —
            // adopting the official one is not a change the user needs listed.
            if (next[key] !== undefined && cur[key] !== undefined && cur[key] !== next[key]) {
              changed.push(`${model}.${key}: ${cur[key]} → ${next[key]}`);
            }
          }
        }
        // Merge fetched over the draft (custom extra models are preserved).
        setDraft((prev) => ({ ...prev, ...fetched }));
        setDirty(changed.length + added.length > 0 ? true : dirty);
        setFetchResult({ changed, added, fetchedAt });
      })
      .catch((e) => setFetchError(String(e instanceof Error ? e.message : e)))
      .finally(() => setFetching(false));
  };

  // A model id your sessions used can be a dated snapshot of a family row
  // (claude-haiku-4-5-20251001 → claude-haiku-4-5). Show and mark the row that
  // actually prices it: listing the dated id instead left a model in use with no
  // row at all, and its cost silently counted as $0 everywhere.
  const inUse = useMemo(
    () => new Set(modelsInUse.map((m) => priceKey(m, draft) ?? priceKey(m, DEFAULT_PRICES) ?? m)),
    [modelsInUse, draft],
  );
  const models = [...new Set([...inUse, ...Object.keys(prices), ...Object.keys(DEFAULT_PRICES)])].sort();

  const setCell = (model: string, key: keyof PriceTable[string], value: number) => {
    setDraft((prev) => ({
      ...prev,
      [model]: { ...(prev[model] ?? DEFAULT_PRICES[model] ?? NO_PRICE), [key]: value },
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
            disabled={fetching}
            onClick={fetchOfficial}
            className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40"
            title="Fetch the current official prices from platform.claude.com (the app's only network call; nothing is saved until you press Save)"
          >
            {fetching ? 'Fetching…' : '⟳ Fetch current prices'}
          </button>
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
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(prices);
              setDirty(false);
              setFetchResult(null);
              setFetchError(null);
            }}
            className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--text-dim)] disabled:cursor-default disabled:opacity-40"
            title="Discard unsaved edits and revert to the last saved table"
          >
            Cancel
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
      {fetchError && (
        <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
          {fetchError}
        </div>
      )}
      {fetchResult && (
        <div className="mb-2 rounded border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-1.5 text-xs">
          {fetchResult.changed.length === 0 && fetchResult.added.length === 0 ? (
            <span className="text-emerald-400">✓ Your table already matches the current official prices.</span>
          ) : (
            <>
              {fetchResult.changed.length > 0 && (
                <>
                  <div className="mb-1 text-amber-400">
                    {fetchResult.changed.length} of your value{fetchResult.changed.length !== 1 ? 's' : ''} changed
                    (e.g. date-dependent rates like Claude Sonnet 5's introductory pricing) — review and press{' '}
                    <b>Save</b> to keep, or <b>Cancel</b> to discard.
                  </div>
                  <ul className="mb-1 max-h-32 list-inside list-disc overflow-y-auto font-mono text-[11px] text-[var(--text-dim)]">
                    {fetchResult.changed.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
              {fetchResult.added.length > 0 && (
                <div className="text-[11px] text-[var(--text-dim)]">
                  <span className="text-sky-400">{fetchResult.added.length} model(s) added</span> that were not in
                  your table (legacy models — they only matter if your sessions used them):{' '}
                  <span className="font-mono">{fetchResult.added.map((a) => a.split(' ')[0]).join(', ')}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
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
            const known = draft[model] ?? DEFAULT_PRICES[model];
            // An unpriced model that is in use still gets a row — that is the
            // only way to give it a price. Costs read "—" until it has one.
            const row = known ?? (inUse.has(model) ? NO_PRICE : null);
            if (!row) return null;
            return (
              <tr key={model} className="border-t border-[var(--border)]">
                <td
                  className={`py-1 pr-2 font-mono ${known ? '' : 'text-amber-400'} ${inUse.has(model) ? '' : 'opacity-50'}`}
                  title={known ? undefined : 'Used by your sessions but not priced — its cost reads “—” until you fill this in'}
                >
                  {model}
                </td>
                {COLS.map(([key]) => (
                  <td key={key} className="px-2 py-0.5 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={key === 'cacheWrite5m' ? cacheWrite5mRate(row) : (row[key] ?? 0)}
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
        prices) — on a subscription this is not actual spend. Claude Code writes caches at both TTLs: <b>1h</b> in a
        session, <b>5m</b> in a subagent, and each message is priced at the one it actually used. Session and daily
        totals only ever see 1h writes.
      </p>
    </div>
  );
}
