import { $$, fmtAgo, fmtMs } from './core.js';
import { t } from '../i18n.js';

setInterval(() => {
  const now = Date.now();

  $$('[data-elapsed-ts]').forEach((el) => {
    const ts = Number(el.dataset.elapsedTs);
    if (ts) el.textContent = fmtMs(now - ts);
  });

  $$('[data-cooldown-until]').forEach((el) => {
    const until = Number(el.dataset.cooldownUntil) || 0;
    const remain = Math.ceil((until - now) / 1000);
    if (remain > 0) {
      el.textContent = t('cooldown · {n}s', { n: remain });
    } else {
      // Cooldown elapsed — optimistically flip to active until the server says otherwise.
      el.textContent = t('active');
      el.classList.remove('badge-cooldown');
      el.classList.add('badge-active');
      el.removeAttribute('data-cooldown-until');
    }
  });

  $$('[data-ago-ts]').forEach((el) => {
    const ts = Number(el.dataset.agoTs);
    el.textContent = fmtAgo(ts || 0);
  });
}, 1000);
