'use strict';
/**
 * ChartSpec: {type, title, series:[{name, evidenceId, field}], range, note}.
 * The AI names evidence + field; the server extracts the points. The AI never supplies data points.
 */
const TYPES = new Set(['line', 'bar', 'area', 'candlestick', 'pie', 'heatmap']);
const MAX_POINTS = 500;

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['records', 'holders', 'bids', 'asks', 'assets']) if (Array.isArray(data[k])) return data[k];
  }
  return null;
}

function resolveChartSpecs(specs, results) {
  const byId = new Map((results || []).filter(r => r && r.ok && r.evidenceId).map(r => [r.evidenceId, r]));
  const charts = []; const rejected = [];
  for (const spec of (Array.isArray(specs) ? specs : []).slice(0, 4)) {
    const reason = (why) => rejected.push({ title: String(spec?.title || '').slice(0, 80), reason: why });
    if (!spec || typeof spec !== 'object') { reason('not an object'); continue; }
    if (!TYPES.has(spec.type)) { reason('unsupported type'); continue; }
    if (!Array.isArray(spec.series) || !spec.series.length) { reason('no series'); continue; }
    const series = []; let bad = null; const sources = [];
    for (const s of spec.series.slice(0, 6)) {
      const ev = byId.get(String(s?.evidenceId));
      if (!ev) { bad = 'unknown evidenceId'; break; }
      const rows = rowsOf(ev.data);
      if (!rows || !rows.length) { bad = 'evidence has no tabular data'; break; }
      const fields = spec.type === 'candlestick' ? ['o', 'h', 'l', 'c'] : [String(s.field || '')];
      if (spec.type !== 'candlestick' && !fields[0]) { bad = 'field missing'; break; }
      const sample = rows[0];
      if (!sample || typeof sample !== 'object' || fields.some(f => !(f in sample))) { bad = 'field not in evidence'; break; }
      const xKey = ['t', 'time', 'fetched_at', 'closedAt', 'sequence', 'price', 'code', 'address'].find(k => k in sample) || null;
      const pts = rows.slice(0, MAX_POINTS).map((r, i) => {
        const p = { x: xKey ? r[xKey] : i };
        for (const f of fields) { const n = Number(r[f]); p[f] = r[f] == null || !Number.isFinite(n) ? null : n; }
        return p;
      });
      series.push({ name: String(s.name || fields[0]).slice(0, 60), field: spec.type === 'candlestick' ? 'ohlc' : fields[0], evidenceId: ev.evidenceId, points: pts });
      sources.push({ evidenceId: ev.evidenceId, source: ev.source, fetchedAt: ev.fetchedAt, kind: ev.kind });
    }
    if (bad) { reason(bad); continue; }
    charts.push({ type: spec.type, title: String(spec.title || '').slice(0, 120), range: spec.range ? String(spec.range).slice(0, 40) : null,
      note: spec.note ? String(spec.note).slice(0, 300) : null, series, sources });
  }
  return { charts, rejected };
}

module.exports = { resolveChartSpecs, TYPES };
