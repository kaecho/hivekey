import { t } from '../i18n.js';

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

export const cssEsc = (window.CSS && CSS.escape)
  ? CSS.escape
  : (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);

// Escape any server-provided string before it goes into HTML.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function fmtNum(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a < 10000) return n.toLocaleString('en-US');
  if (a < 1e6) return (n / 1e3).toFixed(1) + 'K';
  if (a < 1e9) return (n / 1e6).toFixed(1) + 'M';
  return (n / 1e9).toFixed(1) + 'B';
}

export function fmtMs(ms) {
  if (ms == null || isNaN(ms)) return '–';
  ms = Number(ms);
  if (ms < 1000) return Math.round(ms) + ' ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
  return (ms / 60000).toFixed(1) + ' m';
}

export function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString() : '–';
}

export function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleString() : '–';
}

export function fmtAgo(ts) {
  if (!ts) return t('never');
  const d = Date.now() - ts;
  if (d < 5000) return t('just now');
  if (d < 60000) return t('{n}s ago', { n: Math.floor(d / 1000) });
  if (d < 3600000) return t('{n}m ago', { n: Math.floor(d / 60000) });
  if (d < 86400000) return t('{n}h ago', { n: Math.floor(d / 3600000) });
  return new Date(ts).toLocaleDateString();
}

export function fmtUptime(ms) {
  if (!ms) return '–';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm ' + (s % 60) + 's';
}

export function pct(part, whole) {
  return whole ? ((part / whole) * 100).toFixed(1) + '%' : '–';
}

/* ============================================================
 * Store
 * ============================================================ */

export const store = {
  auth: { username: null, token: null },
  route: 'dashboard',
  overview: null,
  channels: [],
  keysByChannel: {},        // channelId -> [Key]
  revealKeys: {},           // channelId -> bool
  expandedChannel: null,
  selectedKeys: new Set(),
  channelFilter: '',
  keyPanelState: {},        // channelId -> {q, page}
  modalKeys: { q: '', page: 1, status: '' },
  channelTest: {},          // channelId -> {state, ok, statusCode, latencyMs, error}
  tokens: [],
  revealedTokens: new Set(),
  settingsEditVersion: 0,
  logs: [],
  expandedLogs: new Set(),
  logFilters: { q: '', channelId: '', status: '', limit: 100, retried: false },
  logsPaused: false,
  logVersion: 0,
  settingsDirty: false,
  modelSel: null,
  routing: null,
  live: new Map(),          // id -> live entry
  recent: [],               // latest finished requests (dashboard)
  settings: null,
  sse: { es: null, connected: false, retryMs: 1000, timer: null },
  dashTimer: null,
};

export async function api(path, opts) {
  opts = opts || {};
  const init = {
    method: opts.method || 'GET',
    headers: {},
    credentials: 'same-origin',
  };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (store.auth.token) {
    init.headers['Authorization'] = 'Bearer ' + store.auth.token;
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new Error(t('Network error. Is the server running?'));
  }

  if (res.status === 401 && !opts.noAuthHandler) document.dispatchEvent(new Event('session-expired'));

  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch (e) { /* non-JSON body */ }

  if (!res.ok) {
    throw new Error((data && data.error) || (res.status + ' ' + res.statusText));
  }
  return data;
}

export function toast(msg, type) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast-' + type : '');
  el.textContent = t(msg); // untranslated keys and server errors get localized; pre-translated strings pass through
  el.addEventListener('click', () => el.remove());
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, 4000);
}

export function openModal(html) {
  const root = $('#modal-root');
  store.modalFocus = document.activeElement;
  $('#shell').inert = true;
  root.innerHTML =
    '<div class="modal-backdrop" data-action="modal-close"></div>' +
    '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
    '<button type="button" class="modal-close btn btn-icon" data-action="modal-close" aria-label="' + esc(t('Close')) + '">×</button>' + html + '</div>';
  root.querySelectorAll('.field').forEach((field) => {
    const input = field.querySelector('input, textarea, select');
    const label = field.querySelector('label');
    if (input && label && !label.contains(input)) {
      if (!input.id) input.id = 'modal-field-' + input.name;
      label.htmlFor = input.id;
    }
  });
  const title = root.querySelector('h3');
  if (title) title.id = 'modal-title';
  root.classList.remove('hidden');
  const first = root.querySelector('input, select, textarea');
  if (first) first.focus();
}

export function closeModal() {
  const root = $('#modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
  $('#shell').inert = false;
  if (store.modalFocus && document.contains(store.modalFocus)) store.modalFocus.focus();
  store.modalFocus = null;
  store.modelSel = null; // drop channel-modal selector state
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success');
  } catch (e) {
    // Clipboard API can be unavailable on http:// origins — fall back.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      if (!document.execCommand('copy')) throw new Error('clipboard unavailable');
      toast('Copied to clipboard', 'success');
    } catch (e2) {
      toast('Copy failed. Select the token manually.', 'error');
    }
    ta.remove();
  }
}

export async function withBusy(btn, fn) {
  if (btn && btn.tagName === 'BUTTON') btn.disabled = true;
  try {
    return await fn();
  } finally {
    if (btn && btn.tagName === 'BUTTON' && document.contains(btn)) btn.disabled = false;
  }
}

export function statusBadgeHtml(en) {
  if (en.status === 'aborted') return '<span class="badge badge-cooldown">' + esc(t('aborted')) + '</span>';
  const ok = en.status === 'success';
  const label = (en.statusCode != null && en.statusCode !== 0)
    ? en.statusCode
    : (ok ? t('ok') : t('error'));
  return '<span class="badge ' + (ok ? 'badge-success' : 'badge-error') + '">' + esc(label) + '</span>';
}

export async function loadChannelsData() {
  store.channels = (await api('/api/channels')) || [];
}

export function clearDashTimer() {
  if (store.dashTimer) { clearInterval(store.dashTimer); store.dashTimer = null; }
}
