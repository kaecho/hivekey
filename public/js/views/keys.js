import { api, esc, fmtMs, fmtNum, pct, store, toast, truncate } from '../core.js';
import { t } from '../../i18n.js';

const KEYS_PAGE_SIZE = 20;
export const MODAL_KEYS_PAGE_SIZE = 8;

export function keyPanelState(chId) {
  let st = store.keyPanelState[chId];
  if (!st) {
    st = { q: '', page: 1 };
    store.keyPanelState[chId] = st;
  }
  return st;
}

export function keySearchMatch(k, q) {
  if (!q) return true;
  const st = k.stats || {};
  return String(k.key || '').toLowerCase().indexOf(q) >= 0 ||
    String(st.lastError || '').toLowerCase().indexOf(q) >= 0 ||
    String(k.status || '').indexOf(q) >= 0;
}

export function pageSlice(list, page, size) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * size, p * size), page: p, pages };
}

export function visibleKeys(chId) {
  const keys = store.keysByChannel[chId];
  if (!Array.isArray(keys)) return null;
  const st = keyPanelState(chId);
  const filtered = keys.filter((k) => keySearchMatch(k, st.q.trim().toLowerCase()));
  const sliced = pageSlice(filtered, st.page, KEYS_PAGE_SIZE);
  st.page = sliced.page;
  return { filtered: filtered, items: sliced.items, page: sliced.page, pages: sliced.pages };
}

export function keyPanelHtml(ch) {
  const reveal = !!store.revealKeys[ch.id];
  const st = keyPanelState(ch.id);
  return '<div class="key-panel">' +
    '<div class="key-toolbar">' +
      '<strong>' + esc(t('Keys · {name}', { name: ch.name })) + '</strong>' +
      '<input type="search" data-keys-search data-id="' + esc(ch.id) + '" placeholder="' + esc(t('Search keys…')) + '" value="' + esc(st.q) + '">' +
      '<label class="checklab"><input type="checkbox" data-reveal data-id="' + esc(ch.id) + '"' + (reveal ? ' checked' : '') + '> ' + esc(t('Reveal keys')) + '</label>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-action="keys-test-all" data-id="' + esc(ch.id) + '">' + esc(t('Test all keys')) + '</button>' +

    '</div>' +
    `<div class="batch-actions"><span data-selection-count>${esc(t('{n} selected', { n: store.selectedKeys.size }))}</span>${[['enable', 'Enable selected'], ['disable', 'Disable selected'], ['reset', 'Reset selected']].map(([operation, label]) => `<button class="btn btn-sm" data-action="keys-batch" data-operation="${operation}" data-id="${esc(ch.id)}" disabled>${esc(t(label))}</button>`).join('')}<button class="btn btn-sm btn-danger" data-action="keys-delete-selected" data-id="${esc(ch.id)}" disabled>${esc(t('Delete selected'))}</button></div>` +
    '<div class="table-scroll"><table>' +
      '<thead><tr>' +
        '<th style="width:28px"><input type="checkbox" aria-label="' + esc(t('Select visible keys')) + '" data-keysel-all data-id="' + esc(ch.id) + '"></th>' +
        '<th>' + esc(t('Key')) + '</th><th>' + esc(t('Status')) + '</th><th class="num">' + esc(t('Req')) + '</th><th class="num">' + esc(t('OK')) + '</th><th class="num">' + esc(t('Fail')) + '</th>' +
        '<th class="num">429</th><th class="num">' + esc(t('Latency')) + '</th><th class="num">' + esc(t('TTFT')) + '</th><th class="num">' + esc(t('tok/s')) + '</th><th>' + esc(t('Last error')) + '</th><th>' + esc(t('Actions')) + '</th>' +
      '</tr></thead>' +
      '<tbody id="keys-tbody-' + esc(ch.id) + '">' + keysRowsHtml(ch.id) + '</tbody>' +
    '</table></div>' +
    '<div class="pager" id="keys-pager-' + esc(ch.id) + '">' + keysPagerHtml(ch.id) + '</div>' +
    '<div class="key-import">' +
      '<textarea id="import-keys-' + esc(ch.id) + '" rows="3" placeholder="sk-...&#10;sk-...&#10;' + esc(t('(one key per line)')) + '"></textarea>' +
      '<div class="side">' +
        '<button class="btn" data-action="keys-import" data-id="' + esc(ch.id) + '">' + esc(t('Import keys')) + '</button>' +
        '<span class="hint" id="import-result-' + esc(ch.id) + '"></span>' +
      '</div>' +
    '</div>' +
  '</div>';
}

