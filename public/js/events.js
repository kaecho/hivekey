import { $, $$, api, closeModal, store, toast, withBusy } from './core.js';
import { setLang, t } from '../i18n.js';
import { doLogin } from './auth.js';
import { renderConnStatus } from './realtime.js';
import { refreshChannelsAndKeys, renderChannelsTable } from './views/channels.js';
import { keyPanelState, loadKeysAndRender, refreshKeyPanel, updateBatchBar, visibleKeys } from './views/keys.js';
import { renderModalKeysList, submitChannelForm } from './views/channel-modal.js';
import { focusModelInput, modelSelAdd, renderModelBox, renderModelDropdown } from './views/models.js';
import { renderTokensTable } from './views/tokens.js';
import { fetchLogs, readLogFilters, renderLogsTable } from './views/logs.js';
import { submitSettingsForm } from './views/settings.js';
import { submitRoutingForm, submitRoutingPreview, updateStrategyHelp } from './views/routing.js';
import { markDirty, setSidebarOpen } from './ui.js';
import { routingAction } from './actions/routing.js';
import { channelAction } from './actions/channel.js';
import { systemAction } from './actions/system.js';
import { tokenAction } from './actions/token.js';
import { logAction } from './actions/log.js';

document.addEventListener('click', async (e) => {
  // Clicking outside the model selector closes its dropdown.
  if (store.modelSel && store.modelSel.open && !e.target.closest('[data-model-widget]')) {
    store.modelSel.open = false;
    renderModelDropdown();
  }

  const actEl = e.target.closest('[data-action]');
  if (actEl) {
    e.preventDefault();
    await runAction(actEl).catch((err) => toast(err.message, 'error'));
    return;
  }

  // Clicking the model selector box focuses its input and opens the list.
  const mbox = e.target.closest('[data-model-box]');
  if (mbox) {
    if (store.modelSel) {
      store.modelSel.open = true;
      renderModelDropdown();
    }
    const inp = mbox.querySelector('[data-model-input]');
    if (inp) inp.focus();
    return;
  }

  // Expand/collapse channel row -> key panel
  const chRow = e.target.closest('tr[data-channel-row]');
  if (chRow && !e.target.closest('[data-stop]')) {
    const id = chRow.getAttribute('data-channel-row');
    if (store.expandedChannel === id) {
      store.expandedChannel = null;
    } else {
      store.expandedChannel = id;
      store.selectedKeys.clear();
    }
    renderChannelsTable();
    if (store.expandedChannel && store.keysByChannel[store.expandedChannel] === undefined) {
      loadKeysAndRender(store.expandedChannel);
    }
    return;
  }

  // Expand/collapse log row
  const logRow = e.target.closest('tr[data-log-row]');
  if (logRow && !e.target.closest('[data-stop]')) {
    const id = logRow.getAttribute('data-log-row');
    if (store.expandedLogs.has(id)) store.expandedLogs.delete(id);
    else store.expandedLogs.add(id);
    renderLogsTable();
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.closest('#routing-form, #settings-form')) markDirty();
  try {
    if (el.matches('[data-lang-sel]')) {
      if (store.settingsDirty && !confirm(t('Discard unsaved changes?'))) { el.value = document.documentElement.lang; return; }
      store.settingsDirty = false;
      setLang(el.value);
      renderConnStatus();
      if (store.auth.username !== null) document.dispatchEvent(new Event('route-refresh')); // re-render the current view in the new language

    } else if (el.matches('[data-toggle="channel"]')) {
      await api('/api/channels/' + encodeURIComponent(el.dataset.id), { method: 'PUT', body: { enabled: el.checked } });
      toast('Channel ' + (el.checked ? 'enabled' : 'disabled'), 'success');
      await refreshChannelsAndKeys(store.expandedChannel);

    } else if (el.matches('[data-toggle="token"]')) {
      await api('/api/tokens/' + encodeURIComponent(el.dataset.id), { method: 'PATCH', body: { enabled: el.checked } });
      const tok = store.tokens.find((x) => x.id === el.dataset.id);
      if (tok) tok.enabled = el.checked;
      toast('Token ' + (el.checked ? 'enabled' : 'disabled'), 'success');

    } else if (el.matches('[data-reveal]')) {
      store.revealKeys[el.dataset.id] = el.checked;
      await loadKeysAndRender(el.dataset.id);

    } else if (el.matches('[data-keysel]')) {
      if (el.checked) store.selectedKeys.add(el.dataset.keysel);
      else store.selectedKeys.delete(el.dataset.keysel);
      updateBatchBar();

    } else if (el.matches('[data-keysel-all]')) {
      // select the keys visible on the current page (post-filter)
      const v = visibleKeys(el.dataset.id);
      const items = (v && v.items) || [];
      items.forEach((k) => {
        if (el.checked) store.selectedKeys.add(k.id);
        else store.selectedKeys.delete(k.id);
      });
      $$('[data-keysel]').forEach((cb) => { cb.checked = store.selectedKeys.has(cb.dataset.keysel); });
      updateBatchBar();

    } else if (el.matches('[data-modal-keys-status]')) {
      store.modalKeys.status = el.value;
      store.modalKeys.page = 1;
      renderModalKeysList(el.dataset.ch);

    } else if (el.closest('#logs-filter') && el.name !== 'q') {
      readLogFilters();
      await fetchLogs();

    } else if (el.id === 'set-strategy') {
      updateStrategyHelp();
    }
  } catch (err) {
    toast(err.message, 'error');
    if (el.type === 'checkbox') el.checked = !el.checked; // revert failed toggle
  }
});

