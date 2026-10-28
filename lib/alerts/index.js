'use strict';
function ensureTables(db) {
  db.run(`CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    kind TEXT NOT NULL,
    network TEXT DEFAULT 'mainnet',
    params_json TEXT,
    enabled INTEGER DEFAULT 1,
    cooldown_sec INTEGER DEFAULT 300,
    last_fired_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS alert_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER,
    message TEXT,
    payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS wallet_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT,
    address TEXT,
    native_balance REAL,
    fetched_at TEXT
  )`);
}

function createAlertEngine({ db }) {
  ensureTables(db);

  function listRules() {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM alert_rules ORDER BY id DESC', [], (e, r) => e ? reject(e) : resolve(r || []));
    });
  }
  function listEvents(limit = 40) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM alert_events ORDER BY id DESC LIMIT ?', [limit], (e, r) => e ? reject(e) : resolve(r || []));
    });
  }
  function addRule(rule) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO alert_rules (name, kind, network, params_json, enabled, cooldown_sec) VALUES (?,?,?,?,?,?)`,
        [rule.name || rule.kind, rule.kind, rule.network || 'mainnet', JSON.stringify(rule.params || {}), rule.enabled === 0 ? 0 : 1, rule.cooldown_sec || 300],
        function (e) { e ? reject(e) : resolve({ id: this.lastID }); }
      );
    });
  }
  function setEnabled(id, enabled) {
    return new Promise((resolve, reject) => {
      db.run('UPDATE alert_rules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id], function (e) {
        e ? reject(e) : resolve({ changes: this.changes });
      });
    });
  }
  function removeRule(id) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM alert_rules WHERE id = ?', [id], function (e) {
        e ? reject(e) : resolve({ changes: this.changes });
      });
    });
  }
  function fire(rule, message, payload) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      db.run('UPDATE alert_rules SET last_fired_at = ? WHERE id = ?', [now, rule.id], () => {});
      db.run(
        'INSERT INTO alert_events (rule_id, message, payload_json) VALUES (?,?,?)',
        [rule.id, message, JSON.stringify(payload || {})],
        function (e) { e ? reject(e) : resolve({ id: this.lastID }); }
      );
    });
  }

  function lastWalletSnap(network, address) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM wallet_snapshots WHERE network=? AND address=? ORDER BY id DESC LIMIT 1',
        [network, address],
        (e, row) => e ? reject(e) : resolve(row || null)
      );
    });
  }
  function saveWalletSnap(network, address, native_balance) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO wallet_snapshots (network, address, native_balance, fetched_at) VALUES (?,?,?,?)',
        [network, address, native_balance, new Date().toISOString()],
        (e) => e ? reject(e) : resolve()
      );
    });
  }

  /**
   * snapshotByNetwork: { mainnet: {height,capacity,status,...}, ... }
   * walletBalances: optional [{network,address,native_balance}]
   * tradeStats: optional { network, countLast: n }
   */
  async function evaluate(snapshotByNetwork, extra = {}) {
    const rules = await listRules();
    const fired = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const params = JSON.parse(rule.params_json || '{}');
      const net = rule.network || 'mainnet';
      if (rule.last_fired_at) {
        const age = (Date.now() - new Date(rule.last_fired_at).getTime()) / 1000;
        if (age < (rule.cooldown_sec || 300)) continue;
      }
      let hit = false;
      let msg = '';
      const snap = snapshotByNetwork[net];

      if (rule.kind === 'network_status' && snap && snap.status && snap.status !== 'ok') {
        hit = true;
        msg = `Network ${net} status=${snap.status} (height ${snap.height ?? '—'})`;
      }
      if (rule.kind === 'capacity_high' && snap && snap.capacity != null && snap.capacity >= (params.threshold ?? 0.8)) {
        hit = true;
        msg = `Capacity ${(snap.capacity * 100).toFixed(0)}% on ${net}`;
      }
      if (rule.kind === 'ledger_stalled' && snap && snap.status === 'stalled') {
        hit = true;
        msg = `Ledger stalled on ${net}`;
      }
      if (rule.kind === 'wallet_balance_change' && Array.isArray(extra.walletBalances)) {
        const addr = params.address;
        const minDelta = Number(params.minDelta || 0);
        const wb = extra.walletBalances.find(w => w.address === addr && w.network === net);
        if (wb && addr) {
          const prev = await lastWalletSnap(net, addr);
          if (prev && prev.native_balance != null) {
            const delta = Number(wb.native_balance) - Number(prev.native_balance);
            if (Math.abs(delta) >= minDelta) {
              hit = true;
              msg = `Wallet ${addr.slice(0, 6)}… balance Δ ${delta} (threshold ${minDelta}) on ${net}`;
            }
          }
          await saveWalletSnap(net, addr, Number(wb.native_balance));
        }
      }
      if (rule.kind === 'trade_activity' && extra.tradeStats && extra.tradeStats.network === net) {
        const minTrades = Number(params.minTrades || 5);
        if ((extra.tradeStats.countLast || 0) >= minTrades) {
          hit = true;
          msg = `Trade activity ${extra.tradeStats.countLast} recent trades on ${net}`;
        }
      }

      if (hit) {
        await fire(rule, msg, { snap, params, extra: extra.tradeStats || null });
        fired.push({ ruleId: rule.id, message: msg });
      }
    }
    return fired;
  }

  return { listRules, listEvents, addRule, setEnabled, removeRule, evaluate, ensureTables, lastWalletSnap, saveWalletSnap };
}

module.exports = { createAlertEngine };
