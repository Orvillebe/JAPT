/**
 * Tests for store.js on the local data layer: saving all or nothing, undo, the changed_at check, and
 * the rules that need more than one row (docs/design.md, Rules).
 *
 * Every test gets a fresh copy of the app's scripts with an empty storage, as the browser loads them.
 * "Today" is Wednesday 4 November 2026, the week starts on Monday.
 * Run: node tests/store.test.js (no dependencies).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const FILES = ['config.js', 'version.js', 'model.js', 'id.js', 'tables.js', 'data-local.js', 'data-service.js', 'store.js'];
const scripts = FILES.map(f => new vm.Script(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f }));

const TODAY = '2026-11-04', YESTERDAY = '2026-11-03', TOMORROW = '2026-11-05', NEXT_MONDAY = '2026-11-09', LAST_MONDAY = '2026-10-26';
const PERIOD = '2026-11-02';                       // a work period of 14 days starts here
const AT = '2026-01-01T09:00:00.000Z';
const row = fields => ({ createdAt: AT, createdBy: 'u1', changedAt: AT, changedBy: 'u1', ...fields });

// The starting data; a test adds its own tasks and placements.
function startData(extra = {}) {
  const block = (id, day) => row({ id, day, start: 540, end: 720, label: '', validFrom: '2026-01-01', validTo: null });
  return {
    members: [row({ id: 'u1', name: 'An', color: '#cf6a52', allowed: true, removedAt: null }), row({ id: 'u2', name: 'Vincent', color: '#4f80bd', allowed: true, removedAt: null })],
    clients: [row({ id: 'c1', name: 'Klant A' })],
    goals: [row({ id: 'g1', name: 'Doel een', note: '', clientId: 'c1', hue: 8, achievedOn: null }), row({ id: 'g2', name: 'Doel twee', note: '', clientId: null, hue: 32, achievedOn: null })],
    tasks: [],
    work_blocks: [block('ma', 1), block('wo', 3), block('do', 4)],
    period_segments: [row({ id: 's1', from: PERIOD, length: 14, unit: 'd' })],
    app_settings: [row({ id: 'periodActive', value: true })],
    ...extra
  };
}
const task = (id, fields = {}) => row({ id, title: 'Taak ' + id, note: '', goalId: 'g1', stage: 'open', doneOn: null, deadline: null, repeat: null, nextTaskId: null, position: 1024, ...fields });
const inBlock = (id, taskId, date, blockId) => row({ id, taskId, date, blockId, position: 1024 });
const inPeriod = (id, taskId) => row({ id, taskId, periodStart: PERIOD, position: 1024 });

// A fresh app with this data, loaded as at startup.
async function app(extra) {
  const data = new Map();
  const context = vm.createContext({
    console, crypto: nodeCrypto.webcrypto,
    localStorage: { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }
  });
  scripts.forEach(s => s.runInContext(context));
  const get = name => vm.runInContext(name, context);
  get('Model').setToday(TODAY);
  const DS = get('DataService'), S = get('Store');
  DS.importBackup({ schemaVersion: get('SCHEMA_VERSION'), data: startData(extra) });
  await S.load();
  const stored = async table => plain(await DS.exportAll())[table];
  return { S, DS, stored };
}

// The Store's objects come from the scripts' own world; compared as plain data.
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);
const ids = rows => rows.map(r => r.id).sort();
const tick = () => new Promise(r => setTimeout(r, 2));   // so that a later save gets a later time

// Checks that an action is refused with exactly these fields, and saved nothing.
async function refused(world, action, fields) {
  const before = JSON.stringify(await world.DS.exportAll());
  let err = null;
  try { await action(); } catch (e) { err = e; }
  assert.ok(err, 'expected a refusal');
  eq(err.code, 'rule', err.message);
  eq(Object.keys(err.problems).sort(), fields);
  eq(JSON.stringify(await world.DS.exportAll()), before, 'a refused action saved something');
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------- saving ---------- */

