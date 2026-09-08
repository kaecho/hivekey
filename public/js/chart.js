import { $, esc, fmtNum, store } from './core.js';
import { t } from '../i18n.js';

let chartGeom = null;

export function niceStep(v) {
  v = Math.max(v, 1);
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const steps = [1, 2, 5];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] * p >= v) return steps[i] * p;
  }
  return 10 * p;
}

export function drawHistoryChart() {
  const canvas = $('#rpm-chart');
  if (!canvas) return;
  const hist = ((store.overview && store.overview.history) || []).slice(-60);
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(wrap.clientWidth || 0, 280);
  const H = 220;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const padL = 38, padR = 6, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const baseY = padT + plotH;
  // pull colors from the active theme so the canvas follows light/dark
  const css = getComputedStyle(document.documentElement);
  const cssVar = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
  const cGrid = cssVar('--grid', '#2c2c2a');
  const cBase = cssVar('--baseline', '#383835');
  const cMuted = cssVar('--muted', '#898781');
  const cGood = cssVar('--good', '#0ca30c');
  const cCrit = cssVar('--crit', '#d03b3b');
  ctx.font = '11px system-ui, sans-serif';

  const maxV = Math.max(1, ...hist.map((b) =>
    Math.max(Number(b.requests) || 0, (Number(b.success) || 0) + (Number(b.failed) || 0))));
  const step = niceStep(maxV / 4);
  const top = Math.max(step, Math.ceil(maxV / step) * step);
  const yFor = (v) => baseY - (v / top) * plotH;

  // Gridlines + y labels (hairline, recessive)
  for (let v = 0; v <= top; v += step) {
    const y = Math.round(yFor(v)) + 0.5;
    ctx.strokeStyle = v === 0 ? cBase : cGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillStyle = cMuted;
    ctx.textAlign = 'right';
    ctx.fillText(fmtNum(v), padL - 6, y + 3.5);
  }

  chartGeom = { slots: [], padT, plotH, padL, W, H };

  if (hist.length === 0) {
    ctx.fillStyle = cMuted;
    ctx.textAlign = 'center';
    ctx.fillText(t('No traffic yet'), padL + plotW / 2, padT + plotH / 2);
    return;
  }

  const n = hist.length;
  const slotW = plotW / n;
  const barW = Math.min(24, Math.max(2, slotW - 2)); // ≤24px thick, ≥2px surface gap between bars
  const r = Math.min(4, barW / 2);

  hist.forEach((b, i) => {
    const x = padL + i * slotW + (slotW - barW) / 2;
    const s = Number(b.success) || 0;
    const f = Number(b.failed) || 0;
    const hs = (s / top) * plotH;
    const hf = (f / top) * plotH;
    let topY = baseY;
    if (s > 0) {
      const y = baseY - hs;
      if (f > 0) {
        ctx.fillStyle = cGood; // interior segment: square ends
        ctx.fillRect(x, y, barW, hs);
      } else {
        fillRoundedTop(ctx, x, y, barW, hs, r, cGood);
      }
      topY = y;
    }
    if (f > 0) {
      const gap = s > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const h = Math.max(hf, 1.5);
      fillRoundedTop(ctx, x, topY - gap - h, barW, h, r, cCrit);
    }
    // x labels on quarter hours
    const d = new Date(Number(b.ts) || 0);
    if (b.ts && d.getMinutes() % 15 === 0) {
      ctx.fillStyle = cMuted;
      ctx.textAlign = 'center';
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      ctx.fillText(hh + ':' + mm, x + barW / 2, H - 6);
    }
    chartGeom.slots.push({ x0: padL + i * slotW, x1: padL + (i + 1) * slotW, b });
  });
}

export function fillRoundedTop(ctx, x, y, w, h, r, color) {
  if (h <= 0) return;
  const rr = Math.min(r, h);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);            // bottom-left (square at baseline)
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);  // rounded data-end
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

export function wireChartHover() {
  const canvas = $('#rpm-chart');
  const tip = $('#chart-tip');
  const band = $('#chart-band');
  if (!canvas || !tip) return;

  canvas.addEventListener('mousemove', (e) => {
    if (!chartGeom || !chartGeom.slots.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const slot = chartGeom.slots.find((s) => mx >= s.x0 && mx < s.x1);
    if (!slot) { tip.classList.add('hidden'); band.classList.add('hidden'); return; }
    const b = slot.b;
    const d = new Date(Number(b.ts) || 0);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    tip.innerHTML =
      '<div class="tip-time">' + hh + ':' + mm + '</div>' +
      '<div>' + esc(t('{n} requests', { n: fmtNum(b.requests || 0) })) + '</div>' +
      '<div><span class="sw" style="background:var(--good);display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></span>' + esc(t('{n} success', { n: fmtNum(b.success || 0) })) + '</div>' +
      '<div><span class="sw" style="background:var(--crit);display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></span>' + esc(t('{n} failed', { n: fmtNum(b.failed || 0) })) + '</div>';
    tip.classList.remove('hidden');
    band.classList.remove('hidden');
    band.style.left = slot.x0 + 'px';
    band.style.width = (slot.x1 - slot.x0) + 'px';
    band.style.top = chartGeom.padT + 'px';
    band.style.height = chartGeom.plotH + 'px';
    const wrapW = canvas.parentElement.clientWidth;
    const tipW = tip.offsetWidth || 120;
    let left = mx + 14;
    if (left + tipW > wrapW - 4) left = mx - tipW - 14;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = Math.max(0, e.clientY - rect.top - 20) + 'px';
  });

  canvas.addEventListener('mouseleave', () => {
    tip.classList.add('hidden');
    band.classList.add('hidden');
  });
}
