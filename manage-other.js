/**
 * JAPT Manage, the seven small tabs of the Beheer window.
 *
 * Responsibilities, one tab each (drawing, clicks, changes, forms):
 *   - Deadlines: the reminder days
 *   - Week: the first day of the week
 *   - Gebruikers: name and colour; removing takes someone off open tasks
 *   - Agenda: the agenda link (a setting, never in the code)
 *   - Prullenbak: what was deleted in the last days, to put back
 *   - Weergave: the look on this device
 *   - Back-up: backup and analysis export, and the versions
 *
 * Owns bin. The window (manage.js) calls start() once with what every tab needs.
 * The rules are in docs/design.md (Users, Meetings, Bin).
 */

const ManageOther = (() => {
  const { $, esc, html } = UI;

  const DEADLINE_MAX_DAYS = 90;       // the same limit as the setting has in config.js
  const WEEK_START_CHOICES = [1, 2, 3, 4, 5, 6, 0];         // Monday first; day numbers as in Date
  const THEMES = ['', 'orville', 'neutral'];                // '' is the light look
  const BIN_TABLES = ['goals', 'tasks', 'clients'];

  let bin = null;

  // What every tab gets from the window, once, in start().
  let render, done, showErr, showing, awaiting, askConfirm, setConfirm, CONFIRM, sectionHead;
  function start(shell) {
    ({ render, done, showErr, showing, awaiting, askConfirm, setConfirm, CONFIRM, sectionHead } = shell);
  }
  // The bin is fetched again the next time it is shown.
  function reset() { bin = null; }

  /* ---------- tabs: deadlines and week ---------- */

  const deadlinesTab = () => html`
    ${sectionHead('deadlines.title', t('deadlines.hint'))}
    <label class="f mdl">
      <span class="fl">${t('deadlines.days')}</span>
      <input type="number" id="mDeadlineDays" min="0" max="${DEADLINE_MAX_DAYS}" step="1" 
        value="${Store.setting('deadlineDays')}">
    </label>`;

  const weekStartOption = n => html`
    <option value="${n}" ${Store.setting('weekStart') === n ? 'selected' : ''}>${UI.wdLong(n)}</option>`;
  const weekTab = () => html`
    ${sectionHead('week.title', t('week.hint'))}
    <label class="f mdl">
      <span class="fl">${t('week.starts')}</span>
      <select id="mWeekStart">${WEEK_START_CHOICES.map(weekStartOption).join('')}</select>
    </label>`;

  /* ---------- tab: users ---------- */

  function userRow(u) {
    const tasks = Store.openTasksOf(u.id).length, asking = awaiting(CONFIRM.USER, u.id);
    const label = asking ? (tasks ? UI.tn('users.sure_tasks', tasks) : t('form.sure')) : t('form.delete');
    return html`
      <div class="musr">
        <input type="color" data-uc="${u.id}" value="${u.color}" aria-label="${t('users.colour')}">
        <input type="text" data-un="${u.id}" value="${esc(u.name)}" autocomplete="off">
        <button type="button" class="mdel ${asking ? 'confirm' : ''}" data-udel="${u.id}">${label}</button>
      </div>`;
  }

  // With logins, people are invited in Supabase; here only name and colour (docs/design.md, Users).
  const userAddForm = () => (DataService.needsLogin
    ? `<p class="mhint">${t('users.invite_hint')}</p>`
    : html`
      <form class="madd" id="mUserForm">
        <div class="f"><input type="text" id="mUserName" placeholder="${t('users.new_ph')}" autocomplete="off"></div>
        <button type="submit" class="primary">${t('users.add')}</button>
      </form>`);

  function usersTab() {
    const rows = Store.members().map(userRow).join('');
    return sectionHead('users.title', t('users.hint'))
      + (rows ? `<div class="mlist">${rows}</div>` : `<div class="mempty">${t('users.none')}</div>`)
      + userAddForm();
  }

  /* ---------- tab: agenda ---------- */

  const agendaTab = () => html`
    ${sectionHead('agenda.title', t('agenda.hint'))}
    <form class="madd" id="mAgendaForm">
      <div class="f">
        <input type="url" id="mAgendaUrl" value="${esc(Store.calendarUrl())}" placeholder="https://…" 
          autocomplete="off" spellcheck="false">
      </div>
      <button type="submit" class="primary">${t('form.save')}</button>
    </form>
    <p class="mhint">${t('agenda.secret')}</p>
    ${Agenda.failed() ? `<p class="merr">${t('agenda.unreachable_long')}</p>` : ''}`;

  /* ---------- tab: bin ---------- */

  // What was deleted together (a goal with its tasks) is one row: the rows per delete group.
  function binGroups() {
    const groups = new Map();
    BIN_TABLES.forEach(tb => bin[tb].forEach(r => {
      if (!groups.has(r.deleteGroup)) groups.set(r.deleteGroup, []);
      groups.get(r.deleteGroup).push({ tb, r });
    }));
    return groups;
  }

  function binDescription(main, taskCount) {
    if (main.tb === 'goals') return t('bin.goal') + (taskCount ? ' · ' + UI.tn('count.tasks', taskCount) : '');
    return main.tb === 'tasks' ? t('bin.task') : t('bin.client');
  }

  function binItem(rows, gid) {
    const main = rows.find(x => x.tb === 'goals') || rows.find(x => x.tb === 'tasks') || rows[0];
    const taskCount = rows.filter(x => x.tb === 'tasks').length;
    const at = main.r.deletedAt, deletedOn = t('bin.deleted_on', { d: UI.fmtDay(at.slice(0, 10)) });
    return {
      at,
      html: html`
        <div class="binrow">
          <div>
            <b>${esc(main.r.name || main.r.title)}</b>
            <small>${binDescription(main, taskCount)} · ${deletedOn}</small>
          </div>
          <button type="button" data-restore="${gid}">${t('bin.restore')}</button>
        </div>`
    };
  }

  function binTab() {
    if (!bin) {
      loadBin();
      return sectionHead('bin.title', t('form.loading'));
    }
    const items = [...binGroups()].map(([gid, rows]) => binItem(rows, gid));
    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    return sectionHead('bin.title', t('bin.hint', { n: JAPT_CONFIG.binDays }))
      + (items.length
        ? `<div class="mlist">${items.map(x => x.html).join('')}</div>`
        : `<div class="mempty">${t('bin.empty')}</div>`);
  }

  async function loadBin() {
    try {
      bin = await Store.loadBin();
    } catch (e) {
      console.error(e);
      bin = { goals: [], tasks: [], clients: [] };
    }
    if (showing('bin')) render();
  }

  /* ---------- tabs: look and backup ---------- */

  function lookTab() {
    const current = App.theme();
    const buttons = THEMES.map(v => html`
      <button type="button" data-theme="${v}" class="${current === v ? 'active' : ''}">
        ${t('look.' + (v || 'light'))}
      </button>`).join('');
    return html`
      ${sectionHead('look.title', t('look.hint'))}
      <div class="seg mtabs">${buttons}</div>`;
  }

  function lastBackupDate() {
    try {
      return localStorage.getItem('japt_last_backup') || '';
    } catch (e) {
      return '';   // not stored
    }
  }

  function backupTab() {
    const last = lastBackupDate(), v = App.versions();
    return html`
      ${sectionHead('backup.title', t('backup.hint'))}
      <div class="mact"><button type="button" class="primary" data-backup>${t('backup.export')}</button></div>
      <p class="mhint">${last ? t('backup.last', { d: UI.fmtDay(last.slice(0, 10)) }) : t('backup.never')}</p>
      ${sectionHead('analysis.title', t('analysis.hint'))}
      <div class="mact"><button type="button" data-analysis>${t('analysis.export')}</button></div>
      ${sectionHead('version.title', t('version.line', { app: v.app, db: v.db }))}`;
  }

  /* ---------- clicks: users, bin, look, backup ---------- */

  async function deleteUser(el) {
    const id = el.dataset.udel;
    if (!awaiting(CONFIRM.USER, id)) { askConfirm(CONFIRM.USER, id); return; }
    setConfirm(null);
    await UI.act(() => Store.removeMember(id));
    done();
  }
  async function restoreFromBin(el) {
    await UI.act(() => Store.restoreGroup(el.dataset.restore, bin));
    bin = null;
    done();
  }
  function chooseTheme(el) { App.setTheme(el.dataset.theme); render(); }
  async function makeBackup() { await UI.act(() => Export.backup()); render(); }
  function makeAnalysis() { Export.analysis(); }

  /* ---------- changes ---------- */

  async function saveWeekStart(field) {
    await UI.act(() => Store.setSetting('weekStart', +field.value));
    done();
  }
  async function saveDeadlineDays(field) {
    const days = Math.max(0, Math.min(DEADLINE_MAX_DAYS, Math.round(+field.value) || 0));
    field.value = days;
    await UI.act(() => Store.setSetting('deadlineDays', days));
    App.render();
  }

  async function changeUser(field, id) {
    let fields;
    if (field.dataset.uc) fields = { color: field.value };
    else {
      const name = field.value.trim(), bad = Store.memberProblems(id, name);
      if (bad) { showErr(t(bad.name)); return; }
      fields = { name };
    }
    // Not saved: no redraw, so what was typed stays.
    if ((await UI.act(() => Store.updateMember(id, fields))) !== null) done();
  }

  // These save at once and leave the window's question and message; false when it is another field.
  function changeQuiet(field) {
    if (field.id === 'mWeekStart') return saveWeekStart(field);
    if (field.id === 'mDeadlineDays') return saveDeadlineDays(field);
    return false;
  }
  // The window's change event, for the other fields; false when the field is not one of them.
  function change(field) {
    const userId = field.dataset.un || field.dataset.uc;
    return userId ? changeUser(field, userId) : false;
  }

  /* ---------- forms ---------- */

  async function saveAgendaUrl() {
    const inp = $('mAgendaUrl'), url = inp.value.trim();
    if (UI.showProblems(Store.calendarUrlProblems(url), { url: inp })) return;
    if ((await UI.act(() => Store.setCalendarUrl(url))) === null) return;
    Agenda.reset();
    done();
    UI.toast(t('agenda.saved'));
  }
  async function addUser() {
    const inp = $('mUserName'), name = inp.value.trim();
    if (UI.showProblems(Store.memberProblems(null, name), { name: inp })) return;
    if ((await UI.act(() => Store.addMember(name))) === null) return;   // not saved: the name stays in the field
    done();
  }
  async function onSubmit(e) {
    e.preventDefault();
    if (e.target.id === 'mAgendaForm') await saveAgendaUrl();
    else await addUser();
  }

  const VIEWS = {
    deadlines: deadlinesTab, week: weekTab, users: usersTab,
    agenda: agendaTab, bin: binTab, look: lookTab, backup: backupTab
  };

  // Per tab: selector -> what a click on it does. The first match wins, in this order.
  const CLICKS = {
    deadlines: [],
    week: [],
    users: [['[data-udel]', deleteUser]],
    agenda: [],
    bin: [['[data-restore]', restoreFromBin]],
    // button[...]: <html> carries data-theme too once a theme is chosen
    look: [['button[data-theme]', chooseTheme]],
    backup: [['[data-backup]', makeBackup], ['[data-analysis]', makeAnalysis]]
  };

  return { start, reset, views: VIEWS, clicks: CLICKS, changeQuiet, change, onSubmit };
})();
