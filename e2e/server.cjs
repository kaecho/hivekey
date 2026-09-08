'use strict';
// Local-only browser fixture. All credentials and traffic below are synthetic.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../src/index');
const { closeDispatchers } = require('../src/proxy');

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivekey-ui-'));
  const upstream = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'claude-sonnet' }, { id: 'gemini-pro' }] }));
    return res.end(JSON.stringify({ id: 'ui-completion', choices: [{ message: { role: 'assistant', content: 'Hello from the test upstream' }, finish_reason: 'stop' }], usage: { prompt_tokens: 24, completion_tokens: 12 } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const ctx = createApp({ dataDir, adminUsername: 'admin', adminPassword: 'ui-test-password', sessionSecret: 'ui-test-session-secret', globalProxy: '' });
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const channels = [
    { name: 'Primary · East', priority: 10, models: ['gpt-*', 'claude-*'], maxInflight: 20 },
    { name: 'Fallback · West', priority: 5, models: ['gpt-*', 'claude-*', 'gemini-*'], maxInflight: 10 },
    { name: 'Development', priority: 0, models: [], maxInflight: 4 },
  ].map((input, i) => {
    const channel = ctx.pool.createChannel({ ...input, baseUrl: url });
    ctx.pool.addKeys(channel.id, [`sk-ui-fixture-${i}-aaa`, `sk-ui-fixture-${i}-bbb`, `sk-ui-fixture-${i}-ccc`]);
    for (const key of ctx.pool.keysByChannel.get(channel.id)) {
      key.stats = { ...key.stats, requests: 240 + i * 30, success: 235 + i * 30, failed: 5 };
      key.ewmaLatencyMs = 120 + i * 45;
      key.ewmaTtftMs = 340 + i * 75;
      key.ewmaTps = 42 + i * 5;
    }
    return channel;
  });
  const now = Date.now();
  for (let n = 180; n > 0; n -= 1) {
    const ts = now - n * 5000;
    const channel = channels[n % channels.length];
    const entry = {
      id: 'req-ui-' + n, ts, method: 'POST', path: '/v1/chat/completions', model: n % 3 === 0 ? 'claude-sonnet' : 'gpt-4o',
      channelId: channel.id, channelName: channel.name, keyId: 'fixture-key', keyMasked: 'sk-ui…aaa',
      attempts: n % 9 === 0 ? 2 : 1, latencyMs: 500 + (n % 10) * 31, ttftMs: 300 + n % 100, tokensPerSec: 44,
      status: n % 23 === 0 ? 'error' : 'success', statusCode: n % 23 === 0 ? 503 : 200,
      error: n % 23 === 0 ? 'upstream temporarily unavailable' : null, promptTokens: 124, completionTokens: 88,
      routing: { configuredStrategy: 'auto', effectiveStrategy: n % 9 === 0 ? 'reliability_first' : 'latency_aware', reason: n % 9 === 0 ? 'Recent failures: prefer healthy alternatives.' : 'Streaming: prioritize first-token latency.' },
      retriesDetail: n % 9 === 0 ? [{ channelName: 'Primary · East', keyMasked: 'sk-ui…bbb', statusCode: 503, error: 'maintenance' }] : [],
    };
    ctx.stats.requestFinished(entry);
    ctx.store.recordDaily(entry);
  }
  // Seed historical chart buckets without relying on wall-clock sleeps.
  for (let minute = 59; minute >= 0; minute -= 1) {
    const b = ctx.stats._bucket(now - minute * 60000);
    b.requests = 8 + (minute * 7 % 19);
    b.failed = minute % 7 === 0 ? 2 : 0;
    b.success = b.requests - b.failed;
  }
  ctx.auth.createAccessToken('Development application');
  const server = ctx.app.listen(Number(process.env.UI_TEST_PORT || 3377), '127.0.0.1');
  const stop = async () => {
    ctx.shutdown();
    server.closeAllConnections?.();
    upstream.closeAllConnections?.();
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => upstream.close(resolve)), closeDispatchers()]);
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((error) => { console.error(error); process.exit(1); });
