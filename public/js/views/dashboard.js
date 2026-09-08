import { icon, pageHead, metric } from '../ui.js';
import { $, api, clearDashTimer, esc, fmtMs, fmtNum, fmtTime, fmtUptime, pct, statusBadgeHtml, store, toast, truncate } from '../core.js';
import { t } from '../../i18n.js';
import { drawHistoryChart, wireChartHover } from '../chart.js';

export function renderDailyTable() {
  const tbody = $('#daily-tbody');
  if (!tbody) return;
  const daily = (store.overview && store.overview.daily) || [];
  // newest first; always show the last 7 days, older ones only when non-empty
  const rows = daily.slice().reverse().filter((d, i) => i < 7 || d.requests > 0);
  if (!rows.length || rows.every((d) => !d.requests)) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">' + esc(t('No traffic yet')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((d) =>
    '<tr>' +
      '<td class="mono small">' + esc(d.date) + '</td>' +
      '<td class="num">' + fmtNum(d.requests) + '</td>' +
      '<td class="num ok-text">' + fmtNum(d.success) + '</td>' +
      '<td class="num' + (d.failed ? ' err-text' : '') + '">' + fmtNum(d.failed) + '</td>' +
      '<td class="num">' + fmtNum(d.promptTokens) + '</td>' +
      '<td class="num">' + fmtNum(d.completionTokens) + '</td>' +
    '</tr>'
  ).join('');
}

export function renderProblemBanner() {
  const box = $('#problem-banner');
  if (!box) return;
  const list = (store.overview && store.overview.problemKeys) || [];
  if (!list.length) { box.innerHTML = ''; return; }
  const MAX = 6;
  box.innerHTML =
    '<div class="card alert-card">' +
      '<div class="alert-head">' +
        '<span class="alert-icon">⚠</span>' +
        '<strong>' + esc(t('{n} keys need attention', { n: list.length })) + '</strong>' +
        '<span class="muted small">' + esc(t('Reset clears failures and re-enables the key.')) + '</span>' +
        '<span class="spacer"></span>' +
        '<a class="btn btn-sm" href="#/channels">' + esc(t('View channels')) + '</a>' +
      '</div>' +
      '<div class="alert-list">' +
      list.slice(0, MAX).map((p) =>
        '<div class="alert-row">' +
          '<span class="alert-ch" title="' + esc(p.channelName) + '">' + esc(p.channelName) + '</span>' +
          '<span class="mono">' + esc(p.keyMasked) + '</span>' +
          problemReasonBadge(p) +
          '<span class="muted small">' + esc(t('{failed}/{total} failed', { failed: fmtNum(p.failed), total: fmtNum(p.requests) })) + '</span>' +
          (p.lastError ? '<span class="err-cell small" title="' + esc(p.lastError) + '">' + esc(truncate(p.lastError, 60)) + '</span>' : '') +
          '<span class="spacer"></span>' +
          '<button class="btn btn-sm" data-action="problem-key-reset" data-id="' + esc(p.keyId) + '">' + esc(t('Reset')) + '</button>' +
        '</div>'
      ).join('') +
      (list.length > MAX ? '<div class="alert-more muted small">' + esc(t('+{n} more…', { n: list.length - MAX })) + '</div>' : '') +
      '</div>' +
    '</div>';
}

export function problemReasonBadge(p) {
  if (p.reason === 'auto_disabled') {
    return '<span class="badge badge-error">' + esc(t('auto-disabled')) + '</span>';
  }
  if (p.reason === 'failing') {
    return '<span class="badge badge-cooldown">' + esc(t('{n} consecutive failures', { n: p.consecutiveFailures })) + '</span>';
  }
  return '<span class="badge badge-error">' + esc(t('{pct} error rate', { pct: pct(p.failed, p.requests) })) + '</span>';
}

export function renderLiveTable() {
  const tbody = $('#live-tbody');
  if (!tbody) return;
  const items = Array.from(store.live.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const count = $('#live-count');
  if (count) count.textContent = items.length ? '(' + items.length + ')' : '';
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">' + esc(t('No requests in flight.')) + '</td></tr>';
    return;
  }
  const now = Date.now();
  tbody.innerHTML = items.map((en) => {
    const elapsed = en.ts ? now - en.ts : (en.elapsedMs || 0);
    return '<tr>' +
      '<td class="muted">' + esc(fmtTime(en.ts)) + '</td>' +
      '<td>' + esc(en.model || '–') + '</td>' +
      '<td>' + esc(en.channelName || '–') + '</td>' +
      '<td class="mono">' + esc(en.keyMasked || '–') + '</td>' +
      '<td class="num">' + esc(en.attempts != null ? en.attempts : 1) + '</td>' +
      '<td class="num" data-elapsed-ts="' + esc(en.ts || '') + '">' + fmtMs(elapsed) + '</td>' +
      '</tr>';
  }).join('');
}