test('a batch with one failing change saves nothing', async () => {
  const { DS, stored } = await app({ tasks: [task('a')] });
  await assert.rejects(DS.batch([
    { op: 'update', table: 'tasks', id: 'a', fields: { title: 'Nieuw' } },
    { op: 'update', table: 'tasks', id: 'bestaat-niet', fields: { title: 'x' } }
  ]));
  eq((await stored('tasks'))[0].title, 'Taak a');
});
test('a save on a row someone changed meanwhile is refused, and nothing is overwritten', async () => {
  const { S, DS, stored } = await app({ tasks: [task('a')] });
  await tick();
  await DS.batch([{ op: 'update', table: 'tasks', id: 'a', fields: { title: 'Van een collega' } }]);
  await assert.rejects(S.updateTask('a', { title: 'Van mij', note: '', goalId: 'g1', who: [], deadline: null, repeat: null }), e => e.code === 'conflict');
  eq((await stored('tasks'))[0].title, 'Van een collega');
});
test('after a reload the same save goes through', async () => {
  const { S, DS, stored } = await app({ tasks: [task('a')] });
  await tick();
  await DS.batch([{ op: 'update', table: 'tasks', id: 'a', fields: { title: 'Van een collega' } }]);
  await S.reload();
  await S.updateTask('a', { title: 'Van mij', note: '', goalId: 'g1', who: [], deadline: null, repeat: null });
  eq((await stored('tasks'))[0].title, 'Van mij');
});
test('memory follows what was stored', async () => {
  const { S, stored } = await app();
  await S.createTask({ title: 'Nieuw', goalId: 'g1' });
  eq(ids(S.tasks()), ids(await stored('tasks')));
  eq((await stored('tasks'))[0].createdBy, 'local-user');
});

test('a form saves against the version it opened, also after a reload', async () => {
  const { S, DS, stored } = await app({ tasks: [task('a', { note: 'origineel' })] });
  const seen = S.task('a').changedAt, form = { title: 'Mijn titel', note: 'origineel', goalId: 'g1', who: [], deadline: null, repeat: null };
  await tick();
  await DS.batch([{ op: 'update', table: 'tasks', id: 'a', fields: { note: 'van een collega' } }]);
  await S.reload();                               // the tab came back while the form was open
  await assert.rejects(S.updateTask('a', form, seen), e => e.code === 'conflict');
  eq((await stored('tasks'))[0].note, 'van een collega');
  await S.updateTask('a', form, S.task('a').changedAt);   // saving again, knowingly
  eq((await stored('tasks'))[0].note, 'origineel');
});
test('the goal form and renaming a client save against the version they opened', async () => {
  const { S, DS, stored } = await app();
  const seenGoal = S.goal('g1').changedAt, seenClient = S.client('c1').changedAt;
  await tick();
  await DS.batch([
    { op: 'update', table: 'goals', id: 'g1', fields: { note: 'van een collega' } },
    { op: 'update', table: 'clients', id: 'c1', fields: { name: 'Hernoemd' } }
  ]);
  await S.reload();
  await assert.rejects(S.updateGoal('g1', { name: 'Doel', note: '', clientName: 'Hernoemd', hue: 8 }, seenGoal), e => e.code === 'conflict');
  await assert.rejects(S.renameClient('c1', 'Van mij', seenClient), e => e.code === 'conflict');
  eq((await stored('goals'))[0].note, 'van een collega');
  eq((await stored('clients'))[0].name, 'Hernoemd');
});

/* ---------- undo ---------- */

