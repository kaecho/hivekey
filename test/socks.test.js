'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { request } = require('undici');
const { createApp } = require('../src/index');
const {
  getDispatcher,
  closeDispatchers,
  isSocksProxy,
  parseSocksProxy,
} = require('../src/proxy');

describe('SOCKS proxy unit tests', () => {
  test('isSocksProxy detects socks schemes', () => {
    assert.strictEqual(isSocksProxy('socks5://127.0.0.1:1080'), true);
    assert.strictEqual(isSocksProxy('socks5h://127.0.0.1:1080'), true);
    assert.strictEqual(isSocksProxy('socks://127.0.0.1:1080'), true);
    assert.strictEqual(isSocksProxy('socks4://127.0.0.1:1080'), true);
    assert.strictEqual(isSocksProxy('socks4a://127.0.0.1:1080'), true);
    assert.strictEqual(isSocksProxy('SOCKS5://127.0.0.1:1080'), true);
    assert.strictEqual(isSocksProxy('  socks5://localhost:1080  '), true);

    assert.strictEqual(isSocksProxy('http://127.0.0.1:7890'), false);
    assert.strictEqual(isSocksProxy('https://127.0.0.1:7890'), false);
    assert.strictEqual(isSocksProxy('ftp://127.0.0.1:1080'), false);
    assert.strictEqual(isSocksProxy(''), false);
    assert.strictEqual(isSocksProxy(null), false);
    assert.strictEqual(isSocksProxy(undefined), false);
  });

  test('parseSocksProxy parses URLs correctly', () => {
    const p1 = parseSocksProxy('socks5://127.0.0.1:1080');
    assert.deepStrictEqual(p1, {
      proxy: { host: '127.0.0.1', port: 1080, type: 5 },
      protocol: 'socks5:',
    });

    const p2 = parseSocksProxy('socks5h://alice:p%40ss@proxy.example.com:7890');
    assert.deepStrictEqual(p2, {
      proxy: { host: 'proxy.example.com', port: 7890, type: 5, userId: 'alice', password: 'p@ss' },
      protocol: 'socks5h:',
    });

    const p3 = parseSocksProxy('socks4://127.0.0.1');
    assert.deepStrictEqual(p3, {
      proxy: { host: '127.0.0.1', port: 1080, type: 4 },
      protocol: 'socks4:',
    });

    const p4 = parseSocksProxy('socks://[::1]:1080');
    assert.deepStrictEqual(p4, {
      proxy: { host: '::1', port: 1080, type: 5 },
      protocol: 'socks:',
    });

    assert.throws(() => parseSocksProxy('http://127.0.0.1:7890'), /Unsupported SOCKS protocol/);
  });
});

