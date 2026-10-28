/* PiChart — dependency-free canvas market chart (no CDN). Mobile-first: drag = pan, pinch / wheel = zoom,
 * tap / hover = crosshair, double-tap/click = reset. Candles are positioned by TIME, so periods without
 * trades stay visibly empty (nothing is interpolated or invented).
 * Types: candles | hollow | ohlc | line | area | heikin. Optional volume + indicators (derived, see pi-indicators.js). */
(function (root) {
  'use strict';
  const Ind = root.PiInd;
  const C = { bg: '#020617', grid: 'rgba(51,65,85,.38)', text: '#94a3b8', up: '#34d399', down: '#f87171',
    sma: '#fbbf24', ema: '#60a5fa', bb: 'rgba(167,139,250,.9)', bbFill: 'rgba(167,139,250,.08)', vwap: '#f472b6',
    line: '#f59e0b', rsi: '#a78bfa', macd: '#38bdf8', sig: '#fb923c', stK: '#38bdf8', stD: '#fb923c', cross: 'rgba(148,163,184,.7)' };
  const AXIS_W = 62, TIME_H = 18, FONT = '10px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const NICE = [6e4, 3e5, 9e5, 18e5, 36e5, 108e5, 216e5, 432e5, 864e5, 1728e5, 6048e5, 12096e5, 2592e6, 7776e6, 15552e6, 31536e6];

  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function fmtPrice(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(2);
    if (a >= 1) return v.toFixed(4);
    if (a === 0) return '0';
    return v.toPrecision(4);
  }
  function fmtVol(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(2) + 'K';
    return v.toFixed(a < 1 ? 4 : 2);
  }
  function fmtTime(t, tf, long) {
    const d = new Date(t);
    const date = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
    if (tf >= 2592e6) return pad2(d.getMonth() + 1) + '/' + d.getFullYear();
    if (tf >= 864e5) return long ? date + '/' + d.getFullYear() : date;
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return long ? date + ' ' + hm : (d.getHours() === 0 && d.getMinutes() === 0 ? date : hm);
  }
  function niceTicks(min, max, n) {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag, step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(v);
    return out;
  }
  function lowerBound(arr, t) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < t) lo = m + 1; else hi = m; } return lo; }

  function create(container, userOpts) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:pan-y;cursor:crosshair';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const S = { data: [], disp: [], tf: 36e5, opts: { type: 'candles', volume: true, ind: {} }, barSpace: 8, right: 0,
      cross: null, W: 0, H: 0, dpr: 1, ind: {}, raf: 0, lang: (userOpts && userOpts.lang) || 'en', onCross: null };
    const ptrs = new Map(); let drag = null, pinch = null, moved = false;

    function subPanes() { const o = S.opts.ind || {}; return ['rsi', 'macd', 'stoch'].filter(k => o[k]); }
    function layout() {
      const subs = subPanes(), plotW = Math.max(40, S.W - AXIS_W), usable = S.H - TIME_H;
      const subH = subs.length ? Math.min(usable * 0.22, 90) : 0;
      const mainH = usable - subH * subs.length;
      const rects = { main: { x: 0, y: 0, w: plotW, h: mainH } }; let y = mainH;
      subs.forEach(k => { rects[k] = { x: 0, y, w: plotW, h: subH }; y += subH; });
      return { rects, subs, plotW, timeY: usable };
    }
    function computeInd() {
      const o = S.opts.ind || {}, d = S.disp, cl = Ind.closes(d); S.ind = {};
      if (o.sma) S.ind.sma = Ind.sma(cl, 20);
      if (o.ema) S.ind.ema = Ind.ema(cl, 50);
      if (o.bb) S.ind.bb = Ind.bollinger(cl, 20, 2);
      if (o.vwap) S.ind.vwap = Ind.vwap(d);
      if (o.rsi) S.ind.rsi = Ind.rsi(cl, 14);
      if (o.macd) S.ind.macd = Ind.macd(cl, 12, 26, 9);
      if (o.stoch) S.ind.stoch = Ind.stochastic(d, 14, 3);
    }
    function rebuild() { S.disp = S.opts.type === 'heikin' ? Ind.heikinAshi(S.data) : S.data; computeInd(); }
    function xOf(t, L) { return L.plotW - (S.right - t) / S.tf * S.barSpace; }
    function tOf(x, L) { return S.right - (L.plotW - x) / S.barSpace * S.tf; }
    function clampView(L) {
      S.barSpace = Math.min(60, Math.max(2, S.barSpace));
      if (!S.data.length) return;
      const first = S.data[0].t, last = S.data[S.data.length - 1].t;
      S.right = Math.min(last + S.tf * Math.max(3, L.plotW / S.barSpace * 0.6), Math.max(first + S.tf * 5, S.right));
    }
    function resetView() {
      const L = layout();
      if (!S.data.length) return;
      const n = Math.min(S.data.length, 90);
      S.barSpace = Math.min(40, Math.max(3, L.plotW / (n + 4)));
      S.right = S.data[S.data.length - 1].t + S.tf * 3;
      draw();
    }

    function schedule() { if (S.raf) return; S.raf = 1; requestAnimationFrame(() => { S.raf = 0; draw(); }); }

    function draw() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      S.W = w; S.H = h; S.dpr = dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
      ctx.font = FONT; ctx.textBaseline = 'middle';
      const L = layout(); clampView(L);
      const d = S.disp;
      if (!d.length) return;
      const tL = tOf(0, L), tR = S.right;
      let i0 = Math.max(0, lowerBound(d, tL - S.tf) - 1), i1 = Math.min(d.length - 1, lowerBound(d, tR + S.tf));
      if (i1 < i0) return;
      drawTimeGrid(L, tL, tR);
      drawMain(L, i0, i1);
      L.subs.forEach(k => drawSub(k, L, i0, i1));
      drawTimeAxis(L, tL, tR);
      drawCross(L, i0, i1);
    }

    function drawTimeGrid(L, tL, tR) {
      const stepMin = 78 / S.barSpace * S.tf; const step = NICE.find(s => s >= stepMin) || NICE[NICE.length - 1];
      S._ticks = []; const tz = new Date(tL).getTimezoneOffset() * 6e4;
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (let t = Math.ceil((tL - tz) / step) * step + tz; t <= tR; t += step) {
        const x = Math.round(xOf(t, L)) + 0.5; if (x < 0 || x > L.plotW) continue;
        ctx.moveTo(x, 0); ctx.lineTo(x, L.timeY); S._ticks.push({ x, t });
      }
      ctx.stroke();
    }
    function drawTimeAxis(L) {
      ctx.fillStyle = C.text; ctx.textAlign = 'center';
      (S._ticks || []).forEach(k => { if (k.x > 20 && k.x < L.plotW - 20) ctx.fillText(fmtTime(k.t, S.tf, false), k.x, L.timeY + TIME_H / 2); });
    }

    function priceRange(i0, i1) {
      let lo = Infinity, hi = -Infinity; const d = S.disp;
      for (let i = i0; i <= i1; i++) { if (d[i].l < lo) lo = d[i].l; if (d[i].h > hi) hi = d[i].h; }
      if (S.ind.bb) for (let i = i0; i <= i1; i++) { const u = S.ind.bb.upper[i], l = S.ind.bb.lower[i]; if (u != null && u > hi) hi = u; if (l != null && l < lo) lo = l; }
      if (!Number.isFinite(lo)) return null;
      if (hi === lo) { hi += Math.abs(hi) * 0.01 || 1; lo -= Math.abs(lo) * 0.01 || 1; }
      const p = (hi - lo) * 0.08; return { lo: lo - p, hi: hi + p };
    }

    function drawMain(L, i0, i1) {
      const r = L.rects.main, d = S.disp, pr = priceRange(i0, i1); if (!pr) return;
      const volOn = S.opts.volume && d.some(k => k.v != null);
      const volH = volOn ? r.h * 0.2 : 0;
      const yP = (v) => r.y + 4 + (pr.hi - v) / (pr.hi - pr.lo) * (r.h - 8 - volH * 0.0);
      S._yP = yP; S._pr = pr;
      // horizontal grid + price axis
      ctx.strokeStyle = C.grid; ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.lineWidth = 1;
      niceTicks(pr.lo, pr.hi, Math.max(3, Math.floor(r.h / 55))).forEach(v => {
        const y = Math.round(yP(v)) + 0.5; if (y < r.y || y > r.y + r.h) return;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.w, y); ctx.stroke(); ctx.fillText(fmtPrice(v), r.w + 4, y);
      });
      // volume (overlay at bottom of main pane)
      const bw = Math.max(1, S.barSpace * 0.7);
      if (volOn) {
        let mv = 0; for (let i = i0; i <= i1; i++) if (d[i].v > mv) mv = d[i].v;
        if (mv > 0) for (let i = i0; i <= i1; i++) {
          if (d[i].v == null) continue; const x = xOf(d[i].t, L), up = d[i].c >= d[i].o, hh = d[i].v / mv * volH;
          ctx.fillStyle = up ? 'rgba(52,211,153,.35)' : 'rgba(248,113,113,.35)'; ctx.fillRect(x - bw / 2, r.y + r.h - hh, bw, hh);
        }
      }
      ctx.save(); ctx.beginPath(); ctx.rect(0, r.y, r.w, r.h); ctx.clip();
      // bollinger band fill
      if (S.ind.bb) {
        const b = S.ind.bb; ctx.beginPath(); let started = false;
        for (let i = i0; i <= i1; i++) if (b.upper[i] != null) { const x = xOf(d[i].t, L), y = yP(b.upper[i]); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; }
        for (let i = i1; i >= i0; i--) if (b.lower[i] != null) ctx.lineTo(xOf(d[i].t, L), yP(b.lower[i]));
        ctx.closePath(); ctx.fillStyle = C.bbFill; ctx.fill();
        line(b.upper, C.bb, 1); line(b.lower, C.bb, 1); line(b.mid, C.bb, 1, [4, 3]);
      }
      function line(arr, color, lw, dash) {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lw || 1.5; ctx.setLineDash(dash || []); let pen = false;
        for (let i = i0; i <= i1; i++) { if (arr[i] == null) { pen = false; continue; } const x = xOf(d[i].t, L), y = yP(arr[i]); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }
        ctx.stroke(); ctx.setLineDash([]);
      }
      const type = S.opts.type;
      if (type === 'line' || type === 'area') {
        ctx.beginPath(); let pen = false, fx0 = null, lx = null;
        for (let i = i0; i <= i1; i++) { const x = xOf(d[i].t, L), y = yP(d[i].c); pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); if (!pen) fx0 = x; lx = x; pen = true; }
        ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
        if (type === 'area' && fx0 != null) {
          ctx.lineTo(lx, r.y + r.h); ctx.lineTo(fx0, r.y + r.h); ctx.closePath();
          const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h); g.addColorStop(0, 'rgba(245,158,11,.30)'); g.addColorStop(1, 'rgba(245,158,11,0)');
          ctx.fillStyle = g; ctx.fill();
        }
      } else {
        for (let i = i0; i <= i1; i++) {
          const k = d[i], x = xOf(k.t, L), up = k.c >= k.o, col = up ? C.up : C.down;
          const yo = yP(k.o), yc = yP(k.c), yh = yP(k.h), yl = yP(k.l);
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
          if (type === 'ohlc') {
            ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.moveTo(x - bw / 2, yo); ctx.lineTo(x, yo); ctx.moveTo(x, yc); ctx.lineTo(x + bw / 2, yc); ctx.stroke();
          } else {
            ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, yh); ctx.lineTo(Math.round(x) + 0.5, yl); ctx.stroke();
            const top = Math.min(yo, yc), hh = Math.max(1, Math.abs(yc - yo));
            if (type === 'hollow' && up) { ctx.strokeRect(x - bw / 2 + 0.5, top, Math.max(1, bw - 1), hh); }
            else ctx.fillRect(x - bw / 2, top, Math.max(1, bw), hh);
          }
        }
      }
      if (S.ind.sma) line(S.ind.sma, C.sma, 1.4);
      if (S.ind.ema) line(S.ind.ema, C.ema, 1.4);
      if (S.ind.vwap) line(S.ind.vwap, C.vwap, 1.4, [5, 3]);
      ctx.restore();
      // last price marker
      const last = d[d.length - 1], yl = yP(last.c);
      if (yl >= r.y && yl <= r.y + r.h) {
        const col = last.c >= last.o ? C.up : C.down;
        ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, yl); ctx.lineTo(r.w, yl); ctx.stroke(); ctx.setLineDash([]);
        tag(r.w, yl, fmtPrice(last.c), col, '#020617');
      }
    }

    function tag(x, y, text, bg, fg) {
      const w = ctx.measureText(text).width + 8; ctx.fillStyle = bg; ctx.fillRect(x, y - 8, w, 16);
      ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.fillText(text, x + 4, y);
    }

    function drawSub(k, L, i0, i1) {
      const r = L.rects[k], d = S.disp; ctx.save();
      ctx.strokeStyle = 'rgba(100,116,139,.55)'; ctx.beginPath(); ctx.moveTo(0, r.y + 0.5); ctx.lineTo(r.w, r.y + 0.5); ctx.stroke();
      ctx.beginPath(); ctx.rect(0, r.y, r.w, r.h); ctx.clip();
      let lo = 0, hi = 100, name = '';
      const ser = [];
      if (k === 'rsi') { name = 'RSI 14'; ser.push({ a: S.ind.rsi, c: C.rsi }); }
      if (k === 'stoch') { name = 'Stoch 14,3'; ser.push({ a: S.ind.stoch.k, c: C.stK }, { a: S.ind.stoch.d, c: C.stD }); }
      if (k === 'macd') {
        name = 'MACD 12,26,9'; const m = S.ind.macd; lo = Infinity; hi = -Infinity;
        for (let i = i0; i <= i1; i++) for (const a of [m.line, m.signal, m.hist]) if (a[i] != null) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
        if (!Number.isFinite(lo)) { lo = -1; hi = 1; } const p = (hi - lo) * 0.1 || 1; lo -= p; hi += p;
      }
      const y = (v) => r.y + 4 + (hi - v) / (hi - lo) * (r.h - 8);
      ctx.fillStyle = C.text; ctx.textAlign = 'left';
      if (k === 'macd') {
        const m = S.ind.macd, y0 = y(0), bw = Math.max(1, S.barSpace * 0.6);
        for (let i = i0; i <= i1; i++) if (m.hist[i] != null) { ctx.fillStyle = m.hist[i] >= 0 ? 'rgba(52,211,153,.55)' : 'rgba(248,113,113,.55)'; const yy = y(m.hist[i]); ctx.fillRect(xOf(d[i].t, L) - bw / 2, Math.min(y0, yy), bw, Math.max(1, Math.abs(yy - y0))); }
        ser.push({ a: m.line, c: C.macd }, { a: m.signal, c: C.sig });
      } else {
        const lv = k === 'stoch' ? [20, 80] : [30, 70]; ctx.strokeStyle = C.grid; ctx.setLineDash([3, 3]);
        lv.forEach(v => { ctx.beginPath(); ctx.moveTo(0, y(v)); ctx.lineTo(r.w, y(v)); ctx.stroke(); }); ctx.setLineDash([]);
      }
      ser.forEach(s => {
        ctx.beginPath(); ctx.strokeStyle = s.c; ctx.lineWidth = 1.4; let pen = false;
        for (let i = i0; i <= i1; i++) { if (s.a[i] == null) { pen = false; continue; } const x = xOf(d[i].t, L), yy = y(s.a[i]); pen ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); pen = true; }
        ctx.stroke();
      });
      ctx.restore();
      ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.fillText(name, 6, r.y + 10);
      const lastVals = ser.map(s => s.a[Math.min(S.cross ? S.cross.i : d.length - 1, d.length - 1)]).filter(v => v != null);
      if (lastVals.length) ctx.fillText(lastVals.map(v => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2))).join('  '), 6 + ctx.measureText(name).width + 8, r.y + 10);
      if (k !== 'macd') { [lo, hi].forEach(v => ctx.fillText(String(v), r.w + 4, y(v))); }
      else { ctx.fillText(fmtPrice(hi), r.w + 4, r.y + 8); ctx.fillText(fmtPrice(lo), r.w + 4, r.y + r.h - 8); }
    }

    function drawCross(L) {
      const d = S.disp, r = L.rects.main;
      let i = d.length - 1, pinned = false;
      if (S.cross) {
        const t = tOf(S.cross.x, L); let j = lowerBound(d, t); if (j >= d.length) j = d.length - 1;
        if (j > 0 && Math.abs(d[j - 1].t - t) < Math.abs(d[j].t - t)) j--;
        S.cross.i = j; i = j; pinned = true;
        const x = Math.round(xOf(d[j].t, L)) + 0.5;
        ctx.strokeStyle = C.cross; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, L.timeY);
        if (S.cross.y >= r.y && S.cross.y <= r.y + r.h) { ctx.moveTo(0, S.cross.y); ctx.lineTo(r.w, S.cross.y); }
        ctx.stroke(); ctx.setLineDash([]);
        if (S.cross.y >= r.y && S.cross.y <= r.y + r.h && S._pr) { const v = S._pr.hi - (S.cross.y - r.y - 4) / (r.h - 8) * (S._pr.hi - S._pr.lo); tag(r.w, S.cross.y, fmtPrice(v), '#334155', '#e2e8f0'); }
        const tl = fmtTime(d[j].t, S.tf, true), tw = ctx.measureText(tl).width + 10;
        ctx.fillStyle = '#334155'; ctx.fillRect(Math.min(Math.max(0, x - tw / 2), L.plotW - tw), L.timeY + 1, tw, TIME_H - 2);
        ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'center'; ctx.fillText(tl, Math.min(Math.max(tw / 2, x), L.plotW - tw / 2), L.timeY + TIME_H / 2);
      }
      const k = d[i], prev = d[i - 1], chg = prev ? (k.c - prev.c) / prev.c * 100 : null;
      const parts = [['O', fmtPrice(k.o)], ['H', fmtPrice(k.h)], ['L', fmtPrice(k.l)], ['C', fmtPrice(k.c)]];
      if (chg != null && Number.isFinite(chg)) parts.push([(chg >= 0 ? '+' : '') + chg.toFixed(2) + '%', null]);
      if (k.v != null) parts.push(['Vol', fmtVol(k.v)]);
      ['sma', 'ema', 'vwap'].forEach(n => { if (S.ind[n] && S.ind[n][i] != null) parts.push([n.toUpperCase(), fmtPrice(S.ind[n][i])]); });
      if (S.ind.bb && S.ind.bb.mid[i] != null) parts.push(['BB', fmtPrice(S.ind.bb.lower[i]) + '–' + fmtPrice(S.ind.bb.upper[i])]);
      ctx.textAlign = 'left'; let x = 6; const y = r.y + 10; const up = k.c >= k.o;
      ctx.fillStyle = 'rgba(2,6,23,.65)'; ctx.fillRect(0, r.y, Math.min(r.w, 420), 16);
      parts.forEach(p => { const txt = p[1] == null ? p[0] : p[0] + ' ' + p[1]; ctx.fillStyle = p[1] == null ? (chg >= 0 ? C.up : C.down) : (['O', 'H', 'L', 'C'].includes(p[0]) ? (up ? C.up : C.down) : C.text); ctx.fillText(txt, x, y); x += ctx.measureText(txt).width + 8; });
      if (S.onCross) S.onCross(pinned ? { candle: k, index: i } : null);
    }

    // ---- interaction ----
    const pos = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); const p = pos(e); ptrs.set(e.pointerId, p); moved = false;
      if (ptrs.size === 1) drag = { x: p.x, right: S.right }; else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), space: S.barSpace }; drag = null; }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pos(e); const L = layout();
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()], dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, tAt = tOf(mx, L);
        S.barSpace = pinch.space * dist / (pinch.dist || 1); S.right = tAt + (L.plotW - mx) / S.barSpace * S.tf; moved = true; S.cross = null; schedule(); return;
      }
      if (ptrs.size === 1 && drag && (e.buttons || e.pointerType !== 'mouse')) {
        const dx = p.x - drag.x; if (Math.abs(dx) > 3) moved = true;
        if (moved) { S.right = drag.right - dx / S.barSpace * S.tf; S.cross = null; schedule(); }
        return;
      }
      if (e.pointerType === 'mouse') { S.cross = { x: Math.min(p.x, L.plotW), y: p.y }; schedule(); }
    });
    const end = (e) => {
      const p = pos(e); const wasTap = !moved && ptrs.size === 1 && e.type === 'pointerup';
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) drag = null;
      if (wasTap && e.pointerType !== 'mouse') { const L = layout(); S.cross = S.cross && Math.abs(S.cross.x - p.x) < 6 ? null : { x: Math.min(p.x, L.plotW), y: p.y }; schedule(); }
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { S.cross = null; schedule(); } });
    canvas.addEventListener('dblclick', resetView);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault(); const p = pos(e), L = layout();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { S.right += e.deltaX / S.barSpace * S.tf; }
      else { const tAt = tOf(p.x, L); S.barSpace *= e.deltaY < 0 ? 1.12 : 1 / 1.12; S.barSpace = Math.min(60, Math.max(2, S.barSpace)); S.right = tAt + (L.plotW - p.x) / S.barSpace * S.tf; }
      schedule();
    }, { passive: false });
    let ro = null; if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(schedule); ro.observe(container); }

    return {
      setData(candles, tfMs, keepView) {
        const prevLast = S.data.length ? S.data[S.data.length - 1].t : null;
        S.data = (candles || []).filter(k => k && Number.isFinite(k.t) && Number.isFinite(k.c)); S.tf = tfMs || S.tf; rebuild();
        if (!keepView || prevLast == null) resetView();
        else { schedule(); }
      },
      setOptions(o) { S.opts = { ...S.opts, ...o, ind: { ...(S.opts.ind || {}), ...((o && o.ind) || {}) } }; if (o && o.ind) S.opts.ind = { ...o.ind }; rebuild(); schedule(); },
      resetView, resize: schedule, onCrosshair(cb) { S.onCross = cb; },
      toDataURL() { draw(); return canvas.toDataURL('image/png'); },
      destroy() { if (ro) ro.disconnect(); if (canvas.parentNode) canvas.parentNode.removeChild(canvas); },
      _state: S
    };
  }
  root.PiChart = { create, fmtPrice, fmtVol, fmtTime, niceTicks };
})(typeof window !== 'undefined' ? window : globalThis);
