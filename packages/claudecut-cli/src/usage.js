/**
 * Reads the real `usage` numbers out of an Anthropic Messages response while it
 * streams to the client. Works for both SSE (stream: true) and plain JSON bodies.
 * The response itself is passed through untouched; this only observes a copy.
 */
class UsageCollector {
  constructor(contentType) {
    this.isSSE = /text\/event-stream/i.test(contentType || '');
    this.buffer = '';
    this.body = '';
    this.model = null;
    this.usage = {};
    this.stopReason = null;
    this.error = null;
  }

  push(chunk) {
    const text = chunk.toString('utf8');
    if (!this.isSSE) {
      if (this.body.length < 5e6) this.body += text;
      return;
    }
    this.buffer += text;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.startsWith('data:')) this._event(line.slice(5).trim());
    }
  }

  _event(data) {
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === 'message_start' && ev.message) {
      this.model = ev.message.model || this.model;
      Object.assign(this.usage, ev.message.usage || {});
    } else if (ev.type === 'message_delta') {
      // message_delta usage is cumulative; only copy fields that are present.
      for (const [k, v] of Object.entries(ev.usage || {})) if (v !== null && v !== undefined) this.usage[k] = v;
      if (ev.delta && ev.delta.stop_reason) this.stopReason = ev.delta.stop_reason;
    } else if (ev.type === 'error') {
      this.error = (ev.error && ev.error.message) || 'stream error';
    }
  }

  finish() {
    if (this.isSSE) {
      if (this.buffer.trim().startsWith('data:')) this._event(this.buffer.trim().slice(5).trim());
    } else if (this.body) {
      try {
        const j = JSON.parse(this.body);
        if (j.type === 'error' || j.error) this.error = (j.error && j.error.message) || JSON.stringify(j).slice(0, 300);
        if (j.model) this.model = j.model;
        if (j.usage) Object.assign(this.usage, j.usage);
        if (j.stop_reason) this.stopReason = j.stop_reason;
      } catch {
        if (!this.error && this.body.length < 2000) this.error = this.body.trim() || null;
      }
    }
    return { model: this.model, usage: this.usage, stopReason: this.stopReason, error: this.error };
  }
}

module.exports = { UsageCollector };
