'use strict';
/**
 * Deterministic planner: map user message → max 6 read-only tools.
 * Works offline without LLM. Optional LLM path can refine later.
 */
function planTools(message, context = {}) {
  const m = String(message || '').toLowerCase();
  const tools = [];
  const net = context.network || 'mainnet';

  if (/mạng|network|overview|tóm tắt|height|ledger|phí|fee|status|trạng thái/.test(m)) {
    tools.push({ name: 'get_network_overview', args: { network: net } });
    tools.push({ name: 'query_snapshots', args: { network: net } });
  }
  if (/ví|wallet|address|số dư|balance|g[a-z0-9]{55}/i.test(message || '')) {
    const addr = (message || '').match(/[GM][A-Z2-7]{55}/);
    if (addr) tools.push({ name: 'get_wallet', args: { address: addr[0], network: net } });
    else if (context.address) tools.push({ name: 'get_wallet', args: { address: context.address, network: net } });
  }
  if (/watchlist|theo dõi|ghim|pinned/.test(m)) {
    tools.push({ name: 'list_user_watchlist', args: {} });
  }
  if (/trade|giao dịch|dex|cặp|pair|token|asset/.test(m)) {
    tools.push({ name: 'get_pair_trades', args: { network: net } });
  }
  if (!tools.length) {
    tools.push({ name: 'get_network_overview', args: { network: net } });
  }
  return tools.slice(0, 6);
}

function writeReport(message, results, lang) {
  const isVi = lang === 'vi' || /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(message || '');
  const lines = [];
  const evidence_ids = [];
  lines.push(isVi ? '### Báo cáo quan sát (dữ liệu thật)' : '### Observation report (live data)');
  for (const r of results) {
    if (r.evidenceId) evidence_ids.push(r.evidenceId);
    if (!r.ok) {
      lines.push(`- ${r.name || 'tool'}: ${isVi ? 'lỗi' : 'error'} — ${r.error || '—'}`);
      continue;
    }
    if (r.name === 'get_network_overview' && r.data) {
      lines.push(isVi
        ? `- Mạng: height **${r.data.height ?? '—'}**, protocol **${r.data.protocol ?? '—'}**, closed **${r.data.closedAt ?? '—'}**`
        : `- Network: height **${r.data.height ?? '—'}**, protocol **${r.data.protocol ?? '—'}**, closed **${r.data.closedAt ?? '—'}**`);
    }
    if (r.name === 'query_snapshots' && Array.isArray(r.data)) {
      lines.push(isVi
        ? `- Snapshots: **${r.data.length}** điểm (collector)`
        : `- Snapshots: **${r.data.length}** points (collector)`);
    }
    if (r.name === 'get_wallet' && r.data) {
      lines.push(isVi
        ? `- Ví \`${r.data.address}\`: số dư native **${r.data.balance ?? '—'}**, subentries **${r.data.subentryCount ?? '—'}**`
        : `- Wallet \`${r.data.address}\`: native balance **${r.data.balance ?? '—'}**, subentries **${r.data.subentryCount ?? '—'}**`);
    }
    if (r.name === 'list_user_watchlist' && Array.isArray(r.data)) {
      lines.push(isVi ? `- Watchlist: **${r.data.length}** ví` : `- Watchlist: **${r.data.length}** wallets`);
      r.data.slice(0, 5).forEach(w => lines.push(`  - ${w.alias || ''} \`${w.address}\``));
    }
    if (r.name === 'get_pair_trades' && Array.isArray(r.data)) {
      lines.push(isVi ? `- Trades gần đây: **${r.data.length}**` : `- Recent trades: **${r.data.length}**`);
      r.data.slice(0, 5).forEach(t => lines.push(`  - ${t.base}/${t.counter} ${t.baseAmount}→${t.counterAmount}`));
    }
    lines.push(isVi
      ? `  · nguồn: \`${r.source}\` · lúc ${r.fetchedAt || '—'} · id \`${r.evidenceId || '—'}\``
      : `  · source: \`${r.source}\` · at ${r.fetchedAt || '—'} · id \`${r.evidenceId || '—'}\``);
  }
  lines.push('');
  lines.push(isVi
    ? '_Không dự đoán giá. Token Testnet không có giá trị thật._'
    : '_No price prediction. Testnet tokens have no real value._');
  return {
    reply_markdown: lines.join('\n'),
    evidence_ids,
    follow_ups: isVi
      ? ['Phân tích một địa chỉ ví G…', 'Tóm tắt watchlist', 'Trade gần đây trên Testnet']
      : ['Analyze a G… wallet', 'Summarize watchlist', 'Recent Testnet trades']
  };
}

/** Numeric grounding check: every number in the reply must trace to evidence (see validator.js). */
function validateReply(reply_markdown, results, message) {
  const { validateNumbers } = require('./validator');
  const v = validateNumbers(reply_markdown, results, message);
  return { ok: v.ok, warnings: v.unverified.map(n => 'unverified number: ' + n), unverified: v.unverified, checked: v.checked };
}

module.exports = { planTools, writeReport, validateReply };
