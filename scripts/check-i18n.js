'use strict';
/** Fails if a t('key') used in public/index.html is missing from EN or VI, or if EN/VI key sets differ. */
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const m = html.match(/const I18N = (\{[\s\S]*?\n    \});/);
if (!m) { console.error('I18N block not found'); process.exit(1); }
const I18N = vm.runInNewContext('(' + m[1] + ')');
const used = new Set([...html.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)].map(x => x[1]));
const problems = [];
for (const lang of ['en', 'vi']) for (const k of used) if (!(k in I18N[lang])) problems.push(`missing ${lang}: ${k}`);
for (const k of Object.keys(I18N.en)) if (!(k in I18N.vi)) problems.push(`missing vi (defined in en): ${k}`);
for (const k of Object.keys(I18N.vi)) if (!(k in I18N.en)) problems.push(`missing en (defined in vi): ${k}`);
if (problems.length) { console.error('I18N FAIL:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log(`i18n OK — ${used.size} keys used, EN/VI in sync (${Object.keys(I18N.en).length} keys)`);
