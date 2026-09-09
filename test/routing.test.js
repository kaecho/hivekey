'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Store, DEFAULT_SETTINGS, STRATEGY_NAMES } = require('../src/store');
const { Pool } = require('../src/pool');
const { CircuitBreaker } = require('../src/circuit-breaker');
const { selectCandidate, resolveStrategy, strategies, healthScore } = require('../src/scheduler');
const { createApp } = require('../src/index');
const { closeDispatchers } = require('../src/proxy');

function candidate(id, overrides = {}) {
  return { channel: { id: 'channel-' + id, weight: 1 }, key: { id, inflight: 0, stats: { requests: 20, success: 20 }, ...overrides } };
}

function poolFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivekey-routing-'));
  const store = new Store(dir).load();
  const pool = new Pool(store, { broadcast() {} });
  t.after(() => { store.saveNow(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { pool, store };
}

function addChannel(pool, input = {}) {
  const ch = pool.createChannel({ name: 'upstream', baseUrl: 'http://127.0.0.1:1', models: ['echo'], ...input });
  pool.addKeys(ch.id, input.keys || ['sk-private-routing-key']);
  return ch;
}

test('strategy registry and settings stay in sync; auto resolves deterministically', () => {
  assert.deepEqual([...STRATEGY_NAMES].sort(), Object.keys(strategies).sort());
  const list = [candidate('a'), candidate('b')];
  assert.equal(resolveStrategy('auto', list).effectiveStrategy, 'adaptive');
  assert.equal(resolveStrategy('auto', list, { stream: true }).effectiveStrategy, 'latency_aware');
  assert.equal(resolveStrategy('auto', list, { maxTokens: 8192 }).effectiveStrategy, 'latency_aware');
  assert.equal(resolveStrategy('auto', list, { attempt: 2 }).effectiveStrategy, 'reliability_first');
  list[0].key.failureEwma = 0.5;
  assert.equal(resolveStrategy('auto', list).effectiveStrategy, 'reliability_first');
  list[0].key.failureEwma = 0;
  list[0].key.inflight = 2;
  assert.equal(resolveStrategy('auto', list).effectiveStrategy, 'power_of_two');
  assert.equal(resolveStrategy('round_robin', list).effectiveStrategy, 'round_robin');
  for (const name of STRATEGY_NAMES) assert.equal(selectCandidate([], name, {}), null);
  assert.equal(selectCandidate([list[0]], 'constructor', {}), list[0]);
});

test('power of two chooses the better of two distinct candidates', () => {
  const slow = candidate('slow', { inflight: 4, ewmaTtftMs: 1000 });
  const fast = candidate('fast', { inflight: 0, ewmaTtftMs: 100 });
  for (let n = 0; n < 30; n += 1) assert.equal(selectCandidate([slow, fast], 'power_of_two', {}), fast);
  assert.equal(selectCandidate([fast], 'power_of_two', {}), fast);
});

test('recent health recovers with successes; client errors do not poison it', (t) => {
  const { pool } = poolFixture(t);
  const ch = addChannel(pool);
  const [key] = pool.keysByChannel.get(ch.id);
  pool.markError(key, 'temporary network failure');
  assert.equal(key.failureEwma, 0.25);
  const before = healthScore(key);
  pool.markSuccess(key, 100);
  assert.equal(key.failureEwma, 0.1875);
  assert.ok(healthScore(key) > before);
  const score = healthScore(key);
  pool.markNeutralFailure(key, '404 unsupported model');
  assert.equal(healthScore(key), score);
  assert.equal(key.failureEwma, 0.1875);
});

test('channel and per-key capacity overflow to standby without over-reserving', (t) => {
  const { pool, store } = poolFixture(t);
  store.updateSettings({ maxInflightPerKey: 1 });
  const primary = addChannel(pool, { priority: 10, maxInflight: 1, keys: ['primary-1', 'primary-2'] });
  const standby = addChannel(pool, { priority: 0, keys: ['standby'] });
  const [pick] = pool.candidates('echo');
  const lease = pool.acquire(pick);
  assert.ok(lease);
  assert.equal(pool.acquire(pick), null);
  assert.equal(pool.candidates('echo')[0].channel.id, standby.id);
  pool.release(lease);
  pool.release(lease);
  assert.equal(pick.key.inflight, 0);
  assert.equal(pool.candidates('echo')[0].channel.id, primary.id);
  assert.equal(pool.candidates('different-model').length, 0);
});

test('retries can prefer another failure domain while normal routing honors priority', (t) => {
  const { pool } = poolFixture(t);
  const primary = addChannel(pool, { priority: 10 });
  const secondary = addChannel(pool, { priority: 0, keys: ['other'] });
  assert.equal(pool.candidates('echo')[0].channel.id, primary.id);
  assert.equal(pool.candidates('echo', new Set(), { avoidChannelIds: new Set([primary.id]) })[0].channel.id, secondary.id);
});

test('circuits isolate, allow one recovery probe and reject stale successes', () => {
  let now = 1000;
  const cb = new CircuitBreaker(() => ({ circuitBreakerThreshold: 2, circuitBreakerCooldownMs: 1000 }), () => {}, () => now);
  const first = cb.acquire('main');
  const stale = cb.acquire('main');
  cb.failure(first, '503');
  cb.failure(first, '503');
  assert.equal(cb.snapshot('main').state, 'open');
  assert.equal(cb.acquire('main'), null);
  cb.success(stale);
  assert.equal(cb.snapshot('main').state, 'open');
  now += 1001;
  assert.equal(cb.snapshot('main').state, 'half_open');
  const probe = cb.acquire('main');
  assert.ok(probe.probe);
  assert.equal(cb.acquire('main'), null);
  cb.release(probe); // an aborted probe does not pin the circuit
  const nextProbe = cb.acquire('main');
  cb.failure(nextProbe, '502');
  assert.equal(cb.snapshot('main').state, 'open');
  now += 1001;
  const healthy = cb.acquire('main');
  cb.success(healthy);
  cb.release(healthy);
  assert.equal(cb.snapshot('main').state, 'closed');
  assert.equal(cb.snapshot('main').failures, 0);
});

test('new settings validate limits and retain legacy persisted policy', (t) => {
  const { store } = poolFixture(t);
  assert.equal(store.settings.strategy, 'auto');
  store.updateSettings({ strategy: 'adaptive', maxInflightPerKey: -1, firstByteTimeoutMs: 0, preferDifferentChannel: 'false', maxAttempts: 100000 });
  assert.equal(store.settings.maxInflightPerKey, 0);
  assert.equal(store.settings.firstByteTimeoutMs, DEFAULT_SETTINGS.firstByteTimeoutMs);
  assert.equal(store.settings.preferDifferentChannel, true);
  assert.equal(store.settings.maxAttempts, 3);
  store.saveNow();
  const restored = new Store(store.dataDir).load();
  assert.equal(restored.settings.strategy, 'adaptive');
});

async function fixture(t, upstreams = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivekey-failover-'));
  const ctx = createApp({ dataDir: dir, adminUsername: 'admin', adminPassword: 'routing-test-only', sessionSecret: 'routing-session', globalProxy: '' });
  const servers = [];
  async function listen(handler) {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  t.after(async () => {
    ctx.shutdown();
    for (const server of servers) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await closeDispatchers();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = await listen(ctx.app);
  const urls = [];
  for (const handler of upstreams) urls.push(await listen(handler));
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'routing-test-only' }) });
  const { token } = await login.json();
  const client = ctx.auth.createAccessToken('routing-fixture');
  const admin = async (url, body) => {
    const res = await fetch(base + '/api' + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const request = (body = {}, options = {}) => fetch(base + (options.path || '/v1/chat/completions'), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + client.token },
    body: JSON.stringify({ model: 'echo', messages: [{ role: 'user', content: 'hello' }], ...body }), signal: options.signal,
  });
  return { ...ctx, base, urls, admin, request };
}

function success(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 'chat-1', model: 'echo', choices: [{ message: { role: 'assistant', content: 'recovered' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
}

test('routing diagnostics require auth; preview is masked and side-effect-free; batch actions validate', async (t) => {
  const ctx = await fixture(t);
  const ch = addChannel(ctx.pool);
  const [key] = ctx.pool.keysByChannel.get(ch.id);
  const unauthorized = await fetch(ctx.base + '/api/routing');
  assert.equal(unauthorized.status, 401);
  await unauthorized.text();
  const before = ctx.pool._rrCounter;
  const preview = await ctx.admin('/routing/preview', { model: 'echo', stream: true, strategy: 'auto' });
  assert.equal(preview.data.effectiveStrategy, 'latency_aware');
  assert.equal(preview.data.totalCandidates, 1);
  assert.ok(!JSON.stringify(preview.data).includes(key.key));
  assert.equal(ctx.pool._rrCounter, before);
  assert.equal(key.inflight, 0);
  assert.equal(ctx.pool.circuits.entries.size, 0);
  assert.equal((await ctx.admin('/routing/preview', { stream: 'yes' })).status, 400);
  assert.equal((await ctx.admin('/keys/batch', { ids: [key.id], action: 'delete-everything' })).status, 400);
  assert.equal(key.enabled, true);
  assert.deepEqual((await ctx.admin('/keys/batch', { ids: [key.id, key.id, 'missing'], action: 'disable' })).data, { updated: 1, skipped: 1 });
  assert.equal(key.enabled, false);
  assert.equal((await ctx.admin('/routing/preview', { model: 'echo' })).data.totalCandidates, 0);
  await ctx.admin('/keys/batch', { ids: [key.id], action: 'enable' });
  assert.equal(key.enabled, true);
});

test('5xx failures switch channels transparently, open a circuit and record the decision', async (t) => {
  let failedHits = 0;
  const ctx = await fixture(t, [(req, res) => { failedHits += 1; res.writeHead(503); res.end('maintenance'); }, success]);
  const main = addChannel(ctx.pool, { baseUrl: ctx.urls[0], priority: 10, keys: ['main-one', 'main-two'] });
  addChannel(ctx.pool, { name: 'standby', baseUrl: ctx.urls[1], priority: 0, keys: ['standby-key'] });
  ctx.store.updateSettings({ circuitBreakerThreshold: 1 });
  const response = await ctx.request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'recovered');
  assert.equal(response.headers.get('x-pool-attempts'), '2');
  assert.equal(response.headers.get('x-pool-strategy'), 'reliability_first');
  assert.equal(response.headers.get('x-pool-failover'), 'true');
  assert.ok(response.headers.get('x-pool-request-id'));
  assert.equal(ctx.pool.circuits.snapshot(main.id).state, 'open');
  const second = await ctx.request();
  await second.text();
  assert.equal(second.headers.get('x-pool-attempts'), '1');
  assert.equal(failedHits, 1);
  assert.equal(ctx.stats.totals.recovered, 1);
  const logs = await ctx.admin('/logs?retried=true');
  assert.equal(logs.data.length, 1);
  assert.equal(logs.data[0].routing.effectiveStrategy, 'reliability_first');
  await ctx.admin(`/routing/channels/${main.id}/reset`, {});
  assert.equal(ctx.pool.circuits.snapshot(main.id).state, 'closed');
});

for (const protocol of ['openai', 'anthropic']) {
  test(`first-byte timeout fails over before committing ${protocol} streaming headers`, async (t) => {
    const ctx = await fixture(t, [
      (req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); },
      (req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"recovered"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      },
    ]);
    addChannel(ctx.pool, { baseUrl: ctx.urls[0], priority: 10 });
    addChannel(ctx.pool, { baseUrl: ctx.urls[1], priority: 0 });
    ctx.store.updateSettings({ firstByteTimeoutMs: 100 });
    const response = await ctx.request({ stream: true, max_tokens: 100 }, { path: protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-pool-attempts'), '2');
    const body = await response.text();
    assert.equal((body.match(/recovered/g) || []).length, 1);
    assert.ok(protocol === 'anthropic' ? body.includes('message_stop') : body.includes('[DONE]'));
    assert.equal(ctx.stats.logs[0].retriesDetail[0].error, 'first byte timeout');
    assert.ok(ctx.store.data.keys.every((k) => k.inflight === 0));
  });
}

test('a partially forwarded stream is never retried', async (t) => {
  let backupHits = 0;
  const ctx = await fixture(t, [
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
      setTimeout(() => res.destroy(), 40);
    },
    (req, res) => { backupHits += 1; success(req, res); },
  ]);
  addChannel(ctx.pool, { baseUrl: ctx.urls[0], priority: 10 });
  addChannel(ctx.pool, { baseUrl: ctx.urls[1], priority: 0 });
  const response = await ctx.request({ stream: true });
  assert.equal(response.headers.get('x-pool-attempts'), '1');
  await assert.rejects(response.text());
  assert.equal(backupHits, 0);
  assert.equal(ctx.stats.logs[0].status, 'error');
  assert.ok(ctx.store.data.keys.every((k) => k.inflight === 0));
});

test('all attempts share one deadline instead of multiplying request timeout', async (t) => {
  const stall = (req, res) => { res.writeHead(200); res.flushHeaders(); };
  const ctx = await fixture(t, [stall, stall]);
  addChannel(ctx.pool, { baseUrl: ctx.urls[0], priority: 10 });
  addChannel(ctx.pool, { baseUrl: ctx.urls[1], priority: 0 });
  ctx.store.updateSettings({ firstByteTimeoutMs: 800, requestTimeoutMs: 1000 });
  const start = Date.now();
  const response = await ctx.request();
  await response.text();
  assert.equal(response.status, 504);
  assert.ok(Date.now() - start < 1600);
  assert.ok(ctx.store.data.keys.every((k) => k.inflight === 0));
  const lastKey = ctx.store.data.keys[1];
  assert.equal(lastKey.stats.healthRequests, 0, 'shared deadline must not poison backup health');
  assert.equal(ctx.pool.circuits.snapshot(lastKey.channelId).failures, 0);
});

for (const firstByteTimeoutMs of [1000, 2000]) {
  test(`shared deadline wins when the first-byte budget is ${firstByteTimeoutMs}ms`, async (t) => {
    const ctx = await fixture(t, [(req, res) => { res.writeHead(200); res.flushHeaders(); }]);
    const ch = addChannel(ctx.pool, { baseUrl: ctx.urls[0] });
    ctx.store.updateSettings({ firstByteTimeoutMs, requestTimeoutMs: 1000 });
    const response = await ctx.request();
    await response.text();
    assert.equal(response.status, 504);
    assert.equal(ctx.stats.logs[0].error, 'request deadline exceeded');
    const [key] = ctx.pool.keysByChannel.get(ch.id);
    assert.equal(key.inflight, 0);
    assert.equal(key.stats.healthRequests, 0);
    assert.equal(ctx.pool.circuits.snapshot(ch.id).failures, 0);
  });
}

test('404 on the final attempt does not cool or disable a healthy key', async (t) => {
  const ctx = await fixture(t, [(req, res) => { res.writeHead(404); res.end('model unavailable'); }]);
  const ch = addChannel(ctx.pool, { baseUrl: ctx.urls[0] });
  ctx.store.updateSettings({ maxAttempts: 1 });
  const response = await ctx.request();
  assert.equal(response.status, 404);
  await response.text();
  const [key] = ctx.pool.keysByChannel.get(ch.id);
  assert.equal(ctx.pool.keyStatus(key), 'active');
  assert.equal(key.failureEwma, 0);
  assert.equal(ctx.pool.circuits.snapshot(ch.id).state, 'closed');
});

test('client cancellation before first byte releases capacity without punishing keys', async (t) => {
  let arrived;
  const received = new Promise((resolve) => { arrived = resolve; });
  const ctx = await fixture(t, [(req, res) => { res.writeHead(200); res.flushHeaders(); arrived(); }]);
  const ch = addChannel(ctx.pool, { baseUrl: ctx.urls[0] });
  const controller = new AbortController();
  const pending = ctx.request({}, { signal: controller.signal });
  await received;
  controller.abort();
  await assert.rejects(pending);
  for (let attempt = 0; attempt < 30 && !ctx.stats.logs.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const [key] = ctx.pool.keysByChannel.get(ch.id);
  assert.equal(key.inflight, 0);
  assert.equal(key.stats.failed, 0);
  assert.equal(ctx.pool.circuits.snapshot(ch.id).failures, 0);
  assert.equal(ctx.stats.logs[0].status, 'aborted');
  assert.equal(ctx.stats.logs[0].error, 'client disconnected before completion');
  // a client walk-away is not a request failure
  assert.equal(ctx.stats.totals.failed, 0);
  assert.equal(ctx.stats.totals.aborted, 1);
  const day = ctx.store.data.usage[Store.dayKey()];
  assert.equal(day.failed, 0);
  assert.equal(day.aborted, 1);
});

test('client disconnect mid-stream records an abort without punishing the key', async (t) => {
  const ctx = await fixture(t, [(req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"par"}}]}\n\n');
    // stall: never end, so only the client can close this response
  }]);
  const ch = addChannel(ctx.pool, { baseUrl: ctx.urls[0] });
  const controller = new AbortController();
  const pending = ctx.request({ stream: true }, { signal: controller.signal });
  const response = await pending;
  const reader = response.body.getReader();
  await reader.read(); // first SSE chunk forwarded downstream
  controller.abort();
  await reader.cancel().catch(() => {});
  for (let attempt = 0; attempt < 50 && !ctx.stats.logs.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const [key] = ctx.pool.keysByChannel.get(ch.id);
  assert.equal(key.inflight, 0);
  assert.equal(key.stats.failed, 0);
  assert.equal(key.failureEwma, 0);
  assert.equal(ctx.pool.circuits.snapshot(ch.id).failures, 0);
  assert.equal(ctx.stats.logs[0].status, 'aborted');
  assert.equal(ctx.stats.logs[0].error, 'client disconnected mid-response');
  assert.equal(ctx.stats.totals.failed, 0);
  assert.equal(ctx.stats.totals.aborted, 1);
  const day = ctx.store.data.usage[Store.dayKey()];
  assert.equal(day.failed, 0);
  assert.equal(day.aborted, 1);
});

test('an open circuit is probed by the next real request after the cooldown', async (t) => {
  let hits = 0;
  const flaky = (req, res) => {
    hits += 1;
    if (hits === 1) { res.writeHead(503); res.end('maintenance'); return; }
    success(req, res);
  };
  const ctx = await fixture(t, [flaky]);
  const ch = addChannel(ctx.pool, { baseUrl: ctx.urls[0] });
  ctx.store.updateSettings({ maxAttempts: 1, circuitBreakerThreshold: 1, circuitBreakerCooldownMs: 1000, cooldownErrorBaseMs: 1000, cooldownMaxMs: 1000 });
  const failed = await ctx.request();
  await failed.text();
  assert.equal(failed.status, 503);
  assert.equal(ctx.pool.circuits.snapshot(ch.id).state, 'open');

  // while the circuit cools down the channel gets no traffic at all
  const during = await ctx.request();
  await during.text();
  assert.equal(during.status, 503);
  assert.equal(hits, 1);

  // after the cooldown the next real request becomes the single recovery probe
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const probe = await ctx.request();
  assert.equal(probe.status, 200);
  assert.equal((await probe.json()).choices[0].message.content, 'recovered');
  assert.equal(hits, 2, 'exactly one probe request reached the upstream');
  assert.equal(ctx.pool.circuits.snapshot(ch.id).state, 'closed');
  assert.equal(ctx.stats.logs[0].status, 'success');
});

test('channel health protection is independent from HTTP retry policy', async (t) => {
  const ctx = await fixture(t, [(req, res) => { res.writeHead(503); res.end('unavailable'); }]);
  const ch = addChannel(ctx.pool, { baseUrl: ctx.urls[0] });
  ctx.store.updateSettings({ retryOn: [], circuitBreakerThreshold: 1 });
  const response = await ctx.request();
  assert.equal(response.status, 503);
  await response.text();
  assert.equal(ctx.pool.circuits.snapshot(ch.id).state, 'open');
  assert.equal(ctx.stats.logs[0].attempts, 1);
});

test('recreated channel circuits reject outcomes from removed channel instances', () => {
  const cb = new CircuitBreaker(() => ({ circuitBreakerThreshold: 1, circuitBreakerCooldownMs: 1000 }));
  const oldTicket = cb.acquire('reused-id');
  cb.entries.delete('reused-id');
  const fresh = cb.acquire('reused-id');
  cb.failure(oldTicket, 'stale failure');
  assert.equal(cb.snapshot('reused-id').state, 'closed');
  cb.failure(fresh, 'fresh failure');
  assert.equal(cb.snapshot('reused-id').state, 'open');
});

test('pool.diagnoseCandidates distinguishes channel and key causes', () => {
  const store = {
    settings: { maxInflightPerKey: 2, circuitBreakerThreshold: 1, circuitBreakerCooldownMs: 10000 },
    data: {
      channels: [
        { id: 'ch1', name: 'main', enabled: true, priority: 0, models: ['test-model'], maxInflight: 0 },
      ],
      keys: [
        { id: 'k1', channelId: 'ch1', enabled: false, autoDisabled: true, cooldownUntil: 0, inflight: 0, stats: {} },
      ],
    },
    save: () => {},
  };
  const pool = new Pool(store);
  const diagAutoDisabled = pool.diagnoseCandidates('test-model');
  assert.equal(diagAutoDisabled.type, 'key');
  assert.match(diagAutoDisabled.detail, /auto-disabled/);

  store.data.keys[0].autoDisabled = false;
  const diagDisabled = pool.diagnoseCandidates('test-model');
  assert.equal(diagDisabled.type, 'key');
  assert.equal(diagDisabled.detail, 'all keys are disabled');

  store.data.keys[0].enabled = true;
  store.data.keys[0].cooldownUntil = Date.now() + 5000;
  const diagCooldown = pool.diagnoseCandidates('test-model');
  assert.equal(diagCooldown.type, 'key');
  assert.match(diagCooldown.detail, /all active keys are in cooldown/);

  store.data.keys[0].cooldownUntil = 0;
  store.data.channels[0].enabled = false;
  const diagChDisabled = pool.diagnoseCandidates('test-model');
  assert.equal(diagChDisabled.type, 'channel');
  assert.equal(diagChDisabled.detail, 'all matching channels are disabled');
});
