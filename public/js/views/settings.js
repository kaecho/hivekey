import { $, api, esc, store, toast } from '../core.js';
import { t } from '../../i18n.js';
import { pageHead, icon, field, markSaved } from '../ui.js';

export async function renderSettings() {
  $('#view').innerHTML = pageHead('Settings', 'Keep request limits, access control and backups in one place.',
    `<a href="#/routing" class="btn">${icon('route', 16)}${esc(t('Smart routing'))}</a>`) +
    `<div class="settings-grid"><section class="card"><div id="settings-box" class="empty">${esc(t('Loading…'))}</div></section>
      <aside class="card"><div class="card-head"><h3>${esc(t('Backup & restore'))}</h3></div>
        <p class="hint">${esc(t('Download all channels, keys, tokens and settings as JSON.'))}</p>
        <div class="backup-row"><button class="btn" data-action="export-data">${icon('download', 15)}${esc(t('Export backup'))}</button></div>
        <div class="form-divider"></div><div class="field"><label for="import-file">${esc(t('Backup file'))}</label><input type="file" id="import-file" accept=".json,application/json"></div>
        <div class="backup-row"><label for="import-mode" class="sr-only">${esc(t('Import mode'))}</label><select id="import-mode"><option value="merge">${esc(t('Merge (add new only)'))}</option><option value="replace">${esc(t('Replace everything'))}</option></select><button class="btn" data-action="import-data">${esc(t('Import backup'))}</button></div>
        <p class="hint">${esc(t('Merge adds missing channels, keys and tokens. Replace overwrites the whole configuration (admin login is kept).'))}</p>
        <p class="backup-warning">${esc(t('Backups contain plaintext API keys and tokens. Store them securely and never commit them to Git.'))}</p>
      </aside></div>`;
  try {
    const settings = await api('/api/settings');
    if (store.route !== 'settings' || !store.auth.username) return;
    store.settings = settings;
    renderSettingsForm();
  } catch (error) {
    const box = $('#settings-box');
    if (box) box.textContent = t('Failed to load settings.');
    toast(error.message, 'error');
  }
}

export function renderSettingsForm() {
  const settings = store.settings || {};
  const box = $('#settings-box');
  if (!box) return;
  box.className = '';
  box.innerHTML = `<form id="settings-form" class="settings-form"><div class="section-title"><h3>${esc(t('Request budget'))}</h3></div><div class="form-grid">
    ${field('requestTimeoutMs', 'Request timeout (ms)', settings.requestTimeoutMs, 'One deadline for all attempts, including the response stream.', 1000)}
    ${field('connectTimeoutMs', 'Connect timeout (ms)', settings.connectTimeoutMs, 'Upstream connection timeout.', 100)}
    </div><div class="form-divider"></div><div class="section-title"><h3>${esc(t('Key protection'))}</h3></div><div class="form-grid">
    ${field('cooldown429BaseMs', 'Cooldown after 429 (ms)', settings.cooldown429BaseMs, 'Base cooldown when a key gets rate-limited.', 1000)}
    ${field('cooldownErrorBaseMs', 'Cooldown after error (ms)', settings.cooldownErrorBaseMs, 'Base cooldown after other upstream errors.', 1000)}
    ${field('cooldownMaxMs', 'Max cooldown (ms)', settings.cooldownMaxMs, 'Upper bound for exponential cooldown.', 1000)}
    ${field('disableAfterConsecutiveFailures', 'Disable after failures', settings.disableAfterConsecutiveFailures, '0 disables this threshold. Repeated authentication failures still disable invalid keys.')}
    <div class="field span2"><label for="retry-codes">${esc(t('Retry on status codes'))}</label><input id="retry-codes" name="retryOn" value="${esc((settings.retryOn || []).join(', '))}" placeholder="429, 500, 502, 503, 504"><div class="hint">${esc(t('Comma-separated HTTP codes (400–599). 404 always tries another key without changing key health.'))}</div></div>
    </div><div class="form-divider"></div><div class="section-title"><h3>${esc(t('Logs & access'))}</h3></div><div class="form-grid">
    ${field('logLimit', 'Log limit', settings.logLimit, 'Number of request logs kept in memory.', 50, 10000)}
    <div class="field"><label class="checklab"><input type="checkbox" name="allowAnonymous" ${settings.allowAnonymous ? 'checked' : ''}>${esc(t('Allow anonymous access to /v1 (no access token required)'))}</label><div class="hint">${esc(t('Keep this off for public deployments. All supported protocols share this setting.'))}</div></div>
    </div><div class="save-bar"><span data-save-status>${esc(t('All changes saved'))}</span><button type="submit" class="btn btn-primary">${esc(t('Save settings'))}</button></div></form>`;
}

export async function submitSettingsForm(form) {
  const version = store.settingsEditVersion;
  const fields = form.elements;
  const retryOn = fields.retryOn.value.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (retryOn.some((n) => !Number.isInteger(n) || n < 400 || n > 599)) {
    toast('Retry codes must be HTTP status codes (400–599)', 'error');
    return;
  }
  const body = { retryOn, allowAnonymous: fields.allowAnonymous.checked };
  for (const name of ['requestTimeoutMs', 'connectTimeoutMs', 'cooldown429BaseMs', 'cooldownErrorBaseMs', 'cooldownMaxMs', 'disableAfterConsecutiveFailures', 'logLimit']) body[name] = Number(fields[name].value);
  store.settings = await api('/api/settings', { method: 'PUT', body });
  if (version === store.settingsEditVersion) markSaved();
  toast('Settings saved', 'success');
}
