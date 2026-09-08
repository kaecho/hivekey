import { api, cssEsc, fmtMs, loadChannelsData, store, toast, truncate, withBusy } from '../core.js';
import { t } from '../../i18n.js';
import { chTestHtml, refreshChannelsAndKeys, renderChannelsTable } from '../views/channels.js';
import { keyPanelState, refreshKeyPanel } from '../views/keys.js';
import { loadModalKeys, openChannelModal, renderModalKeys, renderModalKeysList } from '../views/channel-modal.js';
import { fetchModelsForForm, focusModelInput, modelSelAdd, modelSelToggle, renderModelBox } from '../views/models.js';

export async function channelAction(el) {
  const action = el.dataset.action;
  const id = el.dataset.id;
  const chId = el.dataset.ch;
  switch (action) {
    case 'keys-page': {
      const st = keyPanelState(id);
      st.page += Number(el.dataset.dir) || 0;
      refreshKeyPanel(id);
      break;
    }

    case 'modal-keys-page':
      store.modalKeys.page += Number(el.dataset.dir) || 0;
      renderModalKeysList(chId);
      break;

    case 'keys-test-all': {
      const keys = store.keysByChannel[id] || [];
      if (!keys.length) { toast('No keys in this channel. Import some below.', 'error'); return; }
      const r = await withBusy(el, () => api('/api/channels/' + encodeURIComponent(id) + '/test-keys', { method: 'POST', body: {} }));
      ((r && r.results) || []).forEach((tr) => {
        const out = document.querySelector('[data-test-result="' + cssEsc(tr.keyId) + '"]');
        if (!out) return; // key not on the current page
        if (tr.ok) {
          out.textContent = 'OK · ' + tr.statusCode + ' · ' + fmtMs(tr.latencyMs);
          out.className = 'test-result ok-text';
        } else {
          out.textContent = t('Failed') +
            (tr.statusCode ? ' · ' + tr.statusCode : '') +
            (tr.error ? ' · ' + truncate(tr.error, 60) : '');
          out.className = 'test-result err-text';
        }
      });
      toast(t('Key test finished: {ok} ok, {failed} failed', { ok: (r && r.ok) || 0, failed: (r && r.failed) || 0 }),
        r && r.failed ? 'error' : 'success');
      break;
    }

    case 'channel-add':
      openChannelModal(null);
      break;

    case 'fetch-models':
      await fetchModelsForForm(el);
      break;

    case 'model-remove': {
      if (!store.modelSel) break;
      const i = store.modelSel.selected.indexOf(el.dataset.model);
      if (i >= 0) store.modelSel.selected.splice(i, 1);
      renderModelBox();
      focusModelInput();
      break;
    }

    case 'model-opt':
      modelSelToggle(el.dataset.model);
      break;

    case 'model-add-custom':
      modelSelAdd(el.dataset.model);
      break;

    case 'models-select-all': {
      if (!store.modelSel) break;
      const q = store.modelSel.query.trim().toLowerCase();
      store.modelSel.options
        .filter((m) => !q || m.toLowerCase().indexOf(q) >= 0)
        .forEach((m) => { if (store.modelSel.selected.indexOf(m) < 0) store.modelSel.selected.push(m); });
      renderModelBox();
      focusModelInput();
      break;
    }

    case 'models-clear':
      if (!store.modelSel) break;
      store.modelSel.selected = [];
      renderModelBox();
      focusModelInput();
      break;

    case 'channel-edit': {
      const ch = store.channels.find((c) => c.id === id);
      if (ch) openChannelModal(ch);
      break;
    }

    case 'channel-delete': {
      const ch = store.channels.find((c) => c.id === id);
      const name = ch ? ch.name : id;
      if (!confirm(t('Delete channel "{name}" and all of its keys?', { name: name }))) return;
      await withBusy(el, () => api('/api/channels/' + encodeURIComponent(id), { method: 'DELETE' }));
      if (store.expandedChannel === id) store.expandedChannel = null;
      delete store.keysByChannel[id];
      toast('Channel deleted', 'success');
      await refreshChannelsAndKeys(null);
      break;
    }

    case 'channel-test': {
      store.channelTest[id] = { state: 'testing' };
      const cell = document.querySelector('[data-chtest="' + cssEsc(id) + '"]');
      if (cell) cell.innerHTML = chTestHtml(id);
      try {
        const r = await withBusy(el, () => api('/api/channels/fetch-models', { method: 'POST', body: { channelId: id } }));
        store.channelTest[id] = {
          state: 'done',
          ok: !!(r && r.ok),
          statusCode: (r && r.statusCode) || 0,
          latencyMs: r && r.latencyMs,
          error: r && r.error,
        };
      } catch (err) {
        store.channelTest[id] = { state: 'done', ok: false, statusCode: 0, latencyMs: null, error: err.message };
      }
      const done = document.querySelector('[data-chtest="' + cssEsc(id) + '"]');
      if (done) done.innerHTML = chTestHtml(id);
      break;
    }

    case 'channels-refresh':
      await withBusy(el, () => refreshChannelsAndKeys(store.expandedChannel));
      break;

    case 'modal-key-toggle': {
      const enabled = el.dataset.enabled === 'true';
      await withBusy(el, () => api('/api/keys/' + encodeURIComponent(id), { method: 'PATCH', body: { enabled: enabled } }));
      toast('Key ' + (enabled ? 'enabled' : 'disabled'), 'success');
      await loadModalKeys(chId);
      await loadChannelsData();
      if (store.route === 'channels') renderChannelsTable();
      break;
    }

    case 'modal-key-delete': {
      if (!confirm(t('Delete this key?'))) return;
      await withBusy(el, () => api('/api/keys/' + encodeURIComponent(id), { method: 'DELETE' }));
      store.selectedKeys.delete(id);
      toast('Key deleted', 'success');
      store.keysByChannel[chId] = (store.keysByChannel[chId] || []).filter((k) => k.id !== id);
      renderModalKeys(chId);
      await loadChannelsData();
      if (store.route === 'channels') renderChannelsTable();
      break;
    }

    case 'key-toggle': {
      const enabled = el.dataset.enabled === 'true';
      await withBusy(el, () => api('/api/keys/' + encodeURIComponent(id), { method: 'PATCH', body: { enabled: enabled } }));
      toast('Key ' + (enabled ? 'enabled' : 'disabled'), 'success');
      await refreshChannelsAndKeys(chId);
      break;
    }

    case 'key-reset':
      await withBusy(el, () => api('/api/keys/' + encodeURIComponent(id) + '/reset', { method: 'POST' }));
      toast('Key reset', 'success');
      await refreshChannelsAndKeys(chId);
      break;

    case 'key-test': {
      const out = document.querySelector('[data-test-result="' + cssEsc(id) + '"]');
      if (out) { out.textContent = t('Testing…'); out.className = 'test-result muted'; }
      try {
        const r = await withBusy(el, () => api('/api/keys/' + encodeURIComponent(id) + '/test', { method: 'POST' }));
        const fresh = document.querySelector('[data-test-result="' + cssEsc(id) + '"]');
        if (fresh) {
          if (r && r.ok) {
            fresh.textContent = 'OK · ' + r.statusCode + ' · ' + fmtMs(r.latencyMs);
            fresh.className = 'test-result ok-text';
          } else {
            fresh.textContent = t('Failed') +
              (r && r.statusCode ? ' · ' + r.statusCode : '') +
              (r && r.error ? ' · ' + truncate(r.error, 70) : '');
            fresh.className = 'test-result err-text';
          }
        }
      } catch (err) {
        const fresh = document.querySelector('[data-test-result="' + cssEsc(id) + '"]');
        if (fresh) { fresh.textContent = t('Test failed · {err}', { err: truncate(err.message, 70) }); fresh.className = 'test-result err-text'; }
        throw err;
      }
      break;
    }

    case 'key-delete':
      if (!confirm(t('Delete this key?'))) return;
      await withBusy(el, () => api('/api/keys/' + encodeURIComponent(id), { method: 'DELETE' }));
      store.selectedKeys.delete(id);
      toast('Key deleted', 'success');
      await refreshChannelsAndKeys(chId);
      break;

    case 'keys-batch': {
      const ids = [...store.selectedKeys];
      if (!ids.length) return true;
      if (!confirm(t('Apply this action to {n} selected keys?', { n: ids.length }))) return true;
      const result = await withBusy(el, () => api('/api/keys/batch', { method: 'POST', body: { ids, action: el.dataset.operation } }));
      toast(t('Updated {n} keys', { n: result.updated }), 'success');
      store.selectedKeys.clear();
      await refreshChannelsAndKeys(id);
      break;
    }

    case 'keys-delete-selected': {
      const ids = Array.from(store.selectedKeys);
      if (!ids.length) return;
      if (!confirm(t('Delete {n} selected keys?', { n: ids.length }))) return;
      const r = await withBusy(el, () => api('/api/keys/batch-delete', { method: 'POST', body: { ids: ids } }));
      store.selectedKeys.clear();
      toast(t('Deleted {n} keys', { n: (r && r.deleted) != null ? r.deleted : ids.length }), 'success');
      await refreshChannelsAndKeys(id); // data-id on this button is the channel id
      break;
    }

    case 'keys-import': {
      const ta = document.getElementById('import-keys-' + id);
      const text = ta ? ta.value : '';
      if (!text.trim()) { toast('Paste at least one key first', 'error'); return; }
      const r = await withBusy(el, () =>
        api('/api/channels/' + encodeURIComponent(id) + '/keys', { method: 'POST', body: { keys: text } }));
      const added = r && r.added != null ? r.added : 0;
      const skipped = r && r.skipped != null ? r.skipped : 0;
      toast(t('Imported: {added} added, {skipped} skipped', { added: added, skipped: skipped }), added ? 'success' : 'info');
      await refreshChannelsAndKeys(id);
      const res = document.getElementById('import-result-' + id);
      if (res) res.textContent = t('{added} added, {skipped} skipped', { added: added, skipped: skipped });
      break;
    }

    default: return false;
  }
  return true;
}
