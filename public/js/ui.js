import { esc, store } from './core.js';
import { t } from '../i18n.js';

const paths = {
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  route: '<path d="M4 6h4a4 4 0 0 1 4 4v4a4 4 0 0 0 4 4h4M16 14l4 4-4 4M4 18h3M16 6h4M16 2l4 4-4 4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-3-3 3-3m-6 0 3-3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
};

export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.activity}</svg>`;
}

export function pageHead(title, description, actions = '') {
  return `<div class="view-head"><div><div class="eyebrow">${esc(t('WORKSPACE'))}</div><h2>${esc(t(title))}</h2><p class="view-description">${esc(t(description))}</p></div><div class="head-actions">${actions}</div></div>`;
}

export function metric(label, value, description, symbol, tone = '') {
  return `<div class="metric ${tone}"><div class="metric-top"><span>${esc(t(label))}</span><span class="metric-icon">${icon(symbol)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(description)}</div></div>`;
}

export function field(name, label, value, hint = '', min = 0, max = 86400000) {
  return `<div class="field"><label for="field-${name}">${esc(t(label))}</label><input id="field-${name}" type="number" name="${name}" min="${min}" max="${max}" step="1" required value="${esc(value ?? '')}">${hint ? `<div class="hint">${esc(t(hint))}</div>` : ''}</div>`;
}

export function circuitBadge(circuit = {}) {
  const labels = { closed: 'Closed', open: 'Circuit open', half_open: 'Recovery probe' };
  const tone = circuit.state === 'open' ? 'error' : circuit.state === 'half_open' ? 'cooldown' : 'success';
  return `<span class="badge badge-${tone}">${esc(t(labels[circuit.state] || 'Closed'))}</span>`;
}

export function downloadFile(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function markDirty() {
  store.settingsDirty = true;
  store.settingsEditVersion += 1;
  document.querySelectorAll('[data-save-status]').forEach((el) => { el.textContent = t('Unsaved changes'); });
}

export function markSaved() {
  store.settingsDirty = false;
  document.querySelectorAll('[data-save-status]').forEach((el) => { el.textContent = t('All changes saved'); });
}

export function setSidebarOpen(open) {
  const shell = document.getElementById('shell');
  const sidebar = document.getElementById('sidebar');
  const button = document.querySelector('.mobile-menu');
  const mobile = window.matchMedia('(max-width: 850px)').matches;
  const wasOpen = shell.classList.contains('sidebar-open');
  shell.classList.toggle('sidebar-open', open && mobile);
  sidebar.inert = mobile && !open;
  if (button) button.setAttribute('aria-expanded', String(open && mobile));
  if (open && mobile && !wasOpen) sidebar.querySelector('a')?.focus();
  else if (!open && wasOpen && sidebar.contains(document.activeElement)) button?.focus();
}
