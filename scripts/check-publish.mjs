#!/usr/bin/env node
// Pre-publish gate for this fork.
//
// Why this exists: the upstream gate (`npm run check`) needs devDependencies
// (eslint, prettier, esbuild) and a `_dev/` directory that are intentionally not
// shipped, so it cannot run inside a published tree. What *can* be verified
// without installing anything is the artefact itself: the identity in
// package.json, the files npm will actually pack, the locale tables, and the
// syntax of every shipped module (including the prebuilt client bundle).
//
// Run with: node --experimental-vm-modules scripts/check-publish.mjs
// `npm run check:publish` does exactly that, and `prepublishOnly` calls it.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];
const ok = (message) => console.log(`  ok    ${message}`);
const fail = (message) => {
  problems.push(message);
  console.log(`  FAIL  ${message}`);
};

const read = (path) => readFileSync(join(root, path), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '_dev') continue;
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

// 1. identity ---------------------------------------------------------------
console.log('package identity');
const pkg = JSON.parse(read('package.json'));
if (pkg.name === 'dsh-ai-translation') ok(`name ${pkg.name}`);
else fail(`name must be dsh-ai-translation, found ${pkg.name}`);
if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) ok(`version ${pkg.version}`);
else fail(`version ${pkg.version} is not semver`);
if (pkg.license === 'Apache-2.0') ok('license Apache-2.0');
else fail(`license must stay Apache-2.0, found ${pkg.license}`);
if (pkg.author?.name && pkg.author?.email) ok(`author ${pkg.author.name} <${pkg.author.email}>`);
else fail('author name/email missing');
if (Array.isArray(pkg.contributors) && pkg.contributors.some((c) => /Jovi Lecca/i.test(c.name))) {
  ok('upstream author kept in contributors');
} else {
  fail('contributors must credit the upstream author (Jovi Lecca)');
}

// 2. dsh wiring ------------------------------------------------------------
console.log('dsh wiring');
const patchPath = pkg.dsh?.bundle?.patch || '';
if (patchPath && existsSync(join(root, patchPath))) ok(`bundle patch ${patchPath}`);
else fail(`dsh.bundle.patch is missing on disk (${patchPath || 'unset'})`);
if (pkg.exports?.['.'] === './index.js') ok('exports["."] -> ./index.js');
else fail('exports["."] must point at ./index.js');
if (pkg.exports?.['./client'] === './client.js') ok('exports["./client"] -> ./client.js');
else fail('exports["./client"] must point at ./client.js');
try {
  const patch = read(patchPath || 'cordis.patch.yml');
  if (/id:\s*dsh-ai-translation/.test(patch) && /name:\s*dsh-ai-translation/.test(patch)) {
    ok('cordis patch uses the fork id/name');
  } else {
    fail('cordis patch must declare id/name dsh-ai-translation');
  }
} catch {
  fail('cordis.patch.yml unreadable');
}

// 3. what npm will actually pack -------------------------------------------
console.log('packed surface');
for (const entry of pkg.files || []) {
  if (!/[*?]/.test(entry) && !existsSync(join(root, entry))) fail(`files[] entry missing on disk: ${entry}`);
}
ok(`files[] has ${(pkg.files || []).length} entries, all present`);
for (const needed of ['OPTIMIZATIONS.md', 'LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md']) {
  if ((pkg.files || []).includes(needed)) ok(`files[] includes ${needed}`);
  else fail(`files[] must include ${needed}`);
}
const shipped = walk('.');
const stray = shipped.filter((p) => /\.bak-|\.orig-|\.log$|\.tmp$|(^|\/)\.npmrc$/.test(p));
if (stray.length === 0) ok(`no stray artefacts in ${shipped.length} files`);
else fail(`stray artefacts would be published: ${stray.slice(0, 5).join(', ')}`);

// 4. licences and attribution ---------------------------------------------
console.log('attribution');
const license = read('LICENSE');
if (/Apache License/.test(license) && /Jovi Lecca/.test(license)) ok('LICENSE keeps the upstream copyright line');
else fail('LICENSE must stay verbatim (Apache text + upstream copyright)');
const notice = read('NOTICE');
if (/modified fork/i.test(notice) && /Jovi Lecca|dsh-cait|CAIT/.test(notice)) ok('NOTICE keeps upstream notice and adds the fork clause');
else fail('NOTICE must keep the upstream notice and add the fork clause');

// 5. locale tables ---------------------------------------------------------
console.log('locales');
const localeKeys = {};
for (const lang of ['en', 'ja', 'zh']) {
  const path = `locale/${lang}.json`;
  try {
    const table = JSON.parse(read(path));
    localeKeys[lang] = new Set(Object.keys(table));
    ok(`${path}: ${localeKeys[lang].size} keys`);
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}
if (localeKeys.en && localeKeys.zh && localeKeys.ja) {
  const all = new Set([...localeKeys.en, ...localeKeys.zh, ...localeKeys.ja]);
  const missing = [...all].filter((k) => !localeKeys.en.has(k) || !localeKeys.zh.has(k) || !localeKeys.ja.has(k));
  if (missing.length === 0) ok(`locale parity across en/ja/zh (${all.size} keys)`);
  else fail(`locale keys missing in some language: ${missing.slice(0, 8).join(', ')}`);
}

// 6. syntax of every shipped module ---------------------------------------
console.log('syntax');
if (typeof vm.SourceTextModule !== 'function') {
  fail('vm.SourceTextModule unavailable - run with `node --experimental-vm-modules`');
} else {
  const modules = shipped.filter((p) => p.endsWith('.js'));
  let checked = 0;
  for (const rel of modules) {
    const source = readFileSync(join(root, rel), 'utf8');
    try {
      // eslint-disable-next-line no-new
      new vm.SourceTextModule(source, { identifier: rel });
      checked += 1;
    } catch (error) {
      fail(`${rel}: ${error.message}`);
    }
  }
  ok(`${checked}/${modules.length} modules parse as ESM`);
}

// 7. verdict ---------------------------------------------------------------
if (problems.length === 0) {
  console.log('\ncheck-publish: OK - the artefact is ready to publish.');
  process.exit(0);
}
console.log(`\ncheck-publish: ${problems.length} problem(s)`);
for (const problem of problems) console.log(`  - ${problem}`);
process.exit(1);
