/**
 * Session ledger: every API call with its real usage, cost, and what ClaudeCut did.
 * Feeds the live dashboard and is saved (metrics only, never prompt content)
 * to ~/.claudecut/sessions/<id>.jsonl for `claudecut report`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { costOf } = require('./pricing');

const SESSIONS_DIR = path.join(os.homedir(), '.claudecut', 'sessions');

class Ledger extends EventEmitter {
  constructor({ budget = null, persist = true, project = process.cwd(), mode = 'optimize' } = {}) {
    super();
    this.id = new Date().toISOString().replace(/[:.]/g, '-');
    this.startedAt = Date.now();
    this.budget = budget;
    this.project = project;
    this.mode = mode;
    this.requests = [];
    this.totals = this._emptyTotals();
    this.lastContext = null;
    this.file = null;
    if (persist) {
      try {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        this.file = path.join(SESSIONS_DIR, `${this.id}.jsonl`);
      } catch { this.file = null; }
    }
  }

  _emptyTotals() {
    return {
      requests: 0, errors: 0, blockedByBudget: 0,
      input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
      cost: 0, costNoCache: 0, cacheSavings: 0,
      trimmedTokens: 0, trimmedSavings: 0, compressedOutputs: 0,
      unpriced: 0
    };
  }

  overBudget() {
    return this.budget !== null && this.totals.cost >= this.budget;
  }

  record(entry) {
    const u = entry.usage || {};
    const cost = entry.status < 400 ? costOf(entry.model, u) : null;
    // A failed request saved nothing, so it never counts as trimmed.
    const trimmedTokens = entry.status < 400 ? Math.round((entry.report ? entry.report.charsRemoved : 0) / 4) : 0;
    let error = entry.error || null;
    if (entry.status === 401) error = `${error || 'Unauthorized'}. Check your API key: set ANTHROPIC_API_KEY, or log in with "claude /login".`;
    if (entry.status === 429) error = `${error || 'Rate limited'}. Anthropic rate limit: wait a moment and retry.`;
    const row = {
      t: Date.now(),
      model: entry.model || 'unknown',
      status: entry.status,
      ms: entry.ms,
      stream: !!entry.stream,
      error,
      input: u.input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      output: u.output_tokens || 0,
      cost: cost ? cost.actual : null,
      costNoCache: cost ? cost.noCache : null,
      cacheSavings: cost ? cost.cacheSavings : null,
      trimmedTokens,
      // Trimmed tokens are valued at the average input rate actually paid in this request.
      trimmedSavings: cost ? trimmedTokens * cost.effectiveInputRate : null,
      compressed: entry.report ? entry.report.compressed : [],
      breakpoints: entry.report ? entry.report.breakpoints : null,
      blocked: !!entry.blocked
    };

    const T = this.totals;
    T.requests++;
    if (row.blocked) T.blockedByBudget++;
    if (row.status >= 400) T.errors++;
    T.input += row.input; T.cacheRead += row.cacheRead; T.cacheWrite += row.cacheWrite; T.output += row.output;
    if (cost) {
      T.cost += row.cost; T.costNoCache += row.costNoCache; T.cacheSavings += row.cacheSavings;
      T.trimmedSavings += row.trimmedSavings;
    } else if (row.status < 400) T.unpriced++;
    T.trimmedTokens += trimmedTokens;
    if (row.status < 400) T.compressedOutputs += row.compressed.length;

    if (entry.report && entry.report.context) {
      // realTokens: exact input size Anthropic reported, used to correct the chars/4 estimates.
      const real = row.status < 400 ? row.input + row.cacheRead + row.cacheWrite : 0;
      this.lastContext = { ...entry.report.context, hogs: entry.report.hogs, model: row.model, t: row.t, realTokens: real || null };
    }

    this.requests.push(row);
    if (this.requests.length > 1000) this.requests.shift();
    if (this.file) {
      try { fs.appendFileSync(this.file, JSON.stringify(row) + '\n'); } catch {}
    }
    this.emit('update', row);
    return row;
  }

  snapshot() {
    return {
      id: this.id, startedAt: this.startedAt, budget: this.budget, project: this.project, mode: this.mode,
      totals: this.totals, lastContext: this.lastContext, requests: this.requests.slice(-200)
    };
  }
}

function loadSessions(limit = 20) {
  let files = [];
  try { files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse().slice(0, limit); } catch { return []; }
  return files.map(f => {
    const rows = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const sum = k => rows.reduce((n, r) => n + (r[k] || 0), 0);
    return { id: f.replace('.jsonl', ''), requests: rows.length, cost: sum('cost'), cacheSavings: sum('cacheSavings'), trimmedSavings: sum('trimmedSavings'), trimmedTokens: sum('trimmedTokens') };
  });
}

module.exports = { Ledger, loadSessions, SESSIONS_DIR };
