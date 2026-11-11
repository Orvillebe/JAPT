/**
 * The data layer contract on the local layer. For another layer: tests/contract.html.
 * Run: node tests/contract.test.js (no dependencies).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const data = new Map();
const context = vm.createContext({
  console, setTimeout, crypto: require('crypto').webcrypto, atob, btoa, Blob,
  localStorage: { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }
});
for (const f of ['version.js', 'tables.js', 'data-local.js', 'tests/contract.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context, { filename: f });
}

vm.runInContext('runDataLayerContract(createLocalData(), SCHEMA_VERSION)', context).then(({ passed, failures }) => {
  failures.forEach(f => console.error('✗ ' + f));
  console.log(`contract tests: ${passed} passed`);
  if (failures.length) process.exitCode = 1;
});
