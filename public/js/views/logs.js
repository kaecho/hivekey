import { pageHead, icon } from '../ui.js';
import { $, api, esc, fmtMs, fmtNum, fmtTime, loadChannelsData, statusBadgeHtml, store, toast, truncate } from '../core.js';
import { t } from '../../i18n.js';

export async function renderLogs() {
  const f = store.logFilters;
  $('#view').innerHTML =
    pageHead('Request logs', 'Follow every attempt. Understand failures without losing your place.',
      `<button class="btn" data-action="logs-pause" aria-pressed="${store.logsPaused}">${icon(store.logsPaused ? 'play' : 'pause', 15)}${esc(t(store.logsPaused ? 'Resume live' : 'Pause live'))}</button><button class="btn" data-action="logs-export">${icon('download', 15)}${esc(t('Export CSV'))}</button>`) +
    '<div class="card">' +
      '<form id="logs-filter" class="filters">' +
        '<input type="search" name="q" aria-label="' + esc(t('Search requests')) + '" placeholder="' + esc(t('Search model, path, key, error…')) + '" value="' + esc(f.q) + '">' +
        '<select name="channelId" aria-label="' + esc(t('Channel')) + '" id="logs-channel-sel"><option value="">' + esc(t('All channels')) + '</option></select>' +
        '<select name="status" aria-label="' + esc(t('Status')) + '">' +
          '<option value="">' + esc(t('All statuses')) + '</option>' +
          '<option value="success"' + (f.status === 'success' ? ' selected' : '') + '>' + esc(t('Success')) + '</option>' +
          '<option value="error"' + (f.status === 'error' ? ' selected' : '') + '>' + esc(t('Error')) + '</option>' +
          '<option value="aborted"' + (f.status === 'aborted' ? ' selected' : '') + '>' + esc(t('Aborted')) + '</option>' +
        '</select>' +
        '<select name="limit" aria-label="' + esc(t('Row limit')) + '">' +
          [50, 100, 200, 500].map((n) =>
            '<option value="' + n + '"' + (Number(f.limit) === n ? ' selected' : '') + '>' + esc(t('{n} rows', { n: n })) + '</option>').join('') +
        '</select>' +
        `<label class="checklab"><input type="checkbox" name="retried" ${f.retried ? 'checked' : ''}>${esc(t('Retried only'))}</label>` +
        '<button type="button" class="btn" data-action="logs-refresh">' + esc(t('Refresh')) + '</button>' +
      '</form>' +
    '</div>' +
    '<div class="card flush"><div class="log-toolbar-note" id="log-status"></div><div class="table-scroll"><table>' +
      '<thead><tr><th>' + esc(t('Time')) + '</th><th>' + esc(t('Status')) + '</th><th>' + esc(t('Model')) + '</th><th>' + esc(t('Path')) + '</th><th>' + esc(t('Channel')) + '</th><th>' + esc(t('Key')) + '</th>' +
      '<th class="num">' + esc(t('Attempts')) + '</th><th class="num">' + esc(t('Latency')) + '</th><th class="num">' + esc(t('TTFT')) + '</th><th class="num">' + esc(t('Tokens used')) + '</th></tr></thead>' +
      '<tbody id="logs-tbody"><tr><td colspan="10" class="empty">' + esc(t('Loading…')) + '</td></tr></tbody>' +
    '</table></div></div>';

  // Channel dropdown needs channel names.
  try {
    if (!store.channels.length) await loadChannelsData();
  } catch (e) { /* dropdown just stays empty */ }
  const sel = $('#logs-channel-sel');
  if (sel) {
    sel.innerHTML = '<option value="">' + esc(t('All channels')) + '</option>' + store.channels.map((ch) =>
      '<option value="' + esc(ch.id) + '"' + (f.channelId === ch.id ? ' selected' : '') + '>' + esc(ch.name) + '</option>'
    ).join('');
  }

  await fetchLogs();
}

