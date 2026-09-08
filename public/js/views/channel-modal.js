import { field } from '../ui.js';
import { api, closeModal, esc, fmtNum, openModal, store, toast } from '../core.js';
import { t } from '../../i18n.js';
import { MODAL_KEYS_PAGE_SIZE, keyBadgeHtml, keySearchMatch, pageSlice } from './keys.js';
import { refreshChannelsAndKeys } from './channels.js';
import { renderModelBox } from './models.js';

export function openChannelModal(ch) {
  const isEdit = !!ch;
  ch = ch || {};
  store.modalKeys = { q: '', page: 1, status: '' };
  const mappingJson = ch.modelMapping && Object.keys(ch.modelMapping).length
    ? JSON.stringify(ch.modelMapping, null, 2) : '';
  store.modelSel = {
    selected: (ch.models || []).slice(),
    options: (ch.models || []).slice().sort((a, b) => a.localeCompare(b)),
    query: '',
    open: false,
  };
  openModal(
    '<h3>' + esc(isEdit ? t('Edit channel') : t('Add channel')) + '</h3>' +
    '<form id="channel-form"' + (isEdit ? ' data-id="' + esc(ch.id) + '"' : '') + '>' +
      '<div class="form-grid">' +
        '<div class="form-section span2">' + esc(t('Basics')) + '</div>' +
        '<div class="field"><label>' + esc(t('Name')) + '</label>' +
          '<input name="name" required value="' + esc(ch.name || '') + '" placeholder="OpenAI main"></div>' +
        '<div class="field"><label>' + esc(t('Base URL')) + '</label>' +
          '<input name="baseUrl" required value="' + esc(ch.baseUrl || '') + '" placeholder="https://api.openai.com"></div>' +
        '<div class="field span2"><label>' + esc(t('Proxy')) + ' <span class="muted">' + esc(t('(optional, e.g. http://127.0.0.1:7890)')) + '</span></label>' +
          '<input name="proxy" value="' + esc(ch.proxy || '') + '"></div>' +
        '<div class="field"><label>' + esc(t('Priority')) + ' <span class="muted">' + esc(t('(higher = preferred)')) + '</span></label>' +
          '<input name="priority" type="number" step="1" value="' + esc(ch.priority != null ? ch.priority : 0) + '"></div>' +
        '<div class="field"><label>' + esc(t('Weight')) + '</label>' +
          '<input name="weight" type="number" step="1" min="0" value="' + esc(ch.weight != null ? ch.weight : 1) + '"></div>' +

        field('maxInflight', 'Channel concurrency limit', ch.maxInflight || 0, '0 means unlimited. Overflow automatically uses other channels.', 0, 100000) +
        '<div class="form-section span2">' + esc(t('Models')) + ' <span class="muted normalcase">' + esc(t('(empty = all models · trailing * wildcards supported)')) + '</span></div>' +
        '<div class="span2">' +
          '<div class="model-widget" data-model-widget>' +
            '<div class="tag-select" data-model-box></div>' +
            '<div class="tag-dropdown hidden" data-model-dropdown></div>' +
          '</div>' +
          '<div class="fetch-models-row">' +
            '<button type="button" class="btn btn-sm" data-action="fetch-models"' + (isEdit ? ' data-id="' + esc(ch.id) + '"' : '') + '>' + esc(t('Fetch models')) + '</button>' +
            '<button type="button" class="btn btn-sm" data-action="models-clear">' + esc(t('Clear all')) + '</button>' +
            '<span class="hint" id="fetch-models-hint">' + esc(t('Type to add models, or pull /v1/models from the upstream.')) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="field span2"><label>' + esc(t('Model mapping')) + ' <span class="muted">' + esc(t('(JSON, requested → upstream)')) + '</span></label>' +
          '<textarea name="modelMapping" rows="2" placeholder=\'{"gpt-4o": "gpt-4o-2024-11-20"}\'>' + esc(mappingJson) + '</textarea></div>' +

        '<div class="form-section span2">' + esc(t('Authentication')) + '</div>' +
        '<div class="field"><label>' + esc(t('Key header')) + '</label>' +
          '<input name="keyHeader" value="' + esc(ch.keyHeader != null ? ch.keyHeader : 'Authorization') + '"></div>' +
        '<div class="field"><label>' + esc(t('Key prefix')) + '</label>' +
          '<input name="keyPrefix" value="' + esc(ch.keyPrefix != null ? ch.keyPrefix : 'Bearer ') + '"></div>' +

        '<div class="form-section span2">' + esc(t('API keys')) + '</div>' +
        (isEdit ? '<div class="span2" id="modal-keys"><div class="hint" style="margin-bottom:8px">' + esc(t('Loading keys…')) + '</div></div>' : '') +
        '<div class="field span2"><label>' + esc(isEdit ? t('Add keys') : t('API keys')) + ' <span class="muted">' + esc(t('(one per line, optional)')) + '</span></label>' +
          '<textarea name="keys" rows="3" placeholder="sk-...&#10;sk-..."></textarea>' +
          (isEdit ? '<div class="hint">' + esc(t('New keys are imported when you save. Duplicates are skipped.')) + '</div>' : '') +
        '</div>' +

        '<div class="field span2" style="margin-top:4px"><label class="checklab"><input type="checkbox" name="enabled"' +
          ((isEdit ? ch.enabled : true) ? ' checked' : '') + '> ' + esc(t('Enabled')) + '</label></div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn" data-action="modal-close">' + esc(t('Cancel')) + '</button>' +
        '<button type="submit" class="btn btn-primary">' + esc(isEdit ? t('Save changes') : t('Create channel')) + '</button>' +
      '</div>' +
    '</form>'
  );
  renderModelBox();
  if (isEdit) loadModalKeys(ch.id);
}

