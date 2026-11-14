/**
 * Anthropic first-party API prices, USD per 1M tokens.
 * Cache reads default to 0.1x input, 5-minute cache writes to 1.25x input,
 * 1-hour cache writes to 2x input, unless a model lists its own cache-read price.
 *
 * If you use Claude Code with a Pro/Max subscription you are not billed per token;
 * the dashboard then shows the API-equivalent cost.
 */
const PRICES = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-mythos-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-mythos-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  // Haiku 5.5: $0.10 / $0.50 up to 100K prompt tokens, $0.50 / $2.50 beyond.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, longPrompt: { above: 100000, input: 0.5, output: 2.5 } },
  'claude-haiku-4-5': { input: 1, output: 5 }
};

// Longest key first so 'claude-opus-5-5' wins over 'claude-opus-5'.
const KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

function priceFor(model) {
  if (typeof model !== 'string') return null;
  const m = model.toLowerCase();
  const key = KEYS.find(k => m === k || m.startsWith(k + '-') || m.startsWith(k + '[') || m.startsWith(k + '@'));
  return key ? { model: key, ...PRICES[key] } : null;
}

/**
 * usage = Anthropic `usage` object. Returns null when the model's price is unknown.
 * actual   = what this request cost
 * noCache  = what it would have cost if every input token were billed at the full input price
 */
function costOf(model, usage) {
  const p = priceFor(model);
  if (!p || !usage) return null;

  const uncached = usage.input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const out = usage.output_tokens || 0;
  const write1h = (usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens) || 0;
  const write5m = Math.max(0, write - write1h);
  const totalIn = uncached + read + write;

  let inP = p.input;
  let outP = p.output;
  if (p.longPrompt && totalIn > p.longPrompt.above) {
    inP = p.longPrompt.input;
    outP = p.longPrompt.output;
  }
  const speed = usage.speed === 'fast' ? 2 : 1;
  const readP = (p.cacheRead !== undefined && inP === p.input ? p.cacheRead : inP * 0.1);

  const M = 1e6;
  const actual = speed * (uncached * inP + read * readP + write5m * inP * 1.25 + write1h * inP * 2 + out * outP) / M;
  const noCache = speed * (totalIn * inP + out * outP) / M;
  // Average price actually paid per input token in this request (used to value trimmed tokens fairly).
  const inputSpend = speed * (uncached * inP + read * readP + write5m * inP * 1.25 + write1h * inP * 2) / M;
  const effectiveInputRate = totalIn > 0 ? inputSpend / totalIn : inP / M;

  return { actual, noCache, cacheSavings: noCache - actual, effectiveInputRate, pricedAs: p.model };
}

module.exports = { PRICES, priceFor, costOf };
