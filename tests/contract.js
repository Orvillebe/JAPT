/**
 * JAPT data layer contract: what every data layer must do (docs/data-layer.md), checked on the layer itself.
 *
 * Works on any layer: it only uses the functions of the contract, makes its own rows (ids starting with
 * "contract-") and removes them afterwards. Run on the local layer by tests/contract.test.js, on the layer in
 * deployment.js by tests/contract.html.
 *
 * runDataLayerContract(layer, schemaVersion) -> {passed, failures: [text]}
 */

async function runDataLayerContract(layer, schemaVersion) {
  const failures = [];
  let passed = 0;
  const check = (name, ok, detail) => {
    if (ok) passed++;
    else failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
  };
  const tick = () => new Promise(r => setTimeout(r, 5));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  async function thrown(action) {
    try { await action(); return null; } catch (e) { return e; }
  }

  const P = 'contract-';
  const OLD = '2000-01-01T00:00:00.000Z', LONG_BEFORE = '2001-01-01T00:00:00.000Z';
  const ins = (table, row) => ({ op: 'insert', table, row });
  const client = id => ins('clients', { id: P + id, name: 'Contract ' + id });
  const goal = (id, extra = {}) => ins('goals', { id: P + id, name: 'Doel', note: '', clientId: null, hue: 8, achievedOn: null, ...extra });
  const task = (id, goalId, extra = {}) => ins('tasks', {
    id: P + id, title: 'Taak', note: '', goalId: P + goalId, stage: 'open', doneOn: null, deadline: null,
    repeat: null, nextTaskId: null, position: 1024, ...extra
  });
  const has = (rows, id) => rows.some(r => r.id === P + id);
  const made = new Set();   // [table, id] of everything to clean up
  const track = ops => ops.filter(o => o.op === 'insert').forEach(o => made.add(`${o.table}|${o.row.id}`));
  const save = ops => { track(ops); return layer.batch(ops); };

  async function cleanUp() {
    const order = ['block_placements', 'period_placements', 'task_members', 'tasks', 'goals', 'clients', 'work_blocks',
      'period_segments', 'app_settings'];
    const rows = [...made].map(x => x.split('|'));
    rows.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    for (const [table, id] of rows) await thrown(() => layer.batch([{ op: 'remove', table, id }]));
  }

  try {
    check('hasAccess says yes', await layer.hasAccess() === true);
    check('schemaVersion is the version of this code', await layer.schemaVersion() === schemaVersion);

    /* ---------- batch ---------- */

    let out = await save([client('a'), client('b')]);
    check('insert returns the stored rows, in order', out.length === 2 && out[0].id === P + 'a' && out[1].id === P + 'b', out);
    check('a saved row has a version', !!out[0].changedAt, out[0]);
    check('who and when are filled in', !!out[0].createdAt && 'createdBy' in out[0] && 'changedBy' in out[0], out[0]);
    const v1 = out[0].changedAt;
    await tick();

    out = await layer.batch([{ op: 'update', table: 'clients', id: P + 'a', fields: { name: 'Nieuw' } }]);
    check('update returns the new row', out[0].name === 'Nieuw', out[0]);
    check('every saved change gets a new version', out[0].changedAt !== v1, out[0]);
    const v2 = out[0].changedAt;

    let err = await thrown(() => layer.batch([{ op: 'update', table: 'clients', id: P + 'a', fields: { name: 'Fout' }, ifChangedAt: v1 }]));
    check('an old version is refused with code "conflict"', err && err.code === 'conflict', err && err.message);
    out = await layer.batch([{ op: 'update', table: 'clients', id: P + 'a', fields: { name: 'Goed' }, ifChangedAt: v2 }]);
    check('the current version goes through', out[0].name === 'Goed', out[0]);

    err = await thrown(() => layer.batch([
      { op: 'update', table: 'clients', id: P + 'b', fields: { name: 'Half' } },
      { op: 'update', table: 'clients', id: P + 'bestaat-niet', fields: { name: 'x' } }
    ]));
    let all = await layer.loadAll();
    check('updating a row that doesn\'t exist throws', !!err && err.code !== 'conflict', err && err.message);
    check('all or nothing: the first change isn\'t saved', all.clients.find(c => c.id === P + 'b').name === 'Contract b');

    err = await thrown(async () => {
      out = await layer.batch([{ op: 'remove', table: 'clients', id: P + 'bestaat-niet' }]);
    });
    check('removing a row that doesn\'t exist is no error', !err && out[0] === null, err && err.message);

    const twice = { id: P + 'new', name: 'Eén keer' };
    track([ins('clients', twice)]);
    await layer.batch([{ op: 'insert', table: 'clients', row: twice, ifNew: true }]);
    out = await layer.batch([{ op: 'insert', table: 'clients', row: { ...twice, name: 'Twee keer' }, ifNew: true }]);
    all = await layer.loadAll();
    check('ifNew leaves an existing row alone', out[0] === null && all.clients.find(c => c.id === P + 'new').name === 'Eén keer', out);

    made.add(`app_settings|${P}setting`);
    out = await layer.batch([{ op: 'upsert', table: 'app_settings', id: P + 'setting', fields: { value: 1 } }]);
    check('upsert adds', out[0].value === 1, out[0]);
    out = await layer.batch([{ op: 'upsert', table: 'app_settings', id: P + 'setting', fields: { value: true } }]);
    check('upsert changes, and keeps the type of the value', out[0].value === true, out[0]);

    /* ---------- fields ---------- */

    // A batch can add a row and point to it in any order: the placement comes before its block and task.
    const allMembers = all.members;
    const fieldOps = [
      ins('block_placements', { id: P + 'bp', taskId: P + 't1', blockId: P + 'block', date: '2026-11-09', position: 1.5, partStart: 660 }),
      ins('period_placements', { id: P + 'pp', taskId: P + 't1', periodStart: '2026-11-02', position: 3 }),
      ins('task_members', { id: P + 'who', taskId: P + 't1', memberId: allMembers[0].id }),
      task('t1', 'g1', { deadline: '2026-11-20', repeat: '1:w' }),
      goal('g1', { clientId: P + 'a' }),
      ins('work_blocks', { id: P + 'block', day: 1, start: 540, end: 720, label: 'Blok', validFrom: '2026-01-01', validTo: null }),
      ins('period_segments', { id: P + 'seg', from: '2026-11-02', length: 14, unit: 'd' })
    ];
    out = await save(fieldOps);
    check('a batch can refer to rows it adds later', out.length === fieldOps.length, out.length);
    all = await layer.loadAll();
    const pick = (table, id) => all[table].find(r => r.id === P + id);
    const fieldsSurvive = (row, fields) => !!row && Object.entries(fields).every(([k, v]) => same(row[k], v));
    check('work_blocks keep their fields', fieldsSurvive(pick('work_blocks', 'block'),
      { day: 1, start: 540, end: 720, label: 'Blok', validFrom: '2026-01-01', validTo: null }), pick('work_blocks', 'block'));
    check('block_placements keep their fields', fieldsSurvive(pick('block_placements', 'bp'),
      { taskId: P + 't1', blockId: P + 'block', date: '2026-11-09', position: 1.5, partStart: 660 }), pick('block_placements', 'bp'));
    check('period_segments keep their fields', fieldsSurvive(pick('period_segments', 'seg'),
      { from: '2026-11-02', length: 14, unit: 'd' }), pick('period_segments', 'seg'));
    check('period_placements keep their fields', fieldsSurvive(pick('period_placements', 'pp'),
      { taskId: P + 't1', periodStart: '2026-11-02', position: 3 }), pick('period_placements', 'pp'));
    check('tasks keep their fields', fieldsSurvive(pick('tasks', 't1'),
      { goalId: P + 'g1', stage: 'open', deadline: '2026-11-20', repeat: '1:w', doneOn: null }), pick('tasks', 't1'));
    check('goals keep their fields', fieldsSurvive(pick('goals', 'g1'), { clientId: P + 'a', hue: 8, achievedOn: null }), pick('goals', 'g1'));
    check('task_members keep their fields', fieldsSurvive(pick('task_members', 'who'), { taskId: P + 't1' }), pick('task_members', 'who'));

    /* ---------- the Bin ---------- */

    check('loadAll has every table', TABLES.every(t => Array.isArray(all[t])), Object.keys(all));

    await layer.batch([{ op: 'update', table: 'tasks', id: P + 't1', fields: { deletedAt: OLD, deleteGroup: P + 'grp' } }]);
    all = await layer.loadAll();
    check('a binned task isn\'t loaded', !has(all.tasks, 't1'));
    check('nor the rows of a binned task', !has(all.task_members, 'who') && !has(all.block_placements, 'bp') && !has(all.period_placements, 'pp'));
    let bin = await layer.loadBin();
    check('the Bin has clients, goals and tasks', ['clients', 'goals', 'tasks'].every(t => Array.isArray(bin[t])), Object.keys(bin));
    check('the Bin shows the binned task', has(bin.tasks, 't1') && bin.tasks.find(k => k.id === P + 't1').deleteGroup === P + 'grp');
    const backup = await layer.exportAll();
    check('the backup has what is in the Bin', has(backup.tasks, 't1'));

    out = await save([goal('g2'), task('t2', 'g2'), task('t3', 'g2', { deletedAt: OLD })]);
    await layer.batch([{ op: 'update', table: 'goals', id: P + 'g2', fields: { deletedAt: OLD, deleteGroup: P + 'grp2' } }]);
    await layer.purgeBin(LONG_BEFORE);
    all = await layer.loadAll();
    bin = await layer.loadBin();
    const backup2 = await layer.exportAll();
    check('emptying removes what is old enough', !has(backup2.tasks, 't1') && !has(backup2.goals, 'g2') && !has(bin.tasks, 't3'));
    check('and what belongs to those tasks', !has(backup2.block_placements, 'bp') && !has(backup2.task_members, 'who'));
    const orphan = all.tasks.find(k => k.id === P + 't2');
    check('a task alive under a deleted goal goes to the Inbox', !!orphan && orphan.stage === 'inbox' && orphan.goalId === null, orphan);
  } catch (e) {
    failures.push('The test broke off: ' + (e && e.message));
  } finally {
    await cleanUp();
  }
  return { passed, failures };
}

if (typeof module !== 'undefined') module.exports = runDataLayerContract;