export async function loadModalKeys(chId) {
  const box = document.getElementById('modal-keys');
  if (!box) return;
  try {
    const reveal = !!store.revealKeys[chId];
    store.keysByChannel[chId] = (await api('/api/channels/' + encodeURIComponent(chId) + '/keys' + (reveal ? '?reveal=1' : ''))) || [];
  } catch (e) {
    box.innerHTML = '<div class="hint err-text" style="margin-bottom:8px">' + esc(e.message) + '</div>';
    return;
  }
  renderModalKeys(chId);
}

export function renderModalKeys(chId) {
  const box = document.getElementById('modal-keys');
  if (!box) return;
  const keys = store.keysByChannel[chId] || [];
  if (!keys.length) {
    box.innerHTML = '<div class="hint" style="margin-bottom:8px">' + esc(t('No keys in this channel. Import some below.')) + '</div>';
    return;
  }
  const mk = store.modalKeys;
  box.innerHTML =
    '<div class="mk-toolbar">' +
      '<input type="search" data-modal-keys-search data-ch="' + esc(chId) + '" placeholder="' + esc(t('Search keys…')) + '" value="' + esc(mk.q) + '">' +
      '<select data-modal-keys-status data-ch="' + esc(chId) + '">' +
        '<option value="">' + esc(t('All statuses')) + '</option>' +
        ['active', 'cooldown', 'disabled'].map((s) =>
          '<option value="' + s + '"' + (mk.status === s ? ' selected' : '') + '>' + esc(t(s)) + '</option>').join('') +
      '</select>' +
    '</div>' +
    '<div id="modal-keys-list"></div>';
  renderModalKeysList(chId);
}

