import { $, $$, api, clearDashTimer, esc, fmtMs, fmtNum, store, toast, truncate } from '../core.js';
import { t } from '../../i18n.js';
import { icon, pageHead, field, circuitBadge, markDirty, markSaved } from '../ui.js';

export async function renderRouting() {
  $('#view').innerHTML = pageHead('Smart routing', 'Choose an objective. Let the pool handle healthy keys, busy channels and failures.',
    `<span class="badge badge-success">${esc(t('Hot reload · no restart'))}</span>`) +
    `<div class="routing-grid"><section class="card"><div id="routing-editor" class="empty">${esc(t('Loading…'))}</div></section>
      <aside class="card"><div class="section-title"><span class="section-number">02</span><h3>${esc(t('Routing preview'))}</h3></div>
        <p class="info-note">${esc(t('Uses live capacity and the selected policy. No upstream call, no tokens spent.'))}</p>
        <form id="routing-preview-form" class="preview-form"><div class="field"><label for="preview-model">${esc(t('Model'))}</label><input id="preview-model" name="model" placeholder="gpt-4o" maxlength="256" autocomplete="off"></div>
          <div class="form-grid"><div class="field"><label for="preview-stream">${esc(t('Response type'))}</label><select name="stream" id="preview-stream"><option value="true">${esc(t('Streaming'))}</option><option value="false">${esc(t('JSON response'))}</option></select></div>${field('maxTokens', 'Output token budget', 1024, '', 0, 1000000)}</div>
          <button class="btn" type="submit">${icon('play', 15)}${esc(t('Preview route'))}</button></form><div id="routing-preview-result" aria-live="polite"></div>
      </aside></div>
    <section class="card flush"><div class="card-head"><div><h3>${esc(t('Channel protection'))}</h3><div class="card-subtitle">${esc(t('Open → wait → one recovery probe → automatically return to service'))}</div></div><button class="btn btn-sm" data-action="routing-refresh">${esc(t('Refresh'))}</button></div>
      <div class="table-scroll"><table><thead><tr>${['Channel', 'Priority', 'Active keys', 'Capacity', 'Circuit state', 'Actions'].map((label) => `<th>${esc(t(label))}</th>`).join('')}</tr></thead><tbody id="circuits-tbody"></tbody></table></div></section>
    <p class="hint">${esc(t('Recovery probes use real traffic. Authentication failures still require valid keys; resetting a circuit does not enable disabled keys.'))}</p>`;
  try {
    const [settings, routing] = await Promise.all([api('/api/settings'), api('/api/routing')]);
    if (store.route !== 'routing' || !store.auth.username) return;
    store.settings = settings;
    store.routing = routing;
    renderRoutingForm();
    renderCircuitTable();
    clearDashTimer();
    store.dashTimer = setInterval(() => refreshRoutingStatus().catch(() => {}), 10000);
  } catch (error) {
    const box = $('#routing-editor');
    if (box) box.textContent = t('Failed to load settings.');
    toast(error.message, 'error');
  }
}

