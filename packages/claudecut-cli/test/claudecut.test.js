const test = require('node:test');
const assert = require('node:assert');
const { optimizeRequest, compressText, countBreakpoints } = require('../src/optimizer');
const { costOf } = require('../src/pricing');
const { ClaudeCutProxy } = require('../src/proxy');
const { claudeCodeRequest, mockAnthropic, post } = require('./fixtures');

const clone = o => JSON.parse(JSON.stringify(o));

test('never exceeds 4 cache breakpoints on a Claude Code request (the original bug)', () => {
  const req = claudeCodeRequest();
  const before = countBreakpoints(req);
  const report = optimizeRequest(req);
  assert.strictEqual(report.breakpoints.mode, 'client-managed');
  assert.strictEqual(countBreakpoints(req), before);
  assert.ok(countBreakpoints(req) <= 4);
});

test('adds breakpoints (max 4) when the client sets none', () => {
  const req = { model: 'claude-sonnet-5-5', system: 'sys '.repeat(500), tools: [{ name: 'a', input_schema: {} }], messages: [{ role: 'user', content: 'hello' }] };
  const report = optimizeRequest(req);
  assert.strictEqual(report.breakpoints.mode, 'added-by-claudecut');
  assert.strictEqual(countBreakpoints(req), 3);
});

test('never modifies assistant messages (preserved thinking stays valid)', () => {
  const req = claudeCodeRequest({ bigBash: true });
  const assistantsBefore = JSON.stringify(req.messages.filter(m => m.role === 'assistant'));
  optimizeRequest(req);
  assert.strictEqual(JSON.stringify(req.messages.filter(m => m.role === 'assistant')), assistantsBefore);
});

test('never rewrites Read results (file contents the model may edit)', () => {
  const req = claudeCodeRequest({ bigBash: true });
  const readBefore = req.messages[2].content[0].content;
  optimizeRequest(req);
  assert.strictEqual(req.messages[2].content[0].content, readBefore);
});

test('compresses huge Bash output but keeps the error line', () => {
  const req = claudeCodeRequest({ bigBash: true, turns: 1 });
  const report = optimizeRequest(req);
  const out = req.messages[2].content[1].content;
  assert.strictEqual(report.compressed.length, 1);
  assert.strictEqual(report.compressed[0].tool, 'Bash');
  assert.ok(out.length < 30000, `still ${out.length} chars`);
  assert.match(out, /FAIL src\/auth\.test\.js/);
  assert.doesNotMatch(out, /\x1b\[/, 'ANSI color codes removed');
});

test('deterministic: the same history is rewritten identically every turn (cache stays valid)', () => {
  const turn1 = claudeCodeRequest({ bigBash: true, turns: 2 });
  const turn2 = claudeCodeRequest({ bigBash: true, turns: 3 });
  // strip the client's moving breakpoint, which legitimately differs between turns
  const strip = r => { r.messages.forEach(m => Array.isArray(m.content) && m.content.forEach(b => delete b.cache_control)); return r; };
  optimizeRequest(turn1); optimizeRequest(turn2);
  const a = strip(clone(turn1)).messages;
  const b = strip(clone(turn2)).messages.slice(0, a.length);
  assert.deepStrictEqual(b, a);
});

test('compressText leaves small output untouched', () => {
  assert.strictEqual(compressText('line1\nline2'), 'line1\nline2');
});

test('pricing: Opus 5.5 with caching, unknown model is null', () => {
  const c = costOf('claude-opus-5-5', { input_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 0, output_tokens: 1e6 });
  assert.ok(Math.abs(c.actual - (4 + 0.2 + 20)) < 1e-9);
  assert.ok(Math.abs(c.noCache - (8 + 20)) < 1e-9);
  assert.strictEqual(costOf('some-other-model', { input_tokens: 5 }), null);
  assert.strictEqual(costOf('claude-opus-5-5-20990101', { input_tokens: 1e6 }).pricedAs, 'claude-opus-5-5');
});

test('end-to-end: Claude Code request through proxy succeeds and usage is recorded', async () => {
  const api = await mockAnthropic();
  const proxy = new ClaudeCutProxy({ port: 0, upstream: api.url, persist: false });
  proxy.port = 0;
  await proxy.start();
  try {
    const url = `http://127.0.0.1:${proxy.server.address().port}`;
    for (const stream of [true, false]) {
      const r = await post(url + '/v1/messages', claudeCodeRequest({ bigBash: true, stream }));
      assert.strictEqual(r.status, 200, r.text);
      if (stream) assert.match(r.text, /message_stop/);
    }
    const T = proxy.stats;
    assert.strictEqual(T.requests, 2);
    assert.strictEqual(T.errors, 0);
    assert.strictEqual(T.output, 800);
    assert.strictEqual(T.cacheRead, 180000);
    assert.ok(T.cost > 0 && T.cacheSavings > 0 && T.trimmedTokens > 0);
    assert.strictEqual(api.received[0].headers['accept-encoding'], 'identity');
    assert.strictEqual(api.received[0].headers['x-api-key'], 'test', 'auth header forwarded');

    const ct = await post(url + '/v1/messages/count_tokens', claudeCodeRequest({ stream: false }));
    assert.strictEqual(ct.status, 200);
    assert.strictEqual(proxy.stats.requests, 2, 'count_tokens is not billed');

    const dash = await fetch(url + '/__claudecut');
    assert.match(await dash.text(), /ClaudeCut Live/);
    const snap = await (await fetch(url + '/__claudecut/api/snapshot')).json();
    assert.ok(snap.lastContext.hogs.length > 0);
    assert.strictEqual(snap.lastContext.realTokens, 50 + 90000 + 2000, 'context panel uses real token count');
  } finally { proxy.stop(); api.server.close(); }
});

test('budget guard blocks requests once the limit is spent', async () => {
  const api = await mockAnthropic();
  const proxy = new ClaudeCutProxy({ port: 0, upstream: api.url, persist: false, budget: 0.01 });
  proxy.port = 0;
  await proxy.start();
  try {
    const url = `http://127.0.0.1:${proxy.server.address().port}`;
    assert.strictEqual((await post(url + '/v1/messages', claudeCodeRequest())).status, 200);
    const blocked = await post(url + '/v1/messages', claudeCodeRequest());
    assert.strictEqual(blocked.status, 400);
    assert.match(blocked.text, /budget reached/);
    assert.strictEqual(api.received.length, 1, 'blocked request never reached the API');
  } finally { proxy.stop(); api.server.close(); }
});

test('measure-only mode forwards the request byte-for-byte', async () => {
  const api = await mockAnthropic();
  const proxy = new ClaudeCutProxy({ port: 0, upstream: api.url, persist: false, mode: 'measure' });
  proxy.port = 0;
  await proxy.start();
  try {
    const url = `http://127.0.0.1:${proxy.server.address().port}`;
    const req = claudeCodeRequest({ bigBash: true });
    await post(url + '/v1/messages', req);
    assert.deepStrictEqual(api.received[0].body, req);
  } finally { proxy.stop(); api.server.close(); }
});