test('undo takes a new task and its people away', async () => {
  const { S, stored } = await app();
  const { undo } = await S.createTask({ title: 'Nieuw', goalId: 'g1', who: ['u1'] });
  await undo();
  eq(await stored('tasks'), []);
  eq(await stored('task_members'), []);
  eq(S.tasks().length, 0);
});
test('undo puts the changed fields back', async () => {
  const { S, stored } = await app({ tasks: [task('a')] });
  const { undo } = await S.updateTask('a', { title: 'Anders', note: 'n', goalId: 'g2', who: [], deadline: null, repeat: null });
  await undo();
  const k = (await stored('tasks'))[0];
  eq([k.title, k.note, k.goalId], ['Taak a', '', 'g1']);
});
test('undo of a drag puts the task back in its old place', async () => {
  const { S, stored } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma')] });
  const { undo } = await S.plan('a', { date: TOMORROW, blockId: 'do' }, { from: { date: NEXT_MONDAY, blockId: 'ma' } });
  await undo();
  const ps = await stored('block_placements');
  eq(ps.map(p => [p.date, p.blockId]), [[NEXT_MONDAY, 'ma']]);
});
test('undo doesn\'t overwrite what someone changed since', async () => {
  const { S, DS, stored } = await app({ tasks: [task('a')] });
  const form = { title: 'Mijn wijziging', note: '', goalId: 'g1', who: [], deadline: null, repeat: null };
  const { undo } = await S.updateTask('a', form);
  await tick();
  await DS.batch([{ op: 'update', table: 'tasks', id: 'a', fields: { title: 'Van een collega' } }]);
  await S.reload();
  await assert.rejects(undo(), e => e.code === 'conflict');
  eq((await stored('tasks'))[0].title, 'Van een collega');
});
test('undo of a new task doesn\'t remove what someone changed since', async () => {
  const { S, DS, stored } = await app();
  const { undo } = await S.createTask({ title: 'Nieuw', goalId: 'g1' });
  await tick();
  const id = (await stored('tasks'))[0].id;
  await DS.batch([{ op: 'update', table: 'tasks', id, fields: { title: 'Van een collega' } }]);
  await S.reload();
  await assert.rejects(undo(), e => e.code === 'conflict');
  eq((await stored('tasks')).length, 1);
});
test('undo of a save with several changes puts everything back', async () => {
  const { S, stored } = await app({ tasks: [task('a', { deadline: TODAY, repeat: '1:w' })], block_placements: [] });
  const { undo } = await S.plan('a', { date: LAST_MONDAY, blockId: 'ma' });   // planned, checked off, next repeat
  await tick();
  await undo();
  eq((await stored('tasks')).map(k => [k.id, k.doneOn]), [['a', null]]);
  eq(await stored('block_placements'), []);
});
test('a failed undo can be tried again', async () => {
  const { S, DS, stored } = await app();
  const { undo } = await S.createTask({ title: 'Nieuw', goalId: 'g1' });
  const batch = DS.batch;
  DS.batch = async () => { throw new Error('offline'); };
  await assert.rejects(undo());
  DS.batch = batch;
  await undo();
  eq(await stored('tasks'), []);
});
test('undo works only once', async () => {
  const { S, stored } = await app();
  const { undo } = await S.createTask({ title: 'Nieuw', goalId: 'g1' });
  await undo(); await undo();
  eq(await stored('tasks'), []);
});
test('undo of deleting brings the task back with its plan', async () => {
  const { S, stored } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma')] });
  const { undo } = await S.binTask('a');
  eq(S.tasks().length, 0);
  await undo();
  eq(ids(S.tasks()), ['a']);
  eq((await stored('block_placements')).length, 1);
  eq(S.listOf(S.task('a')), 'planned');
});

/* ---------- what may be saved ---------- */

test('a task needs a title and a goal', async () => {
  const w = await app();
  await refused(w, () => w.S.createTask({ title: '  ', goalId: 'g1' }), ['title']);
  await refused(w, () => w.S.createTask({ title: 'x', goalId: null }), ['goal']);
  await refused(w, () => w.S.createTask({ title: 'x', goalId: 'bestaat-niet' }), ['goal']);
});
test('an Inbox task needs no goal to stay in the Inbox, but does to leave it', async () => {
  const w = await app();
  const { id } = await w.S.addInboxTask({ title: 'Idee' });
  eq(w.S.task(id).stage, 'inbox');
  await refused(w, () => w.S.processInbox(id, 'open', null), ['goal']);
  await w.S.processInbox(id, 'open', 'g2');
  eq([w.S.task(id).stage, w.S.task(id).goalId], ['open', 'g2']);
});
test('names of clients and people are unique, whatever the capitals', async () => {
  const w = await app();
  await w.S.createGoal({ name: 'Andere', clientName: 'Klant B', hue: 8 });
  const b = w.S.clientNamed('Klant B');
  await refused(w, () => w.S.renameClient(b.id, ' klant a '), ['name']);
  await refused(w, () => w.S.addMember('AN'), ['name']);
  await refused(w, () => w.S.addMember('  '), ['name']);
  await refused(w, () => w.S.updateMember('u2', { name: 'an' }), ['name']);
});
test('an agenda link must be https, empty is allowed', async () => {
  const w = await app();
  await refused(w, () => w.S.setCalendarUrl('http://x.test/a.ics'), ['url']);
  await w.S.setCalendarUrl('');
  eq(w.S.calendarUrl(), '');
  await w.S.setCalendarUrl(' https://x.test/a.ics ');
  eq(w.S.calendarUrl(), 'https://x.test/a.ics');
});
test('a block can\'t overlap and must end after it starts', async () => {
  const w = await app();
  const id = await w.S.createBlock(3, 780, 840);       // Wednesday afternoon
  await refused(w, () => w.S.reviseBlock(id, { start: 700 }), ['time']);    // into the morning block
  await refused(w, () => w.S.reviseBlock(id, { start: 900 }), ['time']);    // after its end
});
test('a work period can\'t be changed from today or earlier', async () => {
  const w = await app();
  await refused(w, () => w.S.changePeriod(TODAY, 7, 'd'), ['from']);
  await refused(w, () => w.S.changePeriod('', 7, 'd'), ['from']);
});

