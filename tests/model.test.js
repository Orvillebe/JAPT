/**
 * Tests for model.js: dates, blocks, work periods, lists, deadlines, repeats, order and filters.
 * Run: node tests/model.test.js (no dependencies).
 */

const assert = require('assert');
const createModel = require('../model.js');
const CFG = require('../config.js');
const M = createModel(CFG);

let ok = 0;
function test(name, fn) {
  try { fn(); ok++; } catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}
const eq = assert.deepStrictEqual;

M.setToday('2026-11-04');   // a Wednesday

/* ---------- dates ---------- */

test('adding months keeps the last day of a short month', () => {
  eq(M.addMonths('2026-01-31', 1), '2026-02-28');
  eq(M.addMonths('2026-11-15', 3), '2027-02-15');
});
test('a week starts on the shared first day', () => {
  M.setWeekStart(1);
  eq(M.weekFirst('2026-11-04'), '2026-11-02');
  M.setWeekStart(4);
  eq(M.weekFirst('2026-11-04'), '2026-10-29');
  eq(M.weekOrder()[0], 4);
  M.setWeekStart(1);
});
test('today is the local day, not the UTC day', () => {
  const justAfterMidnight = new Date(2026, 10, 5, 0, 30);   // 5 November 00:30 local time
  eq(M.localDs(justAfterMidnight), '2026-11-05');
});

/* ---------- blocks ---------- */

const B = (id, day, s, e, extra = {}) => ({ id, day, start: s * 60, end: e * 60, label: '', validFrom: null, validTo: null, ...extra });
test('a block exists on its weekday within its validity', () => {
  const b = B('a', 3, 9, 12, { validFrom: '2026-11-04', validTo: '2026-11-18' });
  assert.ok(M.blockOnDate(b, '2026-11-04'));
  assert.ok(!M.blockOnDate(b, '2026-11-05'));   // Thursday
  assert.ok(!M.blockOnDate(b, '2026-10-28'));   // before validFrom
  assert.ok(!M.blockOnDate(b, '2026-11-25'));   // after validTo
});
test('a change to an old block ends it yesterday; a block made today changes in place', () => {
  eq(M.blockRevision(B('a', 3, 9, 12, { validFrom: '2026-01-01' })), { inPlace: false, closeOn: '2026-11-03', newFrom: '2026-11-04' });
  eq(M.blockRevision(B('a', 3, 9, 12, { validFrom: '2026-11-04' })), { inPlace: true });
});
test('blocks on one day may not overlap', () => {
  const bs = [B('a', 1, 9, 12), B('b', 1, 13, 17)];
  eq(M.blockProblem(bs, 1, 'a', 9 * 60, 13.5 * 60), 'block.overlap');
  eq(M.blockProblem(bs, 1, 'a', 9 * 60, 13 * 60), '');
  eq(M.blockProblem(bs, 1, 'a', 12 * 60, 9 * 60), 'block.end_after_start');
});
test('dragging a block stays within the room between its neighbours', () => {
  const bs = [B('a', 1, 9, 12), B('b', 1, 13, 17)];
  eq(M.fitBlock(bs, 1, 'a', 'bottom', bs[0], 15 * 60), { start: 540, end: 780 });
  eq(M.fitBlock(bs, 1, 'a', 'move', bs[0], 11 * 60), null);
  eq(M.fitBlock(bs, 1, null, 'create', { start: 12 * 60, end: 12 * 60 }, 13 * 60), { start: 720, end: 780 });
});

/* ---------- work periods ---------- */

test('periods of two weeks follow each other', () => {
  const segs = [{ from: '2026-11-02', length: 14, unit: 'd' }];
  eq(M.periodIn('2026-11-15', segs).start, '2026-11-02');
  eq(M.periodIn('2026-11-15', segs).end, '2026-11-15');
  eq(M.periodIn('2026-11-16', segs).start, '2026-11-16');
  eq(M.periodIn('2026-11-01', segs), undefined);
});
test('a new segment ends the running period and starts a new row', () => {
  const segs = [{ from: '2026-11-02', length: 14, unit: 'd' }, { from: '2026-11-23', length: 7, unit: 'd' }];
  eq(M.periodIn('2026-11-20', segs).end, '2026-11-22');
  eq(M.periodIn('2026-11-24', segs).start, '2026-11-23');
  eq(M.periodIn('2026-12-01', segs).start, '2026-11-30');
});
test('monthly periods follow the calendar', () => {
  const segs = [{ from: '2026-01-31', length: 1, unit: 'm' }];
  eq(M.periodIn('2026-03-15', segs).start, '2026-02-28');
  eq(M.periodIn('2026-03-15', segs).end, '2026-03-30');
});

