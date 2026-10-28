'use strict';
/**
 * Lightweight technical indicators from OHLC closes — all derived, labeled.
 * Returns null fields when not enough history (never invents).
 */
function closesFromCandles(candles) {
  return (candles || [])
    .map(c => Number(c.c != null ? c.c : c.close))
    .filter(n => Number.isFinite(n));
}

function sma(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values, period = 14) {
  if (!values || values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function analyzeCandles(candles, meta = {}) {
  const closes = closesFromCandles(candles);
  const n = closes.length;
  const last = n ? closes[n - 1] : null;
  const first = n ? closes[0] : null;
  const changePct = last != null && first ? ((last - first) / first) * 100 : null;
  const sma7 = sma(closes, 7);
  const sma14 = sma(closes, Math.min(14, n));
  const ema12 = ema(closes, Math.min(12, n));
  const rsi14 = rsi(closes, 14);
  let trend = null;
  if (sma7 != null && sma14 != null && last != null) {
    if (last > sma7 && sma7 >= sma14) trend = 'up';
    else if (last < sma7 && sma7 <= sma14) trend = 'down';
    else trend = 'sideways';
  }
  let rsiZone = null;
  if (rsi14 != null) {
    if (rsi14 >= 70) rsiZone = 'overbought';
    else if (rsi14 <= 30) rsiZone = 'oversold';
    else rsiZone = 'neutral';
  }
  return {
    kind: 'derived',
    source: 'trade_aggregations closes',
    sampleSize: n,
    lastClose: last,
    changePct,
    sma7,
    sma14: n >= 14 ? sma(closes, 14) : null,
    ema12: n >= 12 ? ema(closes, 12) : null,
    rsi14,
    rsiZone,
    trend,
    pair: meta.pair || null,
    network: meta.network || null,
    note: n < 7 ? 'insufficient_history' : null,
    disclaimer: 'Statistical estimate from available Horizon candles only. Not investment advice. Testnet has no real value.'
  };
}

module.exports = { analyzeCandles, sma, ema, rsi, closesFromCandles };