/* ---------- planning ---------- */

test('planning from a list: the task is planned, a backlog task leaves the backlog', async () => {
  const { S, stored } = await app({ tasks: [task('a', { stage: 'backlog' })] });
  await S.plan('a', { date: NEXT_MONDAY, blockId: 'ma' });
  eq((await stored('block_placements')).map(p => [p.taskId, p.date, p.blockId]), [['a', NEXT_MONDAY, 'ma']]);
  eq(S.task('a').stage, 'open');
  eq(S.listOf(S.task('a')), 'planned');
});
test('dragging from block to block moves it, it isn\'t in both', async () => {
  const { S, stored } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma')] });
  await S.plan('a', { date: TOMORROW, blockId: 'do' }, { from: { date: NEXT_MONDAY, blockId: 'ma' } });
  eq((await stored('block_placements')).map(p => [p.date, p.blockId]), [[TOMORROW, 'do']]);
});
test('from a list onto a block it is already in: nothing doubles', async () => {
  const { S, stored } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma')] });
  await S.plan('a', { date: NEXT_MONDAY, blockId: 'ma' });
  eq((await stored('block_placements')).length, 1);
});
test('a task can be in several blocks at once', async () => {
  const { S, stored } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma')] });
  await S.plan('a', { date: TOMORROW, blockId: 'do' });
  eq((await stored('block_placements')).length, 2);
});
test('within the same block only the order changes', async () => {
  const { S, stored } = await app({
    tasks: [task('a'), task('b')],
    block_placements: [{ ...inBlock('p1', 'a', NEXT_MONDAY, 'ma'), position: 1024 }, { ...inBlock('p2', 'b', NEXT_MONDAY, 'ma'), position: 2048 }]
  });
  const place = { date: NEXT_MONDAY, blockId: 'ma' };
  await S.plan('a', place, { from: place, mark: { id: 'b', after: true } });
  const ps = await stored('block_placements');
  eq(ps.length, 2);
  assert.ok(ps.find(p => p.id === 'p1').position > ps.find(p => p.id === 'p2').position);
  eq(S.idx().tasksIn(place), ['b', 'a']);
});
test('within one work period a task is in the period or on days, never both', async () => {
  const { S, stored } = await app({ tasks: [task('a')], period_placements: [inPeriod('q1', 'a')] });
  await S.plan('a', { date: NEXT_MONDAY, blockId: 'ma' });
  eq((await stored('period_placements')).length, 0);
  eq((await stored('block_placements')).length, 1);
  await S.plan('a', { period: PERIOD });
  eq((await stored('period_placements')).length, 1);
  eq((await stored('block_placements')).length, 0);
});
test('planning in the past checks off on that day', async () => {
  const { S } = await app({ tasks: [task('a')] });
  await S.plan('a', { date: LAST_MONDAY, blockId: 'ma' });
  eq(S.task('a').doneOn, LAST_MONDAY);
});
test('planning today or later doesn\'t check off', async () => {
  const { S } = await app({ tasks: [task('a')] });
  await S.plan('a', { date: TODAY, blockId: 'wo' });
  eq(S.task('a').doneOn, null);
});
test('taking out of a block and out of the blocks in a period', async () => {
  const { S, stored } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma'), inBlock('p2', 'a', TOMORROW, 'do')] });
  await S.unplan({ date: TOMORROW, blockId: 'do' }, 'a');
  eq(ids(await stored('block_placements')), ['p1']);
  await S.unplanBlocksInPeriod(PERIOD, 'a');
  eq(await stored('block_placements'), []);
});
test('moving to Nog niet ingepland takes it out of every plan', async () => {
  const { S, stored } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma')], period_placements: [inPeriod('q1', 'a')] });
  await S.moveToList('a', 'open');
  eq(await stored('block_placements'), []);
  eq(await stored('period_placements'), []);
  eq(S.listOf(S.task('a')), 'open');
});
test('moving a done task back to a list unchecks it in one save', async () => {
  const { S, stored } = await app({ tasks: [task('a', { doneOn: YESTERDAY })] });
  await S.moveToList('a', 'backlog');
  const k = (await stored('tasks'))[0];
  eq([k.doneOn, k.stage], [null, 'backlog']);
});
test('moving to Gedaan checks it off', async () => {
  const { S } = await app({ tasks: [task('a')] });
  await S.moveToList('a', 'done');
  eq(S.task('a').doneOn, TODAY);
});
test('a task dropped between two others lands between them', async () => {
  const { S } = await app({ tasks: [task('a', { position: 1000 }), task('b', { position: 2000 }), task('c', { position: 3000 })] });
  await S.moveToList('c', 'open', { id: 'a', after: true });
  eq(S.itemsOf('open').map(k => k.id), ['a', 'c', 'b']);
});

