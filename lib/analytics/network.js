'use strict';
/** Derived network metrics from snapshot rows — no invented points */
function summarizeSnapshots(points) {
  if (!points || !points.length) {
    return { count: 0, heightDelta: null, avgCapacity: null, note: 'no snapshots' };
  }
  const heights = points.map(p => p.height).filter(h => h != null);
  const caps = points.map(p => p.capacity).filter(c => c != null && !Number.isNaN(c));
  return {
    count: points.length,
    heightFrom: heights[0] ?? null,
    heightTo: heights[heights.length - 1] ?? null,
    heightDelta: heights.length >= 2 ? heights[heights.length - 1] - heights[0] : null,
    avgCapacity: caps.length ? caps.reduce((a, b) => a + b, 0) / caps.length : null,
    kind: 'derived',
    source: 'network_snapshots'
  };
}
module.exports = { summarizeSnapshots };