export function keysRowsHtml(chId) {
  const v = visibleKeys(chId);
  if (v === null) {
    return '<tr><td colspan="12" class="empty">' + esc(t('Loading keys…')) + '</td></tr>';
  }
  const keys = store.keysByChannel[chId] || [];
  if (!keys.length) {
    return '<tr><td colspan="12" class="empty">' + esc(t('No keys in this channel. Import some below.')) + '</td></tr>';
  }
  if (!v.filtered.length) {
    return '<tr><td colspan="12" class="empty">' + esc(t('No keys match your search.')) + '</td></tr>';
  }
  return v.items.map((k) => {
    const st = k.stats || {};
    const checked = store.selectedKeys.has(k.id);
    const failWarn = (st.requests || 0) >= 10 && (st.failed || 0) / st.requests >= 0.5;
    return '<tr data-key-row="' + esc(k.id) + '">' +
      '<td data-stop><input type="checkbox" aria-label="' + esc(t('Select key')) + '" data-keysel="' + esc(k.id) + '" data-ch="' + esc(chId) + '"' + (checked ? ' checked' : '') + '></td>' +
      '<td class="mono">' + esc(k.key) + '</td>' +
      '<td>' + keyBadgeHtml(k) + '</td>' +
      '<td class="num">' + fmtNum(st.requests || 0) + '</td>' +
      '<td class="num">' + fmtNum(st.success || 0) + '</td>' +
      '<td class="num' + (failWarn ? ' err-text' : '') + '"' +
        (failWarn ? ' title="' + esc(t('{pct} error rate', { pct: pct(st.failed, st.requests) })) + '"' : '') + '>' +
        fmtNum(st.failed || 0) + '</td>' +
      '<td class="num">' + fmtNum(st.count429 || 0) + '</td>' +
      '<td class="num">' + fmtMs(st.ewmaLatencyMs) + '</td>' +
      '<td class="num">' + (st.ewmaTtftMs ? fmtMs(st.ewmaTtftMs) : '–') + '</td>' +
      '<td class="num">' + (st.ewmaTps ? Number(st.ewmaTps).toFixed(1) : '–') + '</td>' +
      '<td class="err-cell" title="' + esc(st.lastError || '') + '">' + esc(truncate(st.lastError || '', 48)) + '</td>' +
      '<td class="actions" data-stop>' +
        '<button class="btn btn-sm" data-action="key-toggle" data-id="' + esc(k.id) + '" data-ch="' + esc(chId) + '" data-enabled="' + (k.enabled ? 'false' : 'true') + '">' + esc(k.enabled ? t('Disable') : t('Enable')) + '</button>' +
        '<button class="btn btn-sm" data-action="key-reset" data-id="' + esc(k.id) + '" data-ch="' + esc(chId) + '">' + esc(t('Reset')) + '</button>' +
        '<button class="btn btn-sm" data-action="key-test" data-id="' + esc(k.id) + '" data-ch="' + esc(chId) + '">' + esc(t('Test')) + '</button>' +
        '<button class="btn btn-sm btn-danger" data-action="key-delete" data-id="' + esc(k.id) + '" data-ch="' + esc(chId) + '">' + esc(t('Delete')) + '</button>' +
        '<span class="test-result" data-test-result="' + esc(k.id) + '"></span>' +
      '</td></tr>';
  }).join('');
}

export function keysPagerHtml(chId) {
  const v = visibleKeys(chId);
  if (v === null) return '';
  const keys = store.keysByChannel[chId] || [];
  if (!keys.length) return '';
  let html = '<span class="muted small">' + esc(t('{shown} of {total} keys', { shown: v.filtered.length, total: keys.length })) + '</span>';
  if (v.pages > 1) {
    html += '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-action="keys-page" data-id="' + esc(chId) + '" data-dir="-1"' + (v.page <= 1 ? ' disabled' : '') + '>&lsaquo;</button>' +
      '<span class="small muted">' + v.page + ' / ' + v.pages + '</span>' +
      '<button class="btn btn-sm" data-action="keys-page" data-id="' + esc(chId) + '" data-dir="1"' + (v.page >= v.pages ? ' disabled' : '') + '>&rsaquo;</button>';
  }
  return html;
}

export function refreshKeyPanel(chId) {
  const tbody = document.getElementById('keys-tbody-' + chId);
  if (tbody) tbody.innerHTML = keysRowsHtml(chId);
  const pager = document.getElementById('keys-pager-' + chId);
  if (pager) pager.innerHTML = keysPagerHtml(chId);
  updateBatchBar();
}

export function keyBadgeHtml(k) {
  let cls = 'badge-disabled', label = t('disabled'), attrs = '';
  if (k.status === 'active') { cls = 'badge-active'; label = t('active'); }
  else if (k.status === 'cooldown') {
    cls = 'badge-cooldown';
    const remain = Math.max(0, Math.ceil(((Number(k.cooldownUntil) || 0) - Date.now()) / 1000));
    label = t('cooldown · {n}s', { n: remain });
    attrs = ' data-cooldown-until="' + esc(k.cooldownUntil || 0) + '"';
  }
  return '<span class="badge ' + cls + '" data-key-badge="' + esc(k.id) + '"' + attrs + '>' + esc(label) + '</span>';
}

export async function loadKeysAndRender(chId) {
  try {
    const reveal = !!store.revealKeys[chId];
    const keys = await api('/api/channels/' + encodeURIComponent(chId) + '/keys' + (reveal ? '?reveal=1' : ''));
    store.keysByChannel[chId] = keys || [];
    // prune selection to existing keys
    const ids = new Set((keys || []).map((k) => k.id));
    store.selectedKeys.forEach((id) => { if (!ids.has(id)) store.selectedKeys.delete(id); });
  } catch (e) {
    store.keysByChannel[chId] = [];
    toast(e.message, 'error');
  }
  refreshKeyPanel(chId);
}

export function updateBatchBar() {
  document.querySelectorAll('[data-action="keys-batch"]').forEach((button) => { button.disabled = store.selectedKeys.size === 0; });
  const count = document.querySelector('[data-selection-count]');
  if (count) count.textContent = t('{n} selected', { n: store.selectedKeys.size });
  const btn = document.querySelector('[data-action="keys-delete-selected"]');
  if (btn) {
    const n = store.selectedKeys.size;
    btn.disabled = n === 0;
    btn.textContent = n ? t('Delete selected ({n})', { n: n }) : t('Delete selected');
  }
  const all = document.querySelector('[data-keysel-all]');
  if (all) {
    const v = visibleKeys(all.dataset.id);
    const items = (v && v.items) || [];
    all.checked = items.length > 0 && items.every((k) => store.selectedKeys.has(k.id));
  }
}
