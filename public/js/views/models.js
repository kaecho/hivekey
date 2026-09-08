import { api, esc, fmtMs, store, truncate, withBusy } from '../core.js';
import { t } from '../../i18n.js';

export function renderModelBox() {
  const box = document.querySelector('[data-model-box]');
  if (!box || !store.modelSel) return;
  box.innerHTML =
    store.modelSel.selected.map((m) =>
      '<span class="tag"><span class="tag-label" title="' + esc(m) + '">' + esc(m) + '</span>' +
      '<button type="button" class="tag-x" data-action="model-remove" data-model="' + esc(m) + '" aria-label="remove ' + esc(m) + '">&times;</button></span>'
    ).join('') +
    '<input type="text" data-model-input autocomplete="off" spellcheck="false" placeholder="' +
      (store.modelSel.selected.length ? '' : esc(t('Type or pick models…'))) + '" value="' + esc(store.modelSel.query) + '">';
  renderModelDropdown();
}

export function renderModelDropdown() {
  const dd = document.querySelector('[data-model-dropdown]');
  if (!dd || !store.modelSel) return;
  if (!store.modelSel.open) { dd.classList.add('hidden'); return; }
  const q = store.modelSel.query.trim().toLowerCase();
  const sel = new Set(store.modelSel.selected);
  const opts = store.modelSel.options.filter((m) => !q || m.toLowerCase().indexOf(q) >= 0);
  const typed = store.modelSel.query.trim();
  const exact = !typed || sel.has(typed) || store.modelSel.options.some((m) => m.toLowerCase() === q);
  let html =
    '<div class="tag-dd-head">' +
      '<span class="muted small">' + esc(t('{sel} / {total} selected', { sel: store.modelSel.selected.length, total: store.modelSel.options.length })) + '</span>' +
      '<span class="spacer"></span>' +
      (opts.length ? '<button type="button" class="btn btn-sm" data-action="models-select-all">' + esc(t('Select all')) + '</button>' : '') +
    '</div>' +
    '<div class="tag-dd-list">';
  if (!exact) {
    html += '<button type="button" class="tag-opt tag-opt-add" data-action="model-add-custom" data-model="' + esc(typed) + '">+ ' +
      esc(t('Add "{name}"', { name: typed })) + '</button>';
  }
  html += opts.map((m) =>
    '<button type="button" class="tag-opt' + (sel.has(m) ? ' sel' : '') + '" data-action="model-opt" data-model="' + esc(m) + '">' +
      '<span class="check">✓</span><span class="opt-name" title="' + esc(m) + '">' + esc(m) + '</span>' +
    '</button>'
  ).join('');
  if (!opts.length && exact) {
    html += '<div class="tag-dd-empty">' + esc(t('Type a model name and press Enter to add it.')) + '</div>';
  }
  html += '</div>';
  dd.innerHTML = html;
  dd.classList.remove('hidden');
}

export function focusModelInput() {
  const inp = document.querySelector('[data-model-input]');
  if (inp) {
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}

export function modelSelAdd(name) {
  name = String(name || '').trim();
  if (!name || !store.modelSel) return;
  if (store.modelSel.selected.indexOf(name) < 0) store.modelSel.selected.push(name);
  if (store.modelSel.options.indexOf(name) < 0) {
    store.modelSel.options.push(name);
    store.modelSel.options.sort((a, b) => a.localeCompare(b));
  }
  store.modelSel.query = '';
  renderModelBox();
  focusModelInput();
}

export function modelSelToggle(name) {
  if (!store.modelSel) return;
  const i = store.modelSel.selected.indexOf(name);
  if (i >= 0) store.modelSel.selected.splice(i, 1);
  else store.modelSel.selected.push(name);
  renderModelBox(); // keeps the current query, so multi-picking under a filter works
  focusModelInput();
}

export async function fetchModelsForForm(btn) {
  const form = document.getElementById('channel-form');
  if (!form || !store.modelSel) return;
  const f = form.elements;
  const hint = document.getElementById('fetch-models-hint');
  const setHint = (text, isErr) => {
    if (hint) { hint.textContent = text; hint.className = 'hint' + (isErr ? ' err-text' : ''); }
  };
  const baseUrl = f.baseUrl.value.trim();
  if (!baseUrl) {
    setHint(t('Enter a Base URL first'), true);
    return;
  }
  const body = {
    baseUrl: baseUrl,
    proxy: f.proxy.value.trim(),
    keyHeader: f.keyHeader.value,
    keyPrefix: f.keyPrefix.value,
  };
  if (form.dataset.id) body.channelId = form.dataset.id;
  // Borrow the first pasted key for the probe (falls back to a stored key server-side).
  if (f.keys && f.keys.value.trim()) {
    body.key = f.keys.value.split('\n').map((s) => s.trim()).filter(Boolean)[0];
  }
  setHint(t('Fetching…'), false);
  try {
    const r = await withBusy(btn, () => api('/api/channels/fetch-models', { method: 'POST', body }));
    if (!r || !r.ok) {
      setHint(t('Fetch failed') +
        (r && r.statusCode ? ' · ' + r.statusCode : '') +
        (r && r.error ? ' · ' + truncate(r.error, 90) : ''), true);
      return;
    }
    setHint(t('{n} models · {ms}', { n: r.models.length, ms: fmtMs(r.latencyMs) }), false);
    if (!store.modelSel) return; // modal closed while fetching
    const known = new Set(store.modelSel.options);
    (r.models || []).forEach((m) => { if (!known.has(m)) store.modelSel.options.push(m); });
    store.modelSel.options.sort((a, b) => a.localeCompare(b));
    store.modelSel.open = true;
    renderModelDropdown();
    focusModelInput();
  } catch (err) {
    setHint(truncate(err.message, 110), true);
  }
}
