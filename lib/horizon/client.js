'use strict';
const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT = 10000;

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '[::1]' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/i.test(h)) return true;
  if (h === '0.0.0.0' || h === '169.254.169.254' || h.startsWith('169.254.')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  }
  return false;
}

function assertSafeUrl(urlStr, { allowPrivate = false } = {}) {
  let u;
  try { u = new URL(urlStr); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https allowed');
  if (!allowPrivate && isPrivateHost(u.hostname)) throw new Error('Private/internal hosts blocked (SSRF guard)');
  return u;
}

function createHorizonClient(opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
  const concurrency = opts.concurrency || DEFAULT_CONCURRENCY;
  const allowPrivate = !!opts.allowPrivate || process.env.HORIZON_ALLOW_PRIVATE === '1';
  let active = 0;
  const queue = [];
  const cache = new Map(); // key -> { exp, data }
  const stats = { ok: 0, fail: 0, lastOkAt: null, lastError: null, latencyMs: null };

  function runNext() {
    if (active >= concurrency || !queue.length) return;
    const job = queue.shift();
    active++;
    job().finally(() => { active--; runNext(); });
  }

  function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      runNext();
    });
  }

  async function fetchJson(url, { ttlMs = 0, retries = 2 } = {}) {
    assertSafeUrl(url, { allowPrivate });
    const cacheKey = url;
    if (ttlMs > 0) {
      const hit = cache.get(cacheKey);
      if (hit && hit.exp > Date.now()) return hit.data;
    }
    return enqueue(async () => {
      let lastErr;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const t0 = Date.now();
        try {
          const data = await new Promise((resolve, reject) => {
            const u = new URL(url);
            const lib = u.protocol === 'https:' ? https : http;
            const req = lib.get(url, { timeout: timeoutMs, headers: { Accept: 'application/json' } }, (res) => {
              let body = '';
              res.on('data', c => body += c);
              res.on('end', () => {
                stats.latencyMs = Date.now() - t0;
                if (res.statusCode === 429 || res.statusCode >= 500) {
                  const err = new Error(`HTTP ${res.statusCode}`);
                  err.status = res.statusCode;
                  err.retryAfter = res.headers['retry-after'];
                  return reject(err);
                }
                if (res.statusCode >= 400) {
                  const err = new Error(`HTTP ${res.statusCode}`);
                  err.status = res.statusCode;
                  try { err.body = JSON.parse(body); } catch { err.body = body; }
                  return reject(err);
                }
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error('Invalid JSON from Horizon')); }
              });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
          });
          stats.ok++;
          stats.lastOkAt = new Date().toISOString();
          stats.lastError = null;
          if (ttlMs > 0) cache.set(cacheKey, { exp: Date.now() + ttlMs, data });
          return data;
        } catch (e) {
          lastErr = e;
          stats.fail++;
          stats.lastError = e.message;
          if (attempt < retries) {
            let wait = 300 * Math.pow(2, attempt);
            if (e.retryAfter) wait = Math.max(wait, Number(e.retryAfter) * 1000 || wait);
            await new Promise(r => setTimeout(r, wait));
          }
        }
      }
      throw lastErr;
    });
  }

  function getStats() { return { ...stats, active, queued: queue.length, cacheSize: cache.size }; }
  function clearCache() { cache.clear(); }

  return { fetchJson, getStats, clearCache, assertSafeUrl };
}

module.exports = { createHorizonClient, assertSafeUrl: (u, o) => createHorizonClient().assertSafeUrl(u, o), isPrivateHost };
