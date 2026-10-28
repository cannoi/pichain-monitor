'use strict';
function summarizeEvidence(results) {
  return (results || []).map(r => ({
    evidenceId: r.evidenceId || null,
    name: r.name || null,
    ok: !!r.ok,
    source: r.source || null,
    fetchedAt: r.fetchedAt || null,
    kind: r.kind || null,
    args: r.args || null,
    error: r.error || null
  }));
}
module.exports = { summarizeEvidence };
