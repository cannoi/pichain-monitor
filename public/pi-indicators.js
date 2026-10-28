/* PiChain indicators — pure functions, UMD (browser: window.PiInd, Node: require).
 * Input candles: [{t,o,h,l,c,v,cv}] ascending. Every output array has the same length as the input;
 * positions without enough history are null (never filled with invented values). All results are "derived". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PiInd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const closes = (cs) => cs.map(c => c.c);

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    if (!(period >= 1)) return out;
    let sum = 0, n = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) { sum = 0; n = 0; continue; }
      sum += v; n++;
      if (n > period) { sum -= values[i - period]; n = period; }
      if (n === period) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period || !(period >= 1)) return out;
    const k = 2 / (period + 1);
    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    let e = seed / period; out[period - 1] = e;
    for (let i = period; i < values.length; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }

  function bollinger(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const up = new Array(values.length).fill(null), lo = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      if (mid[i] == null) continue;
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += (values[j] - mid[i]) * (values[j] - mid[i]);
      const sd = Math.sqrt(s / period);
      up[i] = mid[i] + mult * sd; lo[i] = mid[i] - mult * sd;
    }
    return { mid, upper: up, lower: lo };
  }

  /** Cumulative VWAP over the loaded window: sum(counter volume)/sum(base volume). Null when volume absent. */
  function vwap(candles) {
    let cv = 0, bv = 0;
    return candles.map(c => {
      if (Number.isFinite(c.v) && Number.isFinite(c.cv)) { bv += c.v; cv += c.cv; }
      return bv > 0 ? cv / bv : null;
    });
  }

  /** Wilder RSI */
  function rsi(values, period = 14) {
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= period; l /= period;
    out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      g = (g * (period - 1) + (d > 0 ? d : 0)) / period;
      l = (l * (period - 1) + (d < 0 ? -d : 0)) / period;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }

  function macd(values, fast = 12, slow = 26, signal = 9) {
    const ef = ema(values, fast), es = ema(values, slow);
    const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const first = line.findIndex(v => v != null);
    const sig = new Array(values.length).fill(null);
    if (first >= 0) {
      const tail = ema(line.slice(first), signal);
      tail.forEach((v, i) => { sig[first + i] = v; });
    }
    const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
    return { line, signal: sig, hist };
  }

  /** Stochastic %K (period) smoothed %D */
  function stochastic(candles, period = 14, smooth = 3) {
    const k = candles.map((c, i) => {
      if (i < period - 1) return null;
      let hi = -Infinity, lo = Infinity;
      for (let j = i - period + 1; j <= i; j++) { hi = Math.max(hi, candles[j].h); lo = Math.min(lo, candles[j].l); }
      return hi === lo ? null : ((c.c - lo) / (hi - lo)) * 100;
    });
    return { k, d: sma(k, smooth) };
  }

  /** Heikin-Ashi transform (derived candles; volume kept) */
  function heikinAshi(candles) {
    const out = []; let pO = null, pC = null;
    for (const c of candles) {
      const hc = (c.o + c.h + c.l + c.c) / 4;
      const ho = pO == null ? (c.o + c.c) / 2 : (pO + pC) / 2;
      out.push({ ...c, o: ho, c: hc, h: Math.max(c.h, ho, hc), l: Math.min(c.l, ho, hc) });
      pO = ho; pC = hc;
    }
    return out;
  }

  return { closes, sma, ema, bollinger, vwap, rsi, macd, stochastic, heikinAshi };
});
