const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { version: APP_VERSION } = require('./lib/version');
const { isValidAccountId } = require('./lib/strkey');
const { meta, networkStatus } = require('./lib/meta');
const { createHorizonClient } = require('./lib/horizon/client');
const { probeNetwork } = require('./lib/horizon/probe');
const { createCollector } = require('./lib/collector');
const { orderBookUrl, tradesUrl, tradeAggUrl } = require('./lib/horizon/pair');
const { bookSpread, ohlcFromAggs } = require('./lib/analytics/pair');
const { analyzeCandles } = require('./lib/analytics/ta');
const { executeTool, listTools } = require('./lib/ai-module/tools');
const { planTools, writeReport, validateReply } = require('./lib/ai-module/planner');
const { summarizeEvidence } = require('./lib/ai-module/evidence');
const { runAnalyst } = require('./lib/ai-module/analyst');
const { TIMEFRAMES, normalizeAggs, aggregate } = require('./lib/analytics/candles');
const { createAlertEngine } = require('./lib/alerts');
const { fetchPiPriceUsd } = require('./lib/price');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Official Pi Horizon (env override with SSRF guard inside client)
const HORIZON = {
  mainnet: process.env.HORIZON_MAINNET_URL || 'https://api.mainnet.minepi.com',
  testnet: process.env.HORIZON_TESTNET_URL || 'https://api.testnet.minepi.com'
};
const horizonClient = createHorizonClient({
  timeoutMs: 10000,
  concurrency: 4,
  allowPrivate: process.env.HORIZON_ALLOW_PRIVATE === '1'
});
const horizonClients = {
  mainnet: { client: horizonClient, baseUrl: HORIZON.mainnet },
  testnet: { client: horizonClient, baseUrl: HORIZON.testnet }
};
let capabilityMatrix = { mainnet: null, testnet: null };
let collector = null;


