/**
 * Tests for tools/restore.js: a backup becomes an SQL script that restores it.
 * Run: node tests/restore.test.js (no dependencies).
 */

const assert = require('assert');
const buildRestoreSql = require('../tools/restore.js');

const VERSION = 4;
const noUpgrade = b => b.data;
const LOGIN = '4ba0d456-5b56-4b08-9518-c47649c69547';
const AT = '2026-11-09T10:00:00.123456+00:00';
const who = { createdBy: LOGIN, createdAt: AT, changedBy: 'local-user', changedAt: AT };
const backup = extra => ({
  app: 'JAPT', schemaVersion: VERSION, exportedAt: '2026-11-09T12:00:00.000Z',
  data: {
    members: [{ id: 'm1', userId: LOGIN, name: "An O'Neil", color: '#111111', allowed: true, removedAt: null, ...who }],
    clients: [{ id: 'c1', name: "Klant 'A'", deletedAt: null, deleteGroup: null, ...who }],
    goals: [{ id: 'g1', name: 'Doel', note: '', clientId: 'c1', hue: 8, achievedOn: null, ...who }],
    tasks: [
      { id: 't1', title: 'Taak', note: 'n', goalId: 'g1', stage: 'open', doneOn: null, deadline: '2026-11-10', repeat: '1:w', nextTaskId: null, position: 1536.5, ...who },
      { id: 't2', title: 'Weg', note: '', goalId: null, stage: 'open', doneOn: null, deadline: null, repeat: null, nextTaskId: null, position: 1, deletedAt: AT, deleteGroup: 'grp', ...who }
    ],
    task_members: [{ id: 'w1', taskId: 't1', memberId: 'm1', ...who }],
    work_blocks: [{ id: 'b1', day: 1, start: 540, end: 720, label: '', validFrom: '2026-01-01', validTo: null, ...who }],
    block_placements: [{ id: 'p1', taskId: 't1', blockId: 'b1', date: '2026-11-09', position: 2, ...who }],
    period_segments: [{ id: 's1', from: '2026-11-02', length: 14, unit: 'd', ...who }],
    period_placements: [{ id: 'q1', taskId: 't1', periodStart: '2026-11-02', position: 3, ...who }],
    calendars: [{ id: 'k1', name: 'Team', url: 'https://x.test/a.ics', owner: null, ...who }],
    app_settings: [{ id: 'weekStart', value: 1, ...who }, { id: 'periodActive', value: true, ...who }],
    ...extra
  }
});
const sql = (b = backup(), team = 'Orville') => buildRestoreSql(b, noUpgrade, VERSION, team);

let ok = 0;
function test(name, fn) {
  try { fn(); ok++; } catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}
const has = (s, part) => assert.ok(s.includes(part), 'missing: ' + part);

test('only a JAPT backup is taken', () => {
  assert.throws(() => sql({ app: 'JAFT', data: {} }), /geen back-up/);
  assert.throws(() => sql({ about: 'analyse' }), /geen back-up/);
});
test('a backup from a newer database is refused', () => {
  assert.throws(() => sql({ ...backup(), schemaVersion: VERSION + 1 }), /Werk de code/);
});
test('a team name is needed', () => assert.throws(() => sql(backup(), '  '), /naam van het team/));
test('it is one transaction that first checks the version, the team and that it is empty', () => {
  const s = sql();
  assert.ok(s.indexOf('begin;') < s.indexOf('raise exception') && s.indexOf('raise exception') < s.indexOf('insert into public.tasks'));
  has(s, `from public.schema_migrations) <> ${VERSION}`);
  has(s, 'No team named');
  has(s, 'already holds planning');
  assert.ok(s.indexOf('commit;') > s.indexOf('insert into public.tasks'));
});
test('without replace, nothing is deleted from the team', () => {
  assert.ok(!sql().includes('delete from public.tasks'));
});
test('replacing happens inside the same transaction, after the checks, and says so', () => {
  const s = buildRestoreSql(backup(), noUpgrade, VERSION, 'Orville', { replace: true });
  const begin = s.indexOf('begin;'), checks = s.indexOf('No team named');
  const wipe = s.indexOf('delete from public.tasks'), insert = s.indexOf('insert into public.tasks'), end = s.indexOf('commit;');
  assert.ok(begin < checks && checks < wipe && wipe < insert && insert < end);
  assert.ok(!s.includes('already holds planning'));
  has(s, 'REPLACES all planning');
});
test('replacing only touches that team', () => {
  const s = buildRestoreSql(backup(), noUpgrade, VERSION, 'Orville', { replace: true });
  s.split('\n').filter(l => l.startsWith('delete from public.'))
    .forEach(l => assert.ok(l.includes('team_id = (select id from restore_team)') || l.startsWith('delete from public.members'), l));
});
test('a space typed along the team name doesn\'t count', () => {
  has(sql(backup(), ' Orville '), "lower(name) = lower('Orville');");
});
test('text with a quote stays one value', () => {
  has(sql(), "'Klant ''A'''");
  has(sql(), "'An O''Neil'");
  has(sql(backup(), "Team's"), "lower(name) = lower('Team''s')");
});
test('columns with another name than their field', () => {
  const s = sql();
  has(s, '"start_min", "end_min"'); has(s, '1, 540, 720');
  has(s, '"on_date"'); has(s, "'2026-11-09'::date");
  has(s, '"from_date"'); has(s, "'2026-11-02'::date, 14, 'd'");
});
test('what was in the Bin stays in the Bin', () => {
  has(sql(), `'${AT}'::timestamptz, 'grp'`);
});
test('empty values go straight into the table, so a column of only nulls keeps its type', () => {
  assert.ok(!sql().includes('from (values'));
  assert.ok(/insert into public\.goals \(team_id, [^)]*\) values\n  \(\(select id from restore_team\), 'g1'/.test(sql()));
});
test('positions keep their decimals', () => has(sql(), '1536.5'));
test('settings keep their type', () => {
  const s = sql();
  has(s, "'weekStart', '1'::jsonb"); has(s, "'periodActive', 'true'::jsonb");
});
test('who made it: a login stays, anything else becomes empty', () => {
  const s = sql();
  has(s, `'${LOGIN}'::uuid, '${AT}'::timestamptz, null, '${AT}'::timestamptz`);
});
test('people are matched by login or by name, and only real logins count', () => {
  const s = sql();
  has(s, 'from auth.users u where u.id = b.user_id');
  has(s, 'lower(btrim(m.name)) = lower(btrim(b.name))');
});
test('the contents are counted at the top and checked at the end', () => {
  const s = sql();
  has(s, '-- Contents: 1 members, 1 clients, 1 goals, 2 tasks');
  has(s, "select 'tasks' as tabel, count(*)");
});
test('an empty table doesn\'t make invalid SQL', () => {
  const s = sql(backup({ calendars: [] }));
  has(s, '-- calendars: nothing in the backup');
  assert.ok(!s.includes('insert into public.calendars'));
});

test('photos come back as bytes, after their task_photos rows', () => {
  const s = sql(backup({
    task_photos: [{ id: 'f1', taskId: 't1', width: 1200, height: 797, ...who }],
    photo_data: [{ id: 'f1', data: '/9j/4AECA//Z' }, { id: 'f2', data: "x'); drop table tasks; --" }]
  }));
  has(s, "decode('/9j/4AECA//Z', 'base64')");
  assert.ok(s.indexOf('insert into public.task_photos') < s.indexOf('insert into public.photo_data'));
  assert.ok(!s.includes('drop table'), 'only base64 may pass');
  has(s, '1 photo_data');
});

console.log(`restore tests: ${ok} passed`);
