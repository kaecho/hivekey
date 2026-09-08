import { $, api, clearDashTimer, closeModal, store, toast } from './core.js';
import { t } from '../i18n.js';
import { connectSSE, disconnectSSE } from './realtime.js';

export async function boot() {
  try {
    const me = await api('/api/auth/me', { noAuthHandler: true });
    enterApp(me.username, null); // cookie session; SSE also works via cookie
  } catch (e) {
    showLogin();
  }
}

export function enterApp(username, token) {
  store.auth.username = username;
  store.auth.token = token;
  $('#login-view').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  $('#whoami').textContent = username || '';
  connectSSE();
  document.dispatchEvent(new Event('route-refresh'));
}

export function showLogin() {
  $('#shell').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  const u = $('#login-username');
  if (u) u.focus();
}

export function onUnauthorized() {
  const wasIn = store.auth.username !== null;
  store.auth.username = null;
  store.auth.token = null;
  store.settingsDirty = false;
  store.keysByChannel = {};
  store.tokens = [];
  store.revealedTokens.clear();
  disconnectSSE();
  clearDashTimer();
  closeModal();
  showLogin();
  if (wasIn) toast('Session expired. Please sign in again.', 'error');
}

export async function doLogin(form) {
  const errBox = $('#login-error');
  errBox.classList.add('hidden');
  const btn = $('#login-btn');
  btn.disabled = true;
  try {
    const d = await api('/api/auth/login', {
      method: 'POST',
      noAuthHandler: true,
      body: {
        username: form.elements.username.value,
        password: form.elements.password.value,
      },
    });
    form.reset();
    enterApp(d.username, d.token);
  } catch (e) {
    errBox.textContent = t(e.message);
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

export async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST', noAuthHandler: true }); } catch (e) { /* ignore */ }
  store.auth.username = null;
  store.auth.token = null;
  store.overview = null;
  store.keysByChannel = {};
  store.revealKeys = {};
  store.tokens = [];
  store.revealedTokens.clear();
  store.logs = [];
  store.settingsDirty = false;
  closeModal();
  store.live.clear();
  store.recent = [];
  disconnectSSE();
  clearDashTimer();
  showLogin();
}
