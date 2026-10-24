// npm run check:i18n — checks the translations, so that a missing one is never silent:
//   1. src/locales/fr.json and en.json: same keys, no empty text, the same {variables} on both sides
//   2. every t('key') used in the code exists, and the keys nobody uses anymore are listed
//   3. the same French text doesn't get two different English versions (the translator couldn't choose)
//   4. dashboard: the French texts of the pages and scripts that its dictionary (i18n-en.js) doesn't translate
// Exit code 1 if there is an error (1 to 3), so it can run in a CI. Untranslated dashboard texts (4) are warnings.
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const SRC = path.join(__dirname, '..', 'src');
const { FR, EN } = require(path.join(SRC, 'core/i18n'));
const { createTranslator } = require(path.join(SRC, 'dashboard/public/i18n'));
const dashboardTr = createTranslator(require(path.join(SRC, 'dashboard/public/i18n-en')));

const errors = [];
const warnings = [];
const varsOf = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// 1. Both files
for (const key of new Set([...Object.keys(FR), ...Object.keys(EN)])) {
  if (!(key in FR)) errors.push(`${key}: missing in fr.json`);
  else if (!(key in EN)) errors.push(`${key}: missing in en.json`);
  else if (!FR[key].trim() || !EN[key].trim()) errors.push(`${key}: empty text`);
  else {
    const fr = varsOf(FR[key]);
    for (const v of varsOf(EN[key])) if (!fr.has(v)) errors.push(`${key}: {${v}} is in en.json but not in fr.json`);
    for (const v of fr) if (!varsOf(EN[key]).has(v)) warnings.push(`${key}: {${v}} isn't used in en.json`);
  }
}

// 2. Keys used in the code
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const botFiles = walk(SRC).filter((f) => f.endsWith('.js') && !f.includes(`${path.sep}public${path.sep}`));
const used = new Set();
for (const file of botFiles) {
  // Comments left out (they can show examples)
  const code = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  for (const [, key] of code.matchAll(/\bt\('([\w.]+)'/g)) {
    used.add(key);
    if (!(key in FR)) errors.push(`${path.relative(SRC, file)}: t('${key}') doesn't exist in the locales`);
  }
  // Key chosen in the code: t(accepted ? 'cases.member_accepted' : 'cases.member_refused')
  for (const [, key] of code.matchAll(/'(\w+\.[\w.]+)'/g)) if (key in FR) used.add(key);
  // Key built in the code: t(`cases.types.${type}`) uses every key starting with "cases.types."
  for (const [, prefix] of code.matchAll(/\bt\(`([\w.]+\.)\$\{/g)) {
    const keys = Object.keys(FR).filter((key) => key.startsWith(prefix));
    if (!keys.length) errors.push(`${path.relative(SRC, file)}: no key starts with "${prefix}"`);
    keys.forEach((key) => used.add(key));
  }
}
const unused = Object.keys(FR).filter((key) => !used.has(key));
if (unused.length) warnings.push(`${unused.length} key(s) not used anymore: ${unused.slice(0, 10).join(', ')}${unused.length > 10 ? '…' : ''}`);

// 3. Same French text, two English versions
const seen = new Map();
for (const [key, text] of Object.entries(FR)) {
  const other = seen.get(text);
  if (other && EN[other] !== EN[key]) errors.push(`${key} and ${other}: same French text, different English texts`);
  seen.set(text, key);
}

// 4. Dashboard: texts of the HTML pages (tags removed) and strings of the scripts, as the page shows them
const PUBLIC = path.join(SRC, 'dashboard', 'public');
const FRENCH = /[éèêàùçâîôœ]|\b(le|la|les|des|du|un|une|est|pour|avec|ton|ta|tes|ce|cette|qui|au|aux|sur|dans|pas|ou|et|de|tu|il|en|ne|son|sa|ses|à)\b/i;
const looksFrench = (s) => /[a-zà-ÿ]{3}/i.test(s) && FRENCH.test(s) && s.split(/\s+/).length >= 2;
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?\/?>/g;
const untranslated = new Map();
const check = (text, where) => {
  for (const piece of text.replace(/<(script|style)[\s\S]*?<\/\1>/g, '\0').replace(/<!--[\s\S]*?-->/g, '').replace(TAG, '\0').split('\0')) {
    const s = piece.replace(/&#10;/g, '\n').replace(/&nbsp;/g, ' ').trim().replace(/\s+/g, ' ');
    if (s && looksFrench(s) && dashboardTr(s) === s && !untranslated.has(s)) untranslated.set(s, where);
  }
};
for (const file of fs.readdirSync(PUBLIC)) {
  const full = path.join(PUBLIC, file);
  if (file.endsWith('.html')) check(fs.readFileSync(full, 'utf8'), file);
  if (!file.endsWith('.js') || /^i18n/.test(file) || file === 'emoji-picker.js') continue;
  const ast = acorn.parse(fs.readFileSync(full, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  (function visit(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object?.name === 'console') return;
    // A template with ${…}: shown as one text (its key has {0} for each part), its inner pieces aren't texts on their own
    if (node.type === 'TemplateLiteral' && node.expressions.length) return;
    // Only whole texts: in a template, each ${…} is an unknown part (the dictionary has {0} for it)
    if (node.type === 'Literal' && typeof node.value === 'string' && !node.value.includes('${')) check(node.value, `${file}:${node.loc.start.line}`);
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) check(node.quasis[0].value.cooked, `${file}:${node.loc.start.line}`);
    for (const [k, v] of Object.entries(node)) {
      if (k === 'loc') continue;
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  })(ast);
}
for (const [text, where] of untranslated) warnings.push(`dashboard, not translated (${where}): ${JSON.stringify(text.slice(0, 100))}`);

// Report
for (const w of warnings) console.log(`⚠️  ${w}`);
for (const e of errors) console.log(`❌ ${e}`);
console.log(`\n${Object.keys(FR).length} keys · ${errors.length} error(s) · ${warnings.length} warning(s)`);
process.exitCode = errors.length ? 1 : 0;
