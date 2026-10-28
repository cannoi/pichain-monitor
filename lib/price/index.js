'use strict';
/**
 * Optional third-party PI price — OFF by default.
 * Label always: third-party, not on-chain.
 */
async function fetchPiPriceUsd() {
  if (process.env.PRICE_ENABLED !== '1') {
    return { enabled: false, value: null, display: '—', note: 'disabled', kind: 'third_party' };
  }
  const url = process.env.PRICE_URL || '';
  if (!url) {
    return { enabled: true, value: null, display: '—', note: 'PRICE_URL not set', kind: 'third_party', source: null };
  }
  try {
    const { createHorizonClient } = require('../horizon/client');
    // reuse SSRF-safe fetch via plain https for external price only if allowlisted host
    const https = require('https');
    const http = require('http');
    const data = await new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { timeout: 8000 }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => {
          try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    // Flexible path: data.price or data.pi.usd or data.raw
    let price = data.price ?? data.usd ?? data?.pi?.usd ?? data?.RAW?.PI?.USD?.PRICE ?? null;
    if (price == null) {
      return { enabled: true, value: null, display: '—', note: 'no price field in response', kind: 'third_party', source: url, fetchedAt: new Date().toISOString() };
    }
    return {
      enabled: true,
      value: Number(price),
      display: String(price),
      unit: 'USD',
      kind: 'third_party',
      source: url,
      fetchedAt: new Date().toISOString(),
      label: 'Third-party, not on-chain'
    };
  } catch (e) {
    return { enabled: true, value: null, display: '—', note: e.message, kind: 'third_party', fetchedAt: new Date().toISOString() };
  }
}

module.exports = { fetchPiPriceUsd };
