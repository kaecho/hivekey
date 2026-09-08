'use strict';

/** Runtime-only channel isolation. A single real request probes recovery.
 * Generation tickets prevent old in-flight responses from closing a new circuit.
 */
class CircuitBreaker {
  constructor(getSettings, onChange = () => {}, now = Date.now) {
    this.getSettings = getSettings;
    this.onChange = onChange;
    this.now = now;
    this.entries = new Map();
  }

  _entry(id) {
    if (!this.entries.has(id)) {
      this.entries.set(id, { state: 'closed', failures: 0, retryAt: 0, generation: 0, probe: false, lastError: null });
    }
    return this.entries.get(id);
  }

  snapshot(id) {
    const entry = this.entries.get(id) || {};
    const enabled = this.getSettings().circuitBreakerThreshold > 0;
    let state = enabled ? entry.state || 'closed' : 'closed';
    if (state === 'open' && entry.retryAt <= this.now()) state = 'half_open';
    return { state, failures: entry.failures || 0, retryAt: entry.retryAt || 0, probeInFlight: !!entry.probe, lastError: entry.lastError || null };
  }

  available(id) {
    const state = this.snapshot(id);
    return state.state === 'closed' || (state.state === 'half_open' && !state.probeInFlight);
  }

  acquire(id) {
    if (!this.available(id)) return null;
    const entry = this._entry(id);
    const probe = this.snapshot(id).state === 'half_open';
    if (probe) {
      entry.state = 'half_open';
      entry.probe = true;
    }
    return { channelId: id, generation: entry.generation, probe, entry };
  }

  release(ticket) {
    const entry = this.entries.get(ticket.channelId);
    if (entry && entry === ticket.entry && ticket.generation === entry.generation && ticket.probe) entry.probe = false;
  }

  success(ticket) {
    const entry = this.entries.get(ticket.channelId);
    if (!entry || entry !== ticket.entry || ticket.generation !== entry.generation) return;
    if (ticket.probe) this.reset(ticket.channelId);
    else if (entry.state === 'closed') entry.failures = 0;
  }

  failure(ticket, message) {
    const settings = this.getSettings();
    if (!settings.circuitBreakerThreshold) return;
    const entry = this.entries.get(ticket.channelId);
    if (!entry || entry !== ticket.entry || ticket.generation !== entry.generation) return;
    entry.failures += 1;
    entry.lastError = String(message).slice(0, 300);
    if (ticket.probe || entry.failures >= settings.circuitBreakerThreshold) {
      entry.state = 'open';
      entry.retryAt = this.now() + Math.max(1000, settings.circuitBreakerCooldownMs);
      entry.generation += 1;
      entry.probe = false;
      this.onChange(ticket.channelId, this.snapshot(ticket.channelId));
    }
  }

  reset(id) {
    const entry = this._entry(id);
    Object.assign(entry, { state: 'closed', failures: 0, retryAt: 0, generation: entry.generation + 1, probe: false, lastError: null });
    this.onChange(id, this.snapshot(id));
    return this.snapshot(id);
  }
}

module.exports = { CircuitBreaker };
