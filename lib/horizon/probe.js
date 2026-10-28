'use strict';
/** Capability matrix for a Horizon base URL */
const ENDPOINTS = [
  { key: 'root', path: '/' },
  { key: 'fee_stats', path: '/fee_stats' },
  { key: 'ledgers', path: '/ledgers?limit=1&order=desc' },
  { key: 'payments', path: '/payments?limit=1&order=desc' },
  { key: 'effects', path: '/effects?limit=1&order=desc' },
  { key: 'operations', path: '/operations?limit=1&order=desc' },
  { key: 'transactions', path: '/transactions?limit=1&order=desc' },
  { key: 'assets', path: '/assets?limit=1' },
  { key: 'trades', path: '/trades?limit=1&order=desc' },
  { key: 'trade_aggregations', path: '/trade_aggregations?base_asset_type=native&counter_asset_type=native&resolution=3600000&limit=1' },
  { key: 'liquidity_pools', path: '/liquidity_pools?limit=1' },
  { key: 'claimable_balances', path: '/claimable_balances?limit=1' },
  { key: 'order_book', path: '/order_book?selling_asset_type=native&buying_asset_type=native' },
  { key: 'sse_ledgers', path: '/ledgers?cursor=now&limit=1' },
];

async function probeNetwork(client, baseUrl) {
  const base = String(baseUrl).replace(/\/$/, '');
  const result = { baseUrl: base, checkedAt: new Date().toISOString(), endpoints: {} };
  for (const ep of ENDPOINTS) {
    try {
      await client.fetchJson(base + ep.path, { ttlMs: 0, retries: 0 });
      result.endpoints[ep.key] = { ok: true };
    } catch (e) {
      result.endpoints[ep.key] = { ok: false, error: e.message, status: e.status || null };
    }
  }
  result.anyOk = Object.values(result.endpoints).some(x => x.ok);
  return result;
}

module.exports = { probeNetwork, ENDPOINTS };
