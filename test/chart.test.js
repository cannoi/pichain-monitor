'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Ind = require('../public/pi-indicators.js');
const { normalizeAggs, aggregate, TIMEFRAMES } = require('../lib/analytics/candles');
const { assetParams } = require('../lib/horizon/pair');

const mk = (n, t0 = 0, step = 3600000) => Array.from({ length: n }, (_, i) => {
  const c = 100 + i; return { t: t0 + i * step, o: c - 0.5, h: c + 1, l: c - 1, c, v: 10, cv: 10 * c, n: 2 };
});

test('SMA/EMA: null until enough history, correct values', () => {
  const s = Ind.sma([1, 2, 3, 4, 5], 3); assert.deepEqual(s, [null, null, 2, 3, 4]);
  const e = Ind.ema([1, 2, 3, 4, 5], 3); assert.equal(e[1], null); assert.equal(e[2], 2); assert.equal(e[3], 3); assert.equal(e[4], 4);
  assert.deepEqual(Ind.sma([1, 2], 5), [null, null]);
});
test('RSI: 100 on strictly rising series, 0 on falling, null before period', () => {
  const up = Ind.rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14);
  assert.equal(up[13], null); assert.equal(up[29], 100);
  const down = Ind.rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14);
  assert.ok(down[29] < 1e-9);
});
test('Bollinger: flat series gives zero-width bands; MACD aligns lengths', () => {
  const b = Ind.bollinger(new Array(25).fill(5), 20, 2); assert.equal(b.upper[24], 5); assert.equal(b.lower[24], 5); assert.equal(b.mid[18], null);
  const m = Ind.macd(Array.from({ length: 60 }, (_, i) => 50 + Math.sin(i / 3) * 5), 12, 26, 9);
  assert.equal(m.line.length, 60); assert.equal(m.line[24], null); assert.notEqual(m.line[25], null); assert.notEqual(m.hist[59], null);
});
test('VWAP uses volumes only and is null without volume; Heikin-Ashi keeps length/volume', () => {
  const c = mk(5); const v = Ind.vwap(c); assert.ok(Math.abs(v[4] - (c.reduce((a, k) => a + k.cv, 0) / c.reduce((a, k) => a + k.v, 0))) < 1e-9);
  assert.deepEqual(Ind.vwap([{ t: 1, o: 1, h: 1, l: 1, c: 1 }]), [null]);
  const ha = Ind.heikinAshi(c); assert.equal(ha.length, 5); assert.equal(ha[2].v, 10);
});
test('Stochastic stays within 0..100', () => {
  const st = Ind.stochastic(mk(30), 14, 3); st.k.filter(x => x != null).forEach(x => assert.ok(x >= 0 && x <= 100));
});

test('normalizeAggs: sorts ascending, de-duplicates, drops malformed rows, never invents volume', () => {
  const recs = [
    { timestamp: '2000', open: '1', high: '2', low: '1', close: '2', base_volume: '5', counter_volume: '9', trade_count: '3' },
    { timestamp: '1000', open: '1', high: '1', low: '1', close: '1' },
    { timestamp: '1000', open: '1', high: '1', low: '1', close: '1' },
    { timestamp: 'x', open: '1', high: '1', low: '1', close: '1' }];
  const c = normalizeAggs(recs); assert.deepEqual(c.map(k => k.t), [1000, 2000]); assert.equal(c[0].v, null); assert.equal(c[1].v, 5);
});
test('aggregate 4h from 1h and 1M from 1d (OHLC, volume sums, month boundary)', () => {
  const H = 3600000; const hrs = mk(8, 0, H); const a = aggregate(hrs, '4h');
  assert.equal(a.length, 2); assert.equal(a[0].o, hrs[0].o); assert.equal(a[0].c, hrs[3].c); assert.equal(a[0].h, hrs[3].h); assert.equal(a[0].l, hrs[0].l); assert.equal(a[0].v, 40);
  const D = 86400000, jan31 = Date.UTC(2026, 0, 31);
  const days = [0, 1, 2].map(i => ({ t: jan31 + i * D, o: 1 + i, h: 2 + i, l: 0.5, c: 1.5 + i, v: 1, cv: 1, n: 1 }));
  const m = aggregate(days, '1M'); assert.equal(m.length, 2); assert.equal(m[0].t, Date.UTC(2026, 0, 1)); assert.equal(m[1].t, Date.UTC(2026, 1, 1)); assert.equal(m[1].v, 2);
  assert.equal(aggregate(hrs, '1h'), hrs);
});
test('timeframes: only Horizon-supported native resolutions are requested', () => {
  const ok = new Set([60000, 300000, 900000, 3600000, 86400000, 604800000]);
  for (const [k, d] of Object.entries(TIMEFRAMES)) assert.ok(ok.has(d.native), k);
});
test('asset codes keep their case (on-chain codes are case-sensitive)', () => {
  assert.equal(assetParams('base', 'USDt', 'GISSUER').base_asset_code, 'USDt');
  assert.equal(assetParams('base', 'pi').base_asset_type, 'native');
});

test('PiChart renders every type/indicator combination without throwing and supports PNG export', () => {
  const noop = () => {};
  // Every numeric argument sent to the canvas must be finite (catches NaN/Infinity geometry bugs)
  const guard = (name) => (...a) => { a.forEach(v => { if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite arg to ' + name + ': ' + a.join(',')); }); };
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 20 }) : k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : k in t ? t[k] : guard(String(k))), set: (t, k, v) => { t[k] = v; return true; } });
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx, addEventListener: noop, setPointerCapture: noop, getBoundingClientRect: () => ({ left: 0, top: 0 }), toDataURL: () => 'data:image/png;base64,AA==', parentNode: null };
  const container = { clientWidth: 640, clientHeight: 520, appendChild: noop };
  globalThis.document = { createElement: () => canvas }; globalThis.PiInd = Ind; globalThis.requestAnimationFrame = (f) => { f(); return 1; }; globalThis.devicePixelRatio = 2;
  delete require.cache[require.resolve('../public/pi-chart.js')]; require('../public/pi-chart.js');
  const chart = globalThis.PiChart.create(container);
  const data = mk(120).map((k, i) => (i % 17 === 0 ? { ...k, v: null, cv: null } : k)).filter((_, i) => i % 11 !== 5); // gaps + missing volume
  chart.setData(data, 3600000);
  for (const type of ['candles', 'hollow', 'ohlc', 'heikin', 'line', 'area']) {
    for (const vol of [true, false]) {
      chart.setOptions({ type, volume: vol, ind: { sma: true, ema: true, bb: true, vwap: true, rsi: true, macd: true, stoch: true } });
      chart._state.cross = { x: 300, y: 100 }; chart.resize();
    }
  }
  chart.setData([], 3600000); chart.setData(mk(1), 3600000); chart.setData(mk(3), 60000);
  assert.match(chart.toDataURL(), /^data:image\/png/);
  chart.destroy();
  assert.equal(globalThis.PiChart.fmtPrice(0.000123456), '0.0001235');
  assert.equal(globalThis.PiChart.fmtVol(1500000), '1.50M');
});
