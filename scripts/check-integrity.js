'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fail = [];
function scan(file, patterns) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [name, re] of patterns) {
    if (re.test(text)) fail.push(`${path.relative(root, file)}: ${name}`);
  }
}
const codeFiles = [];
function walk(d) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'data' || ent.name === '.git') continue;
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(ent.name)) codeFiles.push(p);
  }
}
walk(root);
const patterns = [
  ['hardcoded Healthy consensus', /consensusStatus:\s*['"]Healthy['"]/],
  ['fee fallback 0.01 PI', /['"]0\.01 PI['"]/],
  ['Math.random in product code', /Math\.random\s*\(/],
  ['hardcoded success status in adapter/server', /(?:status|networkStatus)\s*[:=]\s*['"](?:Healthy|healthy|online|success)['"]/],
  ['fake PI fee fallback', /(?:avgFee|baseFee|fee)\s*[:=]\s*['"]0\.0*1\s*(?:PI|tPI)['"]/],
];
for (const f of codeFiles) {
  if (f.includes('check-integrity')) continue;
  if (f.includes('provider-engine') || f.includes('test')) continue;
  if (f.includes('feedback-module')) continue; // upstream module — do not modify
  scan(f, patterns);
}
if (fail.length) {
  console.error('INTEGRITY FAIL:');
  fail.forEach(x => console.error(' -', x));
  process.exit(1);
}
console.log('integrity OK — scanned', codeFiles.length, 'files');
