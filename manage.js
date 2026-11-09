/**
 * JAPT Manage - the Beheer window.
 *
 * Responsibilities, one tab each:
 *   - Werkblokken: the team's standard week; click or drag to make, move or resize a block (quarters),
 *     exact times and a name, clearing a day, copying a day to other days. Changes apply from today.
 *   - Werkperiode: setting up, changing (from the next period), switching off and on
 *   - Deadlines: the reminder days.  Week: the first day of the week.
 *   - Gebruikers: name and colour; removing takes someone off open tasks
 *   - Agenda: the agenda link (a setting, never in the code)
 *   - Prullenbak: what was deleted in the last days, to put back
 *   - Weergave: the look on this device.  Back-up: backup and analysis export, and the versions
 *
 * The window is made when it opens and removed when it closes. Redrawing a tab after a change keeps
 * the field you are in. What may be saved is the Store's to say (Store ...Problems).
 * Each tab draws through small functions, and lists its buttons in TAB_CLICKS; onClick is the one dispatcher.
 * The rules are in docs/design.md (Work blocks, Work period, Users, Meetings, Bin).
 */

const Manage = (() => {
  const M = Model, { $, esc, cap, html } = UI;
  const TABS = ['blocks', 'cycles', 'deadlines', 'week', 'users', 'agenda', 'bin', 'look', 'backup'];

  const MIN_PER_H = 60, HOURS_PER_DAY = 24, DAYS_PER_WEEK = 7;
  // The time lists of a block: from early morning to late evening, per quarter (blocks snap to quarters).
  // A block outside that range keeps its own time in the list.
  const TIME_FIRST = 5 * MIN_PER_H, TIME_LAST = 23 * MIN_PER_H + 45;
  // The week grid shows the calendar's usual day (config.js dayStart-dayEnd) with an hour of room on
  // either side to drag a block just outside it, and widens for blocks beyond that.
  const GRID_MARGIN_H = 1, GRID_PX_PER_H = 30, DRAG_START_PX = 4;
  const BLOCK_GAP_PX = 2;             // a block is drawn this much shorter, so neighbours stay apart
  const CLICK_BLOCK_MIN = 60;         // a click in an empty spot makes a block of an hour
  const UNIT = Object.freeze({ MONTHS: 'm', DAYS: 'd' });   // how a period's length is stored
  const PERIOD_MIN_LENGTH = 1, PERIOD_MAX_LENGTH = 60;      // in the unit chosen in the form
  const PERIOD_DEFAULT_WEEKS = 2;     // what a new period starts from
  const DEADLINE_MAX_DAYS = 90;       // the same limit as the setting has in config.js
  const WEEK_START_CHOICES = [1, 2, 3, 4, 5, 6, 0];         // Monday first; day numbers as in Date
  const THEMES = ['', 'orville', 'neutral'];                // '' is the light look
  const BIN_TABLES = ['goals', 'tasks', 'clients'];
  const PERIOD_FIELDS = ['mCyN', 'mCyU', 'mCyStart'];

  let tab = 'blocks', err = '', selBlock = null, copyTo = [], bin = null;
  let win = null;   // the open window, or null
  let grid = { lo: JAPT_CONFIG.dayStart - GRID_MARGIN_H, px: GRID_PX_PER_H };

  // What waits for a second click before it happens: { kind, id } or null. Only one thing at a time.
  const CONFIRM = Object.freeze({ BLOCK: 'block', DAY: 'day', COPY: 'copy', USER: 'user' });
  let confirmDel = null;
  const awaiting = (kind, id) => !!confirmDel && confirmDel.kind === kind && confirmDel.id === id;
  const askConfirm = (kind, id) => { confirmDel = { kind, id }; render(); };

  const body = () => win.querySelector('[data-mbody]');
  const td = () => M.today();
  const currentBlocks = day => M.currentBlocks(Store.blocks(), day);
  const plannedOn = blocks => blocks.reduce((sum, x) => sum + Store.plannedFromToday(x.id), 0);

  /* ---------- pieces every tab uses ---------- */

  const sectionHead = (titleKey, hint) => html`
    <div class="msec big">${t(titleKey)}</div>
    <p class="mhint">${hint}</p>`;
  const errorBox = msg => (msg ? `<div class="merr" role="alert">${esc(msg)}</div>` : '');

  /* ---------- tab: work blocks ---------- */

  function timeOpts(current) {
    const minutes = [];
    for (let m = TIME_FIRST; m <= TIME_LAST; m += M.SNAP) minutes.push(m);
    if (!minutes.includes(current)) minutes.push(current);
    return minutes.sort((x, y) => x - y).map(m => html`
      <option value="${M.hhmm2(m)}" ${m === current ? 'selected' : ''}>${M.hhmm2(m)}</option>`).join('');
  }

  // The hours the grid runs from and to: the usual day, wider for a block outside it.
  function gridHours(blocks) {
    const earliest = Math.floor(Math.min(...blocks.map(x => x.start / MIN_PER_H), HOURS_PER_DAY));
    const latest = Math.ceil(Math.max(...blocks.map(x => x.end / MIN_PER_H), 0));
    return {
      lo: Math.max(0, Math.min(JAPT_CONFIG.dayStart - GRID_MARGIN_H, earliest)),
      hi: Math.min(HOURS_PER_DAY, Math.max(JAPT_CONFIG.dayEnd + GRID_MARGIN_H, latest))
    };
  }
  const blockTop = (b, lo, px) => (b.start / MIN_PER_H - lo) * px;
  const blockHeight = (b, px) => (b.end - b.start) / MIN_PER_H * px - BLOCK_GAP_PX;

  function gridBlock(x, lo) {
    const box = `top:${blockTop(x, lo, GRID_PX_PER_H)}px;height:${blockHeight(x, GRID_PX_PER_H)}px`;
    return html`
      <div class="wkb ${selBlock === x.id ? 'sel' : ''}" data-bsel="${x.id}" style="${box}">
        <div class="hnd t"></div>
        <b>${UI.span(UI.fmt(x.start), UI.fmt(x.end))}</b>
        ${x.label ? `<span>${esc(x.label)}</span>` : ''}
        <div class="hnd b"></div>
      </div>`;
  }

  function dayClearButton(day) {
    if (!currentBlocks(day).length) return '<div class="wkclr"></div>';
    const on = awaiting(CONFIRM.DAY, day) ? 'on' : '';
    return html`
      <button type="button" class="wkclr ${on}" data-dayclear="${day}" title="${t('blocks.clear_title')}">
        ${t('blocks.clear')}
      </button>`;
  }

  function dayColumn(day, lo, hi) {
    const colStyle = `height:${(hi - lo) * GRID_PX_PER_H}px;background-size:100% ${GRID_PX_PER_H}px`;
    return html`
      <div class="wkd">
        <div class="wkh">${cap(t('wd.' + day))}</div>
        <div class="wkcol" data-day="${day}" style="${colStyle}">
          ${currentBlocks(day).map(x => gridBlock(x, lo)).join('')}
        </div>
        ${dayClearButton(day)}
      </div>`;
  }

  function hourAxis(lo, hi) {
    const hour = i => `<span style="top:${i * GRID_PX_PER_H}px">${lo + i}</span>`;
    const hours = Array.from({ length: hi - lo }, (_, i) => hour(i));
    return html`
      <div class="wkax">
        <div class="wkh">&nbsp;</div>
        <div class="wkaxi" style="height:${(hi - lo) * GRID_PX_PER_H}px">${hours.join('')}</div>
      </div>`;
  }

  function blockDeleteButton(sel, tasks) {
    if (awaiting(CONFIRM.BLOCK, sel.id)) {
      return html`
        <button type="button" class="mdel confirm" data-bdel="${sel.id}">
          ${tasks ? UI.tn('blocks.sure_tasks', tasks) : t('form.sure')}
        </button>`;
    }
    const label = t('blocks.delete');
    return html`
      <button type="button" class="ico" data-bdel="${sel.id}" title="${label}" aria-label="${label}">✕</button>`;
  }

  function blockNameField(sel) {
    if (awaiting(CONFIRM.BLOCK, sel.id)) return '';   // the confirmation takes this place in the row
    return html`
      <input type="text" data-bl="${sel.id}" value="${esc(sel.label)}" placeholder="${t('blocks.name_ph')}" 
        autocomplete="off">`;
  }

  const COPY_CHIP_COLOURS = '--pc:var(--accent);--pcl:var(--block-line)';
  const copyChip = d => html`
    <button type="button" class="wtog ${copyTo.includes(d) ? 'on' : ''}" style="${COPY_CHIP_COLOURS}" data-bcopy="${d}">
      ${cap(t('wd.' + d))}
    </button>`;

  function copyGoButton() {
    if (!copyTo.length) return '';
    const asking = awaiting(CONFIRM.COPY);
    const label = asking ? UI.tn('blocks.sure_tasks', plannedOn(copyTo.flatMap(currentBlocks))) : t('blocks.copy');
    return `<button type="button" class="${asking ? 'dgo' : 'primary'}" data-bcopygo>${label}</button>`;
  }

  function copyPanel(sel) {
    const chips = M.weekOrder().filter(d => d !== sel.day).map(copyChip).join('');
    return html`
      <div class="bcopy">
        <span class="fl">${t('blocks.copy_label', { day: UI.wdLong(sel.day).toLowerCase() })}</span>
        <div class="wrow">${chips}</div>
        ${copyGoButton()}
      </div>`;
  }

  function blockEditor() {
    const sel = Store.blocks().find(x => x.id === selBlock && !x.validTo);
    if (!sel) return `<div class="bedit none">${t('blocks.click_hint')}</div>`;
    return html`
      <div class="bedit">
        <div class="msec">${UI.wdLong(sel.day)}</div>
        <div class="mblk">
          <select data-bs="${sel.id}" aria-label="${t('blocks.start')}">${timeOpts(sel.start)}</select>
          <span class="mto">${t('time.to')}</span>
          <select data-be="${sel.id}" aria-label="${t('blocks.end')}">${timeOpts(sel.end)}</select>
          ${blockNameField(sel)}
          ${blockDeleteButton(sel, Store.plannedFromToday(sel.id))}
        </div>
        ${copyPanel(sel)}
      </div>`;
  }

  function dayClearPanel() {
    if (!confirmDel || confirmDel.kind !== CONFIRM.DAY) return '';
    const day = confirmDel.id, blocks = currentBlocks(day), tasks = plannedOn(blocks);
    return html`
      <div class="gconf dayconf">
        <div class="gstat">
          <b>${t('blocks.clear_q', { day: UI.wdLong(day) })}</b> ${UI.tn('blocks.clear_n', blocks.length)}
          ${tasks ? ', ' + UI.tn('blocks.clear_tasks', tasks) : ''}.
        </div>
        <div class="gcbtns">
          <button type="button" data-dayclearno>${t('form.cancel')}</button>
          <button type="button" class="dgo" data-dayclearyes="${day}">${t('blocks.clear')}</button>
        </div>
      </div>`;
  }

  function blocksTab() {
    const { lo, hi } = gridHours(currentBlocks());
    grid = { lo, px: GRID_PX_PER_H };
    return html`
      ${sectionHead('blocks.title', t('blocks.hint'))}
      <p class="mhow">${t('blocks.how')}</p>
      <div class="wk">${hourAxis(lo, hi)}${M.weekOrder().map(day => dayColumn(day, lo, hi)).join('')}</div>
      ${dayClearPanel()}
      ${blockEditor()}`;
  }

  /* ---------- tab: work period ---------- */

  const inWeeks = sg => sg.unit !== UNIT.MONTHS && sg.length % DAYS_PER_WEEK === 0;
  const inDays = sg => sg.unit !== UNIT.MONTHS && sg.length % DAYS_PER_WEEK !== 0;
  const lengthInUnit = sg => (inWeeks(sg) ? sg.length / DAYS_PER_WEEK : sg.length);

  const unitOption = (value, chosen, label) => `<option value="${value}" ${chosen ? 'selected' : ''}>${label}</option>`;
  const unitSelect = sg => html`
    <select id="mCyU" aria-label="${t('period.unit')}">
      ${unitOption(DAYS_PER_WEEK, inWeeks(sg), t('unit.w'))}
      ${unitOption(1, inDays(sg), t('unit.d'))}
      ${unitOption(UNIT.MONTHS, sg.unit === UNIT.MONTHS, t('unit.m'))}
    </select>`;

  const periodLengthField = (number, sg) => html`
    <label class="f mdl">
      <span class="fl">${t('period.length')}</span>
      <span class="mlen">
        <input type="number" id="mCyN" min="${PERIOD_MIN_LENGTH}" max="${PERIOD_MAX_LENGTH}" step="1" value="${number}">
        ${unitSelect(sg)}
      </span>
    </label>`;
  const periodStartField = (labelKey, value) => html`
    <label class="f mdl">
      <span class="fl">${t(labelKey)}</span>
      <input type="date" id="mCyStart" value="${value}">
    </label>`;

  const periodSetupForm = () => html`
    ${periodLengthField(PERIOD_DEFAULT_WEEKS, { length: PERIOD_DEFAULT_WEEKS * DAYS_PER_WEEK })}
    ${periodStartField('period.first_from', M.weekFirst(td()))}
    <button type="button" class="primary" data-cymake>${t('period.make')}</button>`;

  const periodButtons = on => (on
    ? html`
      <button type="button" class="primary" data-cysave disabled>${t('period.confirm')}</button>
      <button type="button" data-cytoggle>${t('period.off')}</button>`
    : `<button type="button" class="primary" data-cytoggle>${t('period.on')}</button>`);

  function periodChangeForm() {
    const segs = Store.segments(), last = segs[segs.length - 1], on = Store.periodActive();
    const started = !(segs.length === 1 && last.from > td());
    const startKey = started ? 'period.next_from' : 'period.first_from';
    const startValue = started ? M.nextPeriodStart(segs) : last.from;
    return html`
      ${on ? '' : `<p class="mstate">${t('period.off_state')}</p>`}
      ${periodLengthField(lengthInUnit(last), last)}
      ${periodStartField(startKey, startValue)}
      ${started && on ? `<p class="mhint">${t('period.change_hint')}</p>` : ''}
      <div class="mact">${periodButtons(on)}</div>
      ${on ? `<p class="mhint">${t('period.off_hint')}</p>` : ''}`;
  }

  const cyclesTab = () => sectionHead('period.title', t('period.hint'))
    + (Store.periodSetUp() ? periodChangeForm() : periodSetupForm());

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
    if (tab === 'bin' && win) render();
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

  /* ---------- drawing ---------- */

  const VIEWS = {
    blocks: blocksTab, cycles: cyclesTab, deadlines: deadlinesTab, week: weekTab, users: usersTab,
    agenda: agendaTab, bin: binTab, look: lookTab, backup: backupTab
  };

  // The field you are in, by its id or its first data- attribute, so it can be found again after drawing.
  function focusSelector(el) {
    if (!el || !body().contains(el)) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const a = [...el.attributes].find(x => x.name.startsWith('data-'));
    return a ? `[${a.name}="${CSS.escape(a.value)}"]` : null;
  }

  const tabButton = k => html`
    <button type="button" data-mtab="${k}" class="${tab === k ? 'active' : ''}">${t('manage.tab.' + k)}</button>`;

  function render() {
    if (!win) return;
    const fsel = focusSelector(document.activeElement);
    body().innerHTML = `<div class="seg mtabs mtabbar">${TABS.map(tabButton).join('')}</div>`
      + `<div data-merr>${errorBox(err)}</div>` + VIEWS[tab]();
    const back = fsel && body().querySelector(fsel);
    if (back) back.focus();
    const dayPanel = body().querySelector('.dayconf');
    if (dayPanel) dayPanel.scrollIntoView({ block: 'nearest' });
  }
  // A problem shown above the tab without drawing it again, so what you typed stays.
  const showErr = msg => {
    err = msg;
    body().querySelector('[data-merr]').innerHTML = errorBox(msg);
  };
  const done = () => { err = ''; App.render(); render(); };

  /* ---------- dragging blocks in the grid ---------- */

  let bd = null;
  function dragModeOf(target, block) {
    if (!block) return 'create';
    if (target.closest('.hnd.t')) return 'top';
    return target.closest('.hnd.b') ? 'bottom' : 'move';
  }
  function onDown(e) {
    const col = e.target.closest('.wkcol');
    if (!col || e.button > 0) return;
    const { lo, px: PXH } = grid, day = +col.dataset.day;
    const rect = col.getBoundingClientRect();
    const minAt = y => M.snap((lo + (y - rect.top) / PXH) * MIN_PER_H);
    const blk = e.target.closest('.wkb'), id = blk ? blk.dataset.bsel : null;
    const b = id ? Store.blocks().find(x => x.id === id) : null;
    const mode = dragModeOf(e.target, b);
    const ref = b ? { start: b.start, end: b.end } : { start: minAt(e.clientY), end: minAt(e.clientY) };
    bd = { mode, id, day, col, blk, lo, PXH, minAt, startY: e.clientY, ref, moved: false, cand: null, ghost: null };
    e.preventDefault();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
    document.addEventListener('pointercancel', onUp, { once: true });
  }

  // The element that shows the drag: the block itself, or a ghost when making a new one.
  function dragElement(d) {
    if (d.blk) return d.blk;
    if (!d.ghost) {
      d.ghost = document.createElement('div');
      d.ghost.className = 'wkb ghost';
      d.col.appendChild(d.ghost);
    }
    return d.ghost;
  }
  function onMove(e) {
    const d = bd;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < DRAG_START_PX) return;   // a click, not a drag
    d.moved = true;
    const target = d.mode === 'move'
      ? M.snap(d.ref.start + (e.clientY - d.startY) / d.PXH * MIN_PER_H)
      : d.minAt(e.clientY);
    const cand = M.fitBlock(Store.blocks(), d.day, d.id, d.mode, d.ref, target);
    if (!cand) return;
    d.cand = cand;
    const el = dragElement(d);
    el.style.top = blockTop(cand, d.lo, d.PXH) + 'px';
    el.style.height = blockHeight(cand, d.PXH) + 'px';
    el.innerHTML = `<b>${UI.span(UI.fmt(cand.start), UI.fmt(cand.end))}</b>`;
  }
  async function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    const d = bd;
    bd = null;
    if (!d) return;
    confirmDel = null; err = ''; copyTo = [];
    if (d.mode === 'create') {
      let cand = d.cand;
      if (!d.moved) {
        const clicked = { start: d.ref.start, end: d.ref.start };
        cand = M.fitBlock(Store.blocks(), d.day, null, 'create', clicked, d.ref.start + CLICK_BLOCK_MIN);
      }
      if (!cand) { err = t('blocks.no_room'); render(); return; }
      selBlock = await UI.act(() => Store.createBlock(d.day, cand.start, cand.end));
    } else {
      selBlock = d.id;
      if (d.moved && d.cand) {
        selBlock = (await UI.act(() => Store.reviseBlock(d.id, { start: d.cand.start, end: d.cand.end }))) || d.id;
      }
    }
    done();
  }

  /* ---------- clicks: any tab ---------- */

  function switchTab(el) {
    tab = el.dataset.mtab;
    confirmDel = null;
    err = '';
    if (tab === 'bin') bin = null;
    render();
  }
  function closeWindow() { win.close(); }

  /* ---------- clicks: work blocks ---------- */

  function toggleCopyDay(el) {
    const day = +el.dataset.bcopy;
    copyTo = copyTo.includes(day) ? copyTo.filter(x => x !== day) : [...copyTo, day];
    confirmDel = null;
    render();
  }
  async function copyToDays() {
    const src = Store.blocks().find(x => x.id === selBlock);
    if (!src) return;
    const hitsTasks = copyTo.flatMap(currentBlocks).some(x => Store.plannedFromToday(x.id));
    if (hitsTasks && !awaiting(CONFIRM.COPY)) { askConfirm(CONFIRM.COPY); return; }
    const days = copyTo;
    copyTo = [];
    confirmDel = null;
    await UI.act(() => Store.copyDay(src.day, days));
    done();
  }
  function toggleDayClear(el) {
    const day = +el.dataset.dayclear;
    confirmDel = awaiting(CONFIRM.DAY, day) ? null : { kind: CONFIRM.DAY, id: day };
    err = '';
    render();
  }
  function cancelDayClear() { confirmDel = null; render(); }
  async function clearDay(el) {
    confirmDel = null;
    await UI.act(() => Store.clearDay(+el.dataset.dayclearyes));
    if (!Store.blocks().some(x => x.id === selBlock && !x.validTo)) { selBlock = null; copyTo = []; }
    done();
  }
  async function deleteBlock(el) {
    const id = el.dataset.bdel;
    if (!awaiting(CONFIRM.BLOCK, id)) { askConfirm(CONFIRM.BLOCK, id); return; }
    selBlock = null; copyTo = []; confirmDel = null;
    await UI.act(() => Store.removeBlock(id));
    done();
  }
  function selectBlock(el) {
    if (bd) return;   // still dragging: the drag decides when it ends
    selBlock = el.dataset.bsel;
    render();
  }

  /* ---------- clicks and changes: work period ---------- */

  function periodForm() {
    const entered = Math.round(+$('mCyN').value) || PERIOD_MIN_LENGTH;
    const n = Math.max(PERIOD_MIN_LENGTH, Math.min(PERIOD_MAX_LENGTH, entered)), unit = $('mCyU').value;
    return unit === UNIT.MONTHS ? { length: n, unit: UNIT.MONTHS } : { length: n * +unit, unit: UNIT.DAYS };
  }
  // Without redrawing when it can't be saved, so what you typed stays.
  async function applyPeriod(quiet) {
    const { length, unit } = periodForm(), from = $('mCyStart').value;
    const bad = Store.periodProblems(from);
    if (bad) { showErr(t(Object.values(bad)[0])); return false; }
    if ((await UI.act(() => Store.changePeriod(from, length, unit))) === null) return false;
    if (!quiet) done();
    return true;
  }
  async function makePeriod() {
    const { length, unit } = periodForm();
    await UI.act(() => Store.setupPeriod($('mCyStart').value || td(), length, unit));
    done();
  }
  async function savePeriod() { await applyPeriod(); }
  async function togglePeriod() {
    if (!Store.periodActive()) {
      if (!(await applyPeriod(true))) return;   // switching on also takes what you just filled in
      await UI.act(() => Store.setPeriodActive(true));
      done();
      return;
    }
    const back = await UI.act(() => Store.setPeriodActive(false));
    done();
    if (back) UI.toast(UI.tn('toast.back_to_open', back));
  }
  function enablePeriodSave() {
    const b = body().querySelector('[data-cysave]');
    if (b) b.disabled = false;
  }

  /* ---------- clicks: users, bin, look, backup ---------- */

  async function deleteUser(el) {
    const id = el.dataset.udel;
    if (!awaiting(CONFIRM.USER, id)) { askConfirm(CONFIRM.USER, id); return; }
    confirmDel = null;
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

  /* ---------- the click tables ---------- */

  const ANY_TAB_CLICKS = [['[data-mtab]', switchTab], ['[data-mclose]', closeWindow]];

  // Per tab: selector -> what a click on it does. The first match wins, in this order.
  const TAB_CLICKS = {
    blocks: [
      ['[data-bcopy]', toggleCopyDay],
      ['[data-bcopygo]', copyToDays],
      ['[data-dayclear]', toggleDayClear],
      ['[data-dayclearno]', cancelDayClear],
      ['[data-dayclearyes]', clearDay],
      ['[data-bdel]', deleteBlock],
      ['.wkb[data-bsel]', selectBlock]
    ],
    cycles: [
      ['[data-cymake]', makePeriod],
      ['[data-cysave]', savePeriod],
      ['[data-cytoggle]', togglePeriod]
    ],
    deadlines: [],
    week: [],
    users: [['[data-udel]', deleteUser]],
    agenda: [],
    bin: [['[data-restore]', restoreFromBin]],
    // button[...]: <html> carries data-theme too once a theme is chosen
    look: [['button[data-theme]', chooseTheme]],
    backup: [['[data-backup]', makeBackup], ['[data-analysis]', makeAnalysis]]
  };

  async function onClick(e) {
    for (const [selector, handle] of [...ANY_TAB_CLICKS, ...TAB_CLICKS[tab]]) {
      const el = e.target.closest(selector);
      if (el) { await handle(el); return; }
    }
  }

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

  async function saveBlock(id, fields) {
    selBlock = await UI.act(() => Store.reviseBlock(id, fields)) || id;
    done();
  }
  // The start moves the whole block, the end changes its length.
  function editedTimes(block, field) {
    if (field.dataset.bs) {
      const start = M.parseHm(field.value);
      return { start, end: start + (block.end - block.start) };
    }
    return { start: block.start, end: M.parseHm(field.value) };
  }
  async function changeBlock(field, id) {
    const b = Store.blocks().find(x => x.id === id);
    if (!b) return;
    if (field.dataset.bl !== undefined) { await saveBlock(b.id, { label: field.value.trim() }); return; }
    const times = editedTimes(b, field);
    const bad = Store.blockProblems(b.id, times.start, times.end);
    if (bad) { err = t(bad.time); render(); return; }
    await saveBlock(b.id, times);
  }

  async function changeUser(field, id) {
    if (field.dataset.uc) {
      await UI.act(() => Store.updateMember(id, { color: field.value }));
      done();
      return;
    }
    const name = field.value.trim(), bad = Store.memberProblems(id, name);
    if (bad) { showErr(t(bad.name)); return; }
    await UI.act(() => Store.updateMember(id, { name }));
    done();
  }

  async function onChange(e) {
    const field = e.target;
    if (PERIOD_FIELDS.includes(field.id)) { enablePeriodSave(); return; }
    if (field.id === 'mWeekStart') { await saveWeekStart(field); return; }
    if (field.id === 'mDeadlineDays') { await saveDeadlineDays(field); return; }
    // Changing anything else also drops a question that was still open and an old message.
    confirmDel = null;
    err = '';
    const blockId = field.dataset.bs || field.dataset.be || field.dataset.bl;
    if (blockId) { await changeBlock(field, blockId); return; }
    const userId = field.dataset.un || field.dataset.uc;
    if (userId) await changeUser(field, userId);
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

  /* ---------- the window ---------- */

  function open() {
    confirmDel = null; err = ''; selBlock = null; copyTo = []; bin = null;
    win = UI.dialog({ cls: 'wide', closeOutside: () => true, onClose: () => { win = null; bd = null; } });
    const closeLabel = t('form.close');
    win.innerHTML = html`
      <div class="mhead">
        <h3>${t('manage.button')}</h3>
        <button type="button" class="ico" data-mclose title="${closeLabel}" aria-label="${closeLabel}">✕</button>
      </div>
      <div data-mbody></div>`;
    win.addEventListener('pointerdown', onDown);
    win.addEventListener('click', onClick);
    win.addEventListener('change', onChange);
    win.addEventListener('input', e => { if (PERIOD_FIELDS.includes(e.target.id)) enablePeriodSave(); });
    win.addEventListener('submit', onSubmit);
    render();
  }
  function init() { $('btnManage').onclick = open; }
  return { init, render };
})();
