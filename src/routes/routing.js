'use strict';
const express = require('express');
const { STRATEGY_DEFINITIONS, STRATEGY_NAMES, resolveStrategy, healthScore } = require('../scheduler');
const { maskKey } = require('../util');

function routingStatus(pool, stats) {
  return { ...pool.routingSummary(), strategyLabel: STRATEGY_DEFINITIONS.find((s) => s.id === pool.store.settings.strategy)?.label || 'Automatic', policyCounts: { ...stats.policyCounts }, lastDecision: stats.lastDecision };
}

/** Mounted behind the admin session middleware. No upstream calls in preview. */
function createRoutingRouter({ pool, store, stats }) {
  const router = express.Router();
  router.get('/', (req, res) => res.json({
    summary: routingStatus(pool, stats),
    strategies: STRATEGY_DEFINITIONS,
    channels: store.data.channels.map((ch) => pool.serializeChannel(ch)),
  }));

  router.post('/preview', (req, res) => {
    const { model = '', stream = false, maxTokens = 0, strategy = store.settings.strategy } = req.body || {};
    if (typeof model !== 'string' || model.length > 256 || typeof stream !== 'boolean' ||
        !Number.isInteger(maxTokens) || maxTokens < 0 || maxTokens > 1000000 || !STRATEGY_NAMES.includes(strategy)) {
      return res.status(400).json({ error: 'invalid routing preview parameters' });
    }
    const candidates = pool.candidates(model.trim());
    const decision = resolveStrategy(strategy, candidates, { stream, maxTokens });
    return res.json({
      ...decision,
      model: model.trim(),
      totalCandidates: candidates.length,
      priority: candidates.length ? candidates[0].channel.priority : null,
      candidates: [...candidates].sort((a, b) => healthScore(b.key) - healthScore(a.key)).slice(0, 50).map(({ channel, key }) => ({
        channelId: channel.id,
        channelName: channel.name,
        keyId: key.id,
        keyMasked: maskKey(key.key),
        priority: channel.priority,
        weight: channel.weight,
        inflight: key.inflight || 0,
        health: Math.round(healthScore(key) * 100),
        ttftMs: key.ewmaTtftMs || key.ewmaLatencyMs || 0,
        tokensPerSec: key.ewmaTps || 0,
        circuit: pool.circuits.snapshot(channel.id).state,
      })),
    });
  });

  router.post('/channels/:id/reset', (req, res) => {
    if (!pool.channelsById.has(req.params.id)) return res.status(404).json({ error: 'channel not found' });
    return res.json(pool.circuits.reset(req.params.id));
  });
  return router;
}

module.exports = { createRoutingRouter, routingStatus };
