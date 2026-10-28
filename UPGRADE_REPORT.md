# PiChain Monitor 2.4.0 — Upgrade Report

Base: uploaded v2.3.5. Version source: `package.json`.

## Done
- Pro pair chart (candles / hollow / OHLC / Heikin-Ashi / line / area), volume, crosshair legend, pan/zoom (touch + mouse), PNG export, auto-refresh.
- Timeframes 1m 5m 15m 30m 1H 4H 1D 1W 1M (30m/4h/1M derived, labelled); gaps without trades are shown, not filled.
- Indicators: SMA, EMA, Bollinger, VWAP (overlay); RSI, MACD, Stochastic (panels). Unit-tested.
- Custom pair form (token/PI and token/token with issuer); case-sensitive asset codes fixed.
- "Saved pairs" card removed (no function); API/table kept.
- Live badge fixed (green / amber / red, 45 s watchdog, SSE no longer restarted every poll).
- 40 previously missing EN/VI UI strings added; i18n checker added to `npm test`.

## Verified here
- `node --check` on all JS and the inline page script; `check-integrity`, `check-i18n`: pass; `node --test`: 30/30 pass (chart renderer exercised with a mocked canvas, every type × indicator combination, no non-finite geometry).
- Feedback module hash unchanged.

## NOT verified (no network / no browser in the build environment)
- `npm install`, `node test.js` (server smoke test) and a real run: express/sqlite3 could not be installed here.
- Visual check in a real browser / Pi Browser (layout, touch gestures, colours) — the renderer was tested logically, not by eye.
- Horizon `/trade_aggregations` paging with `end_time` and week/1m behaviour on Pi's live endpoints; if a page fails, only the first page is shown.

## Not done / limitations
- 1M needs up to ~400 daily candles, so thin markets show few months; 4H/30M are limited by the 600-candle cap.
- No drawing tools (trendlines, Fibonacci), no compare-two-pairs overlay, no order-book depth chart yet.
- AI-chat chart cards still use the small sparkline (not the new engine); "Save to dashboard" not added.
- Tailwind still from CDN; remaining items from the 2.3.0 report (retention jobs, wallet flow, dashboards export, global search, etc.) are still open.
