# PiChain Monitor 2.3.0

View-only Pi Network observer (EN/VI) + Universal AI & Feedback.

## Features
- Live Horizon Mainnet/Testnet, derived network health
- Ask the chain / AI chat with **evidence**
- Pairs (book, trades, candles), alerts, Simple/Pro
- SSE pulse, optional third-party price (off by default)
- Local Alpine + Chart.js (`public/vendor`)
- StrKey checksum validation for G…/M… addresses
- Credit-asset queries no longer silently fall back to native PI
- Asset API no longer labels unsupported holder/supply values as verified totals
- AI logs read access is protected; chat is rate-limited and client-supplied evidence is not trusted

## Run
```bash
npm install && npm test && npm start
```

## Env
| Variable | Meaning |
|----------|---------|
| ADMIN_TOKEN | Protect AI settings, model refresh/test, and logs (send as `X-Admin-Token` or Bearer token) |
| HORIZON_MAINNET_URL / HORIZON_TESTNET_URL | Custom Horizon |
| HORIZON_ALLOW_PRIVATE | Set `1` only when intentionally connecting to a private Pi Node; default is blocked |
| COLLECTOR_ENABLED | `0` to disable snapshots |
| PRICE_ENABLED | `1` to enable third-party price |
| PRICE_URL | JSON endpoint returning price |
| SSE_INTERVAL_MS | Default 15000 |

## Not claimed
- Global richest wallets ranking (Horizon cannot)
- Tailwind fully vendored (CDN kept for CSS size)
- Price is never treated as on-chain truth

## Version and scope

The version source of truth is `package.json`; `lib/version.js` reads it at runtime. This release (2.3.0) builds on the uploaded 2.2.1 tree; it is not a claim that every requested v2.0.0 P0–P5 feature is complete. See `CHANGELOG.md` for verified changes and remaining work.
