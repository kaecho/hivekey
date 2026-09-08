import { renderSettingsForm } from '../views/settings.js';
import { setSidebarOpen } from '../ui.js';
import { api, closeModal, copyText, loadChannelsData, store, toast, withBusy } from '../core.js';
import { t } from '../../i18n.js';
import { applyTheme } from '../theme.js';
import { doLogout } from '../auth.js';
import { renderDashStats } from '../views/dashboard.js';

export async function systemAction(el) {
  const action = el.dataset.action;
  const id = el.dataset.id;
  const chId = el.dataset.ch;
  switch (action) {
    case 'skip-content': document.getElementById('main').focus(); break;
    case 'sidebar-toggle': setSidebarOpen(!document.getElementById('shell').classList.contains('sidebar-open')); break;
    case 'sidebar-close': setSidebarOpen(false); break;
    case 'global-search':
      location.hash = '#/logs';
      setTimeout(() => document.querySelector('#logs-filter input[name=q]')?.focus(), 0);
      break;
    case 'copy-endpoint': await copyText(location.origin + '/v1'); break;
    case 'copy-text': await copyText(el.dataset.copy || ''); break;

    case 'logout':
      await doLogout();
      break;

    case 'theme-set':
      applyTheme(el.dataset.themeOpt);
      break;

    case 'modal-close':
      closeModal();
      break;

    case 'export-data': {
      const res = await fetch('/api/export', {
        credentials: 'same-origin',
        headers: store.auth.token ? { Authorization: 'Bearer ' + store.auth.token } : {},
      });
      if (!res.ok) { toast('Export failed', 'error'); return; }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hivekey-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      break;
    }

    case 'import-data': {
      const fileInput = document.getElementById('import-file');
      const file = fileInput && fileInput.files && fileInput.files[0];
      if (!file) { toast('Choose a backup file first', 'error'); return; }
      const modeSel = document.getElementById('import-mode');
      const mode = modeSel ? modeSel.value : 'merge';
      if (mode === 'replace' && !confirm(t('Replace ALL channels, keys and tokens with the backup?'))) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (err) {
        toast('Invalid backup file', 'error');
        return;
      }
      const r = await withBusy(el, () => api('/api/import', { method: 'POST', body: { data: data, mode: mode } }));
      toast(t('Imported: {c} channels, {k} keys, {t} tokens', {
        c: (r && r.channels) || 0, k: (r && r.keys) || 0, t: (r && r.tokens) || 0,
      }), 'success');
      if (fileInput) fileInput.value = '';
      store.keysByChannel = {};
      store.revealKeys = {};
      store.revealedTokens.clear();
      store.selectedKeys.clear();
      await loadChannelsData();
      store.settings = await api('/api/settings');
      if (store.route === 'settings' && !store.settingsDirty) renderSettingsForm();
      break;
    }

    case 'problem-key-reset': {
      await withBusy(el, () => api('/api/keys/' + encodeURIComponent(id) + '/reset', { method: 'POST' }));
      toast('Key reset', 'success');
      try { store.overview = await api('/api/overview'); } catch (e) { /* banner refresh is best-effort */ }
      renderDashStats();
      break;
    }

    default: return false;
  }
  return true;
}
