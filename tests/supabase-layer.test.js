/**
 * Tests for the parts of data-supabase.js that decide what a failed request means, how an answer of
 * changes_since (migrations/005) becomes what the Store takes in, and how a photo is asked for (migrations/006). The Supabase library is
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

const { TABLES, BINNED_TABLES, TASK_TABLES } = require('../tables.js');

// The layer on a stand-in library whose save answers with the given error, and the fetch it was handed.
// rpcStub(name, args), when given, answers the database functions instead.
function layerAnswering(error, fetchStub, rpcStub) {
  let limitedFetch = null;
  const window = { supabase: { createClient(url, key, options) {
    limitedFetch = options.global.fetch;
    return {
      rpc: rpcStub || (async () => ({ data: error ? null : [], error })),
      auth: { getSession: async () => ({ data: { session: { access_token: 'login-token' } } }) }
    };
  } } };
  const context = {
    window, setTimeout, AbortController, Blob, fetch: fetchStub,
    JAPT_DEPLOYMENT: { supabaseUrl: 'https://x.test', supabaseKey: 'k' },
    JAPT_CONFIG: { requestSeconds: REQUEST_SECONDS }, TABLES, BINNED_TABLES, TASK_TABLES
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

// A database that answers changes_since with the next answer from the list, and remembers what was asked.
function changesDatabase(answers) {
  const asked = [];
  const rpcStub = async (name, args) => { asked.push(args.p_since); return { data: answers.shift(), error: null }; };
  return { layer: layerAnswering(null, null, rpcStub).data, asked };
}
const T1 = '2026-11-10T09:00:00+00:00', T2 = '2026-11-10T09:01:00+00:00';
const plain = v => JSON.parse(JSON.stringify(v));   // the layer's objects come from its own world
const dbRow = fields => ({ team_id: 'team', changed_at: T1, ...fields });

// A photo request answered with these bytes (an empty list: the photo is gone) or this status.
function photoAnswer(bytes, status = 200) {
  const asked = [];
  const fetchStub = async (url, init) => {
    asked.push({ url, init });
    return { ok: status < 400, status, blob: async () => new Blob([Uint8Array.from(bytes)]) };
  };
  return { layer: layerAnswering(null, fetchStub).data, asked };
}
const photoError = async (layer, id) => {
  try { await layer.loadPhoto(id); return null; } catch (e) { return e; }
};

const TESTS = {
  'the first load is everything, without binned rows or the rows of a binned task': async () => {
    const { layer, asked } = changesDatabase([{ until: T1, removed: [], rows: {
      tasks: [dbRow({ id: 'a', title: 'Levend' }), dbRow({ id: 'b', title: 'Weg', deleted_at: T1 })],
      block_placements: [dbRow({ id: 'p1', task_id: 'a', start_min: 540 }), dbRow({ id: 'p2', task_id: 'b' })]
    } }]);
    const all = await layer.loadAll();
    assert.deepStrictEqual(asked, [null]);
    assert.deepStrictEqual(plain(all.tasks.map(k => k.id)), ['a']);
    assert.deepStrictEqual(plain(all.block_placements.map(p => p.id)), ['p1']);
    assert.strictEqual(all.block_placements[0].start, 540, 'columns become fields');
    assert.ok(!('teamId' in all.tasks[0]) && !('team_id' in all.tasks[0]), 'the team stays in the layer');
    assert.ok(TABLES.every(t => Array.isArray(all[t])), 'every table, also the empty ones');
  },
  'a reload asks what changed since the previous answer': async () => {
    const empty = until => ({ until, removed: [], rows: {} });
    const { layer, asked } = changesDatabase([empty(T1), empty(T2), empty(T2)]);
    assert.strictEqual(await layer.loadChanges(), null, 'nothing loaded yet: load everything');
    await layer.loadAll();
    await layer.loadChanges();
    await layer.loadChanges();
    assert.deepStrictEqual(asked, [null, T1, T2]);
  },
  'a binned row comes back as gone, a changed row as changed': async () => {
    const { layer } = changesDatabase([{ until: T1, removed: [], rows: {} }, { until: T2,
      removed: [{ table: 'block_placements', id: 'p1' }],
      rows: { tasks: [dbRow({ id: 'a', title: 'Nieuw' }), dbRow({ id: 'b', deleted_at: T2 })] } }]);
    await layer.loadAll();
    const changes = await layer.loadChanges();
    assert.deepStrictEqual(plain(changes.rows.tasks.map(k => [k.id, k.title])), [['a', 'Nieuw']]);
    assert.deepStrictEqual(plain(changes.removed), [{ table: 'block_placements', id: 'p1' }, { table: 'tasks', id: 'b' }]);
  },
  'too long ago to tell: load everything, also the next time': async () => {
    const { layer } = changesDatabase([{ until: T1, removed: [], rows: {} }, null]);
    await layer.loadAll();
    assert.strictEqual(await layer.loadChanges(), null);
    assert.strictEqual(await layer.loadChanges(), null);
  },
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
  'a photo is asked as bytes, with the login, and comes back as a JPEG': async () => {
    const { layer, asked } = photoAnswer([0xff, 0xd8, 0xff, 0xd9]);
    const blob = await layer.loadPhoto('f1');
    assert.strictEqual(blob.type, 'image/jpeg');
    assert.strictEqual(blob.size, 4);
    const { url, init } = asked[0];
    assert.ok(url.startsWith('https://x.test/rest/v1/photo_data?select=data') && url.includes('&id=eq.f1'), url);
    assert.strictEqual(init.headers.Accept, 'application/octet-stream', 'bytes, not text');
    assert.strictEqual(init.headers.Authorization, 'Bearer login-token', 'as the person logged in');
    assert.ok(init.signal, 'carries the time limit');
  },
  'an id goes into the address as text, not as more of the address': async () => {
    const { layer, asked } = photoAnswer([1]);
    await layer.loadPhoto('f1&team_id=eq.other');
    assert.ok(asked[0].url.endsWith('&id=eq.f1%26team_id%3Deq.other'), asked[0].url);
  },
  'a photo that is gone is null': async () => {
    assert.strictEqual(await photoAnswer([]).layer.loadPhoto('f1'), null);
  },
  'a photo refused by the database keeps its status': async () => {
    assert.strictEqual((await photoError(photoAnswer([], 401).layer, 'f1')).code, '401');
  },
  'a photo request that hangs is "no answer", in time': async () => {
    const started = Date.now();
    assert.strictEqual((await photoError(layerAnswering(null, hanging).data, 'f1')).code, 'no-answer');
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