export function renderRoutingForm() {
  const box = $('#routing-editor');
  if (!box) return;
  const settings = store.settings || {};
  const strategies = store.routing?.strategies || [];
  box.className = '';
  box.innerHTML = `<form id="routing-form">
    <div class="section-title"><span class="section-number">01</span><h3>${esc(t('Scheduling policy'))}</h3></div>
    <div class="field"><label for="set-strategy">${esc(t('Key selection strategy'))}</label><select id="set-strategy" name="strategy">${strategies.map((s) => `<option value="${s.id}" ${s.id === settings.strategy ? 'selected' : ''}>${esc(t(s.label))}</option>`).join('')}</select></div>
    <div class="strategy-grid">${strategies.filter((s) => s.group === 'smart').map((s) => `<button type="button" class="strategy-card" data-action="routing-strategy" data-strategy="${s.id}"><strong>${icon(s.id === 'auto' ? 'spark' : 'route', 15)}${esc(t(s.label))}${s.id === 'auto' ? `<span class="recommended">${esc(t('Recommended'))}</span>` : ''}</strong><small>${esc(t(s.description))}</small></button>`).join('')}</div>
    <p class="policy-help" id="strategy-help"></p>
    <div class="preset-row"><span>${esc(t('Quick presets'))}</span>${[['balanced', 'Balanced'], ['interactive', 'Interactive'], ['resilient', 'Resilient']].map(([id, label]) => `<button type="button" class="btn btn-sm" data-action="routing-preset" data-preset="${id}">${esc(t(label))}</button>`).join('')}</div>
    <div class="form-divider"></div><div class="section-title"><h3>${esc(t('Failover & capacity'))}</h3></div>
    <div class="form-grid">
      ${field('maxAttempts', 'Max attempts', settings.maxAttempts, 'Total tries per request (first attempt + retries).', 1, 20)}
      ${field('firstByteTimeoutMs', 'First-byte timeout (ms)', settings.firstByteTimeoutMs, 'Switch before sending response bytes if the upstream is silent.', 100)}
      ${field('maxInflightPerKey', 'Concurrent requests per key', settings.maxInflightPerKey, '0 means unlimited. Busy keys are skipped, not queued.', 0, 10000)}
      ${field('circuitBreakerThreshold', 'Circuit failure threshold', settings.circuitBreakerThreshold, 'Consecutive network/5xx failures per channel. 0 disables circuits.', 0, 100)}
      ${field('circuitBreakerCooldownMs', 'Circuit recovery delay (ms)', settings.circuitBreakerCooldownMs, 'After this delay, one real request tests channel recovery.', 1000)}
      <div class="field"><label class="checklab"><input type="checkbox" name="preferDifferentChannel" ${settings.preferDifferentChannel ? 'checked' : ''}>${esc(t('Prefer another channel on failure'))}</label><div class="hint">${esc(t('Try a different failure domain before other keys on the failing channel.'))}</div></div>
    </div><p class="info-note">${esc(t('Retries happen only before response bytes are sent. Partial streams are never replayed. All attempts share the request timeout in Settings.'))}</p>
    <div class="save-bar"><span data-save-status>${esc(t('All changes saved'))}</span><button class="btn" type="button" data-action="routing-reset">${esc(t('Discard changes'))}</button><button class="btn btn-primary" type="submit">${esc(t('Save routing'))}</button></div></form>`;
  updateStrategyHelp();
}

