
/**
 * SoloHost is typically single-user: if ADMIN_TOKEN is unset, allow AI settings
 * from any client that can reach the app (saving API keys must work on LAN/Pi Browser).
 * If ADMIN_TOKEN is set, require X-Admin-Token / Bearer match.
 */
function adminOk(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || !String(token).trim()) return true;
  const h = String(req.headers['x-admin-token'] || req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  return h === token;
}
/** Mount into the host app's existing HTTP server. */
const chatBuckets = new Map();
function chatRateLimited(req) {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown'); const now = Date.now();
  let b = chatBuckets.get(key); if (!b || now - b.start >= 60000) b = { start: now, count: 0 };
  b.count++; chatBuckets.set(key, b); if (chatBuckets.size > 1000) for (const [k,v] of chatBuckets) if (now-v.start >= 60000) chatBuckets.delete(k);
  return b.count > 30;
}
function mountAIRoutes(router, ai) {
  router.get('/api/ai/status', (_req,res)=>res.json({ok:true,configured:ai.configured(),settings:ai.publicSettings()}));
  router.get('/api/ai/catalog', (_req,res)=>res.json({providers:ai.catalog()}));
  router.get('/api/ai/settings', (_req,res)=>res.json(ai.publicSettings()));
  router.post('/api/ai/settings', (req,res)=>{ if(!adminOk(req)) return res.status(403).json({ok:false,error:'admin required'});
    try { res.json({ok:true,settings:ai.saveSettings(req.body||{})}); }
    catch(e){ ai.log('error','ai.settings',{error:e.message}); res.status(400).json({ok:false,error:e.message}); }
  });
  router.get('/api/ai/models', async (req,res)=>{ if(!adminOk(req)) return res.status(403).json({ok:false,error:'admin required'});
    try { res.json(await ai.refreshModels()); }
    catch(e){ ai.log('error','ai.models.refresh.fail',{error:e.message}); res.status(502).json({ok:false,error:safePublicError(e)}); }
  });
  router.post('/api/ai/test', async (req,res)=>{ if(!adminOk(req)) return res.status(403).json({ok:false,error:'admin required'});
    try { res.json(await ai.testConnection()); }
    catch(e){ ai.log('error','ai.provider.test.fail',{error:e.message}); res.status(502).json({ok:false,error:safePublicError(e),code:errorCode(e)}); }
  });
  router.post('/api/ai/chat', async(req,res)=>{
    if (chatRateLimited(req)) return res.status(429).json({ok:false,error:'rate limit exceeded',error_vi:'vượt giới hạn yêu cầu, vui lòng thử lại sau'});
    try {
      const b=req.body||{};
      if(!b.message) return res.status(400).json({ok:false,error:'message required'});
      // Client-supplied context is display context only; never trust client-supplied knowledge/evidence.
      let context = b.context && typeof b.context === 'object' ? { screen: b.context.screen, network: b.context.network, lang: b.context.lang, address: b.context.address } : {};
      const msgStr = String(b.message).slice(0, 4000);
      // Configured provider + data question → grounded analyst pipeline (planner → tools → writer → validator)
      if (ai.configured() && typeof ai._analyze === 'function' && typeof ai._isDataIntent === 'function' && ai._isDataIntent(msgStr)) {
        try {
          const an = await ai._analyze(msgStr, context);
          ai.log('info','ai.analyst',{planner:an.planner,verified:an.verified,rewritten:an.rewritten,tools:(an.plan||[]).map(x=>x.name)});
          return res.json({ ok:true, configured:true, source:'analyst', reply:an.reply_markdown, actions:[], analysis:an,
            provider:ai.publicSettings().provider, model:ai.publicSettings().model });
        } catch (e) { ai.log('warn','ai.analyst.fail',{error:e.message}); /* fall through to chat */ }
      }
      // Optional server-side observe enrichment (set by host on ai._enrichObserve)
      if (typeof ai._enrichObserve === 'function') {
        try {
          const extra = await ai._enrichObserve(b.message, context);
          if (extra) context = { ...context, observe: extra };
        } catch (_) {}
      }
      const out=await ai.chat({message:b.message,history:Array.isArray(b.history)?b.history.slice(-8):[],context});
      if (context.observe) {
        out.observe = context.observe;
        if (!out.reply && context.observe.reply_markdown) out.reply = context.observe.reply_markdown;
        if (out.text == null && context.observe.reply_markdown) out.text = context.observe.reply_markdown;
      }
      ai.log('info','ai.chat',{provider:out.provider,model:out.model});
      res.json(out);
    } catch(e){
      ai.log('error','ai.chat.fail',{error:e.message});
      res.status(502).json({ok:false,error:safePublicError(e),code:errorCode(e)});
    }
  });
  router.get('/api/logs',(req,res)=>{ if(!adminOk(req)) return res.status(403).json({ok:false,error:'admin required'}); res.json({logs:ai.readLogs()}); });
  router.delete('/api/logs',(req,res)=>{ if(!adminOk(req)) return res.status(403).json({ok:false,error:'admin required'}); ai.clearLogs();res.json({ok:true});});
}
function errorCode(e){
  if(e.code==='NO_MODEL') return 'NO_MODEL';
  if(e.code==='TIMEOUT') return 'TIMEOUT';
  if(e.code==='NETWORK') return 'NETWORK_ERROR';
  if(e.code==='NOT_JSON') return 'BAD_BASE_URL';
  if(e.code==='EMPTY_RESPONSE') return 'EMPTY_RESPONSE';
  return e.status===401?'AUTH_ERROR':e.status===403?'FORBIDDEN':e.status===404?'MODEL_OR_ENDPOINT_NOT_FOUND':e.status===429?'RATE_LIMIT':'AI_PROVIDER_ERROR';
}
function safePublicError(e){
  const s=String(e?.message||e||'AI provider unavailable');
  return s.replace(/([?&](?:key|api_key|token|access_token)=[^&\s]+)/ig,'$1=[REDACTED]').replace(/Bearer\s+[^\s]+/ig,'Bearer [REDACTED]').slice(0,700);
}
module.exports={mountAIRoutes};
