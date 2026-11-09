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
 *   - The rules on what may be saved (a task needs a goal, names are unique, ...): screens ask first
 *     (the ...Problems functions) to show it at the field; the actions refuse the same with a RuleError
 *
 * Screens read and write only through the Store; they never see the data layer.
 * Pure rules live in model.js; what each rule means is in docs/design.md.
 */

const Store = (() => {
  const M = Model, { STAGE, LIST } = M;
  let raw = Object.fromEntries(TABLES.map(t => [t, []]));
  let cache = null, listeners = [];

  const nowIso = () => new Date().toISOString();
  const td = () => M.today();

  async function load() {
    const cutoff = new Date(Date.now() - JAPT_CONFIG.binDays * 864e5).toISOString();
    try { await DataService.purgeBin(cutoff); } catch (e) { console.error('Emptying the Bin failed', e); }
    await reload();
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

  // The change that undoes this one, as things are now; null when there is nothing to undo.
  function oppositeOf(o) {
    if (o.op === 'insert') return { op: 'remove', table: o.table, id: o.row.id };
    const old = find(o.table, o.id);
    if (o.op === 'remove') return old ? { op: 'insert', table: o.table, row: old } : null;
    if (old) {
      const fields = Object.fromEntries(Object.keys(o.fields).map(k => [k, old[k] === undefined ? null : old[k]]));
      return { op: 'update', table: o.table, id: o.id, fields };
    }
    return o.op === 'upsert' ? { op: 'remove', table: o.table, id: o.id } : null;
  }
  // Memory takes over the row as it was stored; a removed or binned row leaves memory.
  function followInMemory(o, row) {
    const id = o.op === 'insert' ? o.row.id : o.id, rows = raw[o.table], at = rows.findIndex(r => r.id === id);
    if (o.op === 'remove' || !row || (BINNED_TABLES.includes(o.table) && row.deletedAt)) {
      if (at >= 0) rows.splice(at, 1);
    } else if (at >= 0) rows[at] = row;
    else rows.push(row);
  }

  // Save ops as one batch and bring memory in line with what was stored. Returns the undo.
  async function apply(ops) {
    ops = ops.filter(Boolean);
    if (!ops.length) return async () => {};
    const inverse = [];
    for (const o of ops) { const back = oppositeOf(o); if (back) inverse.unshift(back); }
    const stored = await DataService.batch(ops);
    ops.forEach((o, i) => followInMemory(o, stored[i]));
    changed();
    let undone = false;
    return async () => { if (undone) return; undone = true; await apply(inverse); };
  }

  const ins = (table, row) => ({ op: 'insert', table, row: { id: newId(), ...row } });
  // An update expects the row as it was loaded (docs/design.md, Working at the same time).
  const upd = (table, id, fields) => {
    const r = find(table, id);
    return { op: 'update', table, id, fields, ifChangedAt: r ? r.changedAt : undefined };
  };
  const del = (table, id) => ({ op: 'remove', table, id });
  const settingOp = (key, value) => ({ op: 'upsert', table: 'app_settings', id: key, fields: { value } });

  /* ---------- derived ---------- */

  function build() {
    const members = raw.members;
    const memberOrder = Object.fromEntries(members.map((m, i) => [m.id, i]));
    const who = new Map();
    for (const r of raw.task_members) {
      if (!who.has(r.taskId)) who.set(r.taskId, []);
      who.get(r.taskId).push(r.memberId);
    }
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

  const SETTING_DEFAULTS = {
    weekStart: JAPT_CONFIG.weekStart,
    deadlineDays: JAPT_CONFIG.deadlineDays,
    periodActive: false
  };
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
  const tasks = () => raw.tasks.filter(k => k.stage !== STAGE.INBOX);
  const inbox = () => raw.tasks.filter(k => k.stage === STAGE.INBOX).sort((a, b) => a.position - b.position);
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
  const plannedFromToday = blockId =>
    raw.block_placements.filter(p => p.blockId === blockId && p.date >= td() && task(p.taskId)).length;

  const soonestFirst = (a, b) => {
    if (!dueSoon(a) || !dueSoon(b)) return 0;
    return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
  };
  // Tasks of a list in their manual order; Nog niet ingepland puts due-soon tasks on top, soonest first.
  function itemsOf(list, pass = () => true) {
    const r = tasks().filter(k => shownList(k) === list && pass(k)).sort((a, b) => a.position - b.position);
    if (list === LIST.OPEN) r.sort((a, b) => (+dueSoon(b)) - (+dueSoon(a)) || soonestFirst(a, b));
    return r;
  }
  const goalStats = g => {
    const ts = tasks().filter(k => k.goalId === g.id), open = ts.filter(k => !k.doneOn);
    const planned = open.filter(k => listOf(k) === LIST.PLANNED).length;
    return { total: ts.length, done: ts.length - open.length, open: open.length, planned };
  };

  /* ---------- what may be saved ---------- */

  // A refused change: problems is {field: text key}, for example {goal: 'form.need_goal'}.
  class RuleError extends Error {
    constructor(problems) {
      super('JAPT: not saved, ' + Object.values(problems).join(', '));
      this.code = 'rule';
      this.problems = problems;
    }
  }
  // {field: key or ''} -> only the real problems, or null when everything is fine.
  const problemsOf = o => {
    const p = Object.fromEntries(Object.entries(o).filter(([, v]) => v));
    return Object.keys(p).length ? p : null;
  };
  const refuse = problems => { if (problems) throw new RuleError(problems); };
  const blank = v => !String(v == null ? '' : v).trim();
  const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // Outside the Inbox every task has a goal (docs/design.md, Which list a task is in).
  const taskProblems = ({ title, goalId }, stage) => problemsOf({
    title: blank(title) && 'form.need_task',
    goal: stage !== STAGE.INBOX && !goal(goalId) && 'form.need_goal'
  });
  const goalProblems = ({ name }) => problemsOf({ name: blank(name) && 'form.need_goal_name' });
  const clientProblems = (id, name) => problemsOf({
    name: blank(name) ? 'form.need_name'
      : raw.clients.some(c => c.id !== id && sameName(c.name, name)) && 'client.exists'
  });
  const memberProblems = (id, name) => problemsOf({
    name: blank(name) ? 'users.need_name'
      : members().some(m => m.id !== id && sameName(m.name, name)) && 'users.exists'
  });
  // The agenda link is read by the browser; only https is allowed, an empty link switches it off.
  const calendarUrlProblems = url => problemsOf({
    url: !blank(url) && !/^https:\/\//i.test(url.trim()) && 'agenda.need_https'
  });
  const blockProblems = (id, start, end) => {
    const b = find('work_blocks', id);
    return problemsOf({ time: b ? M.blockProblem(raw.work_blocks, b.day, id, start, end) : '' });
  };

  /* ---------- building blocks of actions ---------- */

  // The position at the end of a stage.
  const lastPosition = stage => {
    const ps = raw.tasks.filter(k => k.stage === stage).map(k => k.position);
    return M.between(ps.length ? Math.max(...ps) : null, null);
  };
  // A new task: the one place that knows every field. A repeat only counts together with a deadline.
  const taskRow = ({ stage, deadline = null, repeat = null, ...fields }) => ({
    id: newId(), note: '', goalId: null, doneOn: null, nextTaskId: null,
    ...fields, stage, deadline, repeat: deadline ? repeat : null, position: lastPosition(stage)
  });
  const peopleOps = (taskId, who) => who.map(m => ins('task_members', { taskId, memberId: m }));
  // Who on a task: the changes from the current members to the wanted ones.
  function whoOps(taskId, wanted) {
    const cur = raw.task_members.filter(r => r.taskId === taskId), ops = [];
    cur.filter(r => !wanted.includes(r.memberId)).forEach(r => ops.push(del('task_members', r.id)));
    return ops.concat(peopleOps(taskId, wanted.filter(m => !cur.some(r => r.memberId === m))));
  }
  const outOfAllPlans = taskId => [
    ...raw.block_placements.filter(p => p.taskId === taskId).map(p => del('block_placements', p.id)),
    ...raw.period_placements.filter(p => p.taskId === taskId).map(p => del('period_placements', p.id))
  ];
  // Back to the Inbox: without goal, not done, out of the agenda.
  const toInboxOps = k => [
    ...outOfAllPlans(k.id),
    upd('tasks', k.id, { goalId: null, doneOn: null, stage: STAGE.INBOX, position: lastPosition(STAGE.INBOX) })
  ];

  // Checking off or unchecking, with what follows from it (docs/design.md, Deadlines and repeats).
  // Returns {ops, notes}: notes are things the screen tells the user afterwards.
  function doneOps(k, on, date = td()) {
    const ops = [], notes = [];
    if (on) {
      ops.push(upd('tasks', k.id, { doneOn: date }));
      if (k.repeat && k.deadline && !(k.nextTaskId && task(k.nextTaskId))) {
        const d = M.nextDeadline(k.deadline, k.repeat);
        if (d) {
          const { title, note, goalId, repeat } = k;
          const n = taskRow({ title, note, goalId, stage: STAGE.BACKLOG, deadline: d, repeat });
          ops.push({ op: 'insert', table: 'tasks', row: n }, ...peopleOps(n.id, whoOf(k.id)));
          ops[0].fields.nextTaskId = n.id;
          notes.push('repeat');
        }
      }
      return { ops, notes };
    }
    const fields = { doneOn: null };
    const nx = k.nextTaskId && task(k.nextTaskId);
    if (nx && !nx.doneOn) {   // the next repeat goes away again, unless it was already done
      const people = raw.task_members.filter(r => r.taskId === nx.id).map(r => del('task_members', r.id));
      ops.push(...outOfAllPlans(nx.id), ...people, del('tasks', nx.id));
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

  async function createTask({ title, note = '', goalId = null, who = [], deadline = null, repeat = null, stage = STAGE.OPEN }) {
    refuse(taskProblems({ title, goalId }, stage));
    const row = taskRow({ title, note, goalId, stage, deadline, repeat });
    return run({ ops: [{ op: 'insert', table: 'tasks', row }, ...whoOps(row.id, who)] });
  }
  async function updateTask(id, { title, note, goalId, who, deadline, repeat }) {
    const k = task(id);
    refuse(taskProblems({ title, goalId }, k.stage));
    const ops = [upd('tasks', id, { title, note, goalId, deadline, repeat: deadline ? repeat : null }), ...whoOps(id, who)];
    // A task moved into an achieved goal reopens that goal.
    if (goalId !== k.goalId && goal(goalId) && goal(goalId).achievedOn) ops.push(upd('goals', goalId, { achievedOn: null }));
    return run({ ops });
  }
  const setDone = (id, on) => run(doneOps(task(id), on));

  // To a list in the sidebar: Nog niet ingepland and Backlog take the task out of every plan.
  // With a neighbour (dropped between two tasks), only the position changes as well.
  async function moveToList(id, list, mark = null) {
    const k = task(id), ops = [];
    const pos = mark ? M.positionAt(itemsOf(list).filter(x => x.id !== id), mark.id, mark.after) : undefined;
    if (list === LIST.DONE) return run(k.doneOn ? { ops: [] } : doneOps(k, true));
    if (shownList(k) === list) {
      if (pos !== undefined) ops.push(upd('tasks', id, { position: pos }));
      return run({ ops });
    }
    const parts = [];
    if (k.doneOn) parts.push(doneOps(k, false));
    if (k.goalId == null && k.doneOn) return run(merge(parts));   // went back to the Inbox
    const position = pos !== undefined ? pos : lastPosition(list);
    parts.push({ ops: [...outOfAllPlans(id), upd('tasks', id, { stage: list, position })] });
    const out = merge(parts);
    // doneOps and the stage change both update the task: fold them into one update
    const tu = out.ops.filter(o => o.op === 'update' && o.table === 'tasks' && o.id === id);
    if (tu.length > 1) {
      tu.slice(1).forEach(o => Object.assign(tu[0].fields, o.fields));
      out.ops = out.ops.filter(o => !tu.slice(1).includes(o));
    }
    return run(out);
  }

  // Dropping a task on a place (docs/design.md, Planning).
  //   to          the place it is dropped on: {date, blockId} or {period}
  //   from        the place it was dragged from, or null when it comes from a list
  //   fromPeriod  dragged from the period view (that period's first day): a task with several blocks
  //               in that period moves as one
  //   mark        {id, after}: next to which task it was dropped, for the order
  const placementTable = place => (place.period ? 'period_placements' : 'block_placements');
  const blocksInPeriod = (taskId, per) => idx().of(taskId).blocks.filter(b => b.date >= per.start && b.date <= per.end);
  async function plan(taskId, to, { from = null, fromPeriod = null, mark = null } = {}) {
    const k = task(taskId), I = idx(), ops = [];
    const posFor = () => {
      const others = I.tasksIn(to).filter(x => x !== taskId).map(id => ({ id, position: I.placement(to, id).position }));
      return M.positionAt(others, mark ? mark.id : null, mark ? mark.after : true);
    };
    if (M.samePlace(from, to)) {   // the same block or period: only the order changes
      return run({ ops: mark ? [upd(placementTable(to), I.placement(to, taskId).id, { position: posFor() })] : [] });
    }
    const drop = (table, id) => { if (!ops.some(o => o.id === id)) ops.push(del(table, id)); };
    const out = place => { const p = I.placement(place, taskId); if (p) drop(placementTable(place), p.id); };
    const outBlocksIn = per => blocksInPeriod(taskId, per).forEach(b => drop('block_placements', b.id));
    if (from) out(from);
    if (fromPeriod) { const sp = periodAt(fromPeriod); if (sp) outBlocksIn(sp); }
    // Within one work period a task is in the period itself or on fixed days, never both: the new place wins.
    let per = null;
    if (to.period) { per = periodAt(to.period); if (per) outBlocksIn(per); }
    else { const pr = periodAt(to.date); if (pr) out({ period: pr.key }); }
    const already = I.placement(to, taskId);
    if (!already || ops.some(o => o.id === already.id)) {
      ops.push(to.period
        ? ins('period_placements', { taskId, periodStart: to.period, position: posFor() })
        : ins('block_placements', { taskId, date: to.date, blockId: to.blockId, position: posFor() }));
    }
    const parts = [{ ops }];
    const tf = {};
    if (k.stage === STAGE.BACKLOG) tf.stage = STAGE.OPEN;
    // Planning in the past checks the task off (docs/design.md, Planning).
    const doneOn = M.pastDoneDate(to.period ? { period: per } : { date: to.date });
    if (doneOn && !k.doneOn) {
      const d = doneOps(k, true, doneOn);
      Object.assign(d.ops[0].fields, tf); parts.push(d);
    } else if (Object.keys(tf).length) parts.push({ ops: [upd('tasks', taskId, tf)] });
    return run(merge(parts));
  }
  async function unplan(place, taskId) {
    const p = idx().placement(place, taskId);
    return run({ ops: p ? [del(placementTable(place), p.id)] : [] });
  }
  // From the period view: out of every block it has in that period.
  async function unplanBlocksInPeriod(periodStart, taskId) {
    const per = periodAt(periodStart);
    return run({ ops: per ? blocksInPeriod(taskId, per).map(b => del('block_placements', b.id)) : [] });
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
    const row = taskRow({ title, note, goalId: goalId && goal(goalId) ? goalId : null, stage: STAGE.INBOX, deadline, repeat });
    const insert = { op: 'insert', table: 'tasks', row };
    const ops = [insert, ...peopleOps(row.id, who)].map(o => ({ ...o, ifNew: true }));
    return { id: row.id, ...(await run({ ops })) };
  }
  // Verwerken: to a goal's In te plannen or Backlog, checked off, or to the Bin.
  async function processInbox(id, to, goalId) {
    const k = task(id);
    if (to === 'deleted') return binTask(id);
    if (to === 'done') {
      // checked off without goal: it stays a finished task without goal (it isn't in any list)
      return run({ ops: [upd('tasks', id, { stage: STAGE.OPEN, doneOn: td(), position: lastPosition(STAGE.OPEN) })] });
    }
    const g = goalId || k.goalId;
    refuse(problemsOf({ goal: !goal(g) && 'form.need_goal' }));   // planning or backlog needs a goal
    return run({ ops: [upd('tasks', id, { goalId: g, stage: to, position: lastPosition(to) })] });
  }

  /* ---------- goals and clients ---------- */

  const clientNamed = name => raw.clients.find(c => sameName(c.name, name)) || null;
  function clientOps(name) {
    if (!name) return { clientId: null, ops: [] };
    const c = clientNamed(name);
    if (c) return { clientId: c.id, ops: [] };
    const o = ins('clients', { name: name.trim() });
    return { clientId: o.row.id, ops: [o] };
  }
  const isLastGoalOfClient = g => !raw.goals.some(x => x.id !== g.id && x.clientId === g.clientId);
  async function createGoal({ name, note = '', clientName = '', hue }) {
    refuse(goalProblems({ name }));
    const c = clientOps(clientName);
    return run({ ops: [...c.ops, ins('goals', { name, note, clientId: c.clientId, hue, achievedOn: null })] });
  }
  async function updateGoal(id, { name, note, clientName, hue }) {
    refuse(goalProblems({ name }));
    const c = clientOps(clientName), g = goal(id);
    const ops = [...c.ops, upd('goals', id, { name, note, clientId: c.clientId, hue })];
    if (g.clientId && g.clientId !== c.clientId && isLastGoalOfClient(g)) {
      ops.push(binOp('clients', g.clientId, newId(), nowIso()));   // its last goal moved to another client
    }
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
    if (g.clientId && isLastGoalOfClient(g)) ops.push(binOp('clients', g.clientId, group, at));
    return run({ ops });
  }
  async function renameClient(id, name) {
    refuse(clientProblems(id, name));
    return run({ ops: [upd('clients', id, { name: name.trim() })] });
  }

  /* ---------- work blocks ---------- */

  const blockOp = (day, fields, validFrom) => ins('work_blocks', { day, ...fields, validFrom, validTo: null });
  // A change from today: in place for a block made today, otherwise the old one ends yesterday and a
  // new one starts today; tasks planned from today move along (docs/design.md, Work blocks).
  function reviseOps(b, change) {
    const r = M.blockRevision(b, change);
    if (r.inPlace) return { ops: [upd('work_blocks', b.id, change)], id: b.id };
    const nb = blockOp(b.day, { start: b.start, end: b.end, label: b.label, ...change }, r.newFrom);
    const moves = raw.block_placements
      .filter(p => p.blockId === b.id && p.date >= r.newFrom)
      .map(p => upd('block_placements', p.id, { blockId: nb.row.id }));
    return { ops: [upd('work_blocks', b.id, { validTo: r.closeOn }), nb, ...moves], id: nb.row.id };
  }
  async function reviseBlock(id, change) {
    const b = find('work_blocks', id);
    if (change.start !== undefined || change.end !== undefined) {
      refuse(blockProblems(id, change.start ?? b.start, change.end ?? b.end));
    }
    const r = reviseOps(b, change);
    await apply(r.ops);
    return r.id;
  }
  async function createBlock(day, start, end) {
    const o = blockOp(day, { start, end, label: '' }, td());
    await apply([o]);
    return o.row.id;
  }
  // Taken out from today: tasks planned there from today leave the agenda; the past stays.
  function removeBlockOps(b) {
    const ops = raw.block_placements.filter(p => p.blockId === b.id && p.date >= td()).map(p => del('block_placements', p.id));
    const madeToday = b.validFrom && b.validFrom >= td();
    ops.push(madeToday ? del('work_blocks', b.id) : upd('work_blocks', b.id, { validTo: M.addDays(td(), -1) }));
    return ops;
  }
  const removeBlock = id => apply(removeBlockOps(find('work_blocks', id)));
  const clearDay = day => apply(M.currentBlocks(raw.work_blocks, day).flatMap(removeBlockOps));
  // The blocks of one day also on other days: what was there goes, the day's blocks are copied.
  async function copyDay(srcDay, days) {
    const set = M.currentBlocks(raw.work_blocks, srcDay);
    const ops = days.flatMap(d => M.currentBlocks(raw.work_blocks, d).flatMap(removeBlockOps));
    days.forEach(d => set.forEach(b => ops.push(blockOp(d, { start: b.start, end: b.end, label: b.label }, td()))));
    return apply(ops);
  }

  /* ---------- work period ---------- */

  // Placements in a period that no longer matches the setting go away.
  function periodCleanOps(segs) {
    const fits = p => { const pr = M.periodIn(p.periodStart, segs); return pr && pr.key === p.periodStart; };
    return raw.period_placements.filter(p => !fits(p)).map(p => del('period_placements', p.id));
  }
  async function setupPeriod(from, length, unit) {
    const seg = ins('period_segments', { from, length, unit });
    return apply([seg, settingOp('periodActive', true)]);
  }
  // The setting as it stands: the last segment, whether it still has to start, and whether it is the only one.
  function periodState() {
    const segs = segments(), last = segs[segs.length - 1], futureLast = last.from > td();
    return { segs, last, futureLast, solo: segs.length === 1 && futureLast };
  }
  // A change takes effect from a period that hasn't started yet (docs/design.md, Work period).
  function periodProblems(from) {
    const { segs, futureLast, solo } = periodState();
    return problemsOf({
      from: !from ? 'period.pick_date'
        : !solo && from <= td() ? 'period.from_tomorrow'
        : futureLast && segs.length > 1 && from <= segs[segs.length - 2].from && 'period.before_previous'
    });
  }
  // Length and start together.
  async function changePeriod(from, length, unit) {
    refuse(periodProblems(from));
    const { segs, last, futureLast, solo } = periodState();
    const lenChanged = length !== last.length || unit !== last.unit;
    const dateChanged = from !== (solo ? last.from : M.nextPeriodStart(segs));
    const ops = [];
    let after = segs;
    if (futureLast) {
      ops.push(upd('period_segments', last.id, { from, length, unit }));
      after = segs.map(s => (s.id === last.id ? { ...s, from, length, unit } : s));
    } else if (lenChanged || dateChanged) {
      const o = ins('period_segments', { from, length, unit });
      ops.push(o);
      after = [...segs, o.row];
    }
    return apply(ops.concat(periodCleanOps(after)));
  }
  // Off: all period placements go; tasks only in a period go back to Nog niet ingepland. Returns their count.
  async function setPeriodActive(on) {
    if (!on) {
      const onlyInPeriod = k => !idx().of(k.id).blocks.length && idx().of(k.id).periods.length;
      const back = tasks().filter(k => !k.doneOn && onlyInPeriod(k)).length;
      await apply([...raw.period_placements.map(p => del('period_placements', p.id)), settingOp('periodActive', false)]);
      return back;
    }
    await apply([settingOp('periodActive', true), ...periodCleanOps(segments())]);
    return 0;
  }

  /* ---------- settings, members, agenda ---------- */

  const setSetting = (key, value) => apply([settingOp(key, value)]);
  function setCalendarUrl(url) {
    refuse(calendarUrlProblems(url));
    const c = raw.calendars.find(x => !x.owner);
    url = url.trim();
    return apply([c ? upd('calendars', c.id, { url }) : ins('calendars', { name: 'Team', url, owner: null })]);
  }
  // A new person gets a colour nobody has yet (model.js, colours of people).
  function addMember(name) {
    refuse(memberProblems(null, name));
    return apply([ins('members', { name: name.trim(), color: M.freshColour(members()), allowed: true, removedAt: null })]);
  }
  function updateMember(id, fields) {
    if (fields.name !== undefined) {
      refuse(memberProblems(id, fields.name));
      fields = { ...fields, name: fields.name.trim() };
    }
    return apply([upd('members', id, fields)]);
  }
  const openTasksOf = id =>
    raw.task_members.filter(r => r.memberId === id && task(r.taskId) && !task(r.taskId).doneOn);
  // Taken off open tasks; done tasks keep the name (docs/design.md, Users).
  const removeMember = id => apply([
    ...openTasksOf(id).map(r => del('task_members', r.id)),
    upd('members', id, { removedAt: nowIso() })
  ]);

  /* ---------- the Bin ---------- */

  const loadBin = () => DataService.loadBin();
  // A group comes back together. A task whose goal is gone goes to the Inbox; a goal brings back its client.
  async function restoreGroup(group, bin) {
    const rows = BINNED_TABLES.flatMap(t => bin[t].filter(r => r.deleteGroup === group).map(r => ({ t, r })));
    const back = new Set(rows.map(x => x.r.id)), ops = [];
    for (const { t, r } of rows) {
      const f = { deletedAt: null, deleteGroup: null };
      if (t === 'tasks' && r.goalId && !goal(r.goalId) && !back.has(r.goalId)) Object.assign(f, { goalId: null, stage: STAGE.INBOX });
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
    load, reload, onChange,
    setting, periodActive, periodSetUp,
    idx, task, goal, client, member, whoOf, members, allMembers, clients, goals, openGoals, tasks, inbox, clientOfTask,
    listOf, shownList, dueSoon, isLate, itemsOf, goalStats, blocks, segments, periodAt, periodSetting, blocksOn,
    calendarUrl, plannedFromToday, clientNamed, openTasksOf,
    taskProblems, goalProblems, clientProblems, memberProblems, calendarUrlProblems, blockProblems, periodProblems,
    createTask, updateTask, setDone, moveToList, plan, unplan, unplanBlocksInPeriod, binTask,
    addInboxTask, processInbox,
    createGoal, updateGoal, achieveGoal, reopenGoal, deleteGoal, renameClient,
    reviseBlock, createBlock, removeBlock, clearDay, copyDay,
    setupPeriod, changePeriod, setPeriodActive,
    setSetting, setCalendarUrl, addMember, updateMember, removeMember,
    loadBin, restoreGroup
  };
})();
