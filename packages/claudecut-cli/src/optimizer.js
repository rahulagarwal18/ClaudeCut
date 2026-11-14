/**
 * ClaudeCut request optimizer.
 *
 * Rules that keep it safe on big, long Claude Code sessions:
 *
 *  1. NEVER edit assistant messages. On current models (Opus 5.5, Sonnet 5.5, Fable 5.x)
 *     editing the model's own past output breaks its preserved thinking.
 *  2. Every transform is DETERMINISTIC and depends only on the block's own content,
 *     never on its position in the conversation. The same tool output is rewritten
 *     the same way on every turn, so the prompt prefix stays byte-identical and the
 *     prompt cache keeps hitting.
 *  3. Never touch file contents the model may later edit (Read / Edit / Write results).
 *  4. Respect the 4 cache_control breakpoint limit, counting the client's own.
 */

const EPHEMERAL = { type: 'ephemeral' };
const MAX_BREAKPOINTS = 4;

const DEFAULTS = {
  // Tool results from these tools are never rewritten (exact file text matters for edits).
  protectedTools: ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'TodoWrite', 'ExitPlanMode'],
  maxLines: 300,        // compress tool output longer than this...
  maxChars: 40000,      // ...or larger than this
  headLines: 80,
  tailLines: 80,
  keepSignalLines: 40   // error/warning lines rescued from the omitted middle
};

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const SIGNAL = /\b(error|errors|fail|failed|failure|exception|traceback|panic|fatal|warn|warning|denied|cannot|undefined|assert)\b|✗|✖/i;
const estTokens = chars => Math.ceil(chars / 4);

/** Collapse runs of identical lines ("line" x 500 -> "line" + note). */
function collapseRepeats(lines) {
  const out = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const run = j - i;
    out.push(lines[i]);
    if (run > 3) out.push(`[ClaudeCut: previous line repeated ${run - 1} more times]`);
    else for (let k = 1; k < run; k++) out.push(lines[i]);
    i = j;
  }
  return out;
}

/** Deterministic compression of one tool-output string. Returns the same string if nothing to do. */
function compressText(text, opts = DEFAULTS) {
  if (typeof text !== 'string' || text.length === 0) return text;

  let t = text.replace(ANSI, '').replace(/[ \t]+$/gm, '').replace(/\n{4,}/g, '\n\n\n');
  let lines = collapseRepeats(t.split('\n'));

  if (lines.length > opts.maxLines || t.length > opts.maxChars) {
    const head = lines.slice(0, opts.headLines);
    const tail = lines.slice(Math.max(opts.headLines, lines.length - opts.tailLines));
    const middle = lines.slice(opts.headLines, Math.max(opts.headLines, lines.length - opts.tailLines));
    const signal = middle.filter(l => SIGNAL.test(l)).slice(0, opts.keepSignalLines).map(l => l.slice(0, 400));
    const omitted = middle.length - signal.length;
    lines = [
      ...head,
      `... [ClaudeCut: ${omitted} lines of output omitted${signal.length ? `; ${signal.length} error/warning lines kept below` : ''}. Re-run the command with a filter (grep, head, tail) if you need them.] ...`,
      ...signal,
      ...(signal.length ? ['... [ClaudeCut: end of kept lines] ...'] : []),
      ...tail
    ];
  }

  // Cap absurdly long single lines (minified JSON, base64...)
  lines = lines.map(l => (l.length > 4000 ? l.slice(0, 2000) + ` ... [ClaudeCut: ${l.length - 2000} chars of this line omitted]` : l));
  const result = lines.join('\n');
  return result.length < text.length ? result : text;
}

function describeToolUse(block) {
  const input = (block && block.input) || {};
  const detail = input.file_path || input.command || input.pattern || input.url || input.path || input.query || input.description || '';
  return { name: block.name || 'tool', detail: String(detail).replace(/\s+/g, ' ').slice(0, 140) };
}

function blockChars(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) return content.reduce((n, b) => n + (b && typeof b.text === 'string' ? b.text.length : b && b.type === 'image' ? 6000 : 0), 0);
  return 0;
}

function countBreakpoints(payload) {
  let n = payload.cache_control ? 1 : 0;
  const visit = blocks => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      if (b.cache_control) n++;
      if (Array.isArray(b.content)) visit(b.content);
    }
  };
  if (Array.isArray(payload.system)) visit(payload.system);
  visit(payload.tools);
  if (Array.isArray(payload.messages)) payload.messages.forEach(m => visit(m && m.content));
  return n;
}

const CACHEABLE = new Set(['text', 'image', 'document', 'tool_result', 'tool_use']);

/**
 * Optimize an Anthropic Messages request body IN PLACE.
 * Returns a report describing exactly what was done (shown on the dashboard).
 */
