const http = require('http');
const https = require('https');
const { URL } = require('url');
const { LocalPersistentState } = require('./memory-engine/persistentState');
const { distillMessages } = require('./memory-engine/contextDistiller');

class ClaudeCutProxy {
  constructor(options = {}) {
    this.port = options.port || 9876;
    this.upstream = options.upstream || 'https://api.anthropic.com';
    this.server = null;
    this.state = new LocalPersistentState();
    this.stats = {
      totalRequests: 0,
      totalPayloadSizeCut: 0
    };
  }

  pruneContent(text) {
    if (typeof text !== 'string') return text;
    let pruned = text.replace(/[ \t]+$/gm, '');
    pruned = pruned.replace(/\n{3,}/g, '\n\n');
    pruned = pruned.replace(/([=\-\*\_~#]){15,}/g, '$1$1$1$1$1$1$1$1$1$1');
    return pruned;
  }

  optimizePayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;

    // 1. Minify whitespace in system prompt
    if (payload.system) {
      if (typeof payload.system === 'string') {
        payload.system = this.pruneContent(payload.system);
      } else if (Array.isArray(payload.system)) {
        payload.system.forEach(block => {
          if (block && block.text) block.text = this.pruneContent(block.text);
        });
      }
    }

    // 2. TOKEN FIREWALL & LOCAL MEMORY WINDOW
    // Caps massive tool outputs and keeps messages strictly capped to a 4-turn distilled window
    if (Array.isArray(payload.messages)) {
      payload.messages = distillMessages(payload.messages, this.state);
    }

    // 3. Ephemeral Prompt Caching Checkpoints (90% off)
    const EPHEMERAL = { type: 'ephemeral' };

    // Breakpoint on System Prompt
    if (payload.system) {
      if (typeof payload.system === 'string' && payload.system.length > 500) {
        payload.system = [{ type: 'text', text: payload.system, cache_control: EPHEMERAL }];
      } else if (Array.isArray(payload.system) && payload.system.length > 0) {
        const last = payload.system[payload.system.length - 1];
        if (last && typeof last === 'object' && !last.cache_control) {
          last.cache_control = EPHEMERAL;
        }
      }
    }

    // Breakpoint on Tool Schemas
    if (Array.isArray(payload.tools) && payload.tools.length > 0) {
      const lastTool = payload.tools[payload.tools.length - 1];
      if (lastTool && typeof lastTool === 'object' && !lastTool.cache_control) {
        lastTool.cache_control = EPHEMERAL;
      }
    }

    // Breakpoint on the last conversation turn
    if (Array.isArray(payload.messages) && payload.messages.length >= 2) {
      const targetMsg = payload.messages[payload.messages.length - 2];
      if (targetMsg) {
        if (typeof targetMsg.content === 'string') {
          targetMsg.content = [{ type: 'text', text: targetMsg.content, cache_control: EPHEMERAL }];
        } else if (Array.isArray(targetMsg.content) && targetMsg.content.length > 0) {
          const lastBlock = targetMsg.content[targetMsg.content.length - 1];
          if (lastBlock && typeof lastBlock === 'object' && !lastBlock.cache_control) {
            lastBlock.cache_control = EPHEMERAL;
          }
        }
      }
    }

    return payload;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const upstreamUrl = new URL(req.url, this.upstream);

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          let reqBody = Buffer.concat(chunks);
          let isJson = false;

          if (req.method === 'POST' && req.url.includes('/v1/messages')) {
            try {
              const originalLen = reqBody.length;
              let parsed = JSON.parse(reqBody.toString('utf8'));
              parsed = this.optimizePayload(parsed);
              reqBody = Buffer.from(JSON.stringify(parsed), 'utf8');
              isJson = true;
              this.stats.totalRequests++;
              this.stats.totalPayloadSizeCut += Math.max(0, originalLen - reqBody.length);
            } catch (err) {
              // pass through unmodified on parse error
            }
          }

          const headers = { ...req.headers };
          delete headers.host;
          headers['host'] = upstreamUrl.hostname;
          if (isJson) {
            headers['content-length'] = Buffer.byteLength(reqBody);
            if (!headers['anthropic-beta']) {
              headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
            }
          }

          const proxyReq = https.request(
            upstreamUrl,
            {
              method: req.method,
              headers: headers,
              timeout: 180000
            },
            proxyRes => {
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
              proxyRes.pipe(res);
            }
          );

          proxyReq.on('error', err => {
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'ClaudeCut Proxy Error', details: err.message }));
            }
          });

          if (reqBody.length > 0) {
            proxyReq.write(reqBody);
          }
          proxyReq.end();
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${this.port}`);
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { ClaudeCutProxy };