export async function fetchLogs() {
  const f = { ...store.logFilters };
  const version = ++store.logVersion;
  store.logFetchTail = [];
  const p = new URLSearchParams();
  p.set('limit', f.limit || 100);
  if (f.channelId) p.set('channelId', f.channelId);
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  if (f.retried) p.set('retried', 'true');
  try {
    const logs = (await api('/api/logs?' + p.toString())) || [];
    if (version !== store.logVersion || store.route !== 'logs' || !store.auth.username) return;
    const merged = new Map([...logs, ...(store.logFetchTail || [])].filter(logMatchesFilters).map((entry) => [entry.id, entry]));
    store.logs = [...merged.values()].sort((a, b) => b.ts - a.ts).slice(0, f.limit);
    store.logFetchTail = null;
    renderLogsTable();
  } catch (e) {
    if (version !== store.logVersion || store.route !== 'logs') return;
    store.logFetchTail = null;
    const tbody = $('#logs-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="empty">' + esc(t('Failed to load logs.')) + '</td></tr>';
    toast(e.message, 'error');
  }
}

export function readLogFilters() {
  const form = $('#logs-filter');
  if (!form) return;
  store.logFilters = {
    q: form.elements.q.value.trim(),
    channelId: form.elements.channelId.value,
    status: form.elements.status.value,
    limit: Number(form.elements.limit.value) || 100,
    retried: form.elements.retried.checked,
  };
}

export function logMatchesFilters(en) {
  const f = store.logFilters;
  if (f.channelId && en.channelId !== f.channelId) return false;
  if (f.status && en.status !== f.status) return false;
  if (f.retried && !(en.attempts > 1)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [en.model, en.path, en.channelName, en.keyMasked, en.error, en.id, en.thinking, en.routing?.effectiveStrategy]
      .map((x) => String(x == null ? '' : x).toLowerCase()).join(' ');
    if (hay.indexOf(q) < 0) return false;
  }
  return true;
}

export function renderLogsTable() {
  const tbody = $('#logs-tbody');
  if (!tbody) return;
  renderLogStatus();
  if (!store.logs.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">' + esc(t('No log entries match.')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = store.logs.map((en) => {
    const expanded = store.expandedLogs.has(en.id);
    const tokens = (Number(en.promptTokens) || 0) + (Number(en.completionTokens) || 0);
    let html = '<tr class="row-click' + (expanded ? ' row-expanded' : '') + '" tabindex="0" aria-expanded="' + expanded + '" data-log-row="' + esc(en.id) + '">' +
      '<td class="muted small">' + esc(fmtTime(en.ts)) + '</td>' +
      '<td>' + statusBadgeHtml(en) + '</td>' +
      '<td>' + esc(en.model || '–') +
        (en.thinking ? ' <span class="badge badge-neutral" title="' + esc(t('Thinking')) + '">' + esc(en.thinking) + '</span>' : '') +
      '</td>' +
      '<td class="mono small">' + esc(truncate(en.path || '', 34)) + '</td>' +
      '<td>' + esc(en.channelName || '–') + '</td>' +
      '<td class="mono">' + esc(en.keyMasked || '–') + '</td>' +
      '<td class="num">' + (en.attempts > 1 ? '<span class="badge badge-cooldown">' + esc(en.attempts) + '</span>' : '1') + '</td>' +
      '<td class="num">' + fmtMs(en.latencyMs) + '</td>' +
      '<td class="num">' + (Number.isFinite(en.ttftMs) ? fmtMs(en.ttftMs) : '<span class="muted">–</span>') + '</td>' +
      '<td class="num">' + (tokens ? fmtNum(tokens) : '<span class="muted">–</span>') + '</td>' +
      '</tr>';
    if (expanded) {
      html += '<tr><td colspan="10" class="nopad"><div class="log-detail">' + logDetailHtml(en) + '</div></td></tr>';
    }
    return html;
  }).join('');
}

