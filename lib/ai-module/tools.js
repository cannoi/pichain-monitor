'use strict';
/**
 * Read-only AI tools whitelist (P4 foundation).
 * Full planner/writer loop ships in later iteration; tools are callable from server only.
 */
const { isValidAccountId } = require('../strkey');
const { orderBookUrl, tradeAggUrl } = require('../horizon/pair');
const { bookSpread, ohlcFromAggs } = require('../analytics/pair');
const { summarizeSnapshots } = require('../analytics/network');

const ALLOWED = new Set([
  'get_network_overview',
  'get_ledger_range',
  'get_wallet',
  'get_asset',
  'list_user_watchlist',
  'get_pair_trades',
  'get_pair_candles',
  'get_order_book',
  'query_snapshots',
  'scan_asset_holders'
]);

const NETWORKS = new Set(['mainnet', 'testnet']);
const RESOLUTIONS = new Set([60000, 300000, 900000, 3600000, 86400000]);
const CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const NATIVE_CODES = new Set(['PI', 'TPI', 'NATIVE']);
let evSeq = 0;
function evId(prefix) { evSeq = (evSeq + 1) % 1e6; return prefix + '-' + Date.now().toString(36) + evSeq.toString(36); }
function clampInt(v, def, lo, hi) { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; }

/** Validate one asset side. Native is PI/tPI; any other code requires a valid issuer. */
function assetArg(code, issuer, label) {
  const c = String(code == null || code === '' ? 'PI' : code);
  if (NATIVE_CODES.has(c.toUpperCase())) return { ok: true, code: 'PI', issuer: null };
  if (!CODE_RE.test(c)) return { ok: false, error: label + ' code invalid (1-12 alphanumeric)' };
  if (!issuer || !isValidAccountId(String(issuer)) || String(issuer)[0] !== 'G') return { ok: false, error: label + ' issuer required (valid G… key)' };
  return { ok: true, code: c, issuer: String(issuer) };
}

/**
 * Strict per-tool argument validation (server side). Returns {ok, args} or {ok:false, error}.
 * Used by both the LLM planner path and direct callers.
 */
function validateArgs(name, raw, defaultNetwork) {
  if (!ALLOWED.has(name)) return { ok: false, error: 'tool not allowed' };
  const a = raw && typeof raw === 'object' ? raw : {};
  const network = String(a.network || defaultNetwork || 'mainnet').toLowerCase();
  if (!NETWORKS.has(network)) return { ok: false, error: 'network must be mainnet|testnet' };
  const out = { network };
  switch (name) {
    case 'get_network_overview': case 'list_user_watchlist': case 'get_pair_trades': case 'query_snapshots':
      return { ok: true, args: out };
    case 'get_ledger_range':
      out.limit = clampInt(a.limit, 10, 1, 20); return { ok: true, args: out };
    case 'get_wallet':
      if (!isValidAccountId(String(a.address || ''))) return { ok: false, error: 'invalid address' };
      out.address = String(a.address); return { ok: true, args: out };
    case 'get_asset': case 'scan_asset_holders': {
      const c = String(a.code || '');
      if (!CODE_RE.test(c)) return { ok: false, error: 'code invalid (1-12 alphanumeric)' };
      out.code = c;
      if (a.issuer) { if (!isValidAccountId(String(a.issuer)) || String(a.issuer)[0] !== 'G') return { ok: false, error: 'issuer invalid' }; out.issuer = String(a.issuer); }
      else out.issuer = null;
      if (name === 'scan_asset_holders') out.limit = clampInt(a.limit, 50, 1, 100);
      return { ok: true, args: out };
    }
    case 'get_pair_candles': case 'get_order_book': {
      const b = assetArg(a.baseCode, a.baseIssuer, 'base'); if (!b.ok) return b;
      const c = assetArg(a.counterCode, a.counterIssuer, 'counter'); if (!c.ok) return c;
      Object.assign(out, { baseCode: b.code, baseIssuer: b.issuer, counterCode: c.code, counterIssuer: c.issuer });
      if (name === 'get_pair_candles') {
        const r = Number(a.resolution || 3600000);
        if (!RESOLUTIONS.has(r)) return { ok: false, error: 'resolution must be one of 60000,300000,900000,3600000,86400000' };
        out.resolution = r; out.limit = clampInt(a.limit, 48, 1, 200);
      }
      return { ok: true, args: out };
    }
  }
  return { ok: false, error: 'unhandled' };
}