/* ---------- lists ---------- */

const blocks = [B('wo', 3, 9, 12, { validFrom: '2026-01-01' }), B('ma', 1, 9, 12, { validFrom: '2026-01-01' })];
const idxFor = (bp = [], pp = [], periodActive = true) => M.planIndex({
  blocks, blockPlacements: bp, periodPlacements: pp, segments: [{ from: '2026-11-02', length: 14, unit: 'd' }], periodActive
});
const T = (id, extra = {}) => ({ id, title: 'Taak ' + id, note: '', goalId: 'g1', stage: 'open', doneOn: null, deadline: null, repeat: null, ...extra });

test('done wins, then planned, then the stage', () => {
  const idx = idxFor([{ taskId: 'a', date: '2026-11-04', blockId: 'wo', position: 1 }]);
  eq(M.listOf(T('a'), idx), 'planned');
  eq(M.listOf(T('a', { doneOn: '2026-11-04' }), idx), 'done');
  eq(M.listOf(T('b', { stage: 'backlog' }), idx), 'backlog');
  eq(M.listOf(T('c'), idx), 'open');
  eq(M.listOf(T('d', { stage: 'inbox', goalId: null }), idx), 'inbox');
});
test('a placement in a block that does not exist that day does not count', () => {
  const idx = idxFor([{ taskId: 'a', date: '2026-11-05', blockId: 'wo', position: 1 }]);
  eq(M.listOf(T('a'), idx), 'open');
});
test('a period placement counts only while work periods are on and the period exists', () => {
  const pp = [{ taskId: 'a', periodStart: '2026-11-02', position: 1 }];
  eq(M.listOf(T('a'), idxFor([], pp)), 'planned');
  eq(M.listOf(T('a'), idxFor([], pp, false)), 'open');
  eq(M.listOf(T('a'), idxFor([], [{ taskId: 'a', periodStart: '2026-11-03', position: 1 }])), 'open');
});
test('a due-soon backlog task is shown in Nog niet ingepland, its stage stays', () => {
  const k = T('a', { stage: 'backlog', deadline: '2026-11-10' });
  assert.ok(M.dueSoon(k, 7));
  eq(M.shownList(k, idxFor(), 7), 'open');
  eq(k.stage, 'backlog');
  eq(M.shownList(T('b', { stage: 'backlog', deadline: '2026-12-10' }), idxFor(), 7), 'backlog');
});
test('planned after the deadline is late', () => {
  const idx = idxFor([{ taskId: 'a', date: '2026-11-09', blockId: 'ma', position: 1 }]);
  assert.ok(M.isLate(T('a', { deadline: '2026-11-06' }), idx));
  assert.ok(!M.isLate(T('a', { deadline: '2026-11-09' }), idx));
});
test('a work period is late only when it starts after the deadline', () => {
  const idx = idxFor([], [{ taskId: 'a', periodStart: '2026-11-02', position: 1 }]);   // 2 to 15 Nov
  assert.ok(!M.isLate(T('a', { deadline: '2026-11-06' }), idx));   // the deadline falls in the period
  assert.ok(!M.isLate(T('a', { deadline: '2026-11-02' }), idx));   // the deadline is its first day
  assert.ok(M.isLate(T('a', { deadline: '2026-11-01' }), idx));    // the period starts after it
});
test('only planned in the past', () => {
  const past = idxFor([{ taskId: 'a', date: '2026-10-28', blockId: 'wo', position: 1 }]);
  assert.ok(M.onlyPlannedInPast(T('a'), past));
  const both = idxFor([{ taskId: 'a', date: '2026-10-28', blockId: 'wo', position: 1 }, { taskId: 'a', date: '2026-11-09', blockId: 'ma', position: 1 }]);
  assert.ok(!M.onlyPlannedInPast(T('a'), both));
});
test('planning in the past checks off on the day of the block or the last day of the period', () => {
  eq(M.pastDoneDate({ date: '2026-11-02' }), '2026-11-02');
  eq(M.pastDoneDate({ date: '2026-11-04' }), null);
  eq(M.pastDoneDate({ period: { start: '2026-10-19', end: '2026-11-01' } }), '2026-11-01');
  eq(M.pastDoneDate({ period: { start: '2026-11-02', end: '2026-11-15' } }), null);
});

