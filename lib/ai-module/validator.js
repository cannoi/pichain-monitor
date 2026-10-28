'use strict';
/**
 * Numeric grounding validator: every number in an AI reply must be traceable to
 * tool evidence (or to the user's own question / validated tool arguments).
 */
const ISO_RE = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g;

function addNum(set, v) { if (typeof v === 'number' && Number.isFinite(v)) set.add(v); }

function collect(value, set, depth = 0) {
  if (depth > 8 || value == null) return;
  if (typeof value === 'number') { addNum(set, value); return; }
  if (typeof value === 'string') {
    if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return;          // addresses / hashes: not numeric facts
    for (const m of value.match(/\d+(?:\.\d+)?/g) || []) addNum(set, Number(m));
    return;
  }
  if (Array.isArray(value)) {
    addNum(set, value.length);                                  // counts are derivable from the evidence
    for (const x of value) collect(x, set, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) collect(value[k], set, depth + 1);
  }
}

/** Build the pool of allowed numbers from tool results, user message and args. */
function evidencePool(results, message) {
  const set = new Set();
  const okResults = (results || []).filter(r => r && r.ok);
  addNum(set, okResults.length);
  for (const r of okResults) {
    collect(r.data, set);
    collect(r.derived, set);
    collect(r.args, set);
    collect(r.fetchedAt, set);
  }
  collect(String(message || ''), set);
  return set;
}

/** Parse a localized numeric token into candidate values (handles 1,234.5 / 1.234,5 / 1234,5). */
function candidates(tok) {
  const out = [];
  const t = tok.replace(/[\u00a0\s]/g, '');
  const hasDot = t.includes('.'), hasCom = t.includes(',');
  const push = (str) => { const n = Number(str); if (Number.isFinite(n)) out.push({ v: n, dec: (str.split('.')[1] || '').length }); };
  if (hasDot && hasCom) {
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    push(t.split(thou).join('').replace(dec, '.'));
  } else if (hasCom) {
    if (/^\d{1,3}(,\d{3})+$/.test(t)) { push(t.replace(/,/g, '')); if ((t.match(/,/g) || []).length === 1) push(t.replace(',', '.')); }
    else push(t.replace(',', '.'));
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) push(t.replace(/\./g, ''));
    else { push(t); if (/^\d{1,3}\.\d{3}$/.test(t)) push(t.replace('.', '')); }
  } else push(t);
  return out;
}

/** Extract number tokens that must be verified. Skips code spans, URLs, ids, dates, list numbering. */
function extractNumbers(text) {
  let s = String(text || '');
  s = s.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/\b[GM][A-Z2-7]{20,}\b/g, ' ');
  s = s.replace(/\b[0-9a-f]{32,}\b/gi, ' ');
  s = s.replace(ISO_RE, ' ');
  s = s.replace(/^\s*(?:[-*]\s+)?\d{1,2}[.)]\s+/gm, '');      // ordered list markers
  s = s.replace(/[A-Za-z_][A-Za-z0-9_]*\d[A-Za-z0-9_]*/g, ' '); // identifiers such as tPI2, G3
  const re = /(\d{1,3}(?:[.,\u00a0 ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\s?%|[kKmMbB](?![A-Za-z]))?/g;
  const out = []; let m;
  while ((m = re.exec(s))) {
    out.push({ raw: m[0].trim(), tok: m[1], pct: !!(m[2] && m[2].includes('%')), scale: m[2] && /[kKmMbB]/.test(m[2]) ? m[2].trim().toLowerCase() : null });
  }
  return out;
}

function matches(pool, v, dec) {
  const tol = 0.5 * Math.pow(10, -dec) + 1e-12;
  for (const p of pool) {
    if (Math.abs(p - v) <= tol + Math.abs(p) * 1e-12) return true;
  }
  return false;
}

/** @returns {{ok:boolean, unverified:string[], checked:number}} */
function validateNumbers(reply, results, message) {
  const pool = [...evidencePool(results, message)];
  const toks = extractNumbers(reply);
  const unverified = [];
  for (const t of toks) {
    let found = false;
    for (const c of candidates(t.tok)) {
      let vals = [c.v];
      if (t.scale === 'k') vals = [c.v * 1e3];
      if (t.scale === 'm') vals = [c.v * 1e6, c.v];
      if (t.scale === 'b') vals = [c.v * 1e9, c.v];
      if (t.pct) vals.push(c.v / 100);
      if (vals.some(v => matches(pool, v, t.scale ? Math.max(0, c.dec - 3) : c.dec))) { found = true; break; }
    }
    if (!found) unverified.push(t.raw);
  }
  return { ok: unverified.length === 0, unverified: [...new Set(unverified)], checked: toks.length };
}

module.exports = { validateNumbers, extractNumbers, evidencePool, candidates };
