/**
 * Tests for the parts of data-supabase.js that decide what a failed request means. The Supabase library is
 * replaced by a stand-in: what the database itself does is proven by tests/contract.html?db=live and
 * tests/teams.test.js.
 * Run: node tests/supabase-layer.test.js (no dependencies).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REQUEST_SECONDS = 0.02;
const script = new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'data-supabase.js'), 'utf8'));

// The layer on a stand-in library whose save answers with the given error, and the fetch it was handed.
function layerAnswering(error, fetchStub) {
  let limitedFetch = null;
  const window = { supabase: { createClient(url, key, options) {
    limitedFetch = options.global.fetch;
    return { rpc: async () => ({ data: error ? null : [], error }) };
  } } };
  const context = {
    window, setTimeout, AbortController, fetch: fetchStub,
    JAPT_DEPLOYMENT: { supabaseUrl: 'https://x.test', supabaseKey: 'k' },
    JAPT_CONFIG: { requestSeconds: REQUEST_SECONDS }, TABLES: [], BINNED_TABLES: [], TASK_TABLES: []
  };
  vm.createContext(context);
  script.runInContext(context);
  return { data: vm.runInContext('createSupabaseData()', context), limitedFetch: () => limitedFetch };
}
const saveError = async error => {
  try { await layerAnswering(error).data.batch([]); return null; } catch (e) { return e; }
};

// A request that never answers, until it is told to stop: as a fetch behaves on a connection that hangs.
const hanging = (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener('abort', () => reject(new Error('stopped')));
});

const TESTS = {
  'a save that ends without a code from the database is "no answer"': async () => {
    assert.strictEqual((await saveError({ message: 'TypeError: Failed to fetch', code: '' })).code, 'no-answer');
    assert.strictEqual((await saveError({ message: '<html>bad gateway</html>' })).code, 'no-answer');
  },
  'a change someone else got to first stays a conflict': async () => {
    assert.strictEqual((await saveError({ message: 'changed', code: 'JP001' })).code, 'conflict');
  },
  'a refusal by the database keeps its own code': async () => {
    assert.strictEqual((await saveError({ message: 'denied', code: '42501' })).code, '42501');
  },
  'a save with no error is no error': async () => {
    assert.strictEqual(await saveError(null), null);
  },
  'a request that hangs is stopped after the time limit': async () => {
    const started = Date.now();
    await assert.rejects(layerAnswering(null, hanging).limitedFetch()('https://x.test', {}), /stopped/);
    assert.ok(Date.now() - started < 2000, 'stopped in time');
  },
  'what the library passes along reaches the real request': async () => {
    let seen = null;
    const fetchStub = async (url, init) => { seen = { url, init }; return 'answer'; };
    const answer = await layerAnswering(null, fetchStub).limitedFetch()('https://x.test/a', { method: 'POST', body: 'b' });
    assert.strictEqual(answer, 'answer');
    assert.strictEqual(seen.url, 'https://x.test/a');
    assert.strictEqual(seen.init.method, 'POST');
    assert.strictEqual(seen.init.body, 'b');
    assert.ok(seen.init.signal, 'carries the time limit');
  }
};

(async () => {
  let failed = 0;
  for (const [name, test] of Object.entries(TESTS)) {
    try { await test(); } catch (e) { failed++; console.error(`✗ ${name}: ${e.message}`); }
  }
  console.log(`supabase layer tests: ${Object.keys(TESTS).length - failed} of ${Object.keys(TESTS).length} passed`);
  if (failed) process.exitCode = 1;
})();
