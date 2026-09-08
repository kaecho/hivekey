'use strict';

// One registry drives validation, the routing API and dashboard strategy cards.
const STRATEGY_DEFINITIONS = [
  { id: 'auto', label: 'Automatic', description: 'Switches policy per request using health, concurrency and response type.', group: 'smart' },
  { id: 'adaptive', label: 'Smart (adaptive)', description: 'Balances recent health, first-token latency, throughput and channel weight.', group: 'smart' },
  { id: 'latency_aware', label: 'Latency aware', description: 'Balances predicted queue time and generation speed without concentrating all traffic on one key.', group: 'smart' },
  { id: 'reliability_first', label: 'Reliability first', description: 'Strongly favors recently healthy keys while retaining exploration and load balancing.', group: 'smart' },
  { id: 'power_of_two', label: 'Power of two choices', description: 'Samples two weighted candidates and chooses the less loaded, faster one.', group: 'smart' },
  { id: 'round_robin', label: 'Round robin', description: 'Cycles through active keys in fixed order.', group: 'classic' },
  { id: 'random', label: 'Random', description: 'Picks a uniformly random active key.', group: 'classic' },
  { id: 'weighted', label: 'Weighted', description: 'Random pick biased by channel weight.', group: 'classic' },
  { id: 'least_inflight', label: 'Least in-flight', description: 'Prefers the key with the fewest requests in flight.', group: 'classic' },
  { id: 'lowest_latency', label: 'Lowest latency', description: 'Prefers the key with the lowest recent average latency.', group: 'classic' },
  { id: 'lowest_ttft', label: 'Fastest first token', description: 'Prefers the key with the lowest time to first token.', group: 'classic' },
  { id: 'highest_throughput', label: 'Highest throughput', description: 'Prefers the key with the highest tokens-per-second output.', group: 'classic' },
];
const STRATEGY_NAMES = STRATEGY_DEFINITIONS.map((s) => s.id);

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function weightedRandom(list, weightOf) {
  let total = 0;
  const weights = list.map((c) => {
    const value = weightOf(c);
    const weight = Number.isFinite(value) ? Math.max(value, 0.000001) : 0.000001;
    total += weight;
    return weight;
  });
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

function minBy(list, valueOf) {
  let best = [];
  let bestVal = Infinity;
  for (const c of list) {
    const value = valueOf(c);
    if (value < bestVal) {
      bestVal = value;
      best = [c];
    } else if (value === bestVal) best.push(c);
  }
  return best.length ? pickRandom(best) : null;
}

function healthScore(key) {
  const stats = key.stats || {};
  const requests = Number.isFinite(stats.healthRequests) ? stats.healthRequests : stats.requests || 0;
  const success = Number.isFinite(stats.healthSuccess) ? stats.healthSuccess : stats.success || 0;
  const historical = (success + 1) / (requests + 2);
  const recent = 1 - Math.min(1, Math.max(0, key.failureEwma || 0));
  return Math.max(0.01, historical * recent);
}

function adaptiveScore({ channel, key }) {
  const firstTokenMs = key.ewmaTtftMs || key.ewmaLatencyMs || 0;
  const speed = 1 / (1 + firstTokenMs / 1000);
  const throughput = 1 + Math.min(key.ewmaTps || 0, 150) / 75;
  return healthScore(key) ** 2 * speed * throughput * (channel.weight || 1) / (1 + (key.inflight || 0));
}

function latencyScore({ channel, key }, context = {}) {
  const ttft = key.ewmaTtftMs || key.ewmaLatencyMs || 500;
  const outputMs = context.maxTokens >= 4096 ? Math.min(context.maxTokens, 131072) / (key.ewmaTps || 30) * 1000 : 0;
  const predicted = (ttft + outputMs) * (1 + (key.inflight || 0));
  return healthScore(key) ** 2 * (channel.weight || 1) / (1 + predicted / 1000);
}

/** Pure policy resolution: preview does not advance counters or consume probes. */
function resolveStrategy(name, candidates, context = {}) {
  const configuredStrategy = STRATEGY_NAMES.includes(name) ? name : 'adaptive';
  if (configuredStrategy !== 'auto') {
    return { configuredStrategy, effectiveStrategy: configuredStrategy, reason: 'Manually selected policy.' };
  }
  let effectiveStrategy = 'adaptive';
  let reason = 'Balanced traffic: explore healthy keys.';
  const load = candidates.reduce((n, c) => n + (c.key.inflight || 0), 0);
  if (context.attempt > 1 || candidates.some((c) => (c.key.failureEwma || 0) >= 0.25)) {
    effectiveStrategy = 'reliability_first';
    reason = 'Recent failures: prefer healthy alternatives.';
  } else if (candidates.length && load >= candidates.length) {
    effectiveStrategy = 'power_of_two';
    reason = 'High concurrency: spread active requests.';
  } else if (context.maxTokens >= 4096) {
    effectiveStrategy = 'latency_aware';
    reason = 'Long output: balance generation speed and queue time.';
  } else if (context.stream) {
    effectiveStrategy = 'latency_aware';
    reason = 'Streaming: prioritize first-token latency.';
  }
  return { configuredStrategy, effectiveStrategy, reason };
}

const strategies = {
  round_robin: (list, pool) => [...list].sort((a, b) => a.key.id.localeCompare(b.key.id))[pool.nextRoundRobin() % list.length],
  random: (list) => pickRandom(list),
  weighted: (list) => weightedRandom(list, (c) => c.channel.weight || 1),
  least_inflight: (list) => minBy(list, (c) => c.key.inflight || 0),
  lowest_latency: (list) => minBy(list, (c) => c.key.ewmaLatencyMs || 0),
  lowest_ttft: (list) => minBy(list, (c) => c.key.ewmaTtftMs || c.key.ewmaLatencyMs || 0),
  highest_throughput: (list) => minBy(list, (c) => -(c.key.ewmaTps || Infinity)),
  adaptive: (list) => weightedRandom(list, adaptiveScore),
  latency_aware: (list, pool, context) => weightedRandom(list, (c) => latencyScore(c, context)),
  reliability_first: (list) => weightedRandom(list, (c) => healthScore(c.key) ** 4 * (c.channel.weight || 1) / (1 + (c.key.inflight || 0))),
  power_of_two(list) {
    if (list.length === 1) return list[0];
    const first = weightedRandom(list, (c) => c.channel.weight || 1);
    const second = weightedRandom(list.filter((c) => c !== first), (c) => c.channel.weight || 1);
    return minBy([first, second], (c) => (1 + (c.key.inflight || 0)) * (c.key.ewmaTtftMs || c.key.ewmaLatencyMs || 500) / Math.max(0.05, healthScore(c.key)));
  },
};
strategies.auto = (list, pool, context) => strategies[resolveStrategy('auto', list, context).effectiveStrategy](list, pool, context);

function selectCandidate(candidates, strategyName, pool, context = {}) {
  if (!candidates.length) return null;
  const strategy = Object.prototype.hasOwnProperty.call(strategies, strategyName) ? strategies[strategyName] : strategies.adaptive;
  return strategy(candidates, pool, context) || null;
}

module.exports = { selectCandidate, resolveStrategy, strategies, adaptiveScore, healthScore, STRATEGY_DEFINITIONS, STRATEGY_NAMES };
