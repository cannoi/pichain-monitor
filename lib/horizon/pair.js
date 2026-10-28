'use strict';
/**
 * Build Horizon query params for asset pairs (native = PI/tPI).
 */
function assetParams(prefix, code, issuer) {
  // Asset codes are case-sensitive on-chain (e.g. "USDt" != "USDT"): only the native check is case-insensitive.
  const raw = String(code || '').trim();
  const c = raw.toUpperCase();
  if (!c || c === 'PI' || c === 'TPI' || c === 'NATIVE' || c === 'XLM') {
    return { [prefix + '_asset_type']: 'native' };
  }
  const code12 = raw.slice(0, 12);
  const params = {
    [prefix + '_asset_code']: code12,
    // Without an issuer Horizon rejects the incomplete query; never silently map to native PI/tPI.
    [prefix + '_asset_type']: code12.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12'
  };
  if (issuer) params[prefix + '_asset_issuer'] = issuer;
  return params;
}

function qs(obj) {
  return Object.entries(obj).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

function orderBookUrl(baseUrl, selling, buying) {
  const p = {
    ...assetParams('selling', selling.code, selling.issuer),
    ...assetParams('buying', buying.code, buying.issuer),
    limit: 20
  };
  return baseUrl.replace(/\/$/, '') + '/order_book?' + qs(p);
}

function tradesUrl(baseUrl, base, counter, limit = 20) {
  const p = {
    ...assetParams('base', base.code, base.issuer),
    ...assetParams('counter', counter.code, counter.issuer),
    order: 'desc',
    limit
  };
  return baseUrl.replace(/\/$/, '') + '/trades?' + qs(p);
}

function tradeAggUrl(baseUrl, base, counter, resolution = 3600000, limit = 48) {
  // resolution in ms: 1m=60000, 5m=300000, 15m=900000, 1h=3600000, 1d=86400000
  const p = {
    ...assetParams('base', base.code, base.issuer),
    ...assetParams('counter', counter.code, counter.issuer),
    resolution: String(resolution),
    order: 'desc',
    limit
  };
  return baseUrl.replace(/\/$/, '') + '/trade_aggregations?' + qs(p);
}

module.exports = { assetParams, orderBookUrl, tradesUrl, tradeAggUrl };
