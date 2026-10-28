'use strict';
/** Derived metrics from order book + trades — labeled estimate/derived */
function bookSpread(bids, asks) {
  if (!bids?.length || !asks?.length) return { spread: null, mid: null, note: 'empty book' };
  const bestBid = Number(bids[0].price);
  const bestAsk = Number(asks[0].price);
  if (!bestBid || !bestAsk) return { spread: null, mid: null, note: 'invalid prices' };
  const mid = (bestBid + bestAsk) / 2;
  const spread = (bestAsk - bestBid) / mid;
  return {
    bestBid, bestAsk, mid,
    spread,
    spreadBps: spread * 10000,
    kind: 'derived',
    source: 'order_book'
  };
}

function ohlcFromAggs(records) {
  // Horizon trade_aggregations: timestamp, open, high, low, close, base_volume, counter_volume
  return (records || []).map(r => ({
    t: r.timestamp,
    o: r.open, h: r.high, l: r.low, c: r.close,
    baseVol: r.base_volume,
    counterVol: r.counter_volume,
    kind: 'raw',
    source: 'trade_aggregations'
  })).reverse();
}

module.exports = { bookSpread, ohlcFromAggs };