function optimizeRequest(payload, options = {}) {
  const opts = { ...DEFAULTS, ...(options.compression || {}) };
  const protectedSet = new Set(opts.protectedTools);
  const report = {
    compressed: [],          // [{tool, detail, charsBefore, charsAfter}]
    charsRemoved: 0,
    breakpoints: { existing: 0, added: 0, mode: 'none' },
    context: { systemChars: 0, toolsChars: 0, messageChars: 0, toolResultChars: 0, messages: 0 },
    hogs: []                 // biggest tool results in this request (after optimization)
  };
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) return report;

  // Map tool_use id -> {name, detail} from assistant turns (read-only).
  const toolUses = new Map();
  for (const msg of payload.messages) {
    if (msg && msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const b of msg.content) if (b && b.type === 'tool_use') toolUses.set(b.id, describeToolUse(b));
    }
  }

  // 1. Deterministic tool-output compression (user-side tool_result blocks only).
  if (options.compress !== false) {
    for (const msg of payload.messages) {
      if (!msg || msg.role !== 'user' || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (!block || block.type !== 'tool_result') continue;
        const info = toolUses.get(block.tool_use_id) || { name: 'tool', detail: '' };
        if (protectedSet.has(info.name)) continue;

        const before = blockChars(block.content);
        if (typeof block.content === 'string') {
          block.content = compressText(block.content, opts);
        } else if (Array.isArray(block.content)) {
          for (const inner of block.content) {
            if (inner && inner.type === 'text' && typeof inner.text === 'string') inner.text = compressText(inner.text, opts);
          }
        }
        const after = blockChars(block.content);
        if (after < before) {
          report.compressed.push({ tool: info.name, detail: info.detail, charsBefore: before, charsAfter: after });
          report.charsRemoved += before - after;
        }
      }
    }
  }

  // 2. Prompt-cache breakpoints, never exceeding the API limit of 4.
  const existing = countBreakpoints(payload);
  report.breakpoints.existing = existing;
  if (options.cache === false) {
    report.breakpoints.mode = 'disabled';
  } else if (existing > 0) {
    // The client (e.g. Claude Code) already manages caching. Adding more would only
    // risk the "maximum of 4 blocks with cache_control" 400 error.
    report.breakpoints.mode = 'client-managed';
  } else {
    let added = 0;
    const mark = block => {
      if (added >= MAX_BREAKPOINTS || !block || typeof block !== 'object' || !CACHEABLE.has(block.type)) return false;
      if (block.type === 'text' && !block.text) return false;
      block.cache_control = EPHEMERAL;
      added++;
      return true;
    };
    if (Array.isArray(payload.tools) && payload.tools.length) {
      const last = payload.tools[payload.tools.length - 1];
      if (last && typeof last === 'object') { last.cache_control = EPHEMERAL; added++; }
    }
    if (typeof payload.system === 'string' && payload.system.length > 0) {
      payload.system = [{ type: 'text', text: payload.system }];
    }
    if (Array.isArray(payload.system) && payload.system.length) mark(payload.system[payload.system.length - 1]);
    // Last user message: caches the whole conversation so far for the next turn.
    const lastMsg = payload.messages[payload.messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      if (typeof lastMsg.content === 'string' && lastMsg.content.length > 0) {
        lastMsg.content = [{ type: 'text', text: lastMsg.content }];
      }
      if (Array.isArray(lastMsg.content)) {
        for (let i = lastMsg.content.length - 1; i >= 0; i--) if (mark(lastMsg.content[i])) break;
      }
    }
    report.breakpoints.added = added;
    report.breakpoints.mode = added ? 'added-by-claudecut' : 'none';
  }

  // 3. Context breakdown + biggest context hogs (what is filling the context window).
  const c = report.context;
  c.systemChars = typeof payload.system === 'string' ? payload.system.length
    : Array.isArray(payload.system) ? payload.system.reduce((n, b) => n + ((b && b.text) || '').length, 0) : 0;
  c.toolsChars = Array.isArray(payload.tools) ? JSON.stringify(payload.tools).length : 0;
  c.messages = payload.messages.length;
  const hogs = [];
  for (const msg of payload.messages) {
    if (!msg) continue;
    if (typeof msg.content === 'string') { c.messageChars += msg.content.length; continue; }
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (!b) continue;
      if (b.type === 'tool_result') {
        const n = blockChars(b.content);
        c.toolResultChars += n;
        const info = toolUses.get(b.tool_use_id) || { name: 'tool', detail: '' };
        hogs.push({ tool: info.name, detail: info.detail, tokens: estTokens(n) });
      } else if (typeof b.text === 'string') c.messageChars += b.text.length;
      else if (typeof b.thinking === 'string') c.messageChars += b.thinking.length;
      else if (b.type === 'tool_use') c.messageChars += JSON.stringify(b.input || {}).length;
    }
  }
  report.hogs = hogs.filter(h => h.tokens >= 200).sort((a, b) => b.tokens - a.tokens).slice(0, 8);
  return report;
}

module.exports = { optimizeRequest, compressText, countBreakpoints, estTokens, DEFAULTS };