describe('SOCKS proxy integration tests', () => {
  let mockTarget;
  let targetPort;

  before(async () => {
    mockTarget = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-socks',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'routed via socks' } }],
      }));
    });
    await new Promise((resolve) => mockTarget.listen(0, resolve));
    targetPort = mockTarget.address().port;
  });

  after(async () => {
    await closeDispatchers();
    await new Promise((resolve) => mockTarget.close(resolve));
  });

  function createMockSocks5Server({ requireAuth = false, expectedUser, expectedPass } = {}) {
    let connectionCount = 0;
    const server = net.createServer((clientSock) => {
      connectionCount += 1;
      clientSock.once('data', () => {
        if (requireAuth) {
          // Advertise USER/PASS auth (0x02)
          clientSock.write(Buffer.from([0x05, 0x02]));
          clientSock.once('data', (auth) => {
            const ulen = auth[1];
            const user = auth.subarray(2, 2 + ulen).toString();
            const plen = auth[2 + ulen];
            const pass = auth.subarray(3 + ulen, 3 + ulen + plen).toString();
            if (user === expectedUser && pass === expectedPass) {
              clientSock.write(Buffer.from([0x01, 0x00])); // success
            } else {
              clientSock.write(Buffer.from([0x01, 0x01])); // fail
              clientSock.destroy();
              return;
            }
            handleConnectRequest(clientSock);
          });
        } else {
          // No auth (0x00)
          clientSock.write(Buffer.from([0x05, 0x00]));
          handleConnectRequest(clientSock);
        }
      });
    });

    function handleConnectRequest(clientSock) {
      clientSock.once('data', (req) => {
        const atyp = req[3];
        let host;
        let offset = 4;
        if (atyp === 1) {
          host = req.subarray(offset, offset + 4).join('.');
          offset += 4;
        } else if (atyp === 3) {
          const len = req[offset++];
          host = req.subarray(offset, offset + len).toString();
          offset += len;
        }
        const port = req.readUInt16BE(offset);
        const upstream = net.connect({ host, port }, () => {
          clientSock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          clientSock.pipe(upstream);
          upstream.pipe(clientSock);
        });
        upstream.on('error', () => clientSock.destroy());
      });
    }

    return {
      server,
      getConnectionCount: () => connectionCount,
    };
  }

  test('getDispatcher sends request through SOCKS5 proxy', async () => {
    const { server: socksServer, getConnectionCount } = createMockSocks5Server();
    await new Promise((resolve) => socksServer.listen(0, resolve));
    const socksPort = socksServer.address().port;

    try {
      const dispatcher = getDispatcher(`socks5://127.0.0.1:${socksPort}`, 5000);
      const res = await request(`http://127.0.0.1:${targetPort}/test`, { dispatcher });
      assert.strictEqual(res.statusCode, 200);
      const body = await res.body.json();
      assert.strictEqual(body.choices[0].message.content, 'routed via socks');
      assert.strictEqual(getConnectionCount(), 1);
    } finally {
      await closeDispatchers();
      await new Promise((resolve) => socksServer.close(resolve));
    }
  });

  test('getDispatcher sends request through SOCKS5h proxy with credentials', async () => {
    const { server: socksServer, getConnectionCount } = createMockSocks5Server({
      requireAuth: true,
      expectedUser: 'proxyuser',
      expectedPass: 'proxypass',
    });
    await new Promise((resolve) => socksServer.listen(0, resolve));
    const socksPort = socksServer.address().port;

    try {
      const dispatcher = getDispatcher(`socks5h://proxyuser:proxypass@127.0.0.1:${socksPort}`, 5000);
      const res = await request(`http://127.0.0.1:${targetPort}/test-auth`, { dispatcher });
      assert.strictEqual(res.statusCode, 200);
      const body = await res.body.json();
      assert.strictEqual(body.choices[0].message.content, 'routed via socks');
      assert.strictEqual(getConnectionCount(), 1);
    } finally {
      await closeDispatchers();
      await new Promise((resolve) => socksServer.close(resolve));
    }
  });

  test('full app channel routes via per-channel SOCKS5 proxy', async () => {
    const { server: socksServer, getConnectionCount } = createMockSocks5Server();
    await new Promise((resolve) => socksServer.listen(0, resolve));
    const socksPort = socksServer.address().port;

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivekey-socks-app-'));
    const { app, pool, auth } = createApp({ dataDir });

    const ch = pool.createChannel({
      name: 'socks-channel',
      baseUrl: `http://127.0.0.1:${targetPort}`,
      proxy: `socks5://127.0.0.1:${socksPort}`,
    });
    pool.addKeys(ch.id, ['sk-upstream-key-1']);
    const clientToken = auth.createAccessToken('socks-client');

    const appServer = app.listen(0);
    await new Promise((resolve) => appServer.once('listening', resolve));
    const appPort = appServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${appPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${clientToken.token}`,
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.choices[0].message.content, 'routed via socks');
      assert.ok(getConnectionCount() >= 1, 'SOCKS connection must be observed');
    } finally {
      await closeDispatchers();
      await new Promise((resolve) => appServer.close(resolve));
      await new Promise((resolve) => socksServer.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('full app channel routes via global fallback SOCKS5 proxy', async () => {
    const { server: socksServer, getConnectionCount } = createMockSocks5Server();
    await new Promise((resolve) => socksServer.listen(0, resolve));
    const socksPort = socksServer.address().port;

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivekey-socks-global-'));
    const { app, pool, auth } = createApp({
      dataDir,
      globalProxy: `socks5://127.0.0.1:${socksPort}`,
    });

    // Channel has NO per-channel proxy configured
    const ch = pool.createChannel({
      name: 'no-proxy-channel',
      baseUrl: `http://127.0.0.1:${targetPort}`,
    });
    pool.addKeys(ch.id, ['sk-upstream-key-2']);
    const clientToken = auth.createAccessToken('global-socks-client');
    const appServer = app.listen(0);
    await new Promise((resolve) => appServer.once('listening', resolve));
    const appPort = appServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${appPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${clientToken.token}`,
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.choices[0].message.content, 'routed via socks');
      assert.ok(getConnectionCount() >= 1, 'global fallback SOCKS connection must be observed');
    } finally {
      await closeDispatchers();
      await new Promise((resolve) => appServer.close(resolve));
      await new Promise((resolve) => socksServer.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
