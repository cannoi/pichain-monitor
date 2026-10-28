'use strict';
/**
 * PiChain Monitor — app adapter for Universal AI module.
 * Knowledge must stay accurate with current app features (v1.2+).
 */
const ALLOWED = new Set(['open_tab', 'refresh_stats', 'switch_network', 'open_view']);
const ALLOWED_VIEWS = new Set(['overview', 'activity', 'wallets', 'pairs', 'assets', 'pools', 'alerts', 'dashboard', 'ai', 'reports', 'sources', 'settings']);

const adapter = {
  knowledge: `
APP NAME: PiChain Monitor
VERSION: sourced from package.json (live /health version)
PURPOSE: Lean international Pi Network blockchain observer for ordinary users and Pioneers. Optimized for Pi Browser & SoloHost.

DATA LAYER: Horizon client with probe + collector snapshots (network_snapshots). UI Sources & status shows endpoint matrix.\nOFFICIAL DATA SOURCES (live, not simulated):
- Mainnet Horizon: https://api.mainnet.minepi.com
- Testnet Horizon: https://api.testnet.minepi.com
- Block explorer: https://blockexplorer.minepi.com/mainnet
Pi uses a Stellar-compatible protocol. Protocol version is read live from Horizon root (current_protocol_version).

MAIN SCREENS / FEATURES:
1. Network Pulse cards: Ledger Height, Protocol version, Ledger Capacity usage, Average (base) Fee — all live from Horizon root + fee_stats.
2. Activity Chart: bar chart of successful transactions per recent ledger (last recent ledgerss) via /api/trends.
3. Wallet Lookup: paste G… or M… address → real balance (native PI), locked/other balances, subentries, last modified, recent payments for that account.
4. Latest Ledgers list and Recent Payments feed (live).
5. Watched wallets (local SQLite): pin addresses, click to re-lookup. Network-aware (mainnet/testnet).
6. Language: EN / VI toggle (saved in localStorage). UI and offline AI replies follow user language.
7. Network switcher: Mainnet | Testnet.

AI PANEL (single robot FAB bottom-right):
Tabs: Chat | Feedback | Settings | Logs.
- Chat: answers in the user’s language when possible. Offline local guide works without any API key.
- Feedback: notices from Feedback Hub (badge), send improvement/bug/question, donate info comes only from Hub sync (never hard-coded in UI source for display).
- Settings: choose AI provider (OpenAI, Gemini, DeepSeek, Anthropic, OpenRouter, Groq, Mistral, xAI, Custom, Local), API key, base URL, model. Keys stored server-side only.
- Logs: server AI/activity logs.

USER WORKFLOWS:
- Check if network is healthy → look at green status + height + capacity.
- See recent activity → Activity chart + Latest ledgers + Recent payments.
- Check a wallet → paste address → Search → optional AI Analyze / ask in Chat about that wallet.
- Pin important wallets → Watchlist.
- Change language EN/VI.
- Configure stronger AI in Settings if user has an API key; otherwise local guide still answers.

LIMITATIONS (be honest):
- Horizon public window is recent history; not a full historical indexer.
- “Trading pairs” in the classic DEX sense are limited; Pi activity is mostly native payments and claimable balances.
- AI without API key uses localReply only (accurate app guide, not free-form LLM).
- Fee is base fee from fee_stats; actual charged fee can vary slightly.


OBSERVE: POST /api/v2/observe runs planner+tools and returns markdown with evidence. Prefer this for factual network/wallet/trade answers.\nMODES: Simple (pulse, feed, wallet search, AI) vs Pro (assets, pairs, sources, alerts). Alerts: network_status, capacity_high, ledger_stalled evaluated after collector snapshots.\nPAIR CENTER: GET /api/v2/pair?base=USDT&counter=PI&network=testnet returns order book, trades, candles when Horizon supports them. Spread is derived. Analyze: POST /api/v2/analyze {type:network|wallet|trades} returns markdown + evidence list (no invented numbers).

MULTI-ASSET / DEX (especially Testnet):
- Official: DEX, AMM liquidity pools, and token creation were rolled out on Testnet for testing (Pi Core Team blog).
- Horizon endpoints used by this app: /assets, /trades, /liquidity_pools on api.testnet.minepi.com (and mainnet when available).
- UI section "Assets · Trades · Pools" shows top assets by list, recent trades (pair base/counter), and AMM pool reserves.
- Testnet tokens have NO real value. Always remind users of that.
- Mainnet multi-asset activity may be limited compared to Testnet.

TOP RICH LIST LIMITATION:
Horizon API does NOT provide a global ranking of richest accounts. This app never invents balances.
If user asks "5 richest wallets", explain this limit and offer: (1) analyze any G… address they paste, (2) summarize their Watchlist wallets, (3) point to community explorers.
Saved reports: user can say "save report" / "lưu báo cáo" after an answer — app stores title+Q+A for later.
Watch pairs: user can track TOKEN/PI pairs on the main UI (especially useful on Testnet).

VIEW ONLY:
- No login, no Pi SDK auth, no private keys. Anyone can open the app and observe public Horizon data.

NEVER invent balances, heights, or transaction data. Prefer directing the user to the live cards/chart or to paste an address for lookup.
`,

  actions: [
    { name: 'open_tab', description: 'Open AI panel tab: chat, feedback, settings, or logs' },
    { name: 'refresh_stats', description: 'Hint user to refresh network stats / chart' },
    { name: 'switch_network', description: 'Hint user to switch Mainnet/Testnet (value: mainnet|testnet)' },
    { name: 'open_view', description: 'Open a supported read-only screen (overview, activity, wallets, pairs, assets, pools, alerts, dashboard, ai, reports, sources, settings)' }
  ],

  async getContext(ctx) {
    const c = ctx || {};
    return {
      screen: c.screen || 'home',
      network: c.network || 'mainnet',
      lang: c.lang || 'en',
      hasWallet: !!c.hasWallet,
      height: c.height || null,
      address: c.address || null,
      observe: c.observe || null
    };
  },

  async executeAction(action) {
    const name = String(action && action.name || '');
    if (!ALLOWED.has(name)) return { ok: false, error: 'Action not allowed' };
    const value = String((action.args && action.args.value) || action.value || '');
    if (name === 'open_view' && !ALLOWED_VIEWS.has(value)) return { ok: false, error: 'View not allowed' };
    if (name === 'switch_network' && !['mainnet', 'testnet'].includes(value)) return { ok: false, error: 'Network not allowed' };
    if (name === 'open_tab' && !['chat', 'feedback', 'settings', 'logs'].includes(value)) return { ok: false, error: 'Tab not allowed' };
    return {
      ok: true,
      action: name,
      value,
      client_execute: true
    };
  },

  async localReply(message, live) {
    if (live && live.observe && live.observe.reply_markdown) {
      return live.observe.reply_markdown;
    }
    const m = String(message || '').toLowerCase();
    const isVi = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/.test(message || '') ||
      (live && live.lang === 'vi');

    if (/^(hi|hello|xin chào|chào|hey)\b/.test(m) || !m.trim()) {
      return isVi
        ? 'Xin chào! Tôi là trợ lý PiChain Monitor. Bạn có thể hỏi: tóm tắt mạng, cách tra cứu ví, biểu đồ activity, phí, Mainnet/Testnet, hoặc cách dùng Feedback/Settings.'
        : 'Hello! I am the PiChain Monitor guide. Ask about: network summary, how to look up a wallet, activity chart, fees, Mainnet/Testnet, or Feedback/Settings.';
    }
    if (/tóm tắt|summary|trạng thái|status|mạng|network|height|chiều cao/.test(m)) {
      const h = live && live.height != null ? Number(live.height).toLocaleString() : '…';
      const net = (live && live.network) || 'mainnet';
      return isVi
        ? `Mạng đang xem: ${net}. Chiều cao ledger (nếu đã tải): ${h}. Xem 4 thẻ trên cùng (Height, Protocol, Capacity, Fee) và biểu đồ Activity để quan sát realtime từ Horizon chính thức.`
        : `Current network: ${net}. Ledger height (if loaded): ${h}. Use the top cards (Height, Protocol, Capacity, Fee) and the Activity chart — all live from official Horizon.`;
    }
    if (/ví|wallet|tra cứu|lookup|address|địa chỉ|phân tích|analyze/.test(m)) {
      return isVi
        ? 'Dán địa chỉ G… hoặc M… vào ô Search → bấm Tra cứu. Bạn sẽ thấy số dư PI thật, subentries và payment gần đây. Có thể ghim ví vào Watchlist. Hỏi thêm trong Chat sau khi đã tra cứu.'
        : 'Paste a G… or M… address in Search → Search. You get real PI balance, subentries and recent payments. Pin to Watchlist. Ask follow-ups in Chat after lookup.';
    }
    if (/biểu đồ|chart|activity|xu hướng|trend|thống kê/.test(m)) {
      return isVi
        ? 'Biểu đồ Activity hiển thị số giao dịch (tx) theo từng ledger gần nhất (recent ledgers). Dữ liệu từ /api/trends → Horizon ledgers.'
        : 'The Activity chart shows transactions per recent ledger (~24). Data from /api/trends → Horizon ledgers.';
    }
    if (/fee|phí|cost/.test(m)) {
      return isVi
        ? 'Phí cơ bản lấy từ Horizon fee_stats (lấy live từ fee_stats). Xem thẻ Average Fee trên dashboard.'
        : 'Base fee comes from Horizon fee_stats (from live fee_stats). See the Average Fee card on the dashboard.';
    }
    if (/mainnet|testnet|mạng nào|switch/.test(m)) {
      return isVi
        ? 'Dùng nút Mainnet / Testnet trên header. Watchlist và tra cứu ví theo đúng mạng đang chọn.'
        : 'Use the Mainnet / Testnet buttons in the header. Watchlist and wallet lookup follow the selected network.';
    }
    if (/nguồn|source|api|horizon|dữ liệu/.test(m)) {
      return isVi
        ? 'Nguồn chính thức: https://api.mainnet.minepi.com và https://api.testnet.minepi.com. Explorer: https://blockexplorer.minepi.com/mainnet'
        : 'Official sources: https://api.mainnet.minepi.com and https://api.testnet.minepi.com. Explorer: https://blockexplorer.minepi.com/mainnet';
    }
    if (/feedback|góp ý|donate|ủng hộ|badge|thông báo/.test(m)) {
      return isVi
        ? 'Mở nút robot → tab Feedback: xem thông báo (badge), gửi góp ý/bug. Thông tin ủng hộ chỉ hiện sau khi sync từ Feedback Hub.'
        : 'Open the robot button → Feedback tab: notices (badge), send feedback/bugs. Donate info appears only after Feedback Hub sync.';
    }
    if (/setting|api key|provider|cài đặt|model/.test(m)) {
      return isVi
        ? 'Tab Settings: chọn provider (OpenAI, Gemini, DeepSeek, Anthropic, OpenRouter, Groq, Mistral, xAI, Custom, Local), nhập API key, Base URL (bắt buộc với Custom/Local), Save. Không có key thì vẫn dùng hướng dẫn offline này.'
        : 'Settings tab: choose provider (OpenAI, Gemini, DeepSeek, Anthropic, OpenRouter, Groq, Mistral, xAI, Custom, Local), API key, Base URL (required for Custom/Local), Save. Without a key, this offline guide still works.';
    }
    if (/top|giàu|rich|largest|số dư lớn|lớn nhất|richest|whale/.test(m)) {
      return isVi
        ? 'Horizon API không có bảng xếp hạng “ví giàu nhất” toàn mạng. App không bịa số dư.\nBạn có thể: (1) dán địa chỉ G… để tra cứu số dư thật, (2) ghim ví vào Watchlist rồi hỏi tóm tắt, (3) xem Explorer chính thức. Nếu bạn có danh sách ví, gửi từng địa chỉ để phân tích.'
        : 'Horizon has no global “richest wallets” ranking. This app never invents balances.\nYou can: (1) paste any G… address for a real lookup, (2) pin wallets to Watchlist then ask for a summary, (3) use the official Explorer. Send addresses one by one to analyze.';
    }
    if (/lưu báo cáo|save report|save this|lưu lại/.test(m)) {
      return isVi
        ? 'Để lưu báo cáo: sau khi có câu trả lời hữu ích, hãy dùng mục “Báo cáo AI đã lưu” trên trang chính (hoặc nhắc “lưu báo cáo” kèm nội dung). Các báo cáo lưu trên server SoloHost của bạn để xem lại sau.'
        : 'To save a report: after a useful answer, use “Saved AI reports” on the main page (or say “save report”). Reports are stored on your SoloHost for later.';
    }
    if (/theo dõi cặp|watch pair|cặp/.test(m) && /\/|pi|token/.test(m)) {
      return isVi
        ? 'Trên trang chính có mục “Theo dõi cặp”: nhập mã token (vd USDT) và PI → Theo dõi. Hữu ích trên Testnet để nhớ cặp bạn quan tâm. Dữ liệu trade/pool vẫn lấy từ Horizon.'
        : 'On the main page, use “Watch pairs”: enter token code (e.g. USDT) and PI → Watch. Useful on Testnet to remember pairs you care about. Trade/pool data still comes from Horizon.';
    }
    if (/phân tích mạng|analyze network|tóm tắt mạng hôm nay/.test(m)) {
      return isVi
        ? 'Dùng nút “Phân tích mạng” trên trang chính hoặc POST /api/v2/analyze type=network — kết quả có bảng bằng chứng (evidence) từ Horizon/snapshot, không bịa số.'
        : 'Use “Analyze network” on the main page or POST /api/v2/analyze type=network — results include evidence from Horizon/snapshots, no invented numbers.';
    }
    if (/order book|sổ lệnh|nến|candle/.test(m)) {
      return isVi
        ? 'Mục Theo dõi cặp: nhập token (vd USDT) / PI → Tải order book. API /api/v2/pair. Cần issuer nếu token không phải native. Testnet only có nhiều cặp.'
        : 'Watch pairs: enter token (e.g. USDT) / PI → Load pair book. API /api/v2/pair. Issuer required for non-native assets. More pairs on Testnet.';
    }
    if (/token|asset|tài sản|dex|trade|pool|amm|cặp/.test(m)) {
      return isVi
        ? 'Trên Testnet có token, trade DEX và liquidity pool (Horizon /assets, /trades, /liquidity_pools). Xem mục Tài sản · Giao dịch · Pool. Token testnet không có giá trị thật. Mainnet có thể hạn chế hơn.'
        : 'On Testnet you can observe tokens, DEX trades and liquidity pools (Horizon /assets, /trades, /liquidity_pools). See Assets · Trades · Pools. Testnet tokens have no real value. Mainnet may be more limited.';
    }
    if (/đăng nhập|login|sign in|auth/.test(m)) {
      return isVi
        ? 'App chỉ xem dữ liệu công khai — không cần đăng nhập, không yêu cầu khóa riêng.'
        : 'This app is view-only public data — no login and no private keys required.';
    }
    if (/pi network|pi là gì|what is pi/.test(m)) {
      return isVi
        ? 'Pi Network là blockchain cộng đồng, giao thức tương thích Stellar. App này chỉ đọc dữ liệu công khai qua Horizon API chính thức.'
        : 'Pi Network is a community blockchain with a Stellar-compatible protocol. This app only reads public data via the official Horizon API.';
    }
    return isVi
      ? 'Tôi hướng dẫn dùng PiChain Monitor: mạng, ví, biểu đồ, phí, EN/VI, Feedback, Settings AI. Hỏi cụ thể hoặc mở tab Settings nếu bạn có API key.'
      : 'I guide PiChain Monitor: network, wallets, chart, fees, EN/VI, Feedback, AI Settings. Ask something specific, or open Settings if you have an API key.';
  }
};

module.exports = adapter;