/* ---------- repeats ---------- */

test('checking off a repeating task makes the next one in the Backlog, with its people', async () => {
  const { S } = await app({ tasks: [task('a', { deadline: TODAY, repeat: '1:w' })], task_members: [row({ id: 'm1', taskId: 'a', memberId: 'u2' })] });
  await S.setDone('a', true);
  const nx = S.task(S.task('a').nextTaskId);
  eq([nx.stage, nx.deadline, nx.repeat, nx.doneOn], ['backlog', '2026-11-11', '1:w', null]);
  eq(S.whoOf(nx.id), ['u2']);
});
test('unchecking removes the next one again', async () => {
  const { S, stored } = await app({ tasks: [task('a', { deadline: TODAY, repeat: '1:w' })] });
  await S.setDone('a', true);
  await S.setDone('a', false);
  eq(ids(await stored('tasks')), ['a']);
  eq(S.task('a').nextTaskId, null);
});
test('unchecking keeps the next one when it is already done', async () => {
  const { S, stored } = await app({ tasks: [task('a', { deadline: TODAY, repeat: '1:w' })] });
  await S.setDone('a', true);
  const next = S.task('a').nextTaskId;
  await S.setDone(next, true);
  await S.setDone('a', false);
  assert.ok(ids(await stored('tasks')).includes(next));
});
test('checking off twice makes only one next task', async () => {
  const { S, stored } = await app({ tasks: [task('a', { deadline: TODAY, repeat: '1:w' })] });
  await S.setDone('a', true);
  await S.setDone('a', false);
  await S.setDone('a', true);
  eq((await stored('tasks')).length, 2);
});
test('unchecking in an achieved goal reopens the goal', async () => {
  const { S } = await app({ goals: [row({ id: 'g1', name: 'D', note: '', clientId: null, hue: 8, achievedOn: YESTERDAY })], tasks: [task('a', { doneOn: YESTERDAY })] });
  await S.setDone('a', false);
  eq(S.goal('g1').achievedOn, null);
});

/* ---------- inbox ---------- */

