/**
 * JAPT teams test: one team can't reach another team's data, proven against the real database.
 *
 * Two test logins, each in its own test team (tools/teams-test-setup.sql). On every table and on the save
 * function, A tries to read, add, change and delete what belongs to B. One attempt that works fails the test.
 * Also: nothing is reachable without logging in, and no table is without Row Level Security.
 *
 * When: after every new file in migrations/, and before going live. Step by step: README, "Teams test".
 *
 * The passwords stay with you, in tests/teams-test.env (not in git):
 *   JAPT_TEST_A_PASSWORD=...
 *   JAPT_TEST_B_PASSWORD=...
 * It tests the database in deployment.js, unless that file also names another one:
 *   JAPT_TEST_SUPABASE_URL=...
 *   JAPT_TEST_SUPABASE_KEY=...      (the publishable key, never the secret one)
 * Run: node tests/teams.test.js (no dependencies; it cleans up its own test rows).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, 'teams-test.env'), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const deployment = fs.readFileSync(path.join(__dirname, '..', 'deployment.js'), 'utf8');
// A url with the key of another project would only fail later and less clearly, so it's both or neither.
assert.strictEqual(!env.JAPT_TEST_SUPABASE_URL, !env.JAPT_TEST_SUPABASE_KEY,
  'teams-test.env needs both JAPT_TEST_SUPABASE_URL and JAPT_TEST_SUPABASE_KEY, or neither');
const URL_ = env.JAPT_TEST_SUPABASE_URL || deployment.match(/supabaseUrl: '([^']+)'/)[1];
const KEY = env.JAPT_TEST_SUPABASE_KEY || deployment.match(/supabaseKey: '([^']+)'/)[1];

const TEAM_A = 'teamtest-a', TEAM_B = 'teamtest-b';
const RETURN_ROWS = { Prefer: 'return=representation' };

async function call(token, method, url, body, headers = {}) {
  const res = await fetch(URL_ + url, {
    method,
    headers: { apikey: KEY, Authorization: 'Bearer ' + (token || KEY), 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: res.status, ok: res.ok, data };
}
async function login(email, password) {
  const r = await call(null, 'POST', '/auth/v1/token?grant_type=password', { email, password });
  assert.ok(r.ok, `logging in ${email} failed: ${JSON.stringify(r.data)}`);
  loginIds[r.data.access_token] = r.data.user.id;
  return r.data.access_token;
}
const rpc = (token, fn, args) => call(token, 'POST', '/rest/v1/rpc/' + fn, args);
const batch = (token, team, ops) => rpc(token, 'apply_batch', { p_team: team, p_ops: ops });

// One row in every table of a team, as complete as the database demands, and a harmless field to change.
function rowsFor(team) {
  const id = name => `${team}-${name}`;
  return [
    ['clients', { id: id('client'), name: 'Client ' + team }, { name: 'aangevallen' }],
    ['goals', { id: id('goal'), name: 'Goal', client_id: id('client') }, { note: 'aangevallen' }],
    ['tasks', { id: id('task'), title: 'Task', stage: 'open', goal_id: id('goal') }, { note: 'aangevallen' }],
    ['task_members', { id: id('who'), task_id: id('task'), member_id: id('me') }, { member_id: id('me') }],
    ['work_blocks', { id: id('block'), day: 1, start_min: 540, end_min: 600, valid_from: '2026-01-01' }, { label: 'aangevallen' }],
    ['block_placements', { id: id('bp'), task_id: id('task'), block_id: id('block'), on_date: '2026-11-09' }, { position: 99 }],
    ['period_segments', { id: id('seg'), from_date: '2026-11-02', length: 14, unit: 'd' }, { length: 7 }],
    ['period_placements', { id: id('pp'), task_id: id('task'), period_start: '2026-11-02' }, { position: 99 }],
    ['task_photos', { id: id('photo'), task_id: id('task'), width: 10, height: 10 }, { width: 11 }],
    ['calendars', { id: id('cal'), name: 'Agenda', url: 'https://x.test/geheim.ics' }, { name: 'aangevallen' }],
    ['app_settings', { id: id('setting'), value: 1 }, { value: 2 }]
  ];
}
const PHOTO = '/9j/4AECA//Z';   // a few bytes as base64; the database stores what it gets
const seedOps = team => [
  ...rowsFor(team).map(([table, row]) => ({ op: 'insert', table, row, if_new: true })),
  { op: 'insert', table: 'photo_data', row: { id: `${team}-photo`, data: PHOTO }, if_new: true }
];
const clearOps = team => rowsFor(team).reverse().map(([table, row]) => ({ op: 'remove', table, id: row.id }));

const loginIds = {};
let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) passed++;
  else failures.push(`${name}${detail === undefined ? '' : ': ' + JSON.stringify(detail).slice(0, 200)}`);
}
const refused = r => !r.ok;
const empty = r => r.ok && Array.isArray(r.data) && r.data.length === 0;

async function attack(a, b) {
  for (const [table, row, change] of rowsFor(TEAM_B)) {
    const mine = rowsFor(TEAM_A).find(x => x[0] === table)[1];
    const target = `/rest/v1/${table}?team_id=eq.${TEAM_B}&id=eq.${row.id}`;

    let r = await call(a, 'GET', target);
    check(`${table}: A can't read B`, empty(r), r.data);
    r = await call(a, 'GET', `/rest/v1/${table}?select=team_id`);
    check(`${table}: without a filter A sees only A`, r.ok && r.data.every(x => x.team_id === TEAM_A), r.data);

    r = await call(a, 'POST', `/rest/v1/${table}`, { ...row, id: row.id + '-attack', team_id: TEAM_B }, RETURN_ROWS);
    check(`${table}: A can't add a row to B`, r.status === 403, r);

    r = await call(a, 'PATCH', target, change, RETURN_ROWS);
    check(`${table}: A can't change B's row`, empty(r), r.data);

    r = await call(a, 'DELETE', target, undefined, RETURN_ROWS);
    check(`${table}: A can't delete B's row`, empty(r), r.data);

    r = await call(b, 'GET', target);
    check(`${table}: B's row is still there, unchanged`, r.ok && r.data.length === 1
      && Object.entries(change).every(([k, v]) => r.data[0][k] !== v || table === 'task_members'), r.data);

    r = await call(a, 'PATCH', `/rest/v1/${table}?team_id=eq.${TEAM_A}&id=eq.${mine.id}`, { team_id: TEAM_B }, RETURN_ROWS);
    check(`${table}: A can't move its own row to B`, refused(r), r);

    r = await batch(a, TEAM_B, [{ op: 'update', table, id: row.id, fields: change }]);
    check(`${table}: A can't change B through the save function`, refused(r), r);
    r = await batch(a, TEAM_B, [{ op: 'remove', table, id: row.id }]);
    check(`${table}: A can't delete B through the save function`, refused(r), r);
    r = await batch(a, TEAM_B, [{ op: 'insert', table, row: { ...row, id: row.id + '-attack' } }]);
    check(`${table}: A can't add to B through the save function`, refused(r), r);

    // The save function ignores a team in the row: it can't be smuggled in through its own team.
    r = await batch(a, TEAM_A, [{ op: 'update', table, id: row.id, fields: change }]);
    check(`${table}: B's id through A's team finds nothing`, refused(r), r);

    r = await call(null, 'GET', `/rest/v1/${table}?select=id`);
    check(`${table}: nothing without logging in`, refused(r) || empty(r), r);
  }

  // A reference across teams.
  let r = await batch(a, TEAM_A, [{ op: 'insert', table: 'tasks',
    row: { id: 'teamtest-a-cross', title: 'x', stage: 'open', goal_id: `${TEAM_B}-goal` } }]);
  check('A task can\'t point to a goal of another team', refused(r), r);
  r = await batch(a, TEAM_A, [{ op: 'insert', table: 'goals',
    row: { id: 'teamtest-a-cross', name: 'x', client_id: `${TEAM_B}-client` } }]);
  check('A goal can\'t point to a client of another team', refused(r), r);

  // People and teams.
  r = await call(a, 'GET', `/rest/v1/members?team_id=eq.${TEAM_B}`);
  check('A can\'t see the people of B', empty(r), r.data);
  r = await call(a, 'POST', '/rest/v1/members', { team_id: TEAM_B, id: 'teamtest-a-sneak', name: 'x', allowed: true }, RETURN_ROWS);
  check('A can\'t add itself to B', r.status === 403, r);
  r = await call(a, 'POST', '/rest/v1/members', { team_id: TEAM_A, id: 'teamtest-a-sneak', name: 'x', allowed: true }, RETURN_ROWS);
  check('Nobody adds a person directly, also not to the own team', r.status === 403, r);
  r = await call(a, 'PATCH', `/rest/v1/members?team_id=eq.${TEAM_B}&id=eq.${TEAM_B}-me`, { name: 'aangevallen' }, RETURN_ROWS);
  check('A can\'t change the people of B', empty(r), r.data);
  r = await call(a, 'PATCH', `/rest/v1/members?team_id=eq.${TEAM_A}&id=eq.${TEAM_A}-me`, { team_id: TEAM_B }, RETURN_ROWS);
  check('A can\'t move itself to B', refused(r), r);
  r = await call(a, 'PATCH', `/rest/v1/members?team_id=eq.${TEAM_A}&id=eq.${TEAM_A}-me`,
    { user_id: '00000000-0000-0000-0000-000000000000' }, RETURN_ROWS);
  check('A member row can\'t be handed to another login', refused(r), r);
  r = await call(a, 'GET', '/rest/v1/teams?select=id');
  check('A sees only its own team', r.ok && r.data.length === 1 && r.data[0].id === TEAM_A, r.data);
  r = await rpc(a, 'my_team_ids', {});
  check('my_team_ids returns only your own', r.ok && JSON.stringify(r.data) === JSON.stringify([TEAM_A]), r.data);

  // Reloading what changed (migrations/005): the answer and the notes of removed rows stay within a team.
  r = await rpc(a, 'changes_since', { p_team: TEAM_B, p_since: null });
  check('A can\'t ask what changed in B', refused(r), r);
  r = await rpc(a, 'changes_since', { p_team: TEAM_A, p_since: null });
  check('What changed in A holds only A',
    r.ok && Object.values(r.data.rows).every(rows => rows.every(x => x.team_id === TEAM_A)), r.data);
  const goneId = `${TEAM_B}-gone`, goneNote = `/rest/v1/removed_rows?team_id=eq.${TEAM_B}&id=eq.${goneId}`;
  await batch(b, TEAM_B, [{ op: 'insert', table: 'clients', row: { id: goneId, name: 'weg' } }]);
  await batch(b, TEAM_B, [{ op: 'remove', table: 'clients', id: goneId }]);
  r = await call(b, 'GET', goneNote);
  check('A removed row leaves a note for its own team', r.ok && r.data.length === 1, r.data);
  r = await call(a, 'GET', `/rest/v1/removed_rows?team_id=eq.${TEAM_B}`);
  check('A can\'t read B\'s notes', empty(r), r.data);
  r = await call(a, 'POST', '/rest/v1/removed_rows', { team_id: TEAM_A, table_name: 'tasks', id: 'x' }, RETURN_ROWS);
  check('Nobody writes a note directly', r.status === 403, r);
  r = await call(b, 'DELETE', `/rest/v1/removed_rows?team_id=eq.${TEAM_B}`, undefined, RETURN_ROWS);
  check('Nobody deletes notes directly, also not of the own team', empty(r), r.data);
  await rpc(a, 'clear_removed_notes', { p_team: TEAM_B });
  r = await call(b, 'GET', goneNote);
  check('A can\'t clear B\'s notes', r.ok && r.data.length === 1, r.data);
  r = await call(null, 'GET', '/rest/v1/removed_rows?select=id');
  check('removed_rows: nothing without logging in', refused(r) || empty(r), r);
  r = await rpc(null, 'changes_since', { p_team: TEAM_B, p_since: null });
  check('What changed needs a login', refused(r), r);

  // The photos themselves (migrations/006): read as bytes, never by another team.
  const photoB = `/rest/v1/photo_data?select=data&team_id=eq.${TEAM_B}&id=eq.${TEAM_B}-photo`;
  r = await call(b, 'GET', photoB, undefined, { Accept: 'application/octet-stream' });
  check("B reads its own photo as bytes", r.ok && typeof r.data === 'string' && r.data.length > 0, r);
  r = await call(a, 'GET', photoB, undefined, { Accept: 'application/octet-stream' });
  check("A can't read B's photo", !r.ok || !r.data, r);
  r = await call(a, 'GET', `/rest/v1/photo_data?team_id=eq.${TEAM_B}`);
  check("A can't read B's photos as rows", empty(r), r.data);
  r = await rpc(a, 'photos_for_backup', { p_team: TEAM_B, p_after: null, p_count: 20 });
  check("A gets none of B's photos for a backup", r.ok && Array.isArray(r.data) && r.data.length === 0, r.data);
  r = await rpc(b, 'photos_for_backup', { p_team: TEAM_B, p_after: null, p_count: 20 });
  check("B gets its own photo for a backup", r.ok && r.data.length === 1 && r.data[0].data === PHOTO, r.data);
  r = await call(a, 'POST', '/rest/v1/photo_data', { team_id: TEAM_B, id: `${TEAM_B}-photo2`, data: '\\x00' }, RETURN_ROWS);
  check("A can't add a photo to B", refused(r), r);
  r = await batch(a, TEAM_B, [{ op: 'insert', table: 'photo_data', row: { id: `${TEAM_B}-photo3`, data: PHOTO } }]);
  check("A can't add a photo to B through the save function", refused(r), r);
  r = await call(b, 'PATCH', `/rest/v1/photo_data?team_id=eq.${TEAM_B}&id=eq.${TEAM_B}-photo`, { data: '\\x00' }, RETURN_ROWS);
  check("Nobody changes a photo, also not of the own team", refused(r) || empty(r), r);
  r = await call(b, 'DELETE', `/rest/v1/photo_data?team_id=eq.${TEAM_B}&id=eq.${TEAM_B}-photo`, undefined, RETURN_ROWS);
  check("A photo goes only with its task_photos row", refused(r) || empty(r), r);
  r = await call(null, 'GET', '/rest/v1/photo_data?select=id');
  check("photo_data: nothing without logging in", refused(r) || empty(r), r);

  // Without logging in.
  r = await call(null, 'GET', '/rest/v1/teams?select=id');
  check('teams: nothing without logging in', refused(r) || empty(r), r);
  r = await call(null, 'GET', '/rest/v1/members?select=id');
  check('members: nothing without logging in', refused(r) || empty(r), r);
  r = await rpc(null, 'apply_batch', { p_team: TEAM_B, p_ops: [] });
  check('The save function needs a login', refused(r), r);

  // What ends up in a colleague's page has a fixed form.
  const BAD = '"><img src=x>';
  r = await call(a, 'PATCH', `/rest/v1/members?team_id=eq.${TEAM_A}&id=eq.${TEAM_A}-me`, { color: `red;${BAD}` }, RETURN_ROWS);
  check('A colour must be a colour', refused(r), r);
  r = await batch(a, TEAM_A, [{ op: 'insert', table: 'clients', row: { id: BAD, name: 'x' } }]);
  check('An id can\'t hold HTML', refused(r), r);
  r = await call(a, 'POST', '/rest/v1/clients', { team_id: TEAM_A, id: BAD, name: 'x' }, RETURN_ROWS);
  check('An id can\'t hold HTML, also not directly', refused(r), r);
  r = await batch(a, TEAM_A, [{ op: 'update', table: 'clients', id: `${TEAM_A}-client`, fields: { delete_group: BAD } }]);
  check('A delete group can\'t hold HTML', refused(r), r);

  // Who and when can't be made up.
  const OTHER = '00000000-0000-0000-0000-000000000000', LONG_AGO = '2000-01-01T00:00:00+00:00', me = loginIds[a];
  r = await batch(a, TEAM_A, [{ op: 'insert', table: 'clients',
    row: { id: `${TEAM_A}-who1`, name: 'who1', created_by: OTHER, created_at: LONG_AGO, changed_by: OTHER } }]);
  check('Who made it can\'t be made up through the save function',
    r.ok && r.data[0].created_by === me && r.data[0].changed_by === me && !r.data[0].created_at.startsWith('2000'), r);
  r = await call(a, 'POST', '/rest/v1/clients',
    { team_id: TEAM_A, id: `${TEAM_A}-who2`, name: 'who2', created_by: OTHER, created_at: LONG_AGO }, RETURN_ROWS);
  check('Who made it can\'t be made up directly', r.ok && r.data[0].created_by === me && !r.data[0].created_at.startsWith('2000'), r);
  r = await call(a, 'PATCH', `/rest/v1/clients?team_id=eq.${TEAM_A}&id=eq.${TEAM_A}-who2`, { created_by: OTHER, created_at: LONG_AGO }, RETURN_ROWS);
  check('Who made it can\'t be changed afterwards', r.ok && r.data[0].created_by === me && !r.data[0].created_at.startsWith('2000'), r);
  await batch(a, TEAM_A, [`${TEAM_A}-who1`, `${TEAM_A}-who2`].map(id => ({ op: 'remove', table: 'clients', id })));

  // A task alive under a deleted goal doesn't block emptying the Bin.
  const GONE = '2000-01-01T00:00:00+00:00', goal = `${TEAM_A}-orphan-goal`, orphan = `${TEAM_A}-orphan`;
  r = await batch(a, TEAM_A, [
    { op: 'insert', table: 'goals', row: { id: goal, name: 'Weg', deleted_at: GONE, delete_group: 'x' } },
    { op: 'insert', table: 'tasks', row: { id: orphan, title: 'Levend', stage: 'open', goal_id: goal } }
  ]);
  check('Setting up the orphan', r.ok, r);
  r = await rpc(a, 'purge_bin', { p_team: TEAM_A, p_before: '2001-01-01T00:00:00+00:00' });
  check('Emptying the Bin goes through', r.ok, r);
  r = await call(a, 'GET', `/rest/v1/tasks?team_id=eq.${TEAM_A}&id=eq.${orphan}`);
  check('The orphan is in the Inbox, without its goal', r.ok && r.data.length === 1 && r.data[0].stage === 'inbox' && r.data[0].goal_id === null, r.data);
  r = await call(a, 'GET', `/rest/v1/goals?team_id=eq.${TEAM_A}&id=eq.${goal}`);
  check('The goal is gone for good', empty(r), r.data);
  r = await rpc(a, 'purge_bin', { p_team: TEAM_B, p_before: '2001-01-01T00:00:00+00:00' });
  check('A can\'t empty the Bin of B', refused(r), r);
  await batch(a, TEAM_A, [{ op: 'remove', table: 'tasks', id: orphan }]);

  // Every table protected.
  r = await rpc(a, 'tables_without_rls', {});
  check('No table without Row Level Security', r.ok && r.data.length === 0, r.data);
}

(async () => {
  console.log('teams test against ' + URL_);
  const a = await login('japt-test-a@example.com', env.JAPT_TEST_A_PASSWORD);
  const b = await login('japt-test-b@example.com', env.JAPT_TEST_B_PASSWORD);
  try {
    for (const [token, team] of [[a, TEAM_A], [b, TEAM_B]]) {
      const r = await batch(token, team, seedOps(team));
      assert.ok(r.ok, `setting up ${team} failed: ${JSON.stringify(r.data)}`);
    }
    await attack(a, b);
  } finally {
    await batch(a, TEAM_A, clearOps(TEAM_A));
    await batch(b, TEAM_B, clearOps(TEAM_B));
  }
  failures.forEach(f => console.error('✗ ' + f));
  console.log(`teams test: ${passed} of ${passed + failures.length} passed`);
  if (failures.length) process.exitCode = 1;
})().catch(e => { console.error('✗ ' + e.message); process.exitCode = 1; });
