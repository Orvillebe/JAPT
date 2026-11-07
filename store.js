/**
 * JAPT Store - the data in memory, and every user action as one save with its undo.
 *
 * Responsibilities:
 *   - Loading everything (DataService.loadAll), reloading at natural moments (App decides when)
 *   - Every action is one batch of changes, saved all or nothing; memory follows what was stored
 *   - Undo: every batch returns a function that saves the opposite changes
 *   - The changed_at check: updates expect the version that was loaded; a refused save reloads
 *   - Derived data, rebuilt after every change: the plan index, who is on a task, lookups
 *   - The rules that need more than one row: repeats, planning in the past, goals achieved or
 *     deleted, block changes from today, work period changes, the Bin
 *
 * Screens read and write only through the Store; they never see the data layer.
 * Pure rules live in model.js; what each rule means is in docs/design.md.
 */

const Store = (() => {
  const M = Model;
  const TABLES = ['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks', 'block_placements',
    'period_segments', 'period_placements', 'calendars', 'app_settings'];
  const BINNED = ['clients', 'goals', 'tasks'];
  let raw = Object.fromEntries(TABLES.map(t => [t, []]));
  let cache = null, me = null, listeners = [];

  const nowIso = () => new Date().toISOString();
  const td = () => M.today();

  async function load() {
    const cutoff = new Date(Date.now() - JAPT_CONFIG.binDays * 864e5).toISOString();
    try { await DataService.purgeBin(cutoff); } catch (e) { console.error('Emptying the Bin failed', e); }
    await reload();
    me = await DataService.getSession();
  }
  async function reload() {
    const data = await DataService.loadAll();
    raw = Object.fromEntries(TABLES.map(t => [t, data[t] || []]));
    changed();
  }
  function changed() {
    cache = null;
    M.setWeekStart(setting('weekStart'));
    listeners.forEach(f => f());
  }
  const onChange = f => listeners.push(f);

  /* ---------- saving ---------- */

  const find = (table, id) => raw[table].find(r => r.id === id) || null;

  // Save ops as one batch and bring memory in line with what was stored. Returns the undo.
  async function apply(ops) {
    ops = ops.filter(Boolean);
    if (!ops.length) return async () => {};
    const inverse = [];
    for (const o of ops) {
      const old = o.op === 'insert' ? null : find(o.table, o.id);
      if (o.op === 'insert') inverse.unshift({ op: 'remove', table: o.table, id: o.row.id });
      else if (o.op === 'remove') { if (old) inverse.unshift({ op: 'insert', table: o.table, row: old }); }
      else if (old) inverse.unshift({ op: 'update', table: o.table, id: o.id, fields: Object.fromEntries(Object.keys(o.fields).map(k => [k, old[k] === undefined ? null : old[k]])) });
      else if (o.op === 'upsert') inverse.unshift({ op: 'remove', table: o.table, id: o.id });
    }
    const stored = await DataService.batch(ops);
    ops.forEach((o, i) => {
      const id = o.op === 'insert' ? o.row.id : o.id, rows = raw[o.table], at = rows.findIndex(r => r.id === id);
      const row = stored[i];
      if (o.op === 'remove' || !row || (BINNED.includes(o.table) && row.deletedAt)) { if (at >= 0) rows.splice(at, 1); return; }
      if (at >= 0) rows[at] = row; else rows.push(row);
    });
    changed();
    let undone = false;
    return async () => { if (undone) return; undone = true; await apply(inverse); };
  }

  const ins = (table, row) => ({ op: 'insert', table, row: { id: newId(), ...row } });
  // An update expects the row as it was loaded (docs/design.md, Working at the same time).
  const upd = (table, id, fields) => { const r = find(table, id); return { op: 'update', table, id, fields, ifChangedAt: r ? r.changedAt : undefined }; };
  const del = (table, id) => ({ op: 'remove', table, id });

  /* ---------- derived ---------- */

  function build() {
    const members = raw.members;
    const memberOrder = Object.fromEntries(members.map((m, i) => [m.id, i]));
    const who = new Map();
    for (const r of raw.task_members) { if (!who.has(r.taskId)) who.set(r.taskId, []); who.get(r.taskId).push(r.memberId); }
    who.forEach(v => v.sort((a, b) => (memberOrder[a] ?? 99) - (memberOrder[b] ?? 99)));
    const idx = M.planIndex({
      blocks: raw.work_blocks, blockPlacements: raw.block_placements, periodPlacements: raw.period_placements,
      segments: raw.period_segments, periodActive: periodActive()
    });
    cache = {
      idx, who,
      task: Object.fromEntries(raw.tasks.map(k => [k.id, k])),
      goal: Object.fromEntries(raw.goals.map(g => [g.id, g])),
      client: Object.fromEntries(raw.clients.map(c => [c.id, c])),
      member: Object.fromEntries(members.map(m => [m.id, m]))
    };
  }
  const c$ = () => { if (!cache) build(); return cache; };

  /* ---------- reading ---------- */

  const SETTING_DEFAULTS = { weekStart: JAPT_CONFIG.weekStart, deadlineDays: JAPT_CONFIG.deadlineDays, periodActive: false };
  function setting(key) {
    const r = raw.app_settings.find(s => s.id === key);
    return r && r.value !== undefined && r.value !== null ? r.value : SETTING_DEFAULTS[key];
  }
  const periodActive = () => !!setting('periodActive') && raw.period_segments.length > 0;
  const periodSetUp = () => raw.period_segments.length > 0;

  const idx = () => c$().idx;
  const task = id => c$().task[id] || null;
  const goal = id => (id == null ? null : c$().goal[id] || null);
  const client = id => (id == null ? null : c$().client[id] || null);
  const member = id => c$().member[id] || null;
  const whoOf = id => c$().who.get(id) || [];
  const members = () => raw.members.filter(m => !m.removedAt);
  const allMembers = () => raw.members;
  const clients = () => raw.clients.slice().sort((a, b) => a.name.localeCompare(b.name, 'nl'));
  const goals = () => raw.goals;
  const openGoals = () => raw.goals.filter(g => !g.achievedOn);
  const tasks = () => raw.tasks.filter(k => k.stage !== 'inbox');
  const inbox = () => raw.tasks.filter(k => k.stage === 'inbox').sort((a, b) => a.position - b.position);
  const clientOfTask = id => { const g = goal((task(id) || {}).goalId); return g ? client(g.clientId) : null; };
  const listOf = k => M.listOf(k, idx());
  const shownList = k => M.shownList(k, idx(), setting('deadlineDays'));
  const dueSoon = k => M.dueSoon(k, setting('deadlineDays'));
  const isLate = k => M.isLate(k, idx());
  const blocks = () => raw.work_blocks;
  const segments = () => raw.period_segments.slice().sort((a, b) => (a.from < b.from ? -1 : 1));
  const periodAt = ds => (periodActive() ? M.periodIn(ds, segments()) : undefined);
  const periodSetting = ds => M.periodIn(ds, segments());   // also while switched off
  const blocksOn = ds => M.blocksOn(raw.work_blocks, ds);
  const calendarUrl = () => { const c = raw.calendars.find(x => !x.owner); return c ? c.url || '' : ''; };
  const myId = () => (me && me.userId) || null;
  const plannedFromToday = blockId => raw.block_placements.filter(p => p.blockId === blockId && p.date >= td() && task(p.taskId)).length;

  // Tasks of a list in their manual order; Nog niet ingepland puts due-soon tasks on top, soonest first.
  function itemsOf(list, pass = () => true) {
    const r = tasks().filter(k => shownList(k) === list && pass(k)).sort((a, b) => a.position - b.position);
    if (list === 'open') r.sort((a, b) => (+dueSoon(b)) - (+dueSoon(a)) || (dueSoon(a) && dueSoon(b) ? (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0) : 0));
    return r;
  }
  const goalStats = g => {
    const ts = tasks().filter(k => k.goalId === g.id), open = ts.filter(k => !k.doneOn);
    return { total: ts.length, done: ts.length - open.length, open: open.length, planned: open.filter(k => listOf(k) === 'planned').length };
  };

  /* ---------- building blocks of actions ---------- */

  const lastPosition = (pred) => {
    const ps = raw.tasks.filter(pred).map(k => k.position);
    return M.between(ps.length ? Math.max(...ps) : null, null);
  };
  // Who on a task: the changes from the current members to the wanted ones.
  function whoOps(taskId, wanted) {
    const cur = raw.task_members.filter(r => r.taskId === taskId), ops = [];
    cur.filter(r => !wanted.includes(r.memberId)).forEach(r => ops.push(del('task_members', r.id)));
    wanted.filter(m => !cur.some(r => r.memberId === m)).forEach(m => ops.push(ins('task_members', { taskId, memberId: m })));
    return ops;
  }
  const outOfAllPlans = taskId => [
    ...raw.block_placements.filter(p => p.taskId === taskId).map(p => del('block_placements', p.id)),
    ...raw.period_placements.filter(p => p.taskId === taskId).map(p => del('period_placements', p.id))
  ];
  // Back to the Inbox: without goal, not done, out of the agenda.
  const toInboxOps = k => [...outOfAllPlans(k.id), upd('tasks', k.id, { goalId: null, doneOn: null, stage: 'inbox', position: lastPosition(x => x.stage === 'inbox') })];

  // Checking off or unchecking, with what follows from it (docs/design.md, Deadlines and repeats).
  // Returns {ops, notes}: notes are things the screen tells the user afterwards.
  function doneOps(k, on, date = td()) {
    const ops = [], notes = [];
    if (on) {
      ops.push(upd('tasks', k.id, { doneOn: date }));
      if (k.repeat && k.deadline && !(k.nextTaskId && task(k.nextTaskId))) {
        const d = M.nextDeadline(k.deadline, k.repeat);
        if (d) {
          const n = { id: newId(), title: k.title, note: k.note, goalId: k.goalId, stage: 'backlog', doneOn: null, deadline: d, repeat: k.repeat, nextTaskId: null, position: lastPosition(x => x.stage === 'backlog') };
          ops.push({ op: 'insert', table: 'tasks', row: n }, ...whoOf(k.id).map(m => ins('task_members', { taskId: n.id, memberId: m })));
          ops[0].fields.nextTaskId = n.id;
          notes.push('repeat');
        }
      }
      return { ops, notes };
    }
    const fields = { doneOn: null };
    const nx = k.nextTaskId && task(k.nextTaskId);
    if (nx && !nx.doneOn) {   // the next repeat goes away again, unless it was already done
      ops.push(...outOfAllPlans(nx.id), ...raw.task_members.filter(r => r.taskId === nx.id).map(r => del('task_members', r.id)), del('tasks', nx.id));
      fields.nextTaskId = null;
    }
    if (k.goalId == null) { ops.push(...toInboxOps(k)); notes.push('inbox'); return { ops, notes }; }
    ops.push(upd('tasks', k.id, fields));
    const g = goal(k.goalId);
    if (g && g.achievedOn) ops.push(upd('goals', g.id, { achievedOn: null }));
    return { ops, notes };
  }
  const merge = parts => ({ ops: parts.flatMap(p => p.ops), notes: parts.flatMap(p => p.notes || []) });
  const run = async ({ ops, notes = [] }) => ({ undo: await apply(ops), notes });

  /* ---------- tasks ---------- */

  async function createTask({ title, note = '', goalId = null, who = [], deadline = null, repeat = null, stage = 'open' }) {
    const id = newId();
    const row = { id, title, note, goalId, stage, doneOn: null, deadline, repeat: deadline ? repeat : null, nextTaskId: null, position: lastPosition(x => x.stage === stage) };
    return run({ ops: [{ op: 'insert', table: 'tasks', row }, ...whoOps(id, who)] });
  }
  async function updateTask(id, { title, note, goalId, who, deadline, repeat }) {
    const k = task(id);
    return run({ ops: [upd('tasks', id, { title, note, goalId, deadline, repeat: deadline ? repeat : null }), ...whoOps(id, who)].concat(goalId !== k.goalId && goal(goalId) && goal(goalId).achievedOn ? [upd('goals', goalId, { achievedOn: null })] : []) });
  }
  const setDone = (id, on) => run(doneOps(task(id), on));

  // To a list in the sidebar: Nog niet ingepland and Backlog take the task out of every plan.
  // With a neighbour (dropped between two tasks), only the position changes as well.
  async function moveToList(id, list, mark = null) {
    const k = task(id), ops = [];
    const pos = mark ? M.positionAt(itemsOf(list).filter(x => x.id !== id), mark.id, mark.after) : undefined;
    if (list === 'done') return run(k.doneOn ? { ops: [] } : doneOps(k, true));
    if (shownList(k) === list) { if (pos !== undefined) ops.push(upd('tasks', id, { position: pos })); return run({ ops }); }
    const parts = [];
    if (k.doneOn) parts.push(doneOps(k, false));
    if (k.goalId == null && k.doneOn) return run(merge(parts));   // went back to the Inbox
    parts.push({ ops: [...outOfAllPlans(id), upd('tasks', id, { stage: list, position: pos !== undefined ? pos : lastPosition(x => x.stage === list) })] });
    const out = merge(parts);
    // doneOps and the stage change both update the task: fold them into one update
    const tu = out.ops.filter(o => o.op === 'update' && o.table === 'tasks' && o.id === id);
    if (tu.length > 1) { tu.slice(1).forEach(o => Object.assign(tu[0].fields, o.fields)); out.ops = out.ops.filter(o => !tu.slice(1).includes(o)); }
    return run(out);
  }

  // Dropping a task in a block on a date, or in a work period (docs/design.md, Planning).
  //   target: {date, blockId} or {period: periodKey}; src: where it was dragged from (a block key
  //   'date|blockId', a period key, or 'new'); srcPeriod: dragged from the period view, where a task
  //   with several blocks in that period moves as one; mark: {id, after} for the position.
  async function plan(taskId, target, src, srcPeriod, mark) {
    const k = task(taskId), I = idx(), ops = [];
    const key = target.period || target.date + '|' + target.blockId;
    const inKey = (k2) => (k2.includes('|') ? I.inBlock(k2) : I.inPeriod(k2));
    const posFor = () => {
      const list = (target.period ? I.inPeriod(key) : I.inBlock(key)).filter(x => x !== taskId).map(id => {
        const p = target.period ? I.periodPlacement(key, id) : I.blockPlacement(key, id);
        return { id, position: p.position };
      });
      return M.positionAt(list, mark ? mark.id : null, mark ? mark.after : true);
    };
    if (src === key) {   // the same block or period: only the order changes
      if (!mark) return run({ ops });
      const p = target.period ? I.periodPlacement(key, taskId) : I.blockPlacement(key, taskId);
      return run({ ops: [upd(target.period ? 'period_placements' : 'block_placements', p.id, { position: posFor() })] });
    }
    const outBlock = bkey => { const p = I.blockPlacement(bkey, taskId); if (p) ops.push(del('block_placements', p.id)); };
    const outPeriod = pkey => { const p = I.periodPlacement(pkey, taskId); if (p) ops.push(del('period_placements', p.id)); };
    const outBlocksIn = per => I.of(taskId).blocks.filter(b => b.date >= per.start && b.date <= per.end).forEach(b => ops.push(del('block_placements', b.id)));
    if (src && src !== 'new') (src.includes('|') ? outBlock : outPeriod)(src);
    if (srcPeriod) { const sp = periodAt(srcPeriod); if (sp) outBlocksIn(sp); }
    // Within one work period a task is in the period itself or on fixed days, never both: the new place wins.
    let per = null;
    if (target.period) { per = periodAt(target.period); if (per) outBlocksIn(per); }
    else { const pr = periodAt(target.date); if (pr) outPeriod(pr.key); }
    const removed = new Set(ops.map(o => o.id));
    const already = target.period ? I.periodPlacement(key, taskId) : I.blockPlacement(key, taskId);
    if (!already || removed.has(already.id)) {
      if (target.period) ops.push(ins('period_placements', { taskId, periodStart: target.period, position: posFor() }));
      else ops.push(ins('block_placements', { taskId, date: target.date, blockId: target.blockId, position: posFor() }));
    }
    const parts = [{ ops }];
    const tf = {};
    if (k.stage === 'backlog') tf.stage = 'open';
    // Planning in the past checks the task off (docs/design.md, Planning).
    const doneOn = M.pastDoneDate(target.period ? { period: per } : { date: target.date });
    if (doneOn && !k.doneOn) {
      const d = doneOps(k, true, doneOn);
      Object.assign(d.ops[0].fields, tf); parts.push(d);
    } else if (Object.keys(tf).length) parts.push({ ops: [upd('tasks', taskId, tf)] });
    return run(merge(parts));
  }
  async function unplanBlock(key, taskId) { const p = idx().blockPlacement(key, taskId); return run({ ops: p ? [del('block_placements', p.id)] : [] }); }
  async function unplanPeriod(key, taskId) { const p = idx().periodPlacement(key, taskId); return run({ ops: p ? [del('period_placements', p.id)] : [] }); }
  // From the period view: out of every block it has in that period.
  async function unplanBlocksInPeriod(periodKey, taskId) {
    const per = periodAt(periodKey); if (!per) return run({ ops: [] });
    return run({ ops: idx().of(taskId).blocks.filter(b => b.date >= per.start && b.date <= per.end).map(b => del('block_placements', b.id)) });
  }

  // Deleting goes to the Bin; one group id keeps things that went together, together.
  const binOp = (table, id, group, at) => ({ ...upd(table, id, { deletedAt: at, deleteGroup: group }) });
  async function binTask(id) {
    const group = newId(), at = nowIso();
    return run({ ops: [...outOfAllPlans(id), binOp('tasks', id, group, at)] });
  }

  /* ---------- inbox ---------- */

  // One self-contained save that may safely be sent twice: the queue for adding without a
  // connection will sit here (docs/design.md, Inbox; Possible future).
  async function addInboxTask({ title, note = '', goalId = null, who = [], deadline = null, repeat = null }) {
    const id = newId();
    const row = { id, title, note, goalId: goalId && goal(goalId) ? goalId : null, stage: 'inbox', doneOn: null, deadline, repeat: deadline ? repeat : null, nextTaskId: null, position: lastPosition(x => x.stage === 'inbox') };
    const ops = [{ op: 'insert', table: 'tasks', row, ifNew: true }, ...who.map(m => ({ op: 'insert', table: 'task_members', row: { id: newId(), taskId: id, memberId: m }, ifNew: true }))];
    return { id, ...(await run({ ops })) };
  }
  // Verwerken: to a goal's In te plannen or Backlog, checked off, or to the Bin.
  async function processInbox(id, to, goalId) {
    const k = task(id);
    if (to === 'deleted') return binTask(id);
    if (to === 'done') {
      // checked off without goal: it stays a finished task without goal (it isn't in any list)
      return run({ ops: [upd('tasks', id, { stage: 'open', doneOn: td(), position: lastPosition(x => x.stage === 'open') })] });
    }
    const g = goalId || k.goalId;
    if (!g) return run({ ops: [] });
    return run({ ops: [upd('tasks', id, { goalId: g, stage: to, position: lastPosition(x => x.stage === to) })] });
  }

  /* ---------- goals and clients ---------- */

  const clientNamed = name => raw.clients.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase()) || null;
  function clientOps(name) {
    if (!name) return { clientId: null, ops: [] };
    const c = clientNamed(name);
    if (c) return { clientId: c.id, ops: [] };
    const o = ins('clients', { name: name.trim() });
    return { clientId: o.row.id, ops: [o] };
  }
  async function createGoal({ name, note = '', clientName = '', hue }) {
    const c = clientOps(clientName);
    return run({ ops: [...c.ops, ins('goals', { name, note, clientId: c.clientId, hue, achievedOn: null })] });
  }
  async function updateGoal(id, { name, note, clientName, hue }) {
    const c = clientOps(clientName), g = goal(id), ops = [...c.ops, upd('goals', id, { name, note, clientId: c.clientId, hue })];
    if (g.clientId && g.clientId !== c.clientId && !raw.goals.some(x => x.id !== id && x.clientId === g.clientId))
      ops.push(binOp('clients', g.clientId, newId(), nowIso()));   // its last goal moved to another client
    return run({ ops });
  }
  // Behaald: open tasks are checked off ('done') or go back to the Inbox ('inbox').
  async function achieveGoal(id, how) {
    const ops = [];
    tasks().filter(k => k.goalId === id && !k.doneOn).forEach(k => {
      if (how === 'done') ops.push(...doneOps(k, true).ops);
      else ops.push(...toInboxOps(k));
    });
    ops.push(upd('goals', id, { achievedOn: td() }));
    return run({ ops });
  }
  const reopenGoal = id => run({ ops: [upd('goals', id, { achievedOn: null })] });
  // Deleting a goal: its tasks go to the Bin with it ('del') or back to the Inbox ('free').
  // A client that loses its last goal goes to the Bin in the same group.
  async function deleteGoal(id, how) {
    const g = goal(id), group = newId(), at = nowIso(), ops = [];
    tasks().filter(k => k.goalId === id).forEach(k => {
      if (how === 'del') ops.push(...outOfAllPlans(k.id), binOp('tasks', k.id, group, at));
      else ops.push(...toInboxOps(k));
    });
    inbox().filter(k => k.goalId === id).forEach(k => ops.push(upd('tasks', k.id, { goalId: null })));
    ops.push(binOp('goals', id, group, at));
    if (g.clientId && !raw.goals.some(x => x.id !== id && x.clientId === g.clientId)) ops.push(binOp('clients', g.clientId, group, at));
    return run({ ops });
  }
  const renameClient = (id, name) => run({ ops: [upd('clients', id, { name })] });

  /* ---------- work blocks ---------- */

  // A change from today: in place for a block made today, otherwise the old one ends yesterday and a
  // new one starts today; tasks planned from today move along (docs/design.md, Work blocks).
  function reviseOps(b, change) {
    const r = M.blockRevision(b, change);
    if (r.inPlace) return { ops: [upd('work_blocks', b.id, change)], id: b.id };
    const nb = ins('work_blocks', { day: b.day, start: b.start, end: b.end, label: b.label, ...change, validFrom: r.newFrom, validTo: null });
    const moves = raw.block_placements.filter(p => p.blockId === b.id && p.date >= r.newFrom).map(p => upd('block_placements', p.id, { blockId: nb.row.id }));
    return { ops: [upd('work_blocks', b.id, { validTo: r.closeOn }), nb, ...moves], id: nb.row.id };
  }
  async function reviseBlock(id, change) { const r = reviseOps(find('work_blocks', id), change); await apply(r.ops); return r.id; }
  async function createBlock(day, start, end) { const o = ins('work_blocks', { day, start, end, label: '', validFrom: td(), validTo: null }); await apply([o]); return o.row.id; }
  // Taken out from today: tasks planned there from today leave the agenda; the past stays.
  function removeBlockOps(b) {
    const ops = raw.block_placements.filter(p => p.blockId === b.id && p.date >= td()).map(p => del('block_placements', p.id));
    ops.push(b.validFrom && b.validFrom >= td() ? del('work_blocks', b.id) : upd('work_blocks', b.id, { validTo: M.addDays(td(), -1) }));
    return ops;
  }
  const removeBlock = id => apply(removeBlockOps(find('work_blocks', id)));
  const clearDay = day => apply(M.currentBlocks(raw.work_blocks, day).flatMap(removeBlockOps));
  // The blocks of one day also on other days: what was there goes, the day's blocks are copied.
  async function copyDay(srcDay, days) {
    const set = M.currentBlocks(raw.work_blocks, srcDay);
    const ops = days.flatMap(d => M.currentBlocks(raw.work_blocks, d).flatMap(removeBlockOps));
    days.forEach(d => set.forEach(b => ops.push(ins('work_blocks', { day: d, start: b.start, end: b.end, label: b.label, validFrom: td(), validTo: null }))));
    return apply(ops);
  }

  /* ---------- work period ---------- */

  // Placements in a period that no longer matches the setting go away.
  function periodCleanOps(segs) {
    return raw.period_placements.filter(p => { const pr = M.periodIn(p.periodStart, segs); return !pr || pr.key !== p.periodStart; }).map(p => del('period_placements', p.id));
  }
  async function setupPeriod(from, length, unit) {
    const seg = ins('period_segments', { from, length, unit });
    return apply([seg, { op: 'upsert', table: 'app_settings', id: 'periodActive', fields: { value: true } }]);
  }
  // Length and start together. Returns an error key, or '' when saved (docs/design.md, Work period).
  async function changePeriod(from, length, unit) {
    const segs = segments(), last = segs[segs.length - 1], futureLast = last.from > td(), solo = segs.length === 1 && futureLast;
    if (!from) return 'period.pick_date';
    if (!solo && from <= td()) return 'period.from_tomorrow';
    if (futureLast && segs.length > 1 && from <= segs[segs.length - 2].from) return 'period.before_previous';
    const lenChanged = length !== last.length || unit !== last.unit, dateChanged = from !== (solo ? last.from : M.nextPeriodStart(segs));
    let ops = [], after;
    if (futureLast) { ops.push(upd('period_segments', last.id, { from, length, unit })); after = segs.map(s => (s.id === last.id ? { ...s, from, length, unit } : s)); }
    else if (lenChanged || dateChanged) { const o = ins('period_segments', { from, length, unit }); ops.push(o); after = [...segs, o.row]; }
    else after = segs;
    ops = ops.concat(periodCleanOps(after));
    await apply(ops);
    return '';
  }
  // Off: all period placements go; tasks only in a period go back to Nog niet ingepland. Returns their count.
  async function setPeriodActive(on) {
    if (!on) {
      const back = tasks().filter(k => !k.doneOn && !idx().of(k.id).blocks.length && idx().of(k.id).periods.length).length;
      await apply([...raw.period_placements.map(p => del('period_placements', p.id)), { op: 'upsert', table: 'app_settings', id: 'periodActive', fields: { value: false } }]);
      return back;
    }
    await apply([{ op: 'upsert', table: 'app_settings', id: 'periodActive', fields: { value: true } }, ...periodCleanOps(segments())]);
    return 0;
  }

  /* ---------- settings, members, agenda ---------- */

  const setSetting = (key, value) => apply([{ op: 'upsert', table: 'app_settings', id: key, fields: { value } }]);
  const setCalendarUrl = url => {
    const c = raw.calendars.find(x => !x.owner);
    return apply([c ? upd('calendars', c.id, { url }) : ins('calendars', { name: 'Team', url, owner: null })]);
  };
  const addMember = (name, color) => apply([ins('members', { name, color, allowed: true, removedAt: null })]);
  const updateMember = (id, fields) => apply([upd('members', id, fields)]);
  const openTasksOf = id => raw.task_members.filter(r => r.memberId === id && task(r.taskId) && !task(r.taskId).doneOn);
  // Taken off open tasks; done tasks keep the name (docs/design.md, Users).
  const removeMember = id => apply([...openTasksOf(id).map(r => del('task_members', r.id)), upd('members', id, { removedAt: nowIso() })]);

  /* ---------- the Bin ---------- */

  const loadBin = () => DataService.loadBin();
  // A group comes back together. A task whose goal is gone goes to the Inbox; a goal brings back its client.
  async function restoreGroup(group, bin) {
    const rows = BINNED.flatMap(t => bin[t].filter(r => r.deleteGroup === group).map(r => ({ t, r })));
    const back = new Set(rows.map(x => x.r.id)), ops = [];
    for (const { t, r } of rows) {
      const f = { deletedAt: null, deleteGroup: null };
      if (t === 'tasks' && r.goalId && !goal(r.goalId) && !back.has(r.goalId)) Object.assign(f, { goalId: null, stage: 'inbox' });
      if (t === 'goals' && r.clientId && !client(r.clientId) && !back.has(r.clientId)) {
        const c = bin.clients.find(x => x.id === r.clientId);
        if (c) ops.push({ op: 'update', table: 'clients', id: c.id, fields: { deletedAt: null, deleteGroup: null } });
      }
      ops.push({ op: 'update', table: t, id: r.id, fields: f });
    }
    await DataService.batch(ops);
    await reload();
  }

  return {
    load, reload, onChange, myId,
    setting, periodActive, periodSetUp,
    idx, task, goal, client, member, whoOf, members, allMembers, clients, goals, openGoals, tasks, inbox, clientOfTask,
    listOf, shownList, dueSoon, isLate, itemsOf, goalStats, blocks, segments, periodAt, periodSetting, blocksOn,
    calendarUrl, plannedFromToday, clientNamed, openTasksOf,
    createTask, updateTask, setDone, moveToList, plan, unplanBlock, unplanPeriod, unplanBlocksInPeriod, binTask,
    addInboxTask, processInbox,
    createGoal, updateGoal, achieveGoal, reopenGoal, deleteGoal, renameClient,
    reviseBlock, createBlock, removeBlock, clearDay, copyDay,
    setupPeriod, changePeriod, setPeriodActive,
    setSetting, setCalendarUrl, addMember, updateMember, removeMember,
    loadBin, restoreGroup
  };
})();
