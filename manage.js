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
 * The rules are in docs/design.md (Work blocks, Work period, Users, Meetings, Bin).
 */

const Manage = (() => {
  const M = Model, { $, esc, cap } = UI;
  const TABS = ['blocks', 'cycles', 'deadlines', 'week', 'users', 'agenda', 'bin', 'look', 'backup'];
  let tab = 'blocks', err = '', selBlock = null, copyTo = [], confirmDel = null, bin = null;
  let win = null;   // the open window, or null
  const body = () => win.querySelector('[data-mbody]');
  const td = () => M.today();

  // The time lists of a block: from early morning to late evening, per quarter (blocks snap to quarters).
  // A block outside that range keeps its own time in the list.
  const TIME_FIRST = 5 * 60, TIME_LAST = 23 * 60 + 45;
  const timeOpts = cur => {
    const ms = []; for (let m = TIME_FIRST; m <= TIME_LAST; m += M.SNAP) ms.push(m);
    if (!ms.includes(cur)) ms.push(cur);
    return ms.sort((x, y) => x - y).map(m => `<option value="${M.hhmm2(m)}" ${m === cur ? 'selected' : ''}>${M.hhmm2(m)}</option>`).join('');
  };
  // The week grid shows the calendar's usual day (config.js dayStart-dayEnd) with an hour of room on
  // either side to drag a block just outside it, and widens for blocks beyond that.
  const GRID_MARGIN_H = 1, GRID_PX_PER_H = 30, DRAG_START_PX = 4;
  let grid = { lo: JAPT_CONFIG.dayStart - GRID_MARGIN_H, px: GRID_PX_PER_H };
  const cur = day => M.currentBlocks(Store.blocks(), day);

  /* ---------- tabs ---------- */

  function blocksTab() {
    const all = cur();
    const lo = Math.max(0, Math.min(JAPT_CONFIG.dayStart - GRID_MARGIN_H, Math.floor(Math.min(...all.map(x => x.start / 60), 24))));
    const hi = Math.min(24, Math.max(JAPT_CONFIG.dayEnd + GRID_MARGIN_H, Math.ceil(Math.max(...all.map(x => x.end / 60), 0)))), PXH = GRID_PX_PER_H;
    grid = { lo, px: PXH };
    const axis = Array.from({ length: hi - lo }, (_, i) => `<span style="top:${i * PXH}px">${lo + i}</span>`).join('');
    const clr = day => (cur(day).length ? `<button type="button" class="wkclr ${confirmDel === 'day' + day ? 'on' : ''}" data-dayclear="${day}" title="${t('blocks.clear_title')}">${t('blocks.clear')}</button>` : '<div class="wkclr"></div>');
    const cols = M.weekOrder().map(day => {
      const bs = cur(day).map(x => `<div class="wkb ${selBlock === x.id ? 'sel' : ''}" data-bsel="${x.id}" style="top:${(x.start / 60 - lo) * PXH}px;height:${(x.end - x.start) / 60 * PXH - 2}px"><div class="hnd t"></div><b>${UI.span(UI.fmt(x.start), UI.fmt(x.end))}</b>${x.label ? `<span>${esc(x.label)}</span>` : ''}<div class="hnd b"></div></div>`).join('');
      return `<div class="wkd"><div class="wkh">${cap(t('wd.' + day))}</div><div class="wkcol" data-day="${day}" style="height:${(hi - lo) * PXH}px;background-size:100% ${PXH}px">${bs}</div>${clr(day)}</div>`;
    }).join('');
    const sel = Store.blocks().find(x => x.id === selBlock && !x.validTo);
    let edit;
    if (sel) {
      const n = Store.plannedFromToday(sel.id), conf = confirmDel === 'b' + sel.id;
      const chips = M.weekOrder().filter(d => d !== sel.day).map(d => `<button type="button" class="wtog ${copyTo.includes(d) ? 'on' : ''}" style="--pc:var(--accent);--pcl:var(--block-line)" data-bcopy="${d}">${cap(t('wd.' + d))}</button>`).join('');
      const rn = copyTo.flatMap(cur).reduce((s, x) => s + Store.plannedFromToday(x.id), 0), cconf = confirmDel === 'copy';
      edit = `<div class="bedit"><div class="msec">${UI.wdLong(sel.day)}</div>
        <div class="mblk"><select data-bs="${sel.id}" aria-label="${t('blocks.start')}">${timeOpts(sel.start)}</select><span class="mto">${t('time.to')}</span><select data-be="${sel.id}" aria-label="${t('blocks.end')}">${timeOpts(sel.end)}</select>
          ${conf ? '' : `<input type="text" data-bl="${sel.id}" value="${esc(sel.label)}" placeholder="${t('blocks.name_ph')}" autocomplete="off">`}
          ${conf ? `<button type="button" class="mdel confirm" data-bdel="${sel.id}">${n ? UI.tn('blocks.sure_tasks', n) : t('form.sure')}</button>`
                 : `<button type="button" class="ico" data-bdel="${sel.id}" title="${t('blocks.delete')}" aria-label="${t('blocks.delete')}">✕</button>`}</div>
        <div class="bcopy"><span class="fl">${t('blocks.copy_label', { day: UI.wdLong(sel.day).toLowerCase() })}</span><div class="wrow">${chips}</div>
          ${copyTo.length ? `<button type="button" class="${cconf ? 'dgo' : 'primary'}" data-bcopygo>${cconf ? UI.tn('blocks.sure_tasks', rn) : t('blocks.copy')}</button>` : ''}</div></div>`;
    } else edit = `<div class="bedit none">${t('blocks.click_hint')}</div>`;
    let dayPanel = '';
    if (confirmDel && confirmDel.startsWith('day')) {
      const day = +confirmDel.slice(3), dbs = cur(day), n = dbs.reduce((s, x) => s + Store.plannedFromToday(x.id), 0);
      dayPanel = `<div class="gconf dayconf"><div class="gstat"><b>${t('blocks.clear_q', { day: UI.wdLong(day) })}</b> ${UI.tn('blocks.clear_n', dbs.length)}${n ? ', ' + UI.tn('blocks.clear_tasks', n) : ''}.</div>
        <div class="gcbtns"><button type="button" data-dayclearno>${t('form.cancel')}</button><button type="button" class="dgo" data-dayclearyes="${day}">${t('blocks.clear')}</button></div></div>`;
    }
    return `<div class="msec big">${t('blocks.title')}</div><p class="mhint">${t('blocks.hint')}</p>
      <p class="mhow">${t('blocks.how')}</p>
      <div class="wk"><div class="wkax"><div class="wkh">&nbsp;</div><div class="wkaxi" style="height:${(hi - lo) * PXH}px">${axis}</div></div>${cols}</div>${dayPanel}${edit}`;
  }

  function cyclesTab() {
    const unitSel = sg => `<select id="mCyU" aria-label="${t('period.unit')}"><option value="7" ${sg.unit !== 'm' && sg.length % 7 === 0 ? 'selected' : ''}>${t('unit.w')}</option><option value="1" ${sg.unit !== 'm' && sg.length % 7 !== 0 ? 'selected' : ''}>${t('unit.d')}</option><option value="m" ${sg.unit === 'm' ? 'selected' : ''}>${t('unit.m')}</option></select>`;
    const lenNum = sg => (sg.unit === 'm' || sg.length % 7 !== 0 ? sg.length : sg.length / 7);
    const intro = `<div class="msec big">${t('period.title')}</div><p class="mhint">${t('period.hint')}</p>`;
    if (!Store.periodSetUp()) {
      return intro + `<label class="f mdl"><span class="fl">${t('period.length')}</span><span class="mlen"><input type="number" id="mCyN" min="1" max="60" step="1" value="2">${unitSel({ length: 14 })}</span></label>
        <label class="f mdl"><span class="fl">${t('period.first_from')}</span><input type="date" id="mCyStart" value="${M.weekFirst(td())}"></label>
        <button type="button" class="primary" data-cymake>${t('period.make')}</button>`;
    }
    const segs = Store.segments(), last = segs[segs.length - 1], started = !(segs.length === 1 && last.from > td()), on = Store.periodActive();
    return intro + (on ? '' : `<p class="mstate">${t('period.off_state')}</p>`) + `<label class="f mdl"><span class="fl">${t('period.length')}</span><span class="mlen"><input type="number" id="mCyN" min="1" max="60" step="1" value="${lenNum(last)}">${unitSel(last)}</span></label>
      <label class="f mdl"><span class="fl">${t(started ? 'period.next_from' : 'period.first_from')}</span><input type="date" id="mCyStart" value="${started ? M.nextPeriodStart(segs) : last.from}"></label>
      ${started && on ? `<p class="mhint">${t('period.change_hint')}</p>` : ''}
      <div class="mact">${on ? `<button type="button" class="primary" data-cysave disabled>${t('period.confirm')}</button><button type="button" data-cytoggle>${t('period.off')}</button>` : `<button type="button" class="primary" data-cytoggle>${t('period.on')}</button>`}</div>
      ${on ? `<p class="mhint">${t('period.off_hint')}</p>` : ''}`;
  }

  const deadlinesTab = () => `<div class="msec big">${t('deadlines.title')}</div><p class="mhint">${t('deadlines.hint')}</p>
    <label class="f mdl"><span class="fl">${t('deadlines.days')}</span><input type="number" id="mDeadlineDays" min="0" max="90" step="1" value="${Store.setting('deadlineDays')}"></label>`;
  const weekTab = () => `<div class="msec big">${t('week.title')}</div><p class="mhint">${t('week.hint')}</p>
    <label class="f mdl"><span class="fl">${t('week.starts')}</span><select id="mWeekStart">${[1, 2, 3, 4, 5, 6, 0].map(n => `<option value="${n}" ${Store.setting('weekStart') === n ? 'selected' : ''}>${UI.wdLong(n)}</option>`).join('')}</select></label>`;

  function usersTab() {
    const rows = Store.members().map(u => {
      const n = Store.openTasksOf(u.id).length, conf = confirmDel === 'u' + u.id;
      return `<div class="musr"><input type="color" data-uc="${u.id}" value="${u.color}" aria-label="${t('users.colour')}"><input type="text" data-un="${u.id}" value="${esc(u.name)}" autocomplete="off">
        <button type="button" class="mdel ${conf ? 'confirm' : ''}" data-udel="${u.id}">${conf ? (n ? UI.tn('users.sure_tasks', n) : t('form.sure')) : t('form.delete')}</button></div>`;
    }).join('');
    // With logins, people are invited in Supabase; here only name and colour (docs/design.md, Users).
    const addForm = DataService.needsLogin ? `<p class="mhint">${t('users.invite_hint')}</p>` : `<form class="madd" id="mUserForm"><div class="f"><input type="text" id="mUserName" placeholder="${t('users.new_ph')}" autocomplete="off"></div><button type="submit" class="primary">${t('users.add')}</button></form>`;
    return `<div class="msec big">${t('users.title')}</div><p class="mhint">${t('users.hint')}</p>` + (rows ? `<div class="mlist">${rows}</div>` : `<div class="mempty">${t('users.none')}</div>`) + addForm;
  }

  const agendaTab = () => `<div class="msec big">${t('agenda.title')}</div><p class="mhint">${t('agenda.hint')}</p>
    <form class="madd" id="mAgendaForm"><div class="f"><input type="url" id="mAgendaUrl" value="${esc(Store.calendarUrl())}" placeholder="https://…" autocomplete="off" spellcheck="false"></div><button type="submit" class="primary">${t('form.save')}</button></form>
    <p class="mhint">${t('agenda.secret')}</p>
    ${Agenda.failed() ? `<p class="merr">${t('agenda.unreachable_long')}</p>` : ''}`;

  function binTab() {
    if (!bin) { loadBin(); return `<div class="msec big">${t('bin.title')}</div><p class="mhint">${t('form.loading')}</p>`; }
    const items = [];
    const groups = new Map();
    ['goals', 'tasks', 'clients'].forEach(tb => bin[tb].forEach(r => { if (!groups.has(r.deleteGroup)) groups.set(r.deleteGroup, []); groups.get(r.deleteGroup).push({ tb, r }); }));
    groups.forEach((rows, gid) => {
      const main = rows.find(x => x.tb === 'goals') || rows.find(x => x.tb === 'tasks') || rows[0];
      const nTasks = rows.filter(x => x.tb === 'tasks').length;
      const at = main.r.deletedAt;
      const what = main.tb === 'goals' ? t('bin.goal') + (nTasks ? ' · ' + UI.tn('count.tasks', nTasks) : '') : main.tb === 'tasks' ? t('bin.task') : t('bin.client');
      items.push({ at, html: `<div class="binrow"><div><b>${esc(main.r.name || main.r.title)}</b><small>${what} · ${t('bin.deleted_on', { d: UI.fmtDay(at.slice(0, 10)) })}</small></div><button type="button" data-restore="${gid}">${t('bin.restore')}</button></div>` });
    });
    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    return `<div class="msec big">${t('bin.title')}</div><p class="mhint">${t('bin.hint', { n: JAPT_CONFIG.binDays })}</p>` + (items.length ? `<div class="mlist">${items.map(x => x.html).join('')}</div>` : `<div class="mempty">${t('bin.empty')}</div>`);
  }
  async function loadBin() { try { bin = await Store.loadBin(); } catch (e) { console.error(e); bin = { goals: [], tasks: [], clients: [] }; } if (tab === 'bin' && win) render(); }

  function lookTab() {
    const cur = App.theme();
    return `<div class="msec big">${t('look.title')}</div><p class="mhint">${t('look.hint')}</p>
      <div class="seg mtabs">${['', 'orville', 'neutral'].map(v => `<button type="button" data-theme="${v}" class="${cur === v ? 'active' : ''}">${t('look.' + (v || 'light'))}</button>`).join('')}</div>`;
  }

  function backupTab() {
    let last = ''; try { last = localStorage.getItem('japt_last_backup') || ''; } catch (e) { /* not stored */ }
    const v = App.versions();
    return `<div class="msec big">${t('backup.title')}</div><p class="mhint">${t('backup.hint')}</p>
      <div class="mact"><button type="button" class="primary" data-backup>${t('backup.export')}</button></div>
      <p class="mhint">${last ? t('backup.last', { d: UI.fmtDay(last.slice(0, 10)) }) : t('backup.never')}</p>
      <div class="msec big">${t('analysis.title')}</div><p class="mhint">${t('analysis.hint')}</p>
      <div class="mact"><button type="button" data-analysis>${t('analysis.export')}</button></div>
      <div class="msec big">${t('version.title')}</div><p class="mhint">${t('version.line', { app: v.app, db: v.db })}</p>`;
  }

  // The field you are in, by its id or its first data- attribute, so it can be found again after drawing.
  function focusSelector(el) {
    if (!el || !body().contains(el)) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const a = [...el.attributes].find(x => x.name.startsWith('data-'));
    return a ? `[${a.name}="${CSS.escape(a.value)}"]` : null;
  }
  function render() {
    if (!win) return;
    const views = { blocks: blocksTab, cycles: cyclesTab, deadlines: deadlinesTab, week: weekTab, users: usersTab, agenda: agendaTab, bin: binTab, look: lookTab, backup: backupTab };
    const fsel = focusSelector(document.activeElement);
    body().innerHTML = `<div class="seg mtabs mtabbar">${TABS.map(k => `<button type="button" data-mtab="${k}" class="${tab === k ? 'active' : ''}">${t('manage.tab.' + k)}</button>`).join('')}</div>`
      + `<div data-merr>${err ? `<div class="merr" role="alert">${esc(err)}</div>` : ''}</div>` + views[tab]();
    const back = fsel && body().querySelector(fsel); if (back) back.focus();
    const dp = body().querySelector('.dayconf'); if (dp) dp.scrollIntoView({ block: 'nearest' });
  }
  // A problem shown above the tab without drawing it again, so what you typed stays.
  const showErr = msg => { err = msg; body().querySelector('[data-merr]').innerHTML = msg ? `<div class="merr" role="alert">${esc(msg)}</div>` : ''; };
  const done = () => { err = ''; App.render(); render(); };

  /* ---------- dragging blocks in the grid ---------- */

  const CLICK_BLOCK_MIN = 60;   // a click in an empty spot makes a block of an hour
  let bd = null;
  function onDown(e) {
    const col = e.target.closest('.wkcol'); if (!col || e.button > 0) return;
    const { lo, px: PXH } = grid, day = +col.dataset.day;
    const rect = col.getBoundingClientRect(), minAt = y => M.snap((lo + (y - rect.top) / PXH) * 60);
    const blk = e.target.closest('.wkb'), id = blk ? blk.dataset.bsel : null, b = id ? Store.blocks().find(x => x.id === id) : null;
    let mode = 'create', ref = { start: minAt(e.clientY), end: minAt(e.clientY) };
    if (b) { mode = e.target.closest('.hnd.t') ? 'top' : e.target.closest('.hnd.b') ? 'bottom' : 'move'; ref = { start: b.start, end: b.end }; }
    bd = { mode, id, day, col, blk, lo, PXH, minAt, startY: e.clientY, ref, moved: false, cand: null, ghost: null };
    e.preventDefault();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
    document.addEventListener('pointercancel', onUp, { once: true });
  }
  function onMove(e) {
    const d = bd; if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < DRAG_START_PX) return;   // a click, not a drag
    d.moved = true;
    const cand = d.mode === 'move'
      ? M.fitBlock(Store.blocks(), d.day, d.id, 'move', d.ref, M.snap(d.ref.start + (e.clientY - d.startY) / d.PXH * 60))
      : M.fitBlock(Store.blocks(), d.day, d.id, d.mode, d.ref, d.minAt(e.clientY));
    if (!cand) return;
    d.cand = cand;
    let el = d.blk;
    if (!el) { if (!d.ghost) { d.ghost = document.createElement('div'); d.ghost.className = 'wkb ghost'; d.col.appendChild(d.ghost); } el = d.ghost; }
    el.style.top = (cand.start / 60 - d.lo) * d.PXH + 'px'; el.style.height = (cand.end - cand.start) / 60 * d.PXH - 2 + 'px';
    el.innerHTML = `<b>${UI.span(UI.fmt(cand.start), UI.fmt(cand.end))}</b>`;
  }
  async function onUp() {
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onUp);
    const d = bd; bd = null; if (!d) return;
    confirmDel = null; err = ''; copyTo = [];
    if (d.mode === 'create') {
      let cand = d.cand;
      if (!d.moved) cand = M.fitBlock(Store.blocks(), d.day, null, 'create', { start: d.ref.start, end: d.ref.start }, d.ref.start + CLICK_BLOCK_MIN);
      if (!cand) { err = t('blocks.no_room'); render(); return; }
      selBlock = await UI.act(() => Store.createBlock(d.day, cand.start, cand.end));
    } else {
      selBlock = d.id;
      if (d.moved && d.cand) selBlock = (await UI.act(() => Store.reviseBlock(d.id, { start: d.cand.start, end: d.cand.end }))) || d.id;
    }
    done();
  }

  /* ---------- clicks and changes ---------- */

  async function onClick(e) {
    const q = sel => e.target.closest(sel);
    const tb = q('[data-mtab]');
    if (tb) { tab = tb.dataset.mtab; confirmDel = null; err = ''; if (tab === 'bin') bin = null; render(); return; }
    if (q('[data-mclose]')) { win.close(); return; }
    const cp = q('[data-bcopy]');
    if (cp) { const d0 = +cp.dataset.bcopy; copyTo = copyTo.includes(d0) ? copyTo.filter(x => x !== d0) : [...copyTo, d0]; confirmDel = null; render(); return; }
    if (q('[data-bcopygo]')) {
      const src = Store.blocks().find(x => x.id === selBlock); if (!src) return;
      if (copyTo.flatMap(cur).some(x => Store.plannedFromToday(x.id)) && confirmDel !== 'copy') { confirmDel = 'copy'; render(); return; }
      const days = copyTo; copyTo = []; confirmDel = null;
      await UI.act(() => Store.copyDay(src.day, days)); done(); return;
    }
    const dc = q('[data-dayclear]');
    if (dc) { confirmDel = confirmDel === 'day' + dc.dataset.dayclear ? null : 'day' + dc.dataset.dayclear; err = ''; render(); return; }
    if (q('[data-dayclearno]')) { confirmDel = null; render(); return; }
    const dy = q('[data-dayclearyes]');
    if (dy) { confirmDel = null; await UI.act(() => Store.clearDay(+dy.dataset.dayclearyes)); if (!Store.blocks().some(x => x.id === selBlock && !x.validTo)) { selBlock = null; copyTo = []; } done(); return; }
    const bdl = q('[data-bdel]');
    if (bdl) {
      const id = bdl.dataset.bdel;
      if (confirmDel !== 'b' + id) { confirmDel = 'b' + id; render(); return; }
      selBlock = null; copyTo = []; confirmDel = null;
      await UI.act(() => Store.removeBlock(id)); done(); return;
    }
    const bs = q('.wkb[data-bsel]');
    if (bs && !bd) { selBlock = bs.dataset.bsel; render(); return; }
    if (q('[data-cymake]')) {
      const { length, unit } = periodForm();
      await UI.act(() => Store.setupPeriod($('mCyStart').value || td(), length, unit)); done(); return;
    }
    if (q('[data-cysave]')) { await applyPeriod(); return; }
    if (q('[data-cytoggle]')) {
      if (!Store.periodActive()) {
        if (!(await applyPeriod(true))) return;   // switching on also takes what you just filled in
        await UI.act(() => Store.setPeriodActive(true)); done(); return;
      }
      const back = await UI.act(() => Store.setPeriodActive(false)); done();
      if (back) UI.toast(UI.tn('toast.back_to_open', back));
      return;
    }
    const ud = q('[data-udel]');
    if (ud) {
      const id = ud.dataset.udel;
      if (confirmDel !== 'u' + id) { confirmDel = 'u' + id; render(); return; }
      confirmDel = null;
      await UI.act(() => Store.removeMember(id)); done(); return;
    }
    const rs = q('[data-restore]');
    if (rs) { await UI.act(() => Store.restoreGroup(rs.dataset.restore, bin)); bin = null; done(); return; }
    const th = q('[data-theme]');
    if (th) { App.setTheme(th.dataset.theme); render(); return; }
    if (q('[data-backup]')) { await UI.act(() => Export.backup()); render(); return; }
    if (q('[data-analysis]')) { Export.analysis(); }
  }
  function periodForm() {
    const n = Math.max(1, Math.min(60, Math.round(+$('mCyN').value) || 1)), u = $('mCyU').value;
    return u === 'm' ? { length: n, unit: 'm' } : { length: n * +u, unit: 'd' };
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
  async function onChange(e) {
    const tg = e.target;
    if (['mCyN', 'mCyU', 'mCyStart'].includes(tg.id)) { const b = body().querySelector('[data-cysave]'); if (b) b.disabled = false; return; }
    if (tg.id === 'mWeekStart') { await UI.act(() => Store.setSetting('weekStart', +tg.value)); done(); return; }
    if (tg.id === 'mDeadlineDays') { const n = Math.max(0, Math.min(90, Math.round(+tg.value) || 0)); tg.value = n; await UI.act(() => Store.setSetting('deadlineDays', n)); App.render(); return; }
    confirmDel = null; err = '';
    const bid = tg.dataset.bs || tg.dataset.be || tg.dataset.bl;
    if (bid) {
      const b = Store.blocks().find(x => x.id === bid); if (!b) return;
      if (tg.dataset.bl !== undefined) { selBlock = await UI.act(() => Store.reviseBlock(b.id, { label: tg.value.trim() })) || b.id; done(); return; }
      // the start moves the whole block, the end changes its length
      const len = b.end - b.start;
      const s0 = tg.dataset.bs ? M.parseHm(tg.value) : b.start, e0 = tg.dataset.be ? M.parseHm(tg.value) : tg.dataset.bs ? s0 + len : b.end;
      const bad = Store.blockProblems(b.id, s0, e0);
      if (bad) { err = t(bad.time); render(); return; }
      selBlock = await UI.act(() => Store.reviseBlock(b.id, { start: s0, end: e0 })) || b.id; done(); return;
    }
    const uid = tg.dataset.un || tg.dataset.uc;
    if (uid) {
      if (tg.dataset.uc) { await UI.act(() => Store.updateMember(uid, { color: tg.value })); done(); return; }
      const v = tg.value.trim(), bad = Store.memberProblems(uid, v);
      if (bad) { showErr(t(bad.name)); return; }
      await UI.act(() => Store.updateMember(uid, { name: v })); done();
    }
  }
  async function onSubmit(e) {
    e.preventDefault();
    if (e.target.id === 'mAgendaForm') {
      const inp = $('mAgendaUrl'), url = inp.value.trim();
      if (UI.showProblems(Store.calendarUrlProblems(url), { url: inp })) return;
      if ((await UI.act(() => Store.setCalendarUrl(url))) === null) return;
      Agenda.reset(); done(); UI.toast(t('agenda.saved')); return;
    }
    const inp = $('mUserName'), v = inp.value.trim();
    if (UI.showProblems(Store.memberProblems(null, v), { name: inp })) return;
    if ((await UI.act(() => Store.addMember(v))) === null) return;   // not saved: the name stays in the field
    done();
  }

  function open() {
    confirmDel = null; err = ''; selBlock = null; copyTo = []; bin = null;
    win = UI.dialog({ cls: 'wide', closeOutside: () => true, onClose: () => { win = null; bd = null; } });
    win.innerHTML = `<div class="mhead"><h3>${t('manage.button')}</h3><button type="button" class="ico" data-mclose title="${t('form.close')}" aria-label="${t('form.close')}">✕</button></div><div data-mbody></div>`;
    win.addEventListener('pointerdown', onDown);
    win.addEventListener('click', onClick);
    win.addEventListener('change', onChange);
    win.addEventListener('input', e => { if (['mCyN', 'mCyU', 'mCyStart'].includes(e.target.id)) { const b = body().querySelector('[data-cysave]'); if (b) b.disabled = false; } });
    win.addEventListener('submit', onSubmit);
    render();
  }
  function init() { $('btnManage').onclick = open; }
  return { init, render };
})();