export function renderRecentTable() {
  const tbody = $('#recent-tbody');
  if (!tbody) return;
  if (!store.recent.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">' + esc(t('No finished requests yet.')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = store.recent.map((en) => {
    return '<tr>' +
      '<td class="muted">' + esc(fmtTime(en.ts)) + '</td>' +
      '<td>' + statusBadgeHtml(en) + '</td>' +
      '<td>' + esc(en.model || '–') + '</td>' +
      '<td>' + esc(en.channelName || '–') + '</td>' +
      '<td class="mono">' + esc(en.keyMasked || '–') + '</td>' +
      '<td class="num">' + esc(en.attempts != null ? en.attempts : 1) + '</td>' +
      '<td class="num">' + fmtMs(en.latencyMs) + '</td>' +
      '</tr>';
  }).join('');
}

export async function renderDashboard() {
  $('#view').innerHTML = pageHead('Overview', 'A clear view of traffic, capacity and automatic failover.',
    `<button class="btn" data-action="copy-endpoint">${icon('copy')}${esc(t('Copy endpoint'))}</button><button class="btn btn-primary" data-action="channel-add">${icon('plus')}${esc(t('Add channel'))}</button>`) +
    '<div id="health-strip"></div><div id="onboarding"></div><div id="stat-cards" class="metric-grid"></div><div id="problem-banner"></div>' +
    `<div class="overview-grid"><section class="card">
      <div class="card-head"><div><h3>${esc(t('Traffic overview'))}</h3><div class="card-subtitle">${esc(t('Completed requests over the last 60 minutes'))}</div></div>
        <div class="chart-toolbar"><div class="legend"><span><span class="sw" style="background:var(--good)"></span>${esc(t('Success'))}</span><span><span class="sw" style="background:var(--crit)"></span>${esc(t('Failed'))}</span></div><span class="chart-period">${esc(t('Last hour'))}</span></div></div>
      <div class="chart-summary"><strong id="traffic-rpm">–</strong><span>${esc(t('requests / min'))}</span></div>
      <div class="chart-wrap"><canvas id="rpm-chart" height="210" role="img" aria-label="${esc(t('Request history'))}"></canvas><div class="chart-band hidden" id="chart-band"></div><div class="chart-tip hidden" id="chart-tip"></div></div>
    </section><section class="card"><div class="card-head"><h3>${esc(t('Routing health'))}</h3><a class="card-link" href="#/routing">${esc(t('Manage'))}${icon('arrow', 14)}</a></div><div id="routing-health"></div></section></div>
    <section class="card flush"><div class="card-head"><h3><span class="live-indicator"></span>${esc(t('Live requests'))} <span class="muted small" id="live-count"></span></h3><span class="card-subtitle">${esc(t('Updates automatically'))}</span></div>
      <div class="performance-row" id="performance-row"></div><div class="table-scroll"><table><thead><tr>${['Started', 'Model', 'Channel', 'Key', 'Attempts', 'Elapsed'].map((s) => `<th>${esc(t(s))}</th>`).join('')}</tr></thead><tbody id="live-tbody"></tbody></table></div></section>
    <section class="card flush"><div class="card-head"><h3>${esc(t('Recent requests'))}</h3><a class="card-link" href="#/logs">${esc(t('View all logs'))}${icon('arrow', 14)}</a></div>
      <div class="table-scroll"><table><thead><tr>${['Time', 'Status', 'Model', 'Channel', 'Key', 'Attempts', 'Latency'].map((s) => `<th>${esc(t(s))}</th>`).join('')}</tr></thead><tbody id="recent-tbody"></tbody></table></div></section>
    <details class="card flush daily-details"><summary>${esc(t('Daily usage (last 14 days)'))}</summary><div class="table-scroll"><table><thead><tr>${['Date', 'Requests', 'Success', 'Failed', 'Prompt tokens', 'Completion tokens'].map((s) => `<th>${esc(t(s))}</th>`).join('')}</tr></thead><tbody id="daily-tbody"></tbody></table></div></details>`;
  renderDashStats();
  renderLiveTable();
  renderRecentTable();
  drawHistoryChart();
  wireChartHover();
  try {
    const [overview, live, recent] = await Promise.all([api('/api/overview'), api('/api/requests/live'), api('/api/logs?limit=8')]);
    if (store.route !== 'dashboard' || !store.auth.username) return;
    store.overview = overview;
    store.live = new Map((live || []).map((entry) => [entry.id, entry]));
    store.recent = recent || [];
    renderDashStats();
    drawHistoryChart();
    renderLiveTable();
    renderRecentTable();
  } catch (error) {
    if (store.route === 'dashboard') toast(error.message, 'error');
  }
  if (store.route !== 'dashboard' || !store.auth.username) return;
  clearDashTimer();
  store.dashTimer = setInterval(async () => {
    try {
      const overview = await api('/api/overview');
      if (store.route !== 'dashboard' || !store.auth.username) return;
      store.overview = overview;
      renderDashStats();
      drawHistoryChart();
    } catch { /* SSE still supplies live counters during transient failures. */ }
  }, 30000);
}