/* ----- debounced free-text log search ----- */

let logSearchTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.closest('#routing-form, #settings-form')) markDirty();
  if (e.target.matches('#logs-filter input[name="q"]')) {
    clearTimeout(logSearchTimer);
    logSearchTimer = setTimeout(() => {
      readLogFilters();
      fetchLogs();
    }, 300);
  } else if (e.target.matches('[data-model-input]')) {
    if (store.modelSel) {
      store.modelSel.query = e.target.value;
      store.modelSel.open = true;
      renderModelDropdown();
    }
  } else if (e.target.matches('[data-channel-search]')) {
    store.channelFilter = e.target.value;
    renderChannelsTable();
  } else if (e.target.matches('[data-keys-search]')) {
    const st = keyPanelState(e.target.dataset.id);
    st.q = e.target.value;
    st.page = 1;
    refreshKeyPanel(e.target.dataset.id);
  } else if (e.target.matches('[data-modal-keys-search]')) {
    store.modalKeys.q = e.target.value;
    store.modalKeys.page = 1;
    renderModalKeysList(e.target.dataset.ch);
  }
});

/* ----- form submits ----- */

document.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();
  try {
    if (form.id === 'login-form') {
      await doLogin(form);
    } else if (form.id === 'channel-form') {
      await withBusy(form.querySelector('[type=submit]'), () => submitChannelForm(form));
    } else if (form.id === 'token-create-form') {
      const name = form.elements.name.value.trim();
      if (!name) return;
      await api('/api/tokens', { method: 'POST', body: { name: name } });
      form.reset();
      toast('Token created', 'success');
      store.tokens = (await api('/api/tokens')) || [];
      renderTokensTable();
    } else if (form.id === 'routing-form') {
      await withBusy(form.querySelector('[type=submit]'), () => submitRoutingForm(form));
    } else if (form.id === 'routing-preview-form') {
      await withBusy(form.querySelector('[type=submit]'), () => submitRoutingPreview(form));
    } else if (form.id === 'settings-form') {
      await withBusy(form.querySelector('[type=submit]'), () => submitSettingsForm(form));
    } else if (form.id === 'logs-filter') {
      readLogFilters();
      await fetchLogs();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

/* ----- keyboard ----- */

document.addEventListener('keydown', (e) => {
  const modal = document.querySelector('#modal-root:not(.hidden) .modal');
  if (e.key === 'Tab' && modal) {
    const focusable = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter((el) => el.offsetParent !== null);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  if (!modal && !e.target.closest('input, textarea, select, [contenteditable=true]') && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'))) {
    e.preventDefault();
    document.querySelector('[data-action=global-search]')?.click();
    return;
  }
  if (e.key === 'Enter' && e.target.matches('tr[data-channel-row], tr[data-log-row]')) { e.preventDefault(); e.target.click(); return; }
  if (e.key === 'Escape') setSidebarOpen(false);
  // Model tag input: Enter/comma adds, Backspace pops, Escape closes the dropdown only.
  if (e.target.matches && e.target.matches('[data-model-input]') && store.modelSel) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault(); // never submit the channel form from here
      const v = e.target.value.trim();
      if (v) modelSelAdd(v);
      return;
    }
    if (e.key === 'Backspace' && e.target.value === '' && store.modelSel.selected.length) {
      store.modelSel.selected.pop();
      renderModelBox();
      focusModelInput();
      return;
    }
    if (e.key === 'Escape' && store.modelSel.open) {
      store.modelSel.open = false;
      renderModelDropdown();
      return;
    }
  }
  if (e.key === 'Escape' && !$('#modal-root').classList.contains('hidden')) {
    closeModal();
  }
});

export async function runAction(el) {
  for (const handler of [channelAction, systemAction, tokenAction, logAction, routingAction]) {
    if (await handler(el)) return;
  }
}
