import { api, store, toast, withBusy } from '../core.js';
import { t } from '../../i18n.js';
import { markSaved } from '../ui.js';
import { selectRoutingStrategy, applyRoutingPreset, refreshRoutingStatus, renderRoutingForm } from '../views/routing.js';

export async function routingAction(element) {
  switch (element.dataset.action) {
    case 'routing-strategy': selectRoutingStrategy(element.dataset.strategy); break;
    case 'routing-preset': applyRoutingPreset(element.dataset.preset); break;
    case 'routing-refresh': await withBusy(element, refreshRoutingStatus); break;
    case 'routing-reset':
      if (store.settingsDirty && !confirm(t('Discard unsaved changes?'))) return true;
      renderRoutingForm();
      markSaved();
      break;
    case 'circuit-reset':
      if (!confirm(t('Reset this channel circuit? Disabled keys will remain disabled.'))) return true;
      await withBusy(element, async () => {
        await api(`/api/routing/channels/${encodeURIComponent(element.dataset.id)}/reset`, { method: 'POST', body: {} });
        await refreshRoutingStatus();
      });
      toast('Circuit reset', 'success');
      break;
    default: return false;
  }
  return true;
}
