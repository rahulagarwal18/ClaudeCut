const http = require('http');
const { countBreakpoints } = require('../src/optimizer');

const E = { type: 'ephemeral' };

/** A request shaped like the ones Claude Code sends (it sets its own cache breakpoints). */
function claudeCodeRequest({ turns = 3, bigBash = false, stream = true } = {}) {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Fix the failing tests in this big repo' }] }];
  for (let i = 0; i < turns; i++) {
    messages.push({ role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'sig' + i },
      { type: 'text', text: `Step ${i}:   checking things   \n\n\n\n` },
      { type: 'tool_use', id: 'read' + i, name: 'Read', input: { file_path: `src/file${i}.js` } },
      { type: 'tool_use', id: 'bash' + i, name: 'Bash', input: { command: 'npm test' } }
    ] });
    const bashOut = bigBash
      ? Array.from({ length: 2000 }, (_, k) => (k === 1234 ? 'FAIL src/auth.test.js: expected 200, got 500' : `\x1b[32m✓\x1b[0m test ${k} passed   `)).join('\n')
      : 'all good';
    messages.push({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'read' + i, content: Array.from({ length: 900 }, (_, k) => `${k}\tconst x${k} = ${k};   `).join('\n') },
      { type: 'tool_result', tool_use_id: 'bash' + i, content: bashOut }
    ] });
  }
  messages[messages.length - 1].content[1].cache_control = E;
  return {
    model: 'claude-opus-5-5', max_tokens: 32000, stream,
    system: [{ type: 'text', text: 'You are Claude Code.' }, { type: 'text', text: 'x'.repeat(3000), cache_control: E }],
    tools: [{ name: 'Read', input_schema: { type: 'object' } }, { name: 'Bash', input_schema: { type: 'object' } }],
    messages
  };
}

/** Mock Anthropic API that rejects requests the real API would reject. */
function mockAnthropic() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      received.push({ url: req.url, headers: req.headers, body });
      const fail = msg => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: msg } })); };

      const n = countBreakpoints(body);
      if (n > 4) return fail(`A maximum of 4 blocks with cache_control may be provided. Found ${n}.`);
      const ids = new Set();
      for (const m of body.messages || []) {
        if (m.role === 'assistant' && Array.isArray(m.content)) m.content.forEach(b => b.type === 'tool_use' && ids.add(b.id));
        if (m.role === 'user' && Array.isArray(m.content)) {
          for (const b of m.content) if (b.type === 'tool_result' && !ids.has(b.tool_use_id)) return fail(`unexpected tool_use_id found in tool_result blocks: ${b.tool_use_id}`);
        }
      }
      if (req.url.endsWith('/count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"input_tokens":1234}'); }

      const usage = { input_tokens: 50, cache_read_input_tokens: 90000, cache_creation_input_tokens: 2000, output_tokens: 0 };
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
        ev('message_start', { message: { id: 'msg_1', model: body.model, usage } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } });
        // split a frame across two writes to exercise the line buffer
        const tail = `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 400 } })}\n\n`;
        res.write(tail.slice(0, 30));
        setTimeout(() => { res.write(tail.slice(30)); ev('message_stop', {}); res.end(); }, 5);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_1', model: body.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { ...usage, output_tokens: 400 } }));
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}` })));
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'test', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

module.exports = { claudeCodeRequest, mockAnthropic, post, E };
