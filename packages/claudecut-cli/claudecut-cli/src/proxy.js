const http = require('http');
const https = require('https');
const { URL } = require('url');
const { compressToolResult } = require('./large-repo/outputCompressor');
const { pruneIdleHistory } = require('./large-repo/historyWindow');

class ClaudeCutProxy {
  constructor(options = {}) {
    this.port = options.port || 9876;
    this.upstream = options.upstream || 'https://api.anthropic.com';
    this.server = null;
    this.stats = {
      totalRequests: 0,
      tokensSavedEstimate: 0
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

    // 2. LARGE REPO ENGINE: Compress Giant Tool Outputs & Prune Idle History
    if (Array.isArray(payload.messages)) {
      // Prune idle historical turns older than 4 turns back
      payload.messages = pruneIdleHistory(payload.messages);

      payload.messages.forEach(msg => {
        if (typeof msg.content === 'string') {
          msg.content = this.pruneContent(msg.content);
        } else if (Array.isArray(msg.content)) {
          msg.content.forEach(b => {
            if (b && b.text) {
              b.text = this.pruneContent(b.text);
            }
            // If it's a tool result (e.g. huge git diff or file read)
            if (b && b.type === 'tool_result' && typeof b.content === 'string') {
              b.content = compressToolResult(this.pruneContent(b.content));
            }
          });
        }
      });
    }

    // 3. Ephemeral Prompt Caching Checkpoints (90% discount on cache reads)
    let breakpoints = 0;
    const EPHEMERAL = { type: 'ephemeral' };

    // Breakpoint 1: System prompt
    if (payload.system) {
      if (typeof payload.system === 'string' && payload.system.length > 500) {
        payload.system = [{ type: 'text', text: payload.system, cache_control: EPHEMERAL }];
        breakpoints++;
      } else if (Array.isArray(payload.system) && payload.system.length > 0) {
        const last = payload.system[payload.system.length - 1];
        if (last && typeof last === 'object' && !last.cache_control) {
          last.cache_control = EPHEMERAL;
          breakpoints++;
        }
      }
    }

    // Breakpoint 2: Tool schemas
    if (breakpoints < 4 && Array.isArray(payload.tools) && payload.tools.length > 0) {
      const lastTool = payload.tools[payload.tools.length - 1];
      if (lastTool && typeof lastTool === 'object' && !lastTool.cache_control) {
        lastTool.cache_control = EPHEMERAL;
        breakpoints++;
      }
    }

    // Breakpoints 3 & 4: Conversation History Turns
    if (breakpoints < 4 && Array.isArray(payload.messages) && payload.messages.length >= 3) {
      const targetIndices = [payload.messages.length - 2];
      if (payload.messages.length >= 5 && breakpoints < 3) {
        targetIndices.unshift(payload.messages.length - 4);
      }

      for (const idx of targetIndices) {
        if (breakpoints >= 4) break;
        const msg = payload.messages[idx];
        if (!msg) continue;

        if (typeof msg.content === 'string') {
          msg.content = [{ type: 'text', text: msg.content, cache_control: EPHEMERAL }];
          breakpoints++;
        } else if (Array.isArray(msg.content) && msg.content.length > 0) {
          const lastBlock = msg.content[msg.content.length - 1];
          if (lastBlock && typeof lastBlock === 'object' && !lastBlock.cache_control) {
            lastBlock.cache_control = EPHEMERAL;
            breakpoints++;
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
              let parsed = JSON.parse(reqBody.toString('utf8'));
              parsed = this.optimizePayload(parsed);
              reqBody = Buffer.from(JSON.stringify(parsed), 'utf8');
              isJson = true;
              this.stats.totalRequests++;
            } catch (err) {
              // pass through unmodified
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
              res.end(JSON.stringify({ error: 'Proxy error', details: err.message }));
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
