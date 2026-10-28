'use strict';
function createCollector({ db, horizonClients, intervalMs = 60000, onCycle }) {
  let timer = null;
  let lastRun = null;
  let lastError = null;
  let running = false;

  function ensureTable(cb) {
    db.run(`CREATE TABLE IF NOT EXISTS network_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      network TEXT NOT NULL,
      height INTEGER,
      protocol INTEGER,
      capacity REAL,
      base_fee REAL,
      closed_at TEXT,
      status TEXT,
      fetched_at TEXT NOT NULL,
      raw_json TEXT
    )`, cb);
  }

  function getSnapshots(network, limit = 60) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT network, height, protocol, capacity, base_fee, closed_at, status, fetched_at
         FROM network_snapshots WHERE network = ? ORDER BY id DESC LIMIT ?`,
        [network, limit],
        (err, rows) => err ? reject(err) : resolve((rows || []).reverse())
      );
    });
  }

  async function snapshotNetwork(network, client, baseUrl) {
    const src = baseUrl.replace(/\/$/, '');
    const [root, fees] = await Promise.all([
      client.fetchJson(src + '/', { ttlMs: 5000 }),
      client.fetchJson(src + '/fee_stats', { ttlMs: 5000 }).catch(() => null)
    ]);
    const height = root.history_latest_ledger || root.core_latest_ledger || null;
    const closedAt = root.history_latest_ledger_closed_at || null;
    const capacity = fees?.ledger_capacity_usage != null ? Number(fees.ledger_capacity_usage) : null;
    const baseFee = fees?.last_ledger_base_fee != null ? Number(fees.last_ledger_base_fee) / 1e7 : null;
    const fetchedAt = new Date().toISOString();
    let status = 'unknown';
    if (closedAt) {
      const age = (Date.now() - new Date(closedAt).getTime()) / 1000;
      status = age > 60 ? 'stalled' : age > 20 ? 'slow' : 'ok';
    }
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO network_snapshots (network, height, protocol, capacity, base_fee, closed_at, status, fetched_at, raw_json)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [network, height, root.current_protocol_version || null, capacity, baseFee, closedAt, status, fetchedAt,
          JSON.stringify({ horizon_version: root.horizon_version })],
        (err) => err ? reject(err) : resolve()
      );
    });
    return { network, height, capacity, status, closed_at: closedAt, fetched_at: fetchedAt };
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const byNet = {};
      for (const [network, { client, baseUrl }] of Object.entries(horizonClients)) {
        try {
          byNet[network] = await snapshotNetwork(network, client, baseUrl);
        } catch (e) {
          lastError = `${network}: ${e.message}`;
        }
      }
      lastRun = new Date().toISOString();
      if (typeof onCycle === 'function') {
        try { await onCycle(byNet); } catch (e) { lastError = 'onCycle: ' + e.message; }
      }
    } finally {
      running = false;
    }
  }

  function start() {
    ensureTable(() => {});
    if (timer) return;
    tick();
    timer = setInterval(tick, intervalMs);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function status() {
    return { lastRun, lastError, running, enabled: !!timer };
  }

  return { start, stop, tick, status, getSnapshots, ensureTable };
}
module.exports = { createCollector };
