'use strict';
/** Attach display metadata — no invented values */
function meta(value, opts = {}) {
  const out = {
    value: value == null || value === '' ? null : value,
    unit: opts.unit || null,
    source: opts.source || null,
    fetchedAt: opts.fetchedAt || new Date().toISOString(),
    kind: opts.kind || 'raw'
  };
  if (out.value == null) out.display = '—';
  else if (opts.format === 'number' && typeof out.value === 'number') {
    out.display = out.value.toLocaleString(undefined, { maximumFractionDigits: opts.digits ?? 7 });
  } else out.display = String(out.value) + (out.unit ? ' ' + out.unit : '');
  return out;
}
function networkStatus(closedAtIso, capacityStr, successRate) {
  // derived from age of latest ledger + optional capacity/success
  if (!closedAtIso) {
    return { status: 'unknown', reason: 'no ledger close time', kind: 'derived' };
  }
  const closedMs = new Date(closedAtIso).getTime();
  if (!Number.isFinite(closedMs) || closedMs <= 0 || closedMs > Date.now() + 5000) {
    return { status: 'unknown', reason: 'invalid ledger close time', kind: 'derived' };
  }
  const ageSec = Math.max(0, (Date.now() - closedMs) / 1000);
  let status = 'ok';
  let reason = `ledger age ${Math.round(ageSec)}s`;
  if (ageSec > 60) { status = 'stalled'; reason = `ledger age ${Math.round(ageSec)}s (>60s)`; }
  else if (ageSec > 20) { status = 'slow'; reason = `ledger age ${Math.round(ageSec)}s (20–60s)`; }
  const cap = capacityStr != null && capacityStr !== '—' ? Number(capacityStr) : null;
  if (cap != null && !Number.isNaN(cap) && cap >= 0.8) {
    if (status === 'ok') status = 'busy';
    reason += `; capacity ${(cap * 100).toFixed(0)}%`;
  }
  if (successRate != null && successRate < 0.9) {
    if (status === 'ok') status = 'degraded';
    reason += `; success ${(successRate * 100).toFixed(0)}%`;
  }
  return { status, reason, ageSec, kind: 'derived' };
}
module.exports = { meta, networkStatus };
