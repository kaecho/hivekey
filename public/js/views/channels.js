import { pageHead, icon, circuitBadge } from '../ui.js';
import { $, api, esc, fmtMs, fmtNum, loadChannelsData, pct, store, toast } from '../core.js';
import { t } from '../../i18n.js';
import { keyPanelHtml, loadKeysAndRender, updateBatchBar } from './keys.js';

export async function renderChannels() {
  $('#view').innerHTML =
    pageHead('Channels', 'Organize upstreams, set capacity and keep credentials healthy.',
      `<button class="btn btn-primary" data-action="channel-add">${icon('plus', 16)}${esc(t('Add channel'))}</button>`) +
    '<div class="channel-summary" id="channel-summary"></div>' +
    '<div class="card table-toolbar">' +
      '<input type="search" data-channel-search aria-label="' + esc(t('Search channels')) + '" placeholder="' + esc(t('Search name, URL or model…')) + '" value="' + esc(store.channelFilter) + '">' +
      '<span class="muted small" id="channel-count"></span>' +
      '<span class="spacer"></span>' +
      '<button class="btn" data-action="channels-refresh">' + esc(t('Refresh')) + '</button>' +
    '</div>' +
    '<div class="card flush"><div class="table-scroll"><table>' +
      '<thead><tr><th>' + esc(t('Name')) + '</th><th>' + esc(t('Models')) + '</th><th class="num">' + esc(t('Priority')) + '</th><th class="num">' + esc(t('Weight')) + '</th>' +
      '<th class="num">' + esc(t('Keys')) + '</th><th>' + esc(t('Requests')) + '</th><th>' + esc(t('Response time')) + '</th><th>' + esc(t('Status')) + '</th><th>' + esc(t('Actions')) + '</th></tr></thead>' +
      '<tbody id="channels-tbody"><tr><td colspan="9" class="empty">' + esc(t('Loading…')) + '</td></tr></tbody>' +
    '</table></div></div>';

  try {
    await loadChannelsData();
    renderChannelsTable();
    if (store.expandedChannel && !store.keysByChannel[store.expandedChannel]) {
      loadKeysAndRender(store.expandedChannel);
    }
  } catch (e) {
    const tbody = $('#channels-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="empty">' + esc(t('Failed to load channels.')) + '</td></tr>';
    toast(e.message, 'error');
  }
}

export function channelMatchesFilter(ch) {
  const q = store.channelFilter.trim().toLowerCase();
  if (!q) return true;
  return [ch.name, ch.baseUrl, (ch.models || []).join(' ')]
    .some((s) => String(s || '').toLowerCase().indexOf(q) >= 0);
}

export function channelModelsHtml(ch) {
  const models = ch.models || [];
  if (!models.length) return '<span class="badge badge-neutral">' + esc(t('All models')) + '</span>';
  const shown = models.slice(0, 2);
  let html = shown.map((m) =>
    '<span class="tag tag-static"><span class="tag-label" title="' + esc(m) + '">' + esc(m) + '</span></span>').join('');
  if (models.length > shown.length) {
    html += '<span class="tag tag-static tag-more" title="' + esc(models.join('\n')) + '">+' + (models.length - shown.length) + '</span>';
  }
  return '<div class="tag-cell">' + html + '</div>';
}

export function chTestHtml(chId) {
  const r = store.channelTest[chId];
  if (!r) return '<span class="muted small">–</span>';
  if (r.state === 'testing') return '<span class="muted small">' + esc(t('Testing…')) + '</span>';
  if (r.ok) return '<span class="badge badge-success">' + esc(fmtMs(r.latencyMs)) + '</span>';
  return '<span class="badge badge-error" title="' + esc(r.error || '') + '">' +
    esc((r.statusCode || t('error')) + ' · ' + fmtMs(r.latencyMs)) + '</span>';
}

export function renderChannelsTable() {
  const tbody = $('#channels-tbody');
  if (!tbody) return;
  const visible = store.channels.filter(channelMatchesFilter);
  const summary = $('#channel-summary');
  if (summary) summary.innerHTML = [[store.channels.length, 'Channels'], [store.channels.reduce((n, ch) => n + ch.keyCount, 0), 'Keys'], [store.channels.filter((ch) => ch.circuit?.state === 'open').length, 'Open circuits']].map(([count, label]) => `<span class="summary-chip"><strong>${fmtNum(count)}</strong>${esc(t(label))}</span>`).join('');
  const count = $('#channel-count');
  if (count) count.textContent = t('{shown} / {total} channels', { shown: visible.length, total: store.channels.length });
  if (!store.channels.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">' + esc(t('No channels yet. Add one to start routing requests.')) + '</td></tr>';
    return;
  }
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">' + esc(t('No channels match your search.')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = visible.map((ch) => {
    const s = ch.stats || {};
    const expanded = store.expandedChannel === ch.id;
    let html = '<tr class="row-click' + (expanded ? ' row-expanded' : '') + '" tabindex="0" aria-expanded="' + expanded + '" data-channel-row="' + esc(ch.id) + '">' +
      '<td><div class="cell-title">' + esc(ch.name) + '</div>' +
        ('<div data-channel-circuit="' + esc(ch.id) + '">' + (ch.circuit?.state !== 'closed' ? circuitBadge(ch.circuit) : '') + '</div>') +
        '<div class="mono small muted cell-sub" title="' + esc(ch.baseUrl) + '">' + esc(ch.baseUrl) + '</div></td>' +
      '<td>' + channelModelsHtml(ch) + '</td>' +
      '<td class="num">' + esc(ch.priority != null ? ch.priority : 0) + '</td>' +
      '<td class="num">' + esc(ch.weight != null ? ch.weight : 1) + '</td>' +
      '<td class="num"><span class="ok-text">' + esc(ch.activeKeyCount != null ? ch.activeKeyCount : '?') + '</span>' +
        '<span class="muted">/' + esc(ch.keyCount != null ? ch.keyCount : '?') + '</span><div class="muted small">' + esc(t('{n} in flight', { n: ch.inflight || 0 })) + (ch.maxInflight ? ' / ' + esc(ch.maxInflight) : '') + '</div></td>' +
      '<td class="small">' + fmtNum(s.requests || 0) + ' <span class="muted">·</span> ' + pct(s.success || 0, s.requests || 0) +
        ' <span class="muted">· ' + fmtMs(s.avgLatencyMs) + '</span></td>' +
      '<td data-chtest="' + esc(ch.id) + '">' + chTestHtml(ch.id) + '</td>' +
      '<td data-stop><label class="switch"><input type="checkbox" data-toggle="channel" data-id="' + esc(ch.id) + '"' +
        (ch.enabled ? ' checked' : '') + '><span class="sl"></span></label></td>' +
      '<td class="actions" data-stop>' +
        '<button class="btn btn-sm" data-action="channel-test" data-id="' + esc(ch.id) + '">' + esc(t('Test')) + '</button>' +
        '<button class="btn btn-sm" data-action="channel-edit" data-id="' + esc(ch.id) + '">' + esc(t('Edit')) + '</button>' +
        '<button class="btn btn-sm btn-danger" data-action="channel-delete" data-id="' + esc(ch.id) + '">' + esc(t('Delete')) + '</button>' +
      '</td></tr>';
    if (expanded) {
      html += '<tr><td colspan="9" class="nopad">' + keyPanelHtml(ch) + '</td></tr>';
    }
    return html;
  }).join('');
  updateBatchBar();
}

export async function refreshChannelsAndKeys(chId) {
  await loadChannelsData();
  if (chId && store.expandedChannel === chId) {
    const reveal = !!store.revealKeys[chId];
    try {
      store.keysByChannel[chId] = (await api('/api/channels/' + encodeURIComponent(chId) + '/keys' + (reveal ? '?reveal=1' : ''))) || [];
      const ids = new Set(store.keysByChannel[chId].map((k) => k.id));
      store.selectedKeys.forEach((id) => { if (!ids.has(id)) store.selectedKeys.delete(id); });
    } catch (e) { /* keep stale cache */ }
  }
  if (store.route === 'channels') renderChannelsTable();
}