test('sending the same new Inbox task twice saves it once', async () => {
  const { DS, stored } = await app();
  const row1 = { id: 'x', title: 'Idee', note: '', goalId: null, stage: 'inbox', doneOn: null, deadline: null, repeat: null, nextTaskId: null, position: 1024 };
  await DS.batch([{ op: 'insert', table: 'tasks', row: row1, ifNew: true }]);
  await DS.batch([{ op: 'insert', table: 'tasks', row: row1, ifNew: true }]);
  eq((await stored('tasks')).length, 1);
});
test('Inbox tasks are not in the task lists', async () => {
  const { S } = await app();
  await S.addInboxTask({ title: 'Idee' });
  eq(S.tasks().length, 0);
  eq(S.inbox().length, 1);
});
test('checking off from the Inbox finishes it without a goal; deleting goes to the Bin', async () => {
  const { S } = await app();
  const a = await S.addInboxTask({ title: 'Een' }), b = await S.addInboxTask({ title: 'Twee' });
  await S.processInbox(a.id, 'done');
  eq([S.task(a.id).doneOn, S.task(a.id).goalId], [TODAY, null]);
  await S.processInbox(b.id, 'deleted');
  eq(S.task(b.id), null);
});
test('unchecking a finished task without a goal sends it back to the Inbox', async () => {
  const { S } = await app({ tasks: [task('a', { goalId: null, doneOn: YESTERDAY })] });
  const { notes } = await S.setDone('a', false);
  eq(S.task('a').stage, 'inbox');
  eq(notes, ['inbox']);
});

/* ---------- goals and clients ---------- */

test('a typed client name that doesn\'t exist becomes a client; an existing one is reused', async () => {
  const { S, stored } = await app();
  await S.createGoal({ name: 'A', clientName: 'Nieuwe klant', hue: 8 });
  await S.createGoal({ name: 'B', clientName: 'nieuwe KLANT', hue: 8 });
  eq((await stored('clients')).length, 2);
});
test('moving a client\'s last goal elsewhere sends the client to the Bin', async () => {
  const { S } = await app();
  await S.updateGoal('g1', { name: 'Doel een', note: '', clientName: '', hue: 8 });
  eq(S.client('c1'), null);
  eq(S.clients().length, 0);
});
test('achieving a goal: open tasks are checked off, or go back to the Inbox', async () => {
  const w1 = await app({ tasks: [task('a')] });
  await w1.S.achieveGoal('g1', 'done');
  eq([w1.S.task('a').doneOn, w1.S.goal('g1').achievedOn], [TODAY, TODAY]);
  const w2 = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'ma')] });
  await w2.S.achieveGoal('g1', 'inbox');
  eq([w2.S.task('a').stage, w2.S.task('a').goalId], ['inbox', null]);
  eq(await w2.stored('block_placements'), []);
});
test('deleting a goal with its tasks, and the last goal of a client takes the client along', async () => {
  const { S } = await app({ tasks: [task('a')] });
  await S.deleteGoal('g1', 'del');
  eq([S.goal('g1'), S.task('a'), S.client('c1')], [null, null, null]);
});
test('deleting a goal and freeing its tasks sends them to the Inbox', async () => {
  const { S } = await app({ tasks: [task('a')] });
  await S.deleteGoal('g1', 'free');
  eq([S.goal('g1'), S.task('a').stage, S.task('a').goalId], [null, 'inbox', null]);
});

/* ---------- the Bin ---------- */