// Data dir
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'pichain.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('DB error', err.message);
  else {
    console.log('Connected to SQLite database.');
    const alertEngine = createAlertEngine({ db });
    global.__pichainAlerts = alertEngine;
    collector = createCollector({
      db,
      horizonClients,
      intervalMs: Number(process.env.COLLECTOR_INTERVAL_MS || 60000),
      onCycle: async (byNet) => {
        try {
          const extra = { walletBalances: [], tradeStats: null };
          // sample watched wallets (limit 5) for balance-change rules
          const watched = await new Promise((resolve, reject) => {
            db.all('SELECT address, network FROM watched_wallets LIMIT 8', [], (e, r) => e ? reject(e) : resolve(r || []));
          });
          for (const w of watched) {
            try {
              const net = w.network || 'mainnet';
              const src = baseUrl(net);
              const acc = await horizonFetch(src + '/accounts/' + encodeURIComponent(w.address));
              const native = (acc.balances || []).find(b => b.asset_type === 'native');
              extra.walletBalances.push({ network: net, address: w.address, native_balance: Number(native?.balance || 0) });
            } catch (_) {}
          }
          try {
            const net = 'testnet';
            const tr = await horizonFetch(baseUrl(net) + '/trades?limit=15&order=desc');
            extra.tradeStats = { network: net, countLast: (tr._embedded?.records || []).length };
          } catch (_) {}
          await alertEngine.evaluate(byNet, extra);
        } catch (e) { console.error('alert eval', e.message); }
      }
    });
    if (process.env.COLLECTOR_ENABLED !== '0') {
      collector.start();
      console.log('Collector started');
    }
    // capability probe (async, non-blocking)
    (async () => {
      try {
        capabilityMatrix.mainnet = await probeNetwork(horizonClient, HORIZON.mainnet);
        capabilityMatrix.testnet = await probeNetwork(horizonClient, HORIZON.testnet);
        console.log('Capability probe done');
      } catch (e) { console.error('probe error', e.message); }
    })();
    db.run(`CREATE TABLE IF NOT EXISTS watched_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE,
      network TEXT,
      alias TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS watch_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT DEFAULT 'asset',
      left_code TEXT,
      left_issuer TEXT,
      right_code TEXT DEFAULT 'PI',
      right_issuer TEXT,
      label TEXT,
      network TEXT DEFAULT 'testnet',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS dashboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      widgets_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS saved_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      question TEXT,
      answer TEXT,
      network TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

function horizonFetch(url, timeoutMs = 9000) {
  return horizonClient.fetchJson(url, { retries: 2, ttlMs: 0 });
}


function baseUrl(network) {
  return HORIZON[network] || HORIZON.mainnet;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

app.get('/health', (req, res) => {
  const hs = horizonClient.getStats();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    horizon: hs,
    collector: collector ? collector.status() : { enabled: false },
    capabilities: {
      mainnet: capabilityMatrix.mainnet ? capabilityMatrix.mainnet.anyOk : null,
      testnet: capabilityMatrix.testnet ? capabilityMatrix.testnet.anyOk : null
    }
  });
});

app.get('/api/stats', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  const src = baseUrl(network);
  const fetchedAt = new Date().toISOString();
  try {
    const [root, fees, recentLedgers] = await Promise.all([
      horizonFetch(`${src}/`),
      horizonFetch(`${src}/fee_stats`).catch(() => null),
      horizonFetch(`${src}/ledgers?order=desc&limit=10`).catch(() => null)
    ]);
    const closedAt = root.history_latest_ledger_closed_at || null;
    const capRaw = fees?.ledger_capacity_usage != null ? Number(fees.ledger_capacity_usage) : null;
    const ledgerRows = recentLedgers?._embedded?.records || [];
    const txTotal = ledgerRows.reduce((n, r) => n + Number(r.transaction_count ?? r.successful_transaction_count ?? 0), 0);
    const txSuccess = ledgerRows.reduce((n, r) => n + Number(r.successful_transaction_count ?? 0), 0);
    const successRate = txTotal > 0 ? txSuccess / txTotal : null;
    const netSt = networkStatus(closedAt, capRaw != null ? String(capRaw) : null, successRate);
    const unit = network === 'mainnet' ? 'PI' : 'tPI';
    let avgFeeMeta;
    if (fees?.last_ledger_base_fee != null) {
      avgFeeMeta = meta(Number(fees.last_ledger_base_fee) / 1e7, { unit, source: src + '/fee_stats', fetchedAt, kind: 'raw', format: 'number', digits: 7 });
    } else {
      avgFeeMeta = meta(null, { unit, source: src + '/fee_stats', fetchedAt, kind: 'raw' });
      avgFeeMeta.reason = 'fee_stats unavailable';
    }
    const heightVal = root.history_latest_ledger || root.core_latest_ledger || null;
    res.json({
      network: network === 'mainnet' ? 'Pi Mainnet' : 'Pi Testnet',
      height: meta(heightVal, { source: src + '/', fetchedAt, kind: 'raw' }),
      protocol: meta(root.current_protocol_version || root.supported_protocol_version || null, { source: src + '/', fetchedAt, kind: 'raw' }),
      horizonVersion: meta(root.horizon_version || null, { source: src + '/', fetchedAt, kind: 'raw' }),
      coreVersion: meta(root.core_version || null, { source: src + '/', fetchedAt, kind: 'raw' }),
      networkPassphrase: root.network_passphrase || null,
      avgFee: avgFeeMeta,
      capacity: meta(capRaw, { source: src + '/fee_stats', fetchedAt, kind: 'raw', format: 'number', digits: 4 }),
      transactionSuccessRate: meta(successRate, { unit: 'ratio', source: src + '/ledgers?order=desc&limit=10', fetchedAt, kind: successRate == null ? 'raw' : 'derived', format: 'number', digits: 4 }),
      networkStatus: netSt,
      consensusStatus: netSt.status,
      consensusReason: netSt.reason,
      closedAt,
      dataSource: src,
      fetchedAt
    });
  } catch (err) {
    console.error('stats error:', err.message);
    res.status(502).json({
      error: 'Cannot reach Pi Horizon API',
      detail: err.message,
      network,
      consensusStatus: 'unknown',
      consensusReason: err.message,
      height: meta(null, { reason: err.message }),
      avgFee: meta(null, { reason: err.message })
    });
  }
});

app.get('/api/blocks', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  try {
    const data = await horizonFetch(`${baseUrl(network)}/ledgers?order=desc&limit=12`);
    const records = data._embedded?.records || [];
    res.json(records.map(r => ({
      height: r.sequence,
      hash: r.hash,
      txCount: r.successful_transaction_count ?? r.transaction_count ?? 0,
      opCount: r.operation_count ?? 0,
      closedAt: r.closed_at,
      time: timeAgo(r.closed_at),
      protocol: r.protocol_version
    })));
  } catch (err) {
    console.error('blocks error:', err.message);
    res.status(502).json({ error: err.message, blocks: [] });
  }
});

app.get('/api/transactions', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  try {
    let data;
    try {
      data = await horizonFetch(`${baseUrl(network)}/payments?order=desc&limit=15`);
    } catch {
      data = await horizonFetch(`${baseUrl(network)}/operations?order=desc&limit=15`);
    }
    const records = data._embedded?.records || [];
    res.json(records.map(op => {
      let amountDisplay = null;
      let assetCode = null;
      if (op.amount != null) {
        const isNative = !op.asset_type || op.asset_type === 'native';
        assetCode = isNative ? (network === 'mainnet' ? 'PI' : 'tPI') : (op.asset_code || op.asset_type || '—');
        const issuerShort = op.asset_issuer ? ` (${String(op.asset_issuer).slice(0, 5)}…${String(op.asset_issuer).slice(-4)})` : '';
        amountDisplay = Number(op.amount).toLocaleString(undefined, { maximumFractionDigits: 7 }) + ' ' + assetCode + (isNative ? '' : issuerShort);
      } else {
        amountDisplay = op.type_i === 0 ? 'Create Account' : (op.type || 'Operation');
      }
      return {
        txid: op.transaction_hash || op.id || '',
        id: op.id,
        type: op.type || 'payment',
        sender: op.from || op.source_account || op.funder || null,
        receiver: op.to || op.account || op.into || null,
        amount: amountDisplay,
        assetCode,
        status: op.transaction_successful === false ? 'Failed' : 'Success',
        time: timeAgo(op.created_at),
        createdAt: op.created_at,
        source: baseUrl(network) + '/payments'
      };
    }));
  } catch (err) {
    console.error('transactions error:', err.message);
    res.status(502).json({ error: err.message, transactions: [] });
  }
});

app.get('/api/trends', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  try {
    const data = await horizonFetch(`${baseUrl(network)}/ledgers?order=desc&limit=24`);
    const records = (data._embedded?.records || []).reverse();
    const points = records.map(r => ({
      height: r.sequence,
      tx: r.successful_transaction_count ?? r.transaction_count ?? 0,
      ops: r.operation_count ?? 0,
      time: r.closed_at,
      label: r.closed_at ? new Date(r.closed_at).toISOString().slice(11, 16) : String(r.sequence)
    }));
    const totalTx = points.reduce((s, p) => s + p.tx, 0);
    const totalOps = points.reduce((s, p) => s + p.ops, 0);
    const avgTx = points.length ? (totalTx / points.length).toFixed(1) : 0;
    res.json({
      points,
      summary: {
        ledgers: points.length,
        totalTx,
        totalOps,
        avgTxPerLedger: Number(avgTx),
        from: points[0]?.height,
        to: points[points.length - 1]?.height
      }
    });
  } catch (err) {
    console.error('trends error:', err.message);
    res.status(502).json({ error: err.message, points: [], summary: {} });
  }
});

app.get('/api/wallet/:address', async (req, res) => {
  const address = (req.params.address || '').trim();
  const network = (req.query.network || 'mainnet').toLowerCase();
  if (!isValidAccountId(address)) {
    return res.status(400).json({ error: 'Invalid account address (G… public key or M… muxed account with valid checksum)', error_vi: 'Địa chỉ không hợp lệ (G… hoặc M… có checksum hợp lệ)' });
  }
  try {
    const acc = await horizonFetch(`${baseUrl(network)}/accounts/${encodeURIComponent(address)}`);
    const native = (acc.balances || []).find(b => b.asset_type === 'native') || { balance: '0' };
    // "Locked" on Pi is often claimable_balances, not unauthorized trustlines.
    // We do not invent locked PI from unrelated balances; expose claimable count via separate field when available.
    const otherBalances = (acc.balances || []).filter(b => b.asset_type !== 'native');
    let recentOps = [];
    try {
      const ops = await horizonFetch(`${baseUrl(network)}/accounts/${encodeURIComponent(address)}/payments?order=desc&limit=8`);
      recentOps = (ops._embedded?.records || []).map(op => ({
        type: op.type, amount: op.amount, from: op.from, to: op.to, time: op.created_at,
        asset: (!op.asset_type || op.asset_type === 'native') ? (network==='mainnet'?'PI':'tPI') : (op.asset_code || null)
      }));
    } catch { /* ignore */ }
    let claimable = [];
    try {
      const cb = await horizonFetch(`${baseUrl(network)}/claimable_balances?claimant=${encodeURIComponent(address)}&limit=20`);
      claimable = (cb._embedded?.records || []).map(r => ({
        id: r.id,
        asset: r.asset,
        amount: r.amount,
        sponsor: r.sponsor || null
      }));
    } catch { /* endpoint may be unavailable */ }
    res.json({
      address: acc.account_id || address,
      network,
      balance: Number(native.balance).toLocaleString(undefined, { maximumFractionDigits: 7 }) + (network === 'mainnet' ? ' PI' : ' tPI'),
      balanceRaw: Number(native.balance),
      lockedBalance: null,
      lockedBalanceNote: 'Claimable/locked PI requires /claimable_balances (not inferred from trustlines)',
      otherAssets: otherBalances.map(b => ({
        code: b.asset_code || b.asset_type,
        issuer: b.asset_issuer || null,
        balance: b.balance
      })),
      subentryCount: acc.subentry_count ?? 0,
      flags: acc.flags || {},
      thresholds: acc.thresholds || {},
      signers: (acc.signers || []).length,
      sequence: acc.sequence,
      lastModified: acc.last_modified_time || null,
      // last_modified_time is NOT account creation date
      createdDate: null,
      recentOps,
      claimableBalances: claimable,
      claimableCount: claimable.length,
      dataSource: baseUrl(network)
    });
  } catch (err) {
    console.error('wallet error:', err.message);
    const msg = err.message.includes('not found') || err.message.includes('Resource Missing')
      ? 'Account not found on this network'
      : err.message;
    res.status(404).json({
      error: msg,
      error_vi: msg.includes('not found') ? 'Không tìm thấy tài khoản trên mạng này' : 'Lỗi tra cứu ví',
      address
    });
  }
});

app.get('/api/watched', (req, res) => {
  db.all('SELECT * FROM watched_wallets ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/watched', (req, res) => {
  const { address, network, alias } = req.body;
  if (!address) return res.status(400).json({ error: 'Missing address', error_vi: 'Thiếu địa chỉ ví' });
  const stmt = db.prepare('INSERT OR IGNORE INTO watched_wallets (address, network, alias) VALUES (?, ?, ?)');
  stmt.run(address, network || 'mainnet', alias || 'My Wallet', function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, address, network, alias });
  });
  stmt.finalize();
});

app.delete('/api/watched/:id', (req, res) => {
  db.run('DELETE FROM watched_wallets WHERE id = ?', req.params.id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});


// Assets list (multi-asset — most active on Testnet)
app.get('/api/assets', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  try {
    const data = await horizonFetch(`${baseUrl(network)}/assets?limit=30&order=desc`);
    const records = data._embedded?.records || [];
    const assets = records.map(a => ({
      code: a.asset_code || null,
      issuer: a.asset_issuer || null,
      type: a.asset_type || null,
      // Horizon's /assets response does not provide a universal verified holder count or total supply.
      holdersAuthorized: null,
      holders: null,
      supply: null,
      numAccounts: a.num_accounts != null ? Number(a.num_accounts) : null,
      metadata: {
        value: a.num_accounts != null ? Number(a.num_accounts) : null,
        unit: 'accounts', source: baseUrl(network) + '/assets',
        fetchedAt: new Date().toISOString(), kind: 'raw'
      },
      source: baseUrl(network) + '/assets',
      note: 'Holder count and total supply are not provided as verified totals by this endpoint'
    })).filter(a => a.code);
    res.json({ network, assets, note: network === 'testnet' ? 'Testnet tokens have no real value' : 'Mainnet asset list (may be limited)' });
  } catch (err) {
    console.error('assets error:', err.message);
    res.status(502).json({ error: err.message, assets: [] });
  }
});

// Recent DEX trades (pair activity)
app.get('/api/trades', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  try {
    const data = await horizonFetch(`${baseUrl(network)}/trades?limit=20&order=desc`);
    const records = data._embedded?.records || [];
    const trades = records.map(t => {
      const base = t.base_asset_type === 'native' ? 'PI' : (t.base_asset_code || '?');
      const counter = t.counter_asset_type === 'native' ? 'PI' : (t.counter_asset_code || '?');
      let price = null;
      if (t.price && t.price.n && t.price.d) {
        price = (Number(t.price.n) / Number(t.price.d)).toPrecision(6);
      }
      return {
        id: t.id,
        pair: `${base}/${counter}`,
        base, counter,
        baseIssuer: t.base_asset_type === 'native' ? null : (t.base_asset_issuer || null),
        counterIssuer: t.counter_asset_type === 'native' ? null : (t.counter_asset_issuer || null),
        baseAmount: t.base_amount,
        counterAmount: t.counter_amount,
        price,
        time: timeAgo(t.ledger_close_time),
        closedAt: t.ledger_close_time
      };
    });
    res.json({ network, trades, note: network === 'testnet' ? 'Testnet DEX activity (no real value)' : 'Trades if any' });
  } catch (err) {
    console.error('trades error:', err.message);
    res.status(502).json({ error: err.message, trades: [] });
  }
});

// Liquidity pools (AMM)
app.get('/api/pools', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  try {
    const data = await horizonFetch(`${baseUrl(network)}/liquidity_pools?limit=15&order=desc`);
    const records = data._embedded?.records || [];
    const pools = records.map(p => {
      const reserves = (p.reserves || []).map(r => {
        const asset = r.asset || 'native';
        const code = asset === 'native' ? 'PI' : asset.split(':')[0];
        return { code, amount: r.amount };
      });
      return {
        id: p.id,
        fee: p.fee_bp != null ? (Number(p.fee_bp) / 100) + '%' : '—',
        reserves,
        totalShares: p.total_shares,
        totalTrustlines: p.total_trustlines
      };
    });
    res.json({ network, pools, note: network === 'testnet' ? 'Testnet AMM pools' : 'Liquidity pools' });
  } catch (err) {
    console.error('pools error:', err.message);
    res.status(502).json({ error: err.message, pools: [] });
  }
});


// Watch pairs (asset/PI or custom label) — view-only tracking
app.get('/api/pairs', (req, res) => {
  db.all('SELECT * FROM watch_pairs ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});
app.post('/api/pairs', (req, res) => {
  const b = req.body || {};
  const label = (b.label || `${b.left_code || '?'}/${b.right_code || 'PI'}`).slice(0, 80);
  const stmt = db.prepare(`INSERT INTO watch_pairs (kind, left_code, left_issuer, right_code, right_issuer, label, network) VALUES (?,?,?,?,?,?,?)`);
  stmt.run(
    b.kind || 'asset',
    b.left_code || '',
    b.left_issuer || null,
    b.right_code || 'PI',
    b.right_issuer || null,
    label,
    b.network || 'testnet',
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, label });
    }
  );
  stmt.finalize();
});
app.delete('/api/pairs/:id', (req, res) => {
  db.run('DELETE FROM watch_pairs WHERE id = ?', req.params.id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// Saved AI reports (server-side so they persist on SoloHost)
app.get('/api/reports', (req, res) => {
  db.all('SELECT id, title, question, answer, network, created_at FROM saved_reports ORDER BY created_at DESC LIMIT 50', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});
app.post('/api/reports', (req, res) => {
  const b = req.body || {};
  if (!b.answer && !b.question) return res.status(400).json({ error: 'Empty report' });
  const title = (b.title || b.question || 'Report').toString().slice(0, 120);
  const stmt = db.prepare('INSERT INTO saved_reports (title, question, answer, network) VALUES (?,?,?,?)');
  stmt.run(title, (b.question || '').slice(0, 2000), (b.answer || '').slice(0, 20000), b.network || 'mainnet', function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, title });
  });
  stmt.finalize();
});
app.delete('/api/reports/:id', (req, res) => {
  db.run('DELETE FROM saved_reports WHERE id = ?', req.params.id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});



// ─── API v2 (P1) ───
app.get('/api/v2/sources', (req, res) => {
  res.json({
    version: APP_VERSION,
    horizon: {
      mainnet: HORIZON.mainnet,
      testnet: HORIZON.testnet,
      stats: horizonClient.getStats()
    },
    capabilities: capabilityMatrix,
    collector: collector ? collector.status() : null,
    note: 'Features appear only when the corresponding Horizon endpoint is available'
  });
});

app.get('/api/v2/snapshots', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 60, 500);
  if (!collector) return res.json({ network, points: [], note: 'collector disabled' });
  try {
    const points = await collector.getSnapshots(network, limit);
    res.json({
      network,
      points,
      from: points[0]?.fetched_at || null,
      to: points[points.length - 1]?.fetched_at || null,
      kind: 'raw',
      source: 'network_snapshots'
    });
  } catch (e) {
    res.status(500).json({ error: e.message, points: [] });
  }
});

app.post('/api/v2/probe', async (req, res) => {
  try {
    capabilityMatrix.mainnet = await probeNetwork(horizonClient, HORIZON.mainnet);
    capabilityMatrix.testnet = await probeNetwork(horizonClient, HORIZON.testnet);
    res.json({ ok: true, capabilities: capabilityMatrix });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});


// Pair center (P2)
// Asset codes are case-sensitive on-chain; only native synonyms are normalised to 'PI'.
function normCode(v) { const c = String(v || 'PI').trim(); return ['PI', 'TPI', 'NATIVE'].includes(c.toUpperCase()) ? 'PI' : c; }
app.get('/api/v2/pair', async (req, res) => {
  const network = (req.query.network || 'testnet').toLowerCase();
  const baseCode = normCode(req.query.base);
  const counterCode = normCode(req.query.counter);
  const baseIssuer = req.query.base_issuer || null;
  const counterIssuer = req.query.counter_issuer || null;
  const src = baseUrl(network);
  const fetchedAt = new Date().toISOString();
  const base = { code: baseCode, issuer: baseIssuer };
  const counter = { code: counterCode, issuer: counterIssuer };

  // Native/native order book is invalid on Horizon — require at least one distinct side
  if (baseCode === counterCode && !baseIssuer && !counterIssuer && (baseCode === 'PI' || baseCode === 'TPI' || baseCode === 'NATIVE')) {
    return res.json({
      network, base, counter, fetchedAt,
      orderBook: null, trades: [], candles: [],
      spread: null,
      note: 'Select a non-native token side (e.g. USDT/PI). Native/native book is not valid.',
      note_vi: 'Chọn một phía là token (vd USDT/PI). Cặp native/native không hợp lệ.'
    });
  }

  const out = { network, base, counter, fetchedAt, sources: {} };
  const needsIssuer =
    (baseCode !== 'PI' && baseCode !== 'TPI' && baseCode !== 'NATIVE' && !baseIssuer) ||
    (counterCode !== 'PI' && counterCode !== 'TPI' && counterCode !== 'NATIVE' && !counterIssuer);
  try {
    if (needsIssuer) {
      out.note = 'Token side needs issuer for full book/candles. Open from Recent trades (issuer auto-filled).';
      out.note_vi = 'Token cần issuer để đủ order book/nến. Hãy bấm cặp trong Giao dịch gần đây (tự điền issuer).';
    }
    try {
      if (needsIssuer) throw new Error('issuer required for credit asset');
      const book = await horizonFetch(orderBookUrl(src,
        { code: baseCode, issuer: baseIssuer },
        { code: counterCode, issuer: counterIssuer }
      ));
      out.orderBook = {
        bids: (book.bids || []).slice(0, 15).map(x => ({ price: x.price, amount: x.amount })),
        asks: (book.asks || []).slice(0, 15).map(x => ({ price: x.price, amount: x.amount })),
        source: src + '/order_book',
        kind: 'raw'
      };
      out.spread = bookSpread(out.orderBook.bids, out.orderBook.asks);
      out.sources.order_book = true;
    } catch (e) {
      out.orderBook = null;
      out.orderBookError = e.message;
      out.sources.order_book = false;
    }

    try {
      const tr = await horizonFetch(tradesUrl(src, base, counter, 20));
      out.trades = (tr._embedded?.records || []).map(t => ({
        id: t.id,
        baseAmount: t.base_amount,
        counterAmount: t.counter_amount,
        price: t.price ? Number(t.price.n) / Number(t.price.d) : null,
        time: t.ledger_close_time,
        source: src + '/trades',
        kind: 'raw'
      }));
      out.sources.trades = true;
    } catch (e) {
      out.trades = [];
      out.tradesError = e.message;
      out.sources.trades = false;
    }

    try {
      const agg = await horizonFetch(tradeAggUrl(src, base, counter, 3600000, 48));
      const records = agg._embedded?.records || (Array.isArray(agg) ? agg : []);
      out.candles = ohlcFromAggs(records);
      out.sources.trade_aggregations = true;
    } catch (e) {
      out.candles = [];
      out.candlesError = e.message;
      out.sources.trade_aggregations = false;
    }

    out.note = network === 'testnet' ? 'Testnet tokens have no real value' : null;
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message, network, base, counter });
  }
});

// Deterministic analyze (P4 assist — evidence always attached)
app.post('/api/v2/analyze', async (req, res) => {
  const b = req.body || {};
  const type = b.type || 'network';
  const network = (b.network || 'mainnet').toLowerCase();
  const ctx = {
    horizonFetch,
    baseUrl,
    db,
    network
  };
  const evidence = [];
  const sections = [];
  try {
    if (type === 'network' || type === 'overview') {
      const r = await executeTool('get_network_overview', { network }, ctx);
      evidence.push(r);
      if (r.ok) {
        sections.push({
          title: 'Network',
          lines: [
            `Height: ${r.data.height ?? '—'}`,
            `Protocol: ${r.data.protocol ?? '—'}`,
            `Closed: ${r.data.closedAt ?? '—'}`,
            `Source: ${r.source}`,
            `At: ${r.fetchedAt}`
          ]
        });
      } else sections.push({ title: 'Network', lines: ['Unavailable: ' + (r.error || '')] });
      const sn = await executeTool('query_snapshots', { network }, ctx);
      evidence.push(sn);
      if (sn.ok && sn.data?.length) {
        sections.push({ title: 'Snapshots', lines: [`Points: ${sn.data.length}`, `From: ${sn.data[0]?.fetched_at}`, `To: ${sn.data[sn.data.length-1]?.fetched_at}`] });
      }
    } else if (type === 'wallet') {
      const r = await executeTool('get_wallet', { address: b.address, network }, ctx);
      evidence.push(r);
      if (r.ok) {
        sections.push({
          title: 'Wallet',
          lines: [
            `Address: ${r.data.address}`,
            `Native balance: ${r.data.balance ?? '—'}`,
            `Subentries: ${r.data.subentryCount ?? '—'}`,
            `Source: ${r.source}`,
            `At: ${r.fetchedAt}`
          ]
        });
      } else sections.push({ title: 'Wallet', lines: [r.error || 'error'] });
    } else if (type === 'trades') {
      const r = await executeTool('get_pair_trades', { network }, ctx);
      evidence.push(r);
      if (r.ok) {
        sections.push({
          title: 'Recent trades',
          lines: (r.data || []).slice(0, 8).map(t => `${t.base}/${t.counter} ${t.baseAmount}→${t.counterAmount} @ ${t.time || ''}`)
        });
      }
    } else {
      return res.status(400).json({ error: 'type must be network|wallet|trades' });
    }
    const markdown = sections.map(s => `### ${s.title}\n` + s.lines.map(l => '- ' + l).join('\n')).join('\n\n');
    res.json({
      ok: true,
      type,
      network,
      markdown,
      sections,
      evidence: evidence.map(e => ({
        ok: e.ok,
        evidenceId: e.evidenceId,
        source: e.source,
        fetchedAt: e.fetchedAt,
        kind: e.kind,
        error: e.error || null
      })),
      disclaimer: 'Numbers only from listed evidence. No price prediction.'
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/v2/tools', (_req, res) => {
  res.json({ tools: listTools() });
});


// Alerts (P3)
app.get('/api/v2/alerts/rules', async (req, res) => {
  try {
    const eng = global.__pichainAlerts;
    if (!eng) return res.json([]);
    res.json(await eng.listRules());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/v2/alerts/events', async (req, res) => {
  try {
    const eng = global.__pichainAlerts;
    if (!eng) return res.json([]);
    res.json(await eng.listEvents(Number(req.query.limit) || 30));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/v2/alerts/rules', async (req, res) => {
  try {
    const eng = global.__pichainAlerts;
    const b = req.body || {};
    const allowed = new Set(['network_status', 'capacity_high', 'ledger_stalled', 'wallet_balance_change', 'trade_activity']);
    if (!allowed.has(b.kind)) return res.status(400).json({ error: 'invalid alert kind' });
    res.json(await eng.addRule(b));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/v2/alerts/rules/:id/enable', async (req, res) => {
  try {
    const eng = global.__pichainAlerts;
    res.json(await eng.setEnabled(req.params.id, !!req.body?.enabled));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/v2/alerts/rules/:id', async (req, res) => {
  try {
    const eng = global.__pichainAlerts;
    res.json(await eng.removeRule(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// AI observe pipeline (planner → tools → report + evidence) — works without API key
app.post('/api/v2/observe', async (req, res) => {
  const b = req.body || {};
  const message = String(b.message || '').slice(0, 2000);
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });
  const network = (b.network || 'mainnet').toLowerCase();
  const lang = b.lang || 'en';
  const ctx = { horizonFetch, baseUrl, db, network };
  try {
    const plan = planTools(message, { network, address: b.address });
    const results = [];
    for (const step of plan) {
      const out = await executeTool(step.name, { ...(step.args || {}), network }, ctx);
      results.push({ name: step.name, ...out });
    }
    const report = writeReport(message, results, lang);
    const validation = validateReply(report.reply_markdown, results, message);
    res.json({
      ok: true,
      plan,
      reply_markdown: report.reply_markdown,
      follow_ups: report.follow_ups,
      evidence: summarizeEvidence(results),
      evidence_ids: report.evidence_ids,
      validation,
      disclaimer: 'Read-only tools. No investment advice.'
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/v2/holders', async (req, res) => {
  const network = (req.query.network || 'testnet').toLowerCase();
  const code = String(req.query.code || '').slice(0, 12);
  const issuer = req.query.issuer || null;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const out = await executeTool('scan_asset_holders', { code, issuer, limit, network }, { horizonFetch, baseUrl, db, network });
    res.json(out);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});


// Simple dashboards (P3) — list of widget ids only
app.get('/api/v2/dashboards', (req, res) => {
  db.all('SELECT id, name, widgets_json, created_at FROM dashboards ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json((rows || []).map(r => ({ ...r, widgets: JSON.parse(r.widgets_json || '[]') })));
  });
});
app.post('/api/v2/dashboards', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || 'My board').slice(0, 80);
  const widgets = Array.isArray(b.widgets) ? b.widgets.slice(0, 12) : [];
  db.run('INSERT INTO dashboards (name, widgets_json) VALUES (?,?)', [name, JSON.stringify(widgets)], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, widgets });
  });
});
app.delete('/api/v2/dashboards/:id', (req, res) => {
  db.run('DELETE FROM dashboards WHERE id = ?', req.params.id, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});


// Optional third-party price (off unless PRICE_ENABLED=1)
app.get('/api/v2/price', async (req, res) => {
  try {
    res.json(await fetchPiPriceUsd());
  } catch (e) {
    res.json({ enabled: false, value: null, display: '—', note: e.message, kind: 'third_party' });
  }
});

// Lightweight SSE stream of network pulse (polling-backed)
app.get('/api/v2/stream', async (req, res) => {
  const network = (req.query.network || 'mainnet').toLowerCase();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  let closed = false;
  req.on('close', () => { closed = true; });
  const send = async () => {
    if (closed) return;
    try {
      const src = baseUrl(network);
      const root = await horizonFetch(src + '/');
      const payload = {
        network,
        height: root.history_latest_ledger || root.core_latest_ledger || null,
        closedAt: root.history_latest_ledger_closed_at || null,
        fetchedAt: new Date().toISOString(),
        source: src + '/'
      };
      res.write('data: ' + JSON.stringify(payload) + '\n\n');
    } catch (e) {
      res.write('data: ' + JSON.stringify({ error: e.message, fetchedAt: new Date().toISOString() }) + '\n\n');
    }
  };
  await send();
  const iv = setInterval(send, Number(process.env.SSE_INTERVAL_MS || 15000));
  req.on('close', () => clearInterval(iv));
});


// Multi-timeframe candles with volume (1m…1M). Non-native timeframes are derived from a native one and labelled so.
app.get('/api/v2/pair/candles', async (req, res) => {
  const network = String(req.query.network || 'testnet').toLowerCase();
  const tf = String(req.query.tf || '1h');
  const def = TIMEFRAMES[tf];
  if (!['mainnet', 'testnet'].includes(network)) return res.status(400).json({ ok: false, error: 'network must be mainnet|testnet' });
  if (!def) return res.status(400).json({ ok: false, error: 'tf must be one of ' + Object.keys(TIMEFRAMES).join(',') });
  const side = (code, issuer) => {
    const c = String(code || 'PI').trim();
    if (['PI', 'TPI', 'NATIVE'].includes(c.toUpperCase())) return { code: 'PI', issuer: null };
    if (!/^[A-Za-z0-9]{1,12}$/.test(c)) return { error: 'asset code must be 1-12 alphanumeric' };
    if (!issuer) return { needsIssuer: true, code: c, issuer: null };
    if (!isValidAccountId(String(issuer)) || String(issuer)[0] !== 'G') return { error: 'invalid issuer' };
    return { code: c, issuer: String(issuer) };
  };
  const base = side(req.query.base, req.query.base_issuer);
  const counter = side(req.query.counter, req.query.counter_issuer);
  if (base.error || counter.error) return res.status(400).json({ ok: false, error: base.error || counter.error });
  const fetchedAt = new Date().toISOString();
  const out = { ok: true, network, base, counter, tf, tfMs: def.ms, fetchedAt, kind: def.native === def.ms ? 'raw' : 'derived',
    derivedFrom: def.native === def.ms ? null : (def.calendar ? '1d' : String(def.native / 60000) + 'm'), candles: [] };
  if (base.needsIssuer || counter.needsIssuer) {
    out.note = 'Token side needs an issuer (G…) to load candles.'; out.note_vi = 'Token cần issuer (G…) để tải nến.';
    return res.json(out);
  }
  if (base.code === 'PI' && counter.code === 'PI') {
    out.note = 'Select a non-native token on one side.'; out.note_vi = 'Chọn một phía là token (không phải PI/PI).';
    return res.json(out);
  }
  const wanted = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 20), 600);
  const needRaw = def.factor ? wanted * def.factor : (def.calendar ? 400 : wanted);
  const pages = Math.min(Math.ceil(needRaw / 200), 3);
  const src = baseUrl(network);
  const b = { code: base.code, issuer: base.issuer }, c = { code: counter.code, issuer: counter.issuer };
  let records = []; let endTime = null;
  try {
    for (let i = 0; i < pages; i++) {
      let url = tradeAggUrl(src, b, c, def.native, Math.min(200, needRaw - records.length));
      if (endTime != null) url += '&end_time=' + endTime;
      const agg = await horizonFetch(url);
      const recs = agg._embedded?.records || [];
      if (!recs.length) break;
      records = records.concat(recs);
      const oldest = Math.min(...recs.map(r => Number(r.timestamp)).filter(Number.isFinite));
      if (!Number.isFinite(oldest) || recs.length < 200) break;
      endTime = oldest;
    }
    out.source = src + '/trade_aggregations';
    let candles = normalizeAggs(records);
    if (def.factor || def.calendar) candles = aggregate(candles, tf);
    out.candles = candles.slice(-wanted);
    out.count = out.candles.length;
    if (!out.candles.length) { out.note = 'No trades in this range on this network yet.'; out.note_vi = 'Chưa có giao dịch trong khoảng này trên mạng này.'; }
    res.json(out);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message, network, tf, fetchedAt });
  }
});

// Technical analysis for a pair (derived from candles only)
app.get('/api/v2/pair/ta', async (req, res) => {
  const network = (req.query.network || 'testnet').toLowerCase();
  const baseCode = normCode(req.query.base);
  const counterCode = normCode(req.query.counter);
  const baseIssuer = req.query.base_issuer || null;
  const counterIssuer = req.query.counter_issuer || null;
  const src = baseUrl(network);
  const base = { code: baseCode, issuer: baseIssuer };
  const counter = { code: counterCode, issuer: counterIssuer };
  try {
    let candles = [];
    let candlesError = null;
    try {
      const agg = await horizonFetch(tradeAggUrl(src, base, counter, 3600000, 48));
      const records = agg._embedded?.records || (Array.isArray(agg) ? agg : []);
      candles = ohlcFromAggs(records);
    } catch (e) {
      candlesError = e.message;
    }
    const ta = analyzeCandles(candles, {
      pair: baseCode + '/' + counterCode,
      network
    });
    res.json({
      ok: true,
      network,
      base,
      counter,
      candlesCount: candles.length,
      candlesError,
      analysis: ta,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

function requireAdmin(req, res, next) {
  // SoloHost default: open unless ADMIN_TOKEN is explicitly set
  const token = process.env.ADMIN_TOKEN;
  if (!token || !String(token).trim()) return next();
  const h = req.headers['x-admin-token'] || req.headers['authorization'] || '';
  const got = String(h).replace(/^Bearer\s+/i, '');
  if (got === token) return next();
  return res.status(403).json({ ok: false, error: 'Invalid admin token' });
}

// Simple in-memory rate limit for AI chat
const chatHits = new Map();
function rateLimitChat(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const max = 30;
  let arr = chatHits.get(ip) || [];
  arr = arr.filter(t => now - t < windowMs);
  if (arr.length >= max) return res.status(429).json({ ok: false, error: 'Rate limit' });
  arr.push(now);
  chatHits.set(ip, arr);
  next();
}

// ─── Universal AI + Feedback (single system) ───
const adapter = require('./lib/app-adapter');
const { createAIService } = require('./lib/ai-module/ai-service');
const { mountAIRoutes } = require('./lib/ai-module/routes');
const { createFeedbackService, mountFeedbackRoutes } = require('./lib/feedback-module/feedback-service');

const pkg = require('./package.json');
const ai = createAIService({
  dataDir,
  appName: 'PiChain Monitor',
  adapter
});
// Enrich factual chat with observe pipeline (planner→tools→evidence)
ai._enrichObserve = async (message, context) => {
  const m = String(message || '');
  if (!ai._isDataIntent(m)) return null;
  const network = (context && context.network) || 'mainnet';
  const lang = (context && context.lang) || 'en';
  const ctx = { horizonFetch, baseUrl, db, network };
  const plan = planTools(m, { network, address: context && context.address });
  const results = [];
  for (const step of plan) {
    const out = await executeTool(step.name, { ...(step.args || {}), network }, ctx);
    results.push({ name: step.name, ...out });
  }
  const report = writeReport(m, results, lang);
  const validation = validateReply(report.reply_markdown, results, m);
  return {
    reply_markdown: report.reply_markdown,
    evidence: summarizeEvidence(results),
    evidence_ids: report.evidence_ids,
    validation,
    plan
  };
};
// Data-question gate shared by observe + analyst
ai._isDataIntent = (m) => /(mạng|network|ví|wallet|trade|giao dịch|height|tóm tắt|summary|watchlist|phí|fee|ledger|số dư|balance|token|asset|cặp|pair|order|nến|candle|G[A-Z2-7]{55}|M[A-Z2-7]{55})/i.test(String(m || ''));
// LLM planner → whitelisted tools → writer → numeric validator (only when a provider is configured)
ai._analyze = async (message, context) => {
  const network = String((context && context.network) || 'mainnet').toLowerCase();
  const lang = (context && context.lang) || 'en';
  const ctx = { horizonFetch, baseUrl, db, network };
  return runAnalyst({
    message: String(message || '').slice(0, 2000), lang, network, address: context && context.address,
    llm: (msgs) => ai.complete(msgs),
    exec: (name, args) => executeTool(name, args, ctx)
  });
};
mountAIRoutes(app, ai);

const fbOpts = {
  appId: 'pichain-monitor',
  appName: 'PiChain Monitor',
  version: APP_VERSION
};
// Hub credentials: module DEFAULTS already contain the correct values.
// Only override from env when explicitly set (non-empty).
if (process.env.SHFH_HUB_ID) fbOpts.hubId = process.env.SHFH_HUB_ID;
if (process.env.SHFH_HUB_URL) fbOpts.baseUrl = process.env.SHFH_HUB_URL;
if (process.env.SHFH_INGEST_TOKEN) fbOpts.ingestToken = process.env.SHFH_INGEST_TOKEN;
const fb = createFeedbackService(fbOpts);
mountFeedbackRoutes(app, fb);

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`PiChain Monitor v${APP_VERSION} on port ${PORT}`);
  console.log(`Horizon: ${HORIZON.mainnet} | ${HORIZON.testnet}`);
  console.log('Universal AI + Feedback mounted (single system)');
});