/* ---------- repeats ---------- */

test('the next repeat is the first deadline after today', () => {
  eq(M.nextDeadline('2026-11-10', '1:w'), '2026-11-17');
  eq(M.nextDeadline('2026-09-01', '1:w'), '2026-11-10');   // far too late: no backlog of repeats
  eq(M.nextDeadline('2026-08-31', '3:m'), '2026-11-30');
  eq(M.nextDeadline('2026-11-10', null), null);
});

/* ---------- order ---------- */

test('a position lands between its neighbours', () => {
  const list = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 4 }];
  eq(M.positionAt(list, 'b', true), 3);
  eq(M.positionAt(list, 'a', false), 1 - 1024);
  eq(M.positionAt(list, null), 4 + 1024);
  eq(M.positionAt([], null), 1024);
});

/* ---------- filters ---------- */

test('OR within a filter, AND between filters', () => {
  const goals = { g1: { id: 'g1', clientId: 'c1' }, g2: { id: 'g2', clientId: null } };
  const who = { a: ['u1'], b: ['u2'], c: [] };
  const f = (x = {}) => ({ q: '', who: [], goal: [], client: [], ...x });
  const pass = (k, fl) => M.passes(k, fl, id => goals[id], id => who[id] || []);
  assert.ok(pass(T('a'), f({ who: ['u1', 'u2'] })));
  assert.ok(pass(T('b'), f({ who: ['u1', 'u2'] })));
  assert.ok(!pass(T('b'), f({ who: ['u1', 'u2'], client: ['intern'] })));
  assert.ok(pass(T('c', { goalId: 'g2' }), f({ who: ['none'], client: ['intern'] })));
  assert.ok(pass(T('a', { note: 'Offerte met scope' }), f({ q: 'SCOPE' })));
  eq(M.filterCount(f({ q: 'x', who: ['u1', 'u2'] })), 2);
});

/* ---------- places ---------- */

test('a place goes to text and back, and a block and a period never get mixed up', () => {
  const blk = { date: '2026-11-04', blockId: 'wo' }, per = { period: '2026-11-02' };
  eq(M.parsePlace(M.placeText(blk)), blk);
  eq(M.parsePlace(M.placeText(per)), per);
  eq(M.parsePlace('2026-11-02'), null);   // a bare date is not a place
  eq(M.parsePlace(''), null);
  assert.ok(M.samePlace(blk, { date: '2026-11-04', blockId: 'wo' }));
  assert.ok(!M.samePlace(blk, per));
});
test('the plan index answers per place, and every entry carries its place', () => {
  const idx = idxFor([{ id: 'p1', taskId: 'a', date: '2026-11-04', blockId: 'wo', position: 2 }, { id: 'p2', taskId: 'b', date: '2026-11-04', blockId: 'wo', position: 1 }],
    [{ id: 'q1', taskId: 'a', periodStart: '2026-11-02', position: 1 }]);
  eq(idx.tasksIn({ date: '2026-11-04', blockId: 'wo' }), ['b', 'a']);
  eq(idx.tasksIn({ period: '2026-11-02' }), ['a']);
  eq(idx.placement({ period: '2026-11-02' }, 'a').id, 'q1');
  eq(idx.of('a').blocks[0].place, { date: '2026-11-04', blockId: 'wo' });
  eq(idx.of('a').periods[0].place, { period: '2026-11-02' });
});

/* ---------- colours ---------- */

test('a stored hue outside the set moves to the nearest allowed one', () => {
  eq(M.goalHue({ hue: 150 }), 185);
  eq(M.goalHue({ hue: 350 }), 8);   // around the circle
  eq(M.goalHue({ hue: -1 }), -1);
  eq(M.freshHue([{ hue: 8 }, { hue: 32 }]), 55);
});
test('a new person gets the first colour nobody has', () => {
  eq(M.freshColour([{ color: M.MEMBER_COLOURS[0] }, { color: M.MEMBER_COLOURS[2] }]), M.MEMBER_COLOURS[1]);
});

console.log(`model tests: ${ok} passed`);
