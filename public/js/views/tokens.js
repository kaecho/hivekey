import { pageHead, icon } from '../ui.js';
import { $, api, esc, fmtAgo, fmtDate, fmtNum, store, toast } from '../core.js';
import { t } from '../../i18n.js';

export async function renderTokens() {
  $('#view').innerHTML =
    pageHead('Access tokens', 'Give each application its own credential. Keep upstream keys private.') +
    '<div class="card">' +
      '<form id="token-create-form" class="inline-form">' +
        '<input name="name" required aria-label="' + esc(t('Token name')) + '" placeholder="' + esc(t('Token name (e.g. my-app)')) + '">' +
        '<button type="submit" class="btn btn-primary">' + esc(t('Create token')) + '</button>' +
      '</form>' +
      '<p class="hint" style="margin:10px 0 0">' + esc(t('Use this as the Bearer token when calling the pool’s /v1 endpoint.')) + '</p>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-head"><h3>' + esc(t('API endpoints')) + '</h3></div>' +
      [
        ['OpenAI SDK', 'POST ' + location.origin + '/v1/chat/completions'],
        ['OpenAI Responses API', 'POST ' + location.origin + '/v1/responses'],
        ['Anthropic SDK (Claude)', 'POST ' + location.origin + '/v1/messages'],
        ['Google Gemini SDK', 'POST ' + location.origin + '/v1beta/models/{model}:generateContent'],
      ].map((row) =>
        '<div class="ep-row"><span class="ep-name">' + esc(t(row[0])) + '</span><code class="mono small">' + esc(row[1]) + '</code><button class="btn btn-sm" data-action="copy-text" data-copy="' + esc(row[1].replace(/^POST /, '')) + '">' + esc(t('Copy')) + '</button></div>'
      ).join('') +
      '<p class="hint" style="margin:10px 0 0">' + esc(t('Every endpoint accepts the pool access token — as Bearer, x-api-key, x-goog-api-key or ?key=.')) + '</p>' +
    '</div>' +
    '<div class="card flush"><div class="table-scroll"><table>' +
      '<thead><tr><th>' + esc(t('Name')) + '</th><th>' + esc(t('Token')) + '</th><th>' + esc(t('Enabled')) + '</th><th class="num">' + esc(t('Requests')) + '</th>' +
      '<th>' + esc(t('Created')) + '</th><th>' + esc(t('Last used')) + '</th><th>' + esc(t('Actions')) + '</th></tr></thead>' +
      '<tbody id="tokens-tbody"><tr><td colspan="7" class="empty">' + esc(t('Loading…')) + '</td></tr></tbody>' +
    '</table></div></div>';

  try {
    store.tokens = (await api('/api/tokens')) || [];
    renderTokensTable();
  } catch (e) {
    const tbody = $('#tokens-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty">' + esc(t('Failed to load tokens.')) + '</td></tr>';
    toast(e.message, 'error');
  }
}

export function renderTokensTable() {
  const tbody = $('#tokens-tbody');
  if (!tbody) return;
  if (!store.tokens.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">' + esc(t('No access tokens yet. Create one so clients can call /v1.')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = store.tokens.map((tk) => {
    return '<tr>' +
      '<td><div class="cell-title">' + esc(tk.name) + '</div></td>' +
      '<td><span class="mono token-mask">' + esc(store.revealedTokens.has(tk.id) ? tk.token : tk.token.slice(0, 10) + '…' + tk.token.slice(-4)) + '</span> ' +
        '<button class="btn btn-sm" data-action="token-reveal" data-id="' + esc(tk.id) + '">' + esc(t(store.revealedTokens.has(tk.id) ? 'Hide' : 'Reveal')) + '</button> ' +
        '<button class="btn btn-sm" data-action="token-copy" data-id="' + esc(tk.id) + '">' + esc(t('Copy')) + '</button></td>' +
      '<td><label class="switch"><input type="checkbox" aria-label="' + esc(t('Toggle token')) + '" data-toggle="token" data-id="' + esc(tk.id) + '"' +
        (tk.enabled ? ' checked' : '') + '><span class="sl"></span></label></td>' +
      '<td class="num">' + fmtNum(tk.requests || 0) + '</td>' +
      '<td class="muted small">' + esc(fmtDate(tk.createdAt)) + '</td>' +
      '<td class="muted small" data-ago-ts="' + esc(tk.lastUsedAt || '') + '">' + esc(fmtAgo(tk.lastUsedAt)) + '</td>' +
      '<td class="actions"><button class="btn btn-sm btn-danger" data-action="token-delete" data-id="' + esc(tk.id) + '">' + esc(t('Delete')) + '</button></td>' +
      '</tr>';
  }).join('');
}
