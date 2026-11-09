/**
 * JAPT Export - the backup and the analysis export (Beheer, Back-up).
 *
 * Responsibilities:
 *   - Backup: everything exactly as stored, as one JSON file, and the date of the last export on this
 *     device. The free Supabase plan has no restorable backups, so this is the safety net.
 *   - Analysis: one JSON file meant to be read by an AI: per goal its client and tasks, with readable
 *     labels instead of codes, where each task is planned, and the work blocks and period setting.
 *     The Bin and the meetings are left out (docs/design.md, Analysis export).
 */

const Export = (() => {
  const M = Model;
  function download(name, obj) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function backup() {
    const data = await DataService.exportAll();
    download(`japt-backup-${M.today()}.json`, {
      app: 'JAPT', appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data
    });
    try { localStorage.setItem('japt_last_backup', new Date().toISOString()); } catch (e) { /* not stored */ }
  }
  function analysis() {
    const names = ids => ids.map(id => (Store.member(id) || {}).name || '?');
    const taskOut = k => {
      const p = Store.idx().of(k.id);
      return {
        title: k.title, note: k.note || '', who: names(Store.whoOf(k.id)), list: t('list.' + Store.listOf(k)),
        deadline: k.deadline, repeat: k.repeat ? UI.repText(k.repeat) : null, doneOn: k.doneOn, createdAt: k.createdAt,
        plannedOn: p.blocks.map(b => ({ date: b.date, from: M.hhmm(b.start), to: M.hhmm(b.end) })),
        plannedInPeriods: p.periods.map(o => ({ from: o.start, to: o.end })),
        plannedAfterDeadline: Store.isLate(k)
      };
    };
    const goals = Store.goals().map(g => ({
      goal: g.name, client: (Store.client(g.clientId) || { name: t('client.intern') }).name, note: g.note || '',
      achievedOn: g.achievedOn, createdAt: g.createdAt, tasks: Store.tasks().filter(k => k.goalId === g.id).map(taskOut)
    }));
    const blocks = Store.blocks().map(b => ({
      day: UI.wdLong(b.day), from: M.hhmm(b.start), to: M.hhmm(b.end),
      name: b.label || '', validFrom: b.validFrom, validTo: b.validTo
    }));
    const workPeriod = s => ({ from: s.from, length: s.length, unit: s.unit === 'm' ? 'months' : 'days' });
    download(`japt-analyse-${M.today()}.json`, {
      about: 'JAPT (Just A Planning Tool): goals per client with their tasks, where each task was planned, '
        + 'and the team\'s work blocks. Labels are in Dutch.',
      exportedAt: new Date().toISOString(),
      today: M.today(),
      firstDayOfWeek: UI.wdLong(Store.setting('weekStart')),
      deadlineReminderDays: Store.setting('deadlineDays'),
      workPeriods: Store.periodActive() ? Store.segments().map(workPeriod) : null,
      goals,
      tasksWithoutGoal: Store.tasks().filter(k => !Store.goal(k.goalId)).map(taskOut),
      inbox: Store.inbox().map(taskOut),
      workBlocks: blocks
    });
  }
  return { backup, analysis };
})();
