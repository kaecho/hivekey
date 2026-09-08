import { $, copyText, store, withBusy } from '../core.js';
import { icon, downloadFile } from '../ui.js';
import { t } from '../../i18n.js';
import { fetchLogs, readLogFilters, renderLogStatus } from '../views/logs.js';
import { logsToCsv } from '../log-export.mjs';

export async function logAction(element) {
  switch (element.dataset.action) {
    case 'logs-refresh':
      readLogFilters();
      await withBusy(element, fetchLogs);
      break;
    case 'logs-pause':
      store.logsPaused = !store.logsPaused;
      store.logVersion += 1; // freeze even if an earlier refresh is still pending
      element.innerHTML = icon(store.logsPaused ? 'play' : 'pause', 15) + t(store.logsPaused ? 'Resume live' : 'Pause live');
      element.setAttribute('aria-pressed', String(store.logsPaused));
      renderLogStatus();
      if (!store.logsPaused) await withBusy(element, fetchLogs);
      break;
    case 'logs-export':
      downloadFile('hivekey-requests-' + new Date().toISOString().slice(0, 10) + '.csv', logsToCsv(store.logs), 'text/csv;charset=utf-8');
      break;
    case 'log-copy-id': await copyText(element.dataset.id || ''); break;
    case 'logs-clear': {
      const form = $('#logs-filter');
      if (!form) return true;
      form.elements.q.value = '';
      form.elements.channelId.value = '';
      form.elements.status.value = '';
      form.elements.retried.checked = false;
      readLogFilters();
      await fetchLogs();
      break;
    }
    default: return false;
  }
  return true;
}
