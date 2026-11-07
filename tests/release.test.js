/**
 * Release check: every local file in index.html carries the current APP_VERSION (?v=),
 * so browsers fetch the new files after a release instead of mixing cached old and new ones.
 * Run: node tests/release.test.js (no dependencies).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { APP_VERSION } = require('../version.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const local = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));

try {
  assert.ok(local.length > 15, 'expected the local scripts and the stylesheet');
  const wrong = local.filter(u => !u.endsWith('?v=' + APP_VERSION));
  assert.deepStrictEqual(wrong, [], `these don't carry ?v=${APP_VERSION}: ${wrong.join(', ')}`);
  for (const u of local) assert.ok(fs.existsSync(path.join(__dirname, '..', u.split('?')[0])), `${u} doesn't exist`);
  console.log(`release check passed: ${local.length} files carry ?v=${APP_VERSION}`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exitCode = 1;
}
