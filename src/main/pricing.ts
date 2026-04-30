// Per-model Claude pricing (USD per 1,000,000 tokens).
//
// Source: https://www.anthropic.com/pricing
// Last verified: 2026-04-30
//
// Update both the rates and the verified date when Anthropic changes pricing.
// Unknown models are skipped (computeCost returns null) so drift surfaces as
// an under-report rather than silent zero-cost.

export interface UsageEntry {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

const PER_MILLION = 1_000_000;

// All members of a Claude 4.x family share rates. Add a new family object
// when a new family lands; add a new alias to FAMILY_OF when Anthropic ships
// a new minor version. Dated suffixes (-YYYYMMDD) and variant tags (e.g.
// [1m]) are stripped before lookup by `normalizeModelKey`.
const FAMILY_RATES: Record<string, ModelRates> = {
  opus4: { input: 15, output: 75, cacheRead: 1.5, cacheWrite5m: 18.75, cacheWrite1h: 30 },
  sonnet4: { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 },
  haiku4: { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 },
};

const FAMILY_OF: Record<string, keyof typeof FAMILY_RATES> = {
  'claude-opus-4': 'opus4',
  'claude-opus-4-5': 'opus4',
  'claude-opus-4-6': 'opus4',
  'claude-opus-4-7': 'opus4',
  'claude-sonnet-4': 'sonnet4',
  'claude-sonnet-4-5': 'sonnet4',
  'claude-sonnet-4-6': 'sonnet4',
  'claude-sonnet-4-7': 'sonnet4',
  'claude-haiku-4': 'haiku4',
  'claude-haiku-4-5': 'haiku4',
};

const unknownModelsLogged = new Set<string>();

export function normalizeModelKey(model: string): string {
  let key = model.trim().toLowerCase();
  // Strip trailing variant tag like "[1m]"
  key = key.replace(/\[[^\]]+\]$/, '');
  // Strip trailing -YYYYMMDD date suffix
  key = key.replace(/-\d{8}$/, '');
  return key;
}

// Claude Code marks internal/non-API messages with a sentinel model value
// (e.g. `<synthetic>` for compaction/system messages). These are not billable
// and should be skipped silently rather than logged as unknown.
const NON_BILLABLE_MODELS = new Set(['<synthetic>']);

export function computeCost(model: string, usage: UsageEntry): number | null {
  if (NON_BILLABLE_MODELS.has(model)) return null;
  const key = normalizeModelKey(model);
  const family = FAMILY_OF[key];
  const rates = family ? FAMILY_RATES[family] : undefined;
  if (!rates) {
    if (!unknownModelsLogged.has(key)) {
      unknownModelsLogged.add(key);
      // eslint-disable-next-line no-console
      console.debug(`[pricing] unknown model "${model}" (key="${key}") — skipping`);
    }
    return null;
  }

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  const cw5m = usage.cache_creation?.ephemeral_5m_input_tokens;
  const cw1h = usage.cache_creation?.ephemeral_1h_input_tokens;

  let cacheWriteCost: number;
  if (cw5m !== undefined || cw1h !== undefined) {
    cacheWriteCost =
      ((cw5m ?? 0) * rates.cacheWrite5m + (cw1h ?? 0) * rates.cacheWrite1h) / PER_MILLION;
  } else {
    const aggregate = usage.cache_creation_input_tokens ?? 0;
    cacheWriteCost = (aggregate * rates.cacheWrite5m) / PER_MILLION;
  }

  const inputCost = (inputTokens * rates.input) / PER_MILLION;
  const outputCost = (outputTokens * rates.output) / PER_MILLION;
  const cacheReadCost = (cacheReadTokens * rates.cacheRead) / PER_MILLION;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

export function _resetForTesting(): void {
  unknownModelsLogged.clear();
}
