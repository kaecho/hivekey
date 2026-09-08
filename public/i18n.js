import zhCN from './js/locales/zh-cn.js';

const I18N_DICT = { 'zh-CN': zhCN };

let I18N_LANG = (() => {
  try {
    const saved = localStorage.getItem('hivekey-lang');
    if (saved && (saved === 'en' || I18N_DICT[saved])) return saved;
  } catch (e) { /* storage unavailable */ }
  return (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh-CN' : 'en';
})();

export function t(str, params) {
  const dict = I18N_DICT[I18N_LANG];
  let out = dict && Object.prototype.hasOwnProperty.call(dict, str) ? dict[str] : str;
  if (params) {
    out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
  }
  return out;
}

export function setLang(lang) {
  I18N_LANG = (lang === 'en' || I18N_DICT[lang]) ? lang : 'en';
  try { localStorage.setItem('hivekey-lang', I18N_LANG); } catch (e) { /* ignore */ }
  applyStaticI18n();
}

/* Translate static markup: data-i18n (textContent), data-i18n-title,
 * data-i18n-placeholder. Also syncs <html lang> and the language pickers. */
export function applyStaticI18n() {
  document.documentElement.lang = I18N_LANG === 'zh-CN' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-lang-sel]').forEach((sel) => {
    sel.value = I18N_LANG;
  });
}

applyStaticI18n();
