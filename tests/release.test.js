/**
 * Release check, run: node tests/release.test.js (no dependencies).
 *   - Every local file in index.html carries the current APP_VERSION (?v=), so browsers fetch the new
 *     files after a release instead of mixing cached old and new ones.
 *   - No line of code is longer than MAX_LINE, so nothing grows unreadable again. figures.js holds
 *     drawings as long lines of SVG and doesn't count.
 *   - The escape test (tests/escape.html, run in a browser) has a step for every calendar view and every
 *     Beheer tab, so a new one can't go untested.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { APP_VERSION } = require('../version.js');

const MAX_LINE = 140;   // the width of two editor panes; a line over it no longer reads at a glance

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const local = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));

try {
  assert.ok(local.length > 15, 'expected the local scripts and the stylesheet');
  const wrong = local.filter(u => !u.endsWith('?v=' + APP_VERSION));
  assert.deepStrictEqual(wrong, [], `these don't carry ?v=${APP_VERSION}: ${wrong.join(', ')}`);
  for (const u of local) assert.ok(fs.existsSync(path.join(__dirname, '..', u.split('?')[0])), `${u} doesn't exist`);

  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const code = local.map(u => u.split('?')[0]).filter(f => f.endsWith('.js') && f !== 'figures.js' && !f.startsWith('i18n/'));
  const tooLong = code.flatMap(f => read(f).split('\n').map((l, i) => [f, i + 1, l.length]).filter(x => x[2] > MAX_LINE));
  assert.deepStrictEqual(tooLong, [], `lines over ${MAX_LINE} characters: ${tooLong.map(x => `${x[0]}:${x[1]}`).join(', ')}`);

  const list = (src, name) => { const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`)); assert.ok(m, `${name} not found`); return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]); };
  const escape = read('tests/escape.html');
  const modes = [...html.matchAll(/data-mode="([^"]+)"/g)].map(m => m[1]);
  const missingModes = modes.filter(m => !list(escape, 'MODES').includes(m));
  assert.deepStrictEqual(missingModes, [], `tests/escape.html has no step for the calendar view(s): ${missingModes.join(', ')}`);
  const missingTabs = list(read('manage.js'), 'TABS').filter(k => !list(escape, 'MANAGE_TABS').includes(k));
  assert.deepStrictEqual(missingTabs, [], `tests/escape.html has no step for the Beheer tab(s): ${missingTabs.join(', ')}`);

  console.log(`release check passed: ${local.length} files carry ?v=${APP_VERSION}; the escape test covers ${modes.length} views and every Beheer tab`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exitCode = 1;
}
