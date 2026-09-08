import { circuitBadge } from './ui.js';
import { refreshRoutingStatus } from './views/routing.js';
import { $, $$, api, cssEsc, store } from './core.js';
import { t } from '../i18n.js';
import { renderDashStats, renderLiveTable, renderRecentTable } from './views/dashboard.js';
import { drawHistoryChart } from './chart.js';
import { keyBadgeHtml } from './views/keys.js';
import { fetchLogs, logMatchesFilters, renderLogsTable } from './views/logs.js';

export function connectSSE() {
  disconnectSSE();
  const url = '/api/events' + (store.auth.token ? '?token=' + encodeURIComponent(store.auth.token) : '');
  let es;
  try {
    es = new EventSource(url); // same-origin: session cookie is sent automatically
  } catch (e) {
    scheduleReconnect();
    return;
  }
  store.sse.es = es;

  es.onopen = () => {
    store.sse.connected = true;
    store.sse.retryMs = 1000;
    renderConnStatus();
  };

  es.addEventListener('snapshot', (e) => { safeJson(e, handleSnapshot); });
  es.addEventListener('request', (e) => { safeJson(e, handleRequestEvent); });
  es.addEventListener('keys', (e) => { safeJson(e, handleKeysEvent); });
  es.addEventListener('routing', (event) => safeJson(event, (data) => {
    const channel = store.channels.find((ch) => ch.id === data.channelId);
    if (channel) channel.circuit = data.circuit;
    const badge = document.querySelector('[data-channel-circuit="' + cssEsc(data.channelId) + '"]');
    if (badge) badge.innerHTML = data.circuit.state === 'closed' ? '' : circuitBadge(data.circuit);
    refreshRoutingStatus().catch(() => {});
  }));
  es.addEventListener('overview', (e) => { safeJson(e, handleOverviewEvent); });

  es.onerror = () => {
    store.sse.connected = false;
    renderConnStatus();
    es.close();
    if (store.sse.es === es) store.sse.es = null;
    if (store.auth.username !== null) scheduleReconnect();
  };
}

export function scheduleReconnect() {
  if (store.sse.timer) clearTimeout(store.sse.timer);
  store.sse.timer = setTimeout(connectSSE, store.sse.retryMs);
  store.sse.retryMs = Math.min(store.sse.retryMs * 2, 30000);
}

export function disconnectSSE() {
  if (store.sse.timer) { clearTimeout(store.sse.timer); store.sse.timer = null; }
  if (store.sse.es) { store.sse.es.close(); store.sse.es = null; }
  store.sse.connected = false;
  renderConnStatus();
}

export function safeJson(e, fn) {
  try { fn(JSON.parse(e.data)); } catch (err) { /* malformed event — ignore */ }
}

export function renderConnStatus() {
  const el = $('#conn-status');
  if (!el) return;
  el.classList.toggle('connected', store.sse.connected);
  el.querySelector('.conn-text').textContent = store.sse.connected ? t('Live') : t('Disconnected');
}

export function handleSnapshot(d) {
  if (d.overview) store.overview = d.overview;
  store.live.clear();
  (d.live || []).forEach((en) => { if (en && en.id) store.live.set(en.id, en); });
  if (store.route === 'dashboard') {
    renderDashStats();
    drawHistoryChart();
    renderLiveTable();
  }
  if (store.route === 'logs' && !store.logsPaused) fetchLogs();
}

export function handleRequestEvent(d) {
  const entry = d && d.entry;
  if (!entry || !entry.id) return;
  if (d.phase === 'start' || d.phase === 'attempt' || d.phase === 'retry') {
    store.live.set(entry.id, entry);
    if (store.route === 'dashboard') { renderLiveTable(); renderDashStats(); }
  } else if (d.phase === 'end') {
    store.live.delete(entry.id);
    store.recent.unshift(entry);
    if (store.recent.length > 15) store.recent.length = 15;
    if (store.route === 'dashboard') {
      renderLiveTable();
      renderRecentTable();
      renderDashStats();
    } else if (store.route === 'logs' && !store.logsPaused && logMatchesFilters(entry)) {
      if (store.logFetchTail) store.logFetchTail.push(entry);
      store.logs = [entry, ...store.logs.filter((log) => log.id !== entry.id)];
      const lim = Number(store.logFilters.limit) || 100;
      if (store.logs.length > lim) store.logs.length = lim;
      renderLogsTable();
    }
  }
}

export function handleKeysEvent(d) {
  if (!d || !d.keyId) return;
  const list = store.keysByChannel[d.channelId];
  if (list) {
    const k = list.find((x) => x.id === d.keyId);
    if (k) {
      k.status = d.status;
      k.cooldownUntil = d.cooldownUntil;
      if (typeof d.enabled === 'boolean') k.enabled = d.enabled;
    }
  }
  // Patch badges in place (key panel and/or edit modal) — avoids clobbering inputs.
  $$('[data-key-badge="' + cssEsc(d.keyId) + '"]').forEach((badge) => {
    badge.outerHTML = keyBadgeHtml({ id: d.keyId, status: d.status, cooldownUntil: d.cooldownUntil });
  });
}

export function handleOverviewEvent(d) {
  if (!d) return;
  // Same shape as /api/overview totals+rpm+keyCounts — merge, keep history.
  store.overview = Object.assign({}, store.overview || {}, d);
  if (store.route === 'dashboard') renderDashStats();
}
