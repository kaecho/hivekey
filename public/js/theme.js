import { $$ } from './core.js';

export function getTheme() {
  try {
    const theme = localStorage.getItem('hivekey-theme');
    if (theme === 'light' || theme === 'dark') return theme;
  } catch { /* storage unavailable */ }
  return 'auto';
}

export function applyTheme(preference) {
  const theme = ['light', 'dark'].includes(preference) ? preference : 'auto';
  try { localStorage.setItem('hivekey-theme', theme); } catch { /* storage unavailable */ }
  document.documentElement.dataset.theme = theme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  $$('[data-theme-opt]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeOpt === theme);
    button.setAttribute('aria-pressed', String(button.dataset.themeOpt === theme));
  });
  document.dispatchEvent(new Event('theme-change'));
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getTheme() === 'auto') applyTheme('auto');
});