test('a group comes back together', async () => {
  const { S } = await app({ tasks: [task('a')] });
  await S.deleteGoal('g1', 'del');
  const bin = await S.loadBin();
  await S.restoreGroup(bin.tasks[0].deleteGroup, bin);
  assert.ok(S.goal('g1') && S.task('a') && S.client('c1'));
});
test('a task whose goal is gone comes back in the Inbox', async () => {
  const { S } = await app({ tasks: [task('a')] });
  await S.binTask('a');
  await S.deleteGoal('g1', 'del');
  const bin = await S.loadBin();
  const group = bin.tasks[0].deleteGroup;
  await S.restoreGroup(group, bin);
  eq([S.task('a').stage, S.task('a').goalId, S.goal('g1')], ['inbox', null, null]);
});
test('restoring a goal when its client\'s name is taken again doesn\'t make two', async () => {
  const { S } = await app();
  await S.deleteGoal('g1', 'del');
  await S.createGoal({ name: 'Nieuw', clientName: 'klant a', hue: 8 });
  const existing = S.clientNamed('Klant A');
  const bin = await S.loadBin();
  await S.restoreGroup(bin.goals[0].deleteGroup, bin);
  eq(S.clients().length, 1);
  eq(S.goal('g1').clientId, existing.id);
});
test('undoing a delete when the client\'s name is taken again doesn\'t make two', async () => {
  const { S } = await app();
  const { undo } = await S.deleteGoal('g1', 'del');
  await S.createGoal({ name: 'Nieuw', clientName: 'klant a', hue: 8 });
  const existing = S.clientNamed('Klant A');
  await undo();
  eq(S.clients().length, 1);
  eq(S.goal('g1').clientId, existing.id);
});
test('undoing a goal\'s move away from its last client keeps names unique too', async () => {
  const { S } = await app();
  const { undo } = await S.updateGoal('g1', { name: 'Doel een', note: '', clientName: '', hue: 8 });
  await S.createGoal({ name: 'Nieuw', clientName: 'KLANT A', hue: 8 });
  const existing = S.clientNamed('Klant A');
  await undo();
  eq(S.clients().length, 1);
  eq(S.goal('g1').clientId, existing.id);
});
test('without a clash the client simply comes back', async () => {
  const { S } = await app();
  const { undo } = await S.deleteGoal('g1', 'del');
  await undo();
  eq(S.client('c1').name, 'Klant A');
  eq(S.goal('g1').clientId, 'c1');
});
test('what stayed in the Bin too long is gone at the next start', async () => {
  const old = new Date(Date.now() - 40 * 864e5).toISOString(), recent = new Date(Date.now() - 2 * 864e5).toISOString();
  const { DS, stored } = await app({ tasks: [task('a', { deletedAt: old }), task('b', { deletedAt: recent })], task_members: [row({ id: 'm1', taskId: 'a', memberId: 'u1' })] });
  await DS.purgeBin(new Date(Date.now() - 30 * 864e5).toISOString());
  eq(ids(await stored('tasks')), ['b']);
  eq(await stored('task_members'), []);
});

/* ---------- work blocks ---------- */

test('changing a block starts a new one today; the past keeps the old one', async () => {
  const { S, stored } = await app({ tasks: [task('a'), task('b')], block_placements: [inBlock('p1', 'a', LAST_MONDAY, 'ma'), inBlock('p2', 'b', NEXT_MONDAY, 'ma')] });
  const id = await S.reviseBlock('ma', { start: 600 });
  const bs = await stored('work_blocks');
  eq(bs.find(b => b.id === 'ma').validTo, YESTERDAY);
  eq([bs.find(b => b.id === id).start, bs.find(b => b.id === id).validFrom], [600, TODAY]);
  const ps = await stored('block_placements');
  eq(ps.find(p => p.id === 'p1').blockId, 'ma');    // the past stays on the old block
  eq(ps.find(p => p.id === 'p2').blockId, id);      // the future moves along
});
test('a block made today is changed in place', async () => {
  const { S, stored } = await app();
  const id = await S.createBlock(5, 540, 600);
  eq(await S.reviseBlock(id, { end: 660 }), id);
  eq((await stored('work_blocks')).filter(b => b.day === 5).length, 1);
});
test('removing a block: tasks from today leave the agenda, the past stays', async () => {
  const { S, stored } = await app({ tasks: [task('a'), task('b')], block_placements: [inBlock('p1', 'a', LAST_MONDAY, 'ma'), inBlock('p2', 'b', NEXT_MONDAY, 'ma')] });
  await S.removeBlock('ma');
  eq(ids(await stored('block_placements')), ['p1']);
  eq((await stored('work_blocks')).find(b => b.id === 'ma').validTo, YESTERDAY);
});
test('copying a day replaces what was on the other day', async () => {
  const { S } = await app();
  await S.copyDay(1, [3]);                                  // Monday onto Wednesday
  const wed = S.blocks().filter(b => b.day === 3 && !b.validTo);
  eq(wed.length, 1);
  eq(wed[0].id === 'wo', false);
});
test('clearing a day removes all its blocks', async () => {
  const { S } = await app();
  await S.clearDay(1);
  eq(S.blocks().filter(b => b.day === 1 && !b.validTo).length, 0);
});

/* ---------- work period ---------- */