export function logDetailHtml(en) {
  let html = '<div><span class="muted">' + esc(t('Request:')) + '</span> <span class="mono">' +
    esc(en.method || 'POST') + ' ' + esc(en.path || '') + '</span>' +
    (en.api && en.api !== 'openai' ? ' <span class="badge badge-neutral">' + esc(en.api) + '</span>' : '') +
    (en.stream ? ' <span class="badge badge-neutral">' + esc(t('stream')) + '</span>' : '') +
    (en.thinking ? ' <span class="badge badge-neutral">' + esc(t('Thinking')) + ' ' + esc(en.thinking) + '</span>' : '') +
    ' <span class="muted">· id ' + esc(en.id) + '</span></div>';
  if (en.routing) html += '<div class="decision">' + esc(t('Policy')) + ': ' + esc(en.routing.effectiveStrategy) + ' · ' + esc(t(en.routing.reason)) + '</div>';
  html += '<div><button class="btn btn-sm" data-action="log-copy-id" data-id="' + esc(en.id) + '">' + esc(t('Copy request ID')) + '</button></div>';
  html += '<div><span class="muted">' + esc(t('Thinking:')) + '</span> ' +
    esc(en.thinking || t('not set')) + '</div>';
  html += '<div><span class="muted">' + esc(t('Tokens:')) + '</span> ' +
    esc(t('{p} prompt / {c} completion', { p: fmtNum(en.promptTokens || 0), c: fmtNum(en.completionTokens || 0) })) + '</div>';
  if (Number.isFinite(en.ttftMs)) {
    html += '<div><span class="muted">' + esc(t('Performance:')) + '</span> ' +
      esc(t('first token {t}', { t: fmtMs(en.ttftMs) })) +
      (en.tokensPerSec ? ' · ' + esc(t('{n} tok/s', { n: en.tokensPerSec })) : '') + '</div>';
  }
  if (en.error) {
    html += '<div class="err-text"><span class="muted">' + esc(t('Error:')) + '</span> ' + esc(en.error) + '</div>';
  }
  const retries = en.retriesDetail || [];
  if (retries.length) {
    html += '<div><span class="muted">' + esc(t('Retries ({n}):', { n: retries.length })) + '</span></div>' +
      '<div class="table-scroll"><table>' +
      '<thead><tr><th>#</th><th>' + esc(t('Channel')) + '</th><th>' + esc(t('Key')) + '</th><th class="num">' + esc(t('Status')) + '</th><th>' + esc(t('Error')) + '</th></tr></thead><tbody>' +
      retries.map((r, i) =>
        '<tr><td class="muted">' + (i + 1) + '</td>' +
        '<td>' + esc(r.channelName || '–') + '</td>' +
        '<td class="mono">' + esc(r.keyMasked || '–') + '</td>' +
        '<td class="num">' + esc(r.statusCode != null ? r.statusCode : '–') + '</td>' +
        '<td class="err-cell" style="max-width:340px" title="' + esc(r.error || '') + '">' + esc(truncate(r.error || '', 80)) + '</td></tr>'
      ).join('') +
      '</tbody></table></div>';
  } else {
    html += '<div class="muted">' + esc(en.status === 'success'
      ? t('No retries. The first attempt succeeded.')
      : en.status === 'aborted'
        ? t('No retries. The client disconnected.')
        : t('No retries. The first attempt failed.')) + '</div>';
  }
  return html;
}

export function renderLogStatus() {
  const box = $('#log-status');
  if (!box) return;
  box.classList.toggle('paused', store.logsPaused);
  box.innerHTML = `<span>${esc(t(store.logsPaused ? 'Live updates paused. Filters and export use this snapshot.' : 'Live updates on. Click a request to inspect the routing decision.'))}</span><span>${esc(t('{n} rows', { n: store.logs.length }))} · <button class="btn btn-sm" data-action="logs-clear">${esc(t('Clear filters'))}</button></span>`;
}