export function renderDashStats() {
  const box = $('#stat-cards');
  if (!box) return;
  const ov = store.overview || {};
  const totals = ov.totals || {};
  const today = (ov.daily || []).slice(-1)[0] || {};
  box.innerHTML = metric('Requests today', fmtNum(today.requests || 0), t('{n} tokens today', { n: fmtNum((today.promptTokens || 0) + (today.completionTokens || 0)) }), 'activity') +
    metric('Success rate', pct(totals.success, totals.requests), t('{ok} ok / {failed} failed', { ok: fmtNum(totals.success || 0), failed: fmtNum(totals.failed || 0) }), 'shield', 'accent') +
    metric('In flight', fmtNum(store.live.size), t('{n} requests per minute', { n: ov.rpm || 0 }), 'route') +
    metric('Auto-recovered', fmtNum(totals.recovered || 0), t('Failed attempts rescued since startup'), 'spark', 'accent');
  const routing = ov.routing || {};
  const ready = (routing.availableChannels || 0) > 0;
  const configured = (ov.channelCount || 0) > 0;
  const health = $('#health-strip');
  if (health) health.innerHTML = `<div class="health-strip ${ready ? '' : 'warning'}">${icon(ready ? 'shield' : 'server', 16)}<strong>${esc(t(ready ? 'Ready to route' : configured ? 'No upstream available' : 'Let’s connect your first upstream'))}</strong><span class="health-detail">${esc(t('{ready} / {total} channels available', { ready: routing.availableChannels || 0, total: routing.enabledChannels || 0 }))}</span><a href="#/routing" aria-label="${esc(t('Smart routing'))}">${icon('arrow', 14)}</a></div>`;
  const onboarding = $('#onboarding');
  if (onboarding) onboarding.innerHTML = ov.channelCount === 0 ? `<div class="onboarding">${icon('server', 30)}<div><h3>${esc(t('Your workspace is ready. Add your first channel.'))}</h3><p>${esc(t('Connect an upstream, import keys, then create a token for your apps.'))}</p></div><button class="btn btn-primary" data-action="channel-add">${icon('plus', 15)}${esc(t('Add channel'))}</button></div>` : '';
  const rpm = $('#traffic-rpm');
  if (rpm) rpm.textContent = fmtNum(ov.rpm || 0);
  const performance = $('#performance-row');
  if (performance) performance.innerHTML = `<span>${esc(t('Avg first token'))}<strong>${esc(ov.avgTtftMs ? fmtMs(ov.avgTtftMs) : '–')}</strong></span><span>${esc(t('Avg throughput'))}<strong>${esc(ov.avgTps ? ov.avgTps + ' ' + t('tok/s') : '–')}</strong></span><span>${esc(t('Avg latency'))}<strong>${esc(ov.avgLatencyMs ? fmtMs(ov.avgLatencyMs) : '–')}</strong></span><span id="uptime-sub">${esc(t('Uptime {t}', { t: fmtUptime(ov.uptimeMs) }))}</span>`;
  renderRoutingHealth();
  renderProblemBanner();
  renderDailyTable();
}

export function renderRoutingHealth() {
  const box = $('#routing-health');
  if (!box) return;
  const ov = store.overview || {};
  const routing = ov.routing || {};
  const counts = ov.keyCounts || {};
  const strategy = routing.strategyLabel || 'Automatic';
  box.innerHTML = `<div class="routing-label"><span class="routing-mark">${icon('route', 21)}</span><div><strong>${esc(t(strategy))}</strong><small>${esc(t('Current scheduling policy'))}</small></div></div>
    <div class="routing-fact"><span>${esc(t('Available keys'))}</span><strong>${fmtNum(counts.active || 0)} <span class="muted">/ ${fmtNum((counts.active || 0) + (counts.cooldown || 0) + (counts.disabled || 0))}</span></strong></div>
    <div class="routing-fact"><span>${esc(t('Cooling down'))}</span><strong>${fmtNum(counts.cooldown || 0)}</strong></div>
    <div class="routing-fact"><span>${esc(t('Open circuits'))}</span><strong>${fmtNum(routing.openCircuits || 0)}</strong></div>
    <div class="routing-fact"><span>${esc(t('Recovering channels'))}</span><strong>${fmtNum(routing.recoveringCircuits || 0)}</strong></div>
    <div class="routing-explanation">${esc(t(routing.lastDecision?.reason || 'Routing decisions appear here when traffic arrives.'))}</div>
    <a class="card-link" href="#/routing">${esc(t('Try routing preview'))}${icon('arrow', 14)}</a>`;
}