test('a change of the period takes effect later and keeps what is planned', async () => {
  const { S, stored } = await app({ tasks: [task('a')], period_placements: [inPeriod('q1', 'a')] });
  await S.changePeriod('2026-11-16', 7, 'd');
  eq((await stored('period_segments')).length, 2);
  eq((await stored('period_placements')).length, 1);
});
test('switching the period off: placements go, and it says how many tasks went back', async () => {
  const { S, stored } = await app({ tasks: [task('a'), task('b')], period_placements: [inPeriod('q1', 'a'), inPeriod('q2', 'b')], block_placements: [inBlock('p1', 'b', NEXT_MONDAY, 'ma')] });
  eq(await S.switchPeriodOff(), 1);
  eq(await stored('period_placements'), []);
  eq(S.periodActive(), false);
  eq(S.listOf(S.task('a')), 'open');
  eq(S.listOf(S.task('b')), 'planned');
});

test('switching the period on takes what was filled in, in one save', async () => {
  const { S, stored } = await app({ app_settings: [row({ id: 'periodActive', value: false })] });
  await S.switchPeriodOn('2026-11-16', 7, 'd');
  eq(S.periodActive(), true);
  eq((await stored('period_segments')).length, 2);
});
test('switching the period on with a date that isn\'t allowed changes nothing', async () => {
  const w = await app({ app_settings: [row({ id: 'periodActive', value: false })] });
  await refused(w, () => w.S.switchPeriodOn(TODAY, 7, 'd'), ['from']);
});
test('when switching the period on fails, nothing of it is saved', async () => {
  const { S, DS, stored } = await app({ app_settings: [row({ id: 'periodActive', value: false })] });
  const batch = DS.batch;
  DS.batch = async () => { throw new Error('offline'); };
  await assert.rejects(S.switchPeriodOn('2026-11-16', 7, 'd'));
  DS.batch = batch;
  eq(S.periodActive(), false);
  eq((await stored('period_segments')).length, 1);
});

/* ---------- people ---------- */

test('a new person gets a colour nobody has', async () => {
  const { S } = await app();
  await S.addMember('Nieuw');
  const m = S.members().find(x => x.name === 'Nieuw');
  assert.ok(!['#cf6a52', '#4f80bd'].includes(m.color));
});
test('removing someone takes them off open tasks; done tasks keep the name', async () => {
  const { S, stored } = await app({
    tasks: [task('a'), task('b', { doneOn: YESTERDAY })],
    task_members: [row({ id: 'm1', taskId: 'a', memberId: 'u2' }), row({ id: 'm2', taskId: 'b', memberId: 'u2' })]
  });
  await S.removeMember('u2');
  eq(ids(await stored('task_members')), ['m2']);
  eq(S.members().map(m => m.id), ['u1']);
  assert.ok(S.member('u2'));                                // still known, for the old tasks
});

/* ---------- derived ---------- */

test('a task on a deleted block no longer counts as planned', async () => {
  const { S } = await app({ tasks: [task('a')], block_placements: [inBlock('p1', 'a', NEXT_MONDAY, 'weg')] });
  eq(S.listOf(S.task('a')), 'open');
});
test('a due-soon task stands on top of Nog niet ingepland, soonest first', async () => {
  const { S } = await app({ tasks: [task('a', { position: 1 }), task('b', { position: 2, deadline: '2026-11-08' }), task('c', { position: 3, deadline: TOMORROW })] });
  eq(S.itemsOf('open').map(k => k.id), ['c', 'b', 'a']);
});
test('a due-soon backlog task is shown in Nog niet ingepland without changing its stage', async () => {
  const { S } = await app({ tasks: [task('a', { stage: 'backlog', deadline: TOMORROW })] });
  eq(S.itemsOf('open').map(k => k.id), ['a']);
  eq(S.task('a').stage, 'backlog');
});
test('goal figures count done, open and planned', async () => {
  const { S } = await app({ tasks: [task('a'), task('b', { doneOn: YESTERDAY }), task('c')], block_placements: [inBlock('p1', 'c', NEXT_MONDAY, 'ma')] });
  eq(S.goalStats(S.goal('g1')), { total: 3, done: 1, open: 2, planned: 1 });
});

(async () => {
  let ok = 0;
  for (const [name, fn] of tests) {
    try { await fn(); ok++; } catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
  }
  console.log(`store tests: ${ok} of ${tests.length} passed`);
})();
