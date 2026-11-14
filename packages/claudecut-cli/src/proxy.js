const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { optimizeRequest } = require('./optimizer');
const { UsageCollector } = require('./usage');
const { Ledger } = require('./ledger');

const DASHBOARD_HTML = path.join(__dirname, 'dashboard.html');
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'content-length'];
const agents = { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) };

function isMessagesCall(method, pathname) {
  return method === 'POST' && /\/v1\/messages(\/count_tokens)?$/.test(pathname);
}

class ClaudeCutProxy {
  /**
   * options.upstream     Anthropic base URL (default https://api.anthropic.com)
   * options.port         preferred port; the next free port is used if busy
   * options.mode         'optimize' (default) or 'measure' (pass-through, only measures)
   * options.budget       USD; requests are refused once the session spends this much
   * options.compression  overrides for optimizer DEFAULTS
   */
  constructor(options = {}) {
    this.port = options.port ?? 9876;
    this.host = '127.0.0.1';
    this.upstream = new URL(options.upstream || 'https://api.anthropic.com');
    this.mode = options.mode === 'measure' ? 'measure' : 'optimize';
    this.compression = options.compression || {};
    this.ledger = options.ledger || new Ledger({ budget: options.budget ?? null, persist: options.persist !== false, mode: this.mode });
    this.server = null;
    this.sseClients = new Set();
    this.ledger.on('update', row => this._broadcast({ type: 'request', row, snapshot: this.ledger.snapshot() }));
  }

  get stats() { return this.ledger.totals; }
  get url() { return `http://${this.host}:${this.port}`; }
  get dashboardUrl() { return `${this.url}/__claudecut`; }

  _broadcast(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of this.sseClients) res.write(data);
  }

  _serveDashboard(req, res, pathname) {
    if (pathname === '/__claudecut/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: this.ledger.snapshot() })}\n\n`);
      this.sseClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(ping); this.sseClients.delete(res); });
      return;
    }
    if (pathname === '/__claudecut/api/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(this.ledger.snapshot()));
    }
    fs.readFile(DASHBOARD_HTML, (err, html) => {
      res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(err ? 'dashboard missing' : html);
    });
  }

  _handle(req, res) {
    const incoming = new URL(req.url, this.url);
    if (incoming.pathname === '/' && req.method === 'GET') {
      res.writeHead(302, { Location: '/__claudecut' });
      return res.end();
    }
    if (incoming.pathname.startsWith('/__claudecut')) return this._serveDashboard(req, res, incoming.pathname);

    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => this._forward(req, res, incoming, Buffer.concat(chunks)));
  }

  _forward(req, res, incoming, body) {
    const started = Date.now();
    const messagesCall = isMessagesCall(req.method, incoming.pathname);
    const isCountTokens = incoming.pathname.endsWith('/count_tokens');
    let report = null;
    let stream = false;
    let requestedModel = null;

    if (messagesCall) {
      try {
        const payload = JSON.parse(body.toString('utf8'));
        stream = !!payload.stream;
        requestedModel = payload.model || null;
        if (!isCountTokens && this.ledger.overBudget()) {
          const message = `ClaudeCut budget reached: this session spent $${this.ledger.totals.cost.toFixed(2)} of your $${this.ledger.budget} limit. Restart with a higher --budget to continue.`;
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }));
          this.ledger.record({ model: requestedModel, status: 400, ms: 0, error: message, blocked: true });
          return;
        }
        if (this.mode === 'optimize') {
          report = optimizeRequest(payload, { compression: this.compression });
          body = Buffer.from(JSON.stringify(payload), 'utf8');
        } else {
          // Measure-only: run the optimizer on a copy just to show what it WOULD do.
          report = optimizeRequest(JSON.parse(JSON.stringify(payload)), { compression: this.compression });
          report = { ...report, charsRemoved: 0, compressed: [], breakpoints: { ...report.breakpoints, added: 0, mode: 'measure-only' } };
        }
      } catch {
        report = null; // not JSON: forward untouched
      }
    }

    const target = new URL(this.upstream.toString());
    target.pathname = (this.upstream.pathname.replace(/\/$/, '') + incoming.pathname).replace(/\/{2,}/g, '/');
    target.search = incoming.search;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.includes(k.toLowerCase())) headers[k] = v;
    headers.host = target.host;
    if (body.length) headers['content-length'] = body.length;
    // Ask for an uncompressed body so usage can be read from the stream copy.
    if (messagesCall) headers['accept-encoding'] = 'identity';

    const lib = target.protocol === 'http:' ? http : https;
    const upstreamReq = lib.request(target, { method: req.method, headers, agent: agents[target.protocol] }, upstreamRes => {
      const collector = messagesCall && !isCountTokens ? new UsageCollector(upstreamRes.headers['content-type']) : null;
      const outHeaders = { ...upstreamRes.headers };
      delete outHeaders['content-length'];
      delete outHeaders['transfer-encoding'];
      delete outHeaders.connection;
      res.writeHead(upstreamRes.statusCode, outHeaders);
      upstreamRes.on('data', chunk => {
        if (collector) collector.push(chunk);
        res.write(chunk);
      });
      upstreamRes.on('end', () => {
        res.end();
        if (collector) {
          const r = collector.finish();
          this.ledger.record({
            model: r.model || requestedModel, usage: r.usage, status: upstreamRes.statusCode,
            ms: Date.now() - started, stream, error: r.error, report
          });
        }
      });
      upstreamRes.on('error', () => res.destroy());
    });

    upstreamReq.on('error', err => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `ClaudeCut could not reach ${this.upstream.origin}: ${err.message}` } }));
      } else res.destroy();
      if (messagesCall && !isCountTokens) this.ledger.record({ model: requestedModel, status: 502, ms: Date.now() - started, error: err.message, report });
    });
    // Client pressed Esc / disconnected: stop the upstream request too.
    res.on('close', () => { if (!res.writableEnded) upstreamReq.destroy(); });

    upstreamReq.end(body);
  }

  start() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryListen = () => {
        this.server = http.createServer((req, res) => this._handle(req, res));
        this.server.once('error', err => {
          if (err.code === 'EADDRINUSE' && attempts < 20) { attempts++; this.port++; tryListen(); }
          else reject(err);
        });
        this.server.listen(this.port, this.host, () => {
          this.port = this.server.address().port;
          resolve(this.url);
        });
      };
      tryListen();
    });
  }

  stop() {
    for (const res of this.sseClients) res.end();
    this.sseClients.clear();
    if (this.server) this.server.close();
    for (const a of Object.values(agents)) a.destroy();
  }
}

module.exports = { ClaudeCutProxy };