/** Compact, model-facing description of tools and args (no numbers that can change). */
const TOOL_SPECS = {
  get_network_overview: 'args: network. Latest ledger height/protocol/close time.',
  get_ledger_range: 'args: network, limit(1-20). Most recent ledgers with tx/op counts.',
  get_wallet: 'args: network, address(G… or M…). Native balance and subentries.',
  get_asset: 'args: network, code(1-12), issuer(G…). Asset record from /assets.',
  list_user_watchlist: 'args: none. Wallets the user pinned.',
  get_pair_trades: 'args: network. Recent trades on the network.',
  get_pair_candles: 'args: network, baseCode, baseIssuer, counterCode, counterIssuer, resolution(ms: 60000|300000|900000|3600000|86400000), limit. Use PI as code for native (no issuer).',
  get_order_book: 'args: network, baseCode, baseIssuer, counterCode, counterIssuer. Top bids/asks and spread.',
  query_snapshots: 'args: network. Collector snapshots of the network (history only since collection started).',
  scan_asset_holders: 'args: network, code, issuer, limit(1-100). Limited, partial scan; always report scanned count.'
};

function listTools() {
  return Object.keys(TOOL_SPECS).map(name => ({ name, description: TOOL_SPECS[name] }));
}

async function executeTool(name, args, ctx) {
  if (!ALLOWED.has(name)) return { ok: false, error: 'tool not allowed' };
  const { horizonFetch, baseUrl, db, network } = ctx;
  const v = validateArgs(name, args, network);
  if (!v.ok) return { ok: false, error: v.error, fetchedAt: new Date().toISOString() };
  args = v.args;
  const net = args.network;
  const src = baseUrl(net);
  const fetchedAt = new Date().toISOString();
  try {
    if (name === 'get_network_overview') {
      const root = await horizonFetch(src + '/');
      return { ok: true, evidenceId: evId('net'), source: src + '/', fetchedAt, kind: 'raw', data: {
        height: root.history_latest_ledger, closedAt: root.history_latest_ledger_closed_at, protocol: root.current_protocol_version
      }};
    }
    if (name === 'get_wallet') {
            const acc = await horizonFetch(src + '/accounts/' + encodeURIComponent(args.address));
      const native = (acc.balances || []).find(b => b.asset_type === 'native');
      return { ok: true, evidenceId: evId('w'), source: src + '/accounts', fetchedAt, kind: 'raw', data: {
        address: acc.account_id, balance: native?.balance, subentryCount: acc.subentry_count
      }};
    }
    if (name === 'list_user_watchlist') {
      const rows = await new Promise((resolve, reject) => {
        db.all('SELECT address, network, alias FROM watched_wallets ORDER BY created_at DESC LIMIT 50', [], (e, r) => e ? reject(e) : resolve(r || []));
      });
      return { ok: true, evidenceId: evId('wl'), source: 'sqlite:watched_wallets', fetchedAt, kind: 'raw', data: rows };
    }
    if (name === 'get_pair_trades') {
      const data = await horizonFetch(src + '/trades?limit=10&order=desc');
      const trades = (data._embedded?.records || []).map(t => ({
        base: t.base_asset_type === 'native' ? 'PI' : t.base_asset_code,
        counter: t.counter_asset_type === 'native' ? 'PI' : t.counter_asset_code,
        baseAmount: t.base_amount, counterAmount: t.counter_amount, time: t.ledger_close_time
      }));
      return { ok: true, evidenceId: evId('tr'), source: src + '/trades', fetchedAt, kind: 'raw', data: trades };
    }
    if (name === 'scan_asset_holders') {
      const code = String(args.code || '').slice(0, 12);
      const issuer = args.issuer || null;
      const limit = Math.min(Number(args.limit) || 50, 100);
      if (!code) return { ok: false, error: 'code required' };
      let url = src + '/accounts?asset=' + encodeURIComponent(code);
      // Horizon accounts?asset=CODE:ISSUER for credit
      if (issuer) url = src + '/accounts?asset=' + encodeURIComponent(code + ':' + issuer);
      else url = src + '/assets?asset_code=' + encodeURIComponent(code) + '&limit=5';
      const data = await horizonFetch(url + (url.includes('accounts') ? '&limit=' + limit : ''));
      const records = data._embedded?.records || [];
      // If assets list, not holders — report partial
      if (url.includes('/assets')) {
        return { ok: true, evidenceId: evId('ah'), source: url, fetchedAt, kind: 'raw', data: {
          mode: 'asset_records', partial: true, scanned: records.length, totalUnknown: true,
          assets: records.map(a => ({ code: a.asset_code, issuer: a.asset_issuer, accounts: a.accounts }))
        }};
      }
      const holders = records.map(a => {
        const native = (a.balances || []).find(b => b.asset_type === 'native');
        const tok = (a.balances || []).find(b => b.asset_code === code);
        return { address: a.account_id, tokenBalance: tok?.balance || null, nativeBalance: native?.balance || null };
      });
      holders.sort((x, y) => Number(y.tokenBalance || 0) - Number(x.tokenBalance || 0));
      return { ok: true, evidenceId: evId('ah'), source: url, fetchedAt, kind: 'raw', data: {
        mode: 'accounts_scan', partial: true, scanned: holders.length, limit, holders: holders.slice(0, limit)
      }};
    }
    if (name === 'get_ledger_range') {
      const url = src + '/ledgers?order=desc&limit=' + args.limit;
      const data = await horizonFetch(url);
      const rows = (data._embedded?.records || []).map(l => ({
        sequence: l.sequence, closedAt: l.closed_at,
        successfulTx: l.successful_transaction_count ?? null, failedTx: l.failed_transaction_count ?? null,
        operations: l.operation_count ?? null
      }));
      return { ok: true, evidenceId: evId('lg'), source: url, fetchedAt, kind: 'raw', data: rows };
    }
    if (name === 'get_asset') {
      let url = src + '/assets?asset_code=' + encodeURIComponent(args.code) + '&limit=5';
      if (args.issuer) url += '&asset_issuer=' + encodeURIComponent(args.issuer);
      const data = await horizonFetch(url);
      const recs = (data._embedded?.records || []).map(a => ({
        code: a.asset_code, issuer: a.asset_issuer, amount: a.amount ?? null,
        numAccounts: a.num_accounts ?? null, accounts: a.accounts ?? null, flags: a.flags ?? null,
        tomlHref: a._links?.toml?.href || null
      }));
      return { ok: true, evidenceId: evId('as'), source: url, fetchedAt, kind: 'raw',
        data: { records: recs, partial: recs.length >= 5, note: 'Fields come only from /assets; absent fields stay null.' } };
    }
    if (name === 'get_pair_candles') {
      const url = tradeAggUrl(src, { code: args.baseCode, issuer: args.baseIssuer }, { code: args.counterCode, issuer: args.counterIssuer }, args.resolution, args.limit);
      const data = await horizonFetch(url);
      const candles = ohlcFromAggs(data._embedded?.records || []).map(c => ({ t: Number(c.t) || c.t, o: c.o, h: c.h, l: c.l, c: c.c, baseVol: c.baseVol, counterVol: c.counterVol }));
      return { ok: true, evidenceId: evId('cd'), source: url, fetchedAt, kind: 'raw', data: candles };
    }
    if (name === 'get_order_book') {
      const url = orderBookUrl(src, { code: args.baseCode, issuer: args.baseIssuer }, { code: args.counterCode, issuer: args.counterIssuer });
      const data = await horizonFetch(url);
      const bids = (data.bids || []).slice(0, 10).map(x => ({ price: x.price, amount: x.amount }));
      const asks = (data.asks || []).slice(0, 10).map(x => ({ price: x.price, amount: x.amount }));
      const sp = bookSpread(bids, asks);
      return { ok: true, evidenceId: evId('ob'), source: url, fetchedAt, kind: 'raw', data: { bids, asks },
        derived: sp.spread == null ? { spread: null, note: sp.note } : { bestBid: sp.bestBid, bestAsk: sp.bestAsk, spreadBps: sp.spreadBps, kind: 'derived' } };
    }
    if (name === 'query_snapshots') {
      const rows = await new Promise((resolve, reject) => {
        db.all('SELECT height, capacity, base_fee, status, fetched_at FROM network_snapshots WHERE network = ? ORDER BY id DESC LIMIT 30', [net], (e, r) => e ? reject(e) : resolve((r || []).reverse()));
      });
      return { ok: true, evidenceId: evId('sn'), source: 'network_snapshots', fetchedAt, kind: 'raw', data: rows, derived: summarizeSnapshots(rows) };
    }
  } catch (e) {
    return { ok: false, error: e.message, fetchedAt };
  }
  return { ok: false, error: 'unhandled' };
}

module.exports = { listTools, executeTool, validateArgs, ALLOWED, TOOL_SPECS };
