import { $, $$, clearDashTimer, closeModal, store } from './js/core.js';
import { t } from './i18n.js';
import { applyTheme, getTheme } from './js/theme.js';
import { boot, onUnauthorized } from './js/auth.js';
import { drawHistoryChart } from './js/chart.js';
import { setSidebarOpen } from './js/ui.js';
import { renderDashboard } from './js/views/dashboard.js';
import { renderChannels } from './js/views/channels.js';
import { renderTokens } from './js/views/tokens.js';
import { renderLogs } from './js/views/logs.js';
import { renderSettings } from './js/views/settings.js';
import { renderRouting } from './js/views/routing.js';
import './js/events.js';
import './js/ticker.js';

const views = {
  dashboard: { title: 'Overview', render: renderDashboard },
  channels: { title: 'Channels', render: renderChannels },
  routing: { title: 'Smart routing', render: renderRouting },
  tokens: { title: 'Access tokens', render: renderTokens },
  logs: { title: 'Request logs', render: renderLogs },
  settings: { title: 'Settings', render: renderSettings },
};

function onRoute() {
  const segment = (location.hash || '').replace(/^#\/?/, '').split('/')[0];
  const route = Object.prototype.hasOwnProperty.call(views, segment) ? segment : 'dashboard';
  if (segment !== route) {
    history.replaceState(null, '', '#/' + route);
  }
  if (store.settingsDirty && route !== store.route && !confirm(t('Discard unsaved changes?'))) {
    history.replaceState(null, '', '#/' + store.route);
    return;
  }
  store.settingsDirty = false;
  store.settingsEditVersion += 1;
  store.route = route;
  store.logVersion += 1;
  clearDashTimer();
  closeModal();
  setSidebarOpen(false);
  $$('#nav a').forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $('#route-title').textContent = t(views[route].title);
  document.title = t(views[route].title) + ' · HiveKey';
  if (!store.auth.username) return;
  $('#main').scrollTop = 0;
  views[route].render();
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (store.route === 'dashboard') drawHistoryChart();
    setSidebarOpen(false);
  }, 150);
});
window.addEventListener('beforeunload', (event) => {
  if (store.settingsDirty) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('hashchange', onRoute);
document.addEventListener('route-refresh', onRoute);
document.addEventListener('session-expired', onUnauthorized);
document.addEventListener('theme-change', drawHistoryChart);
applyTheme(getTheme());
setSidebarOpen(false);
boot();