export function renderModalKeysList(chId) {
  const wrap = document.getElementById('modal-keys-list');
  if (!wrap) return;
  const keys = store.keysByChannel[chId] || [];
  const mk = store.modalKeys;
  const q = mk.q.trim().toLowerCase();
  const filtered = keys.filter((k) => (!mk.status || k.status === mk.status) && keySearchMatch(k, q));
  const v = pageSlice(filtered, mk.page, MODAL_KEYS_PAGE_SIZE);
  mk.page = v.page;

  let html = '';
  if (!filtered.length) {
    html += '<div class="hint" style="margin:2px 0 8px">' + esc(t('No keys match your search.')) + '</div>';
  } else {
    html += '<div class="modal-keys-list">' +
      v.items.map((k) => {
        const st = k.stats || {};
        return '<div class="mk-row">' +
          '<span class="mono mk-key" title="' + esc(k.key) + '">' + esc(k.key) + '</span>' +
          keyBadgeHtml(k) +
          '<span class="muted small mk-stats">' + esc(t('{failed}/{total} failed', { failed: fmtNum(st.failed || 0), total: fmtNum(st.requests || 0) })) + '</span>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="btn btn-sm" data-action="modal-key-toggle" data-id="' + esc(k.id) + '" data-ch="' + esc(chId) + '" data-enabled="' + (k.enabled ? 'false' : 'true') + '">' + esc(k.enabled ? t('Disable') : t('Enable')) + '</button>' +
          '<button type="button" class="btn btn-sm btn-danger" data-action="modal-key-delete" data-id="' + esc(k.id) + '" data-ch="' + esc(chId) + '">' + esc(t('Delete')) + '</button>' +
        '</div>';
      }).join('') +
      '</div>';
  }
  html += '<div class="pager" style="margin-bottom:10px">' +
    '<span class="muted small">' + esc(t('{shown} of {total} keys', { shown: filtered.length, total: keys.length })) + '</span>';
  if (v.pages > 1) {
    html += '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-sm" data-action="modal-keys-page" data-ch="' + esc(chId) + '" data-dir="-1"' + (v.page <= 1 ? ' disabled' : '') + '>&lsaquo;</button>' +
      '<span class="small muted">' + v.page + ' / ' + v.pages + '</span>' +
      '<button type="button" class="btn btn-sm" data-action="modal-keys-page" data-ch="' + esc(chId) + '" data-dir="1"' + (v.page >= v.pages ? ' disabled' : '') + '>&rsaquo;</button>';
  }
  html += '</div>';
  wrap.innerHTML = html;
}

export async function submitChannelForm(form) {
  const f = form.elements;
  const body = {
    name: f.name.value.trim(),
    baseUrl: f.baseUrl.value.trim(),
    proxy: f.proxy.value.trim(),
    priority: Number(f.priority.value) || 0,
    maxInflight: Number(f.maxInflight.value) || 0,
    weight: Number(f.weight.value) || 0,
    models: store.modelSel ? store.modelSel.selected.slice() : [],
    keyHeader: f.keyHeader.value,
    keyPrefix: f.keyPrefix.value,
    enabled: f.enabled.checked,
  };
  const mapTxt = f.modelMapping.value.trim();
  if (mapTxt) {
    try {
      const parsed = JSON.parse(mapTxt);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      body.modelMapping = parsed;
    } catch (e) {
      toast('Model mapping must be a valid JSON object', 'error');
      return;
    }
  } else {
    body.modelMapping = {};
  }
  const id = form.dataset.id;
  if (f.keys && f.keys.value.trim()) {
    body.keys = f.keys.value; // string, one key per line — server trims/dedupes
  }
  let r;
  if (id) {
    r = await api('/api/channels/' + encodeURIComponent(id), { method: 'PUT', body });
    toast('Channel updated', 'success');
  } else {
    r = await api('/api/channels', { method: 'POST', body });
    toast('Channel created', 'success');
  }
  if (r && r.imported && (r.imported.added || r.imported.skipped)) {
    toast(t('Imported: {added} added, {skipped} skipped', { added: r.imported.added, skipped: r.imported.skipped }),
      r.imported.added ? 'success' : 'info');
  }
  closeModal();
  await refreshChannelsAndKeys(store.expandedChannel);
}
