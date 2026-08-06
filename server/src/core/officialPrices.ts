import type { ModelPrices, PriceTable } from '@claude-history/shared';

// Anthropic publishes no pricing API (the Models API has capabilities but no
// prices). The docs, however, are served as raw markdown/MDX by appending
// `.md` — the "Model pricing" table there is the official source:
//   | Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
// This is scraping documentation, NOT a stable API contract: parse
// defensively and fail loudly so the UI falls back to manual editing.
export const PRICING_DOCS_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';

const MIN_EXPECTED_MODELS = 4;
const FETCH_TIMEOUT_MS = 15_000;

/** "Claude Opus 4.8" → "claude-opus-4-8"; "Claude Opus 4" → "claude-opus-4-0". */
export function modelIdFromName(rawName: string): string | null {
  let name = rawName.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // strip md links
  name = name.replace(/\(.*?\)/g, ''); // strip parentheticals (retired notes)
  name = name.replace(/\b(through|starting)\b.*$/i, ''); // strip date qualifiers
  const m = /^\s*Claude\s+(opus|sonnet|haiku|fable|mythos)\s+([\d.]+)/i.exec(name.trim());
  if (!m) return null;
  const family = m[1].toLowerCase();
  const version = m[2];
  // Only the Claude 4 generation uses the -0 alias for bare majors
  // (claude-opus-4-0, claude-sonnet-4-0); Claude 5+ ids are plain
  // (claude-opus-5, claude-sonnet-5).
  const ver = version === '4' && (family === 'opus' || family === 'sonnet') ? '4-0' : version.replace(/\./g, '-');
  return `claude-${family}-${ver}`;
}

function parseMoney(cell: string): number | null {
  const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(cell);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function parseQualifierDate(text: string, kind: 'through' | 'starting'): Date | null {
  const m = new RegExp(`${kind}\\s+([A-Za-z]+\\s+\\d{1,2},\\s*\\d{4})`, 'i').exec(text);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Is this row's price valid right now? (e.g. Sonnet 5 intro vs standard rows) */
function rowValidNow(rawName: string, now: Date): boolean {
  const through = parseQualifierDate(rawName, 'through');
  if (through) {
    through.setHours(23, 59, 59, 999);
    return now <= through;
  }
  const starting = parseQualifierDate(rawName, 'starting');
  if (starting) return now >= starting;
  return true;
}

export function parsePricingMarkdown(markdown: string, now = new Date()): PriceTable {
  const sectionStart = markdown.indexOf('## Model pricing');
  if (sectionStart < 0) throw new Error('Section "## Model pricing" not found — docs format changed');
  const rest = markdown.slice(sectionStart + 1);
  const nextHeading = rest.search(/\n## /);
  const section = nextHeading > 0 ? rest.slice(0, nextHeading) : rest;

  const tableLines = section.split('\n').filter((l) => l.trim().startsWith('|'));
  if (tableLines.length < 3) throw new Error('Pricing table not found — docs format changed');

  const splitRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  const header = splitRow(tableLines[0]);
  const col = (needle: string) => header.findIndex((h) => h.toLowerCase().includes(needle));
  const cInput = col('base input');
  const cWrite1h = col('1h cache');
  const cRead = col('cache hits');
  const cOutput = col('output');
  if (cInput < 0 || cWrite1h < 0 || cRead < 0 || cOutput < 0) {
    throw new Error('Pricing table columns changed — expected Base Input / 1h Cache Writes / Cache Hits / Output');
  }

  const table: PriceTable = {};
  for (const line of tableLines.slice(1)) {
    const cells = splitRow(line);
    if (cells.length <= Math.max(cInput, cWrite1h, cRead, cOutput)) continue;
    if (/^[-\s:]+$/.test(cells[0])) continue; // separator row
    const rawName = cells[0];
    const id = modelIdFromName(rawName);
    if (!id || !rowValidNow(rawName, now)) continue;
    const prices: ModelPrices = {
      input: parseMoney(cells[cInput]) ?? -1,
      output: parseMoney(cells[cOutput]) ?? -1,
      cacheRead: parseMoney(cells[cRead]) ?? -1,
      cacheWrite: parseMoney(cells[cWrite1h]) ?? -1,
    };
    if (Object.values(prices).some((v) => v < 0)) continue; // unparseable row — skip
    table[id] = prices; // later valid rows for the same id overwrite earlier ones
  }

  if (Object.keys(table).length < MIN_EXPECTED_MODELS) {
    throw new Error(`Parsed only ${Object.keys(table).length} models — docs format may have changed`);
  }
  return table;
}

/**
 * User-triggered ONLY (the "Fetch current prices" button). This is the single
 * outbound network call in the whole app — never run it automatically.
 */
export async function fetchOfficialPrices(): Promise<{ prices: PriceTable; source: string; fetchedAt: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PRICING_DOCS_URL, {
      signal: controller.signal,
      headers: { 'user-agent': 'claude-history (local personal tool)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching pricing docs`);
    const markdown = await res.text();
    return {
      prices: parsePricingMarkdown(markdown),
      source: PRICING_DOCS_URL,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