export function updateStrategyHelp() {
  const select = $('#set-strategy');
  if (!select) return;
  const strategy = store.routing?.strategies?.find((s) => s.id === select.value);
  const hint = $('#strategy-help');
  if (hint) hint.textContent = t(strategy?.description || '');
  $$('.strategy-card').forEach((button) => {
    const active = button.dataset.strategy === select.value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

export function selectRoutingStrategy(name) {
  const select = $('#set-strategy');
  if (!select) return;
  select.value = name;
  updateStrategyHelp();
  markDirty();
}

export function applyRoutingPreset(name) {
  const presets = {
    balanced: { strategy: 'auto', maxAttempts: 3, firstByteTimeoutMs: 30000, maxInflightPerKey: 0, circuitBreakerThreshold: 3, circuitBreakerCooldownMs: 30000 },
    interactive: { strategy: 'auto', maxAttempts: 3, firstByteTimeoutMs: 10000, maxInflightPerKey: 4, circuitBreakerThreshold: 3, circuitBreakerCooldownMs: 15000 },
    resilient: { strategy: 'reliability_first', maxAttempts: 5, firstByteTimeoutMs: 20000, maxInflightPerKey: 2, circuitBreakerThreshold: 2, circuitBreakerCooldownMs: 30000 },
  };
  const preset = presets[name];
  const form = $('#routing-form');
  if (!preset || !form) return;
  for (const [key, value] of Object.entries(preset)) form.elements[key].value = value;
  form.elements.preferDifferentChannel.checked = true;
  updateStrategyHelp();
  markDirty();
  toast('Preset applied to draft. Save to activate.', 'success');
}

export async function submitRoutingForm(form) {
  const version = store.settingsEditVersion;
  const fields = form.elements;
  const body = { strategy: fields.strategy.value, preferDifferentChannel: fields.preferDifferentChannel.checked };
  for (const name of ['maxAttempts', 'firstByteTimeoutMs', 'maxInflightPerKey', 'circuitBreakerThreshold', 'circuitBreakerCooldownMs']) body[name] = Number(fields[name].value);
  const settings = await api('/api/settings', { method: 'PUT', body });
  store.settings = settings;
  if (version === store.settingsEditVersion) markSaved();
  toast('Routing saved. New requests use this policy immediately.', 'success');
  await refreshRoutingStatus();
}

let previewVersion = 0;
export async function submitRoutingPreview(form) {
  const version = ++previewVersion;
  const response = await api('/api/routing/preview', { method: 'POST', body: {
    model: form.elements.model.value.trim(), stream: form.elements.stream.value === 'true', maxTokens: Number(form.elements.maxTokens.value),
    strategy: $('#set-strategy')?.value || store.settings?.strategy || 'auto',
  } });
  const box = $('#routing-preview-result');
  if (!box || version !== previewVersion) return;
  const definition = store.routing?.strategies?.find((s) => s.id === response.effectiveStrategy);
  box.innerHTML = `<div class="preview-result"><div class="decision">${esc(t(definition?.label || response.effectiveStrategy))}</div><p class="hint">${esc(t(response.reason))}</p>
    <p><strong>${esc(t('{n} eligible keys', { n: response.totalCandidates }))}</strong></p>
    ${response.totalCandidates ? response.candidates.slice(0, 8).map((c) => `<div class="preview-candidate"><header><strong>${esc(c.channelName)}</strong><span class="mono small">${esc(c.keyMasked)}</span></header><small>${esc(t('Priority {p} · {n} in flight · TTFT {t}', { p: c.priority, n: c.inflight, t: c.ttftMs ? fmtMs(c.ttftMs) : '–' }))}</small></div>`).join('') : `<p class="info-note">${esc(t('No eligible keys. Check model rules, cooldowns, capacity and circuit status.'))}</p>`}
    <p class="hint">${esc(t('Preview does not reserve keys. Availability may change before a real request.'))}</p></div>`;
}

export async function refreshRoutingStatus() {
  if (store.route !== 'routing' || !store.auth.username) return;
  const routing = await api('/api/routing');
  if (store.route !== 'routing' || !store.auth.username) return;
  store.routing = routing;
  renderCircuitTable(); // never replace the policy form while it is being edited
}

export function renderCircuitTable() {
  const tbody = $('#circuits-tbody');
  if (!tbody) return;
  const channels = store.routing?.channels || [];
  if (!channels.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">${esc(t('No channels yet. Add one to start routing requests.'))}</td></tr>`;
    return;
  }
  tbody.innerHTML = channels.map((ch) => `<tr><td><strong>${esc(ch.name)}</strong><div class="muted small">${esc(ch.enabled ? t('Enabled') : t('Disabled'))}</div></td><td>${esc(ch.priority)}</td><td>${fmtNum(ch.activeKeyCount)} / ${fmtNum(ch.keyCount)}</td><td><div class="capacity-meter"><progress max="${ch.maxInflight || Math.max(ch.inflight, 1)}" value="${ch.inflight}"></progress><span>${ch.inflight} / ${ch.maxInflight || '∞'}</span></div></td><td>${circuitBadge(ch.circuit)}${ch.circuit?.lastError ? `<div class="circuit-error small muted" title="${esc(ch.circuit.lastError)}">${esc(truncate(ch.circuit.lastError, 90))}</div>` : ''}${ch.circuit?.state === 'open' ? `<div class="muted small">${esc(t('Probe in {t}', { t: fmtMs(Math.max(0, ch.circuit.retryAt - Date.now())) }))}</div>` : ''}</td><td><button class="btn btn-sm" data-action="circuit-reset" data-id="${esc(ch.id)}" ${ch.circuit?.state === 'closed' ? 'disabled' : ''}>${esc(t('Reset circuit'))}</button></td></tr>`).join('');
}
