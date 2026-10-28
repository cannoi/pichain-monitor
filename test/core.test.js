'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { networkStatus, meta } = require('../lib/meta');
const { assertSafeUrl } = require('../lib/horizon/client');
const { ohlcFromAggs, bookSpread } = require('../lib/analytics/pair');
const { assetParams } = require('../lib/horizon/pair');
const { isValidAccountId, crc16xmodem } = require('../lib/strkey');

test('metadata represents missing data as null, not a fake value', () => {
  const m = meta(null, { source: '/fee_stats', fetchedAt: '2026-01-01T00:00:00Z' });
  assert.equal(m.value, null); assert.equal(m.display, '—'); assert.equal(m.source, '/fee_stats');
});
test('network status derives from ledger age and marks absent data unknown', () => {
  assert.equal(networkStatus(null, null, null).status, 'unknown');
  assert.equal(networkStatus('not-a-date', null, null).status, 'unknown');
  assert.equal(networkStatus(new Date(Date.now() - 70000).toISOString(), null, null).status, 'stalled');
  assert.equal(networkStatus(new Date(Date.now() - 30000).toISOString(), null, null).status, 'slow');
  assert.equal(networkStatus(new Date().toISOString(), '0.9', null).status, 'busy');
});
test('SSRF guard blocks private targets unless explicitly enabled', () => {
  assert.throws(() => assertSafeUrl('http://127.0.0.1:8080')); 
  assert.throws(() => assertSafeUrl('file:///etc/passwd', { allowPrivate: true }));
  assert.equal(assertSafeUrl('http://127.0.0.1:8080', { allowPrivate: true }).hostname, '127.0.0.1');
});
test('OHLC mapper preserves actual source points and ordering', () => {
  const candles = ohlcFromAggs([{ timestamp: 'b', open: '2', high: '4', low: '1', close: '3' }, { timestamp: 'a', open: '1', high: '2', low: '1', close: '2' }]);
  assert.equal(candles[0].t, 'a'); assert.equal(candles[1].h, '4'); assert.equal(candles.length, 2);
});
test('spread is derived only from supplied book levels', () => {
  assert.equal(bookSpread([], []).spread, null);
  assert.equal(bookSpread([{price:'9'}], [{price:'11'}]).spreadBps, 2000);
});
test('credit asset without issuer is never silently mapped to native', () => {
  const p = assetParams('selling', 'USDT', null);
  assert.equal(p.selling_asset_type, 'credit_alphanum4');
  assert.equal(p.selling_asset_issuer, undefined);
});
test('StrKey checksum implementation is stable and invalid IDs rejected', () => {
  assert.equal(crc16xmodem(Buffer.from('123456789')), 0x31c3);
  assert.equal(isValidAccountId('G' + 'A'.repeat(55)), false);
  assert.equal(isValidAccountId('M' + 'A'.repeat(68)), false);
});
