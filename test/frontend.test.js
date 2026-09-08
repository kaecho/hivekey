'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STRATEGY_DEFINITIONS } = require('../src/scheduler');

async function dictionary() {
  const text = fs.readFileSync(path.join(__dirname, '../public/js/locales/zh-cn.js'), 'utf8');
  return (await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'))).default;
}

test('CSV export quotes values, preserves Unicode and neutralizes spreadsheet formulas', async () => {
  const { logsToCsv } = await import('../public/js/log-export.mjs');
  const csv = logsToCsv([{ id: 'req-1', ts: 1, model: '=HYPERLINK("unsafe")', channelName: '测试,渠道', error: '  +SUM(1,2)', routing: { effectiveStrategy: 'auto' } }]);
  assert.ok(csv.startsWith('\uFEFF"Request ID"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""unsafe"")"'));
  assert.ok(csv.includes('"\'  +SUM(1,2)"'));
  assert.ok(csv.includes('"测试,渠道"'));
  assert.ok(csv.includes('"auto"'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(logsToCsv([]).includes('Key (masked)'));
});

test('strategy labels and descriptions all have Chinese translations', async () => {
  const dict = await dictionary();
  for (const strategy of STRATEGY_DEFINITIONS) {
    assert.ok(dict[strategy.label], strategy.label);
    assert.ok(dict[strategy.description], strategy.description);
  }
});

test('literal UI translation keys and static accessibility labels are covered', async () => {
  const dict = await dictionary();
  const missing = new Set();
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'locales') walk(file);
        continue;
      }
      if (!/\.(js|html)$/.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\b(?:t|toast)\(\s*'((?:\\.|[^'\\])*)'\s*[,)]/g)) {
        const key = match[1].replace(/\\'/g, "'");
        if (!dict[key]) missing.add(key);
      }
      for (const match of source.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) {
        if (!dict[match[1]]) missing.add(match[1]);
      }
    }
  }
  walk(path.join(__dirname, '../public'));
  assert.deepEqual([...missing], []);
});
