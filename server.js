const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const dbPath = path.join(__dirname, 'data', 'pichain.db');
const fs = require('fs');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS watched_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE,
      network TEXT,
      alias TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API: Network Stats
app.get('/api/stats', (req, res) => {
  const network = req.query.network || 'mainnet';
  // Simulated realistic Pi blockchain stats
  const stats = network === 'mainnet' ? {
    network: 'Pi Mainnet',
    height: 4859230,
    tps: 18.4,
    validators: 3420,
    avgFee: '0.01 PI',
    activeAccounts: 5420109,
    circulatingSupply: '65,400,000 PI',
    consensusStatus: 'Healthy'
  } : {
    network: 'Pi Testnet',
    height: 1249820,
    tps: 24.2,
    validators: 512,
    avgFee: '0.001 tPI',
    activeAccounts: 893420,
    circulatingSupply: '100,000,000 tPI',
    consensusStatus: 'Healthy'
  };
  res.json(stats);
});

// API: Recent Blocks
app.get('/api/blocks', (req, res) => {
  const network = req.query.network || 'mainnet';
  const baseHeight = network === 'mainnet' ? 4859230 : 1249820;
  const blocks = [];
  for (let i = 0; i < 10; i++) {
    blocks.push({
      height: baseHeight - i,
      hash: '0x' + Math.random().toString(16).substring(2, 15) + Math.random().toString(16).substring(2, 15),
      txCount: Math.floor(Math.random() * 25) + 1,
      validator: 'pi_val_' + Math.random().toString(36).substring(2, 8),
      time: `${i * 5 + 2} secs ago`
    });
  }
  res.json(blocks);
});

// API: Recent Transactions
app.get('/api/transactions', (req, res) => {
  const network = req.query.network || 'mainnet';
  const txs = [];
  for (let i = 0; i < 10; i++) {
    txs.push({
      txid: '0x' + Math.random().toString(16).substring(2, 15) + Math.random().toString(16).substring(2, 15),
      sender: 'pi1' + Math.random().toString(36).substring(2, 12),
      receiver: 'pi1' + Math.random().toString(36).substring(2, 12),
      amount: (Math.random() * 100).toFixed(2) + (network === 'mainnet' ? ' PI' : ' tPI'),
      status: 'Success',
      time: `${i * 12 + 5} secs ago`
    });
  }
  res.json(txs);
});

// API: Wallet Lookup
app.get('/api/wallet/:address', (req, res) => {
  const address = req.params.address;
  const network = req.query.network || 'mainnet';
  if (!address || address.length < 5) {
    return res.status(400).json({ error: 'Địa chỉ ví không hợp lệ' });
  }
  
  res.json({
    address: address,
    network: network,
    balance: (Math.random() * 1250).toFixed(4) + (network === 'mainnet' ? ' PI' : ' tPI'),
    lockedBalance: (Math.random() * 500).toFixed(4) + (network === 'mainnet' ? ' PI' : ' tPI'),
    txCount: Math.floor(Math.random() * 140) + 5,
    createdDate: '2023-11-15'
  });
});

// API: Watched Wallets (DB)
app.get('/api/watched', (req, res) => {
  db.all('SELECT * FROM watched_wallets ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/watched', (req, res) => {
  const { address, network, alias } = req.body;
  if (!address) {
    return res.status(400).json({ error: 'Thiếu địa chỉ ví' });
  }
  const stmt = db.prepare('INSERT OR IGNORE INTO watched_wallets (address, network, alias) VALUES (?, ?, ?)');
  stmt.run(address, network || 'mainnet', alias || 'My Wallet', function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, address, network, alias });
  });
  stmt.finalize();
});

app.delete('/api/watched/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM watched_wallets WHERE id = ?', id, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ deleted: this.changes });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PiChain Monitor running on port ${PORT}`);
});
