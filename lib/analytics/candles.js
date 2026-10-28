'use strict';
/**
 * Candle helpers. Horizon /trade_aggregations only supports these resolutions:
 * 1m, 5m, 15m, 1h, 1d, 1w. Other timeframes (30m, 4h, 1M) are DERIVED by aggregating a
 * smaller native timeframe — they are labelled derived and never interpolated or gap-filled.
 */
const MIN = 60000, HOUR = 3600000, DAY = 86400000, WEEK = 604800000;
const TIMEFRAMES = {
  '1m':  { ms: MIN,      native: MIN },
  '5m':  { ms: 5 * MIN,  native: 5 * MIN },
  '15m': { ms: 15 * MIN, native: 15 * MIN },
  '30m': { ms: 30 * MIN, native: 15 * MIN, factor: 2 },
  '1h':  { ms: HOUR,     native: HOUR },
  '4h':  { ms: 4 * HOUR, native: HOUR, factor: 4 },
  '1d':  { ms: DAY,      native: DAY },
  '1w':  { ms: WEEK,     native: WEEK },
  '1M':  { ms: 30 * DAY, native: DAY, calendar: 'month' }
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Horizon trade_aggregation records (any order) → ascending numeric candles, de-duplicated by timestamp. */
function normalizeAggs(records) {
  const seen = new Map();
  for (const r of records || []) {
    const t = num(r.timestamp);
    const o = num(r.open), h = num(r.high), l = num(r.low), c = num(r.close);
    if (t == null || o == null || h == null || l == null || c == null) continue;
    seen.set(t, { t, o, h, l, c, v: num(r.base_volume), cv: num(r.counter_volume), n: num(r.trade_count) });
  }
  return [...seen.values()].sort((a, b) => a.t - b.t);
}

function bucketStart(t, tf) {
  const def = TIMEFRAMES[tf];
  if (def.calendar === 'month') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  return Math.floor(t / def.ms) * def.ms;
}

/** Aggregate ascending candles into buckets of the target timeframe. Missing volumes stay null. */
function aggregate(candles, tf) {
  const def = TIMEFRAMES[tf];
  if (!def || (!def.factor && !def.calendar)) return candles;
  const out = []; let cur = null;
  for (const k of candles) {
    const b = bucketStart(k.t, tf);
    if (!cur || cur.t !== b) {
      cur = { t: b, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, cv: k.cv, n: k.n };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, k.h); cur.l = Math.min(cur.l, k.l); cur.c = k.c;
      cur.v = cur.v == null || k.v == null ? (cur.v ?? k.v) : cur.v + k.v;
      cur.cv = cur.cv == null || k.cv == null ? (cur.cv ?? k.cv) : cur.cv + k.cv;
      cur.n = cur.n == null || k.n == null ? (cur.n ?? k.n) : cur.n + k.n;
    }
  }
  return out;
}

module.exports = { TIMEFRAMES, normalizeAggs, aggregate, bucketStart };
