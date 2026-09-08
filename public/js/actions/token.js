import { api, copyText, store, toast, withBusy } from '../core.js';
import { t } from '../../i18n.js';
import { renderTokensTable } from '../views/tokens.js';

export async function tokenAction(el) {
  const action = el.dataset.action;
  const id = el.dataset.id;
  const chId = el.dataset.ch;
  switch (action) {
    case 'token-reveal':
      if (store.revealedTokens.has(id)) store.revealedTokens.delete(id);
      else store.revealedTokens.add(id);
      renderTokensTable();
      break;

    case 'token-copy':
      await copyText(store.tokens.find((token) => token.id === id)?.token || '');
      break;

    case 'token-delete': {
      if (!confirm(t('Delete this access token? Clients using it will stop working.'))) return;
      await withBusy(el, () => api('/api/tokens/' + encodeURIComponent(id), { method: 'DELETE' }));
      toast('Token deleted', 'success');
      store.tokens = (await api('/api/tokens')) || [];
      renderTokensTable();
      break;
    }

    default: return false;
  }
  return true;
}
