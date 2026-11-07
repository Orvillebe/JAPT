/**
 * JAPT Calendar - the Taken page on the right: Dag, Werkweek, Week, Werkperiode and Lijst.
 *
 * Responsibilities:
 *   - The bar on top: previous, today, next, go to a date, filter (list view), view mode
 *   - Day and week views: work blocks with their tasks, meetings, the work-period lane on top
 *   - The work-period view (periods side by side) and the list view (planned tasks in time order)
 *   - The open task: a card over the task, the rest dimmed, the sidebar showing it
 *   - Dragging tasks: onto blocks, periods, the sidebar lists and the dock (not in the Inbox)
 *   - Jumping from a Plan line in a card to that day or period
 *   - Swiping on a phone to the previous or next day or week
 *
 * Block keys are 'date|blockId'; period keys in the DOM are 'cy@<first day>'.
 * Saving goes through the Store; the rules are in docs/design.md (Planning).
 */

const Calendar = (() => {
  const M = Model, { $, esc, cap, View } = UI;
  const PX = 88;   // pixels per hour
  let H0 = 8, H1 = 18;
  const CYCLES_SHOWN = 4;
  const td = () => M.today();

  /* ---------- periods as shown ---------- */

  // In Werkweek, Saturday and Sunday are hidden: a period's span then starts and ends on a weekday.
  const hiddenWd = () => (View.mode === 'workweek' ? [0, 6] : []);
  function spanText(o) {
    const hw = hiddenWd(); let a = o.start, z = o.end;
    while (a <= z && hw.includes(M.weekday(a))) a = M.addDays(a, 1);
    while (z >= a && hw.includes(M.weekday(z))) z = M.addDays(z, -1);
    if (a > z) { a = o.start; z = o.end; }
    return t('time.span', { a: UI.fmtSp(a), z: UI.fmtSp(z) });
  }
  const moreVisible = (o, days, back) => {
    const hw = hiddenWd();
    for (let ds = back ? M.addDays(days[0], -1) : M.addDays(days[days.length - 1], 1); back ? ds >= o.start : ds <= o.end; ds = M.addDays(ds, back ? -1 : 1)) if (!hw.includes(M.weekday(ds))) return true;
    return false;
  };
  // The period the calendar date is in, and the next ones.
  function cycleWindow() {
    const out = []; let pr = Store.periodAt(View.date);
    while (pr && out.length < CYCLES_SHOWN) { out.push(pr); pr = Store.periodAt(M.addDays(pr.end, 1)); }
    return out;
  }
  const pkey = o => 'cy@' + o.key;

  function calDays() {
    if (View.mode === 'day') return [View.date];
    const week = M.weekDays(View.date);
    return View.mode === 'week' ? week : week.filter(ds => !M.isWeekend(ds));
  }
  const yrTxt = d => (d.slice(0, 4) === td().slice(0, 4) ? '' : ' ' + d.slice(0, 4));

  /* ---------- the bar on top ---------- */

  function renderBar() {
    const days = calDays(), a = days[0], z = days[days.length - 1], yr = z.slice(0, 4);
    const cyc = View.mode === 'cycle' ? Store.periodAt(View.date) : null;
    let title, sub = '';
    $('calPrev').disabled = !!cyc && !Store.periodAt(M.addDays(cyc.start, -1));
    if (cyc) {
      const win = cycleWindow(), f = win[0], l = win[win.length - 1], y = d => d.slice(0, 4);
      title = t('time.span', { a: `${UI.dnum(f.start)} ${UI.mname(f.start)}${y(f.start) !== y(l.end) ? ' ' + y(f.start) : ''}`, z: `${UI.dnum(l.end)} ${UI.mname(l.end)} ${y(l.end)}` });
    } else if (View.mode === 'day') {
      title = UI.PHONE() ? `${UI.fmtDay(a)}${yrTxt(a)}` : `${UI.wdLong(M.weekday(a))} ${UI.dnum(a)} ${UI.mname(a)} ${yr}`;
    } else if (UI.PHONE()) {
      title = UI.mshort(a) === UI.mshort(z) ? t('time.span', { a: UI.dnum(a), z: `${UI.dnum(z)} ${UI.mshort(z)}${yrTxt(z)}` }) : t('time.span', { a: `${UI.dnum(a)} ${UI.mshort(a)}`, z: `${UI.dnum(z)} ${UI.mshort(z)}${yrTxt(z)}` });
    } else {
      title = UI.mname(a) === UI.mname(z) ? t('time.span', { a: UI.dnum(a), z: `${UI.dnum(z)} ${UI.mname(z)} ${yr}` }) : t('time.span', { a: `${UI.dnum(a)} ${UI.mname(a)}`, z: `${UI.dnum(z)} ${UI.mname(z)} ${yr}` });
    }
    // Vandaag is pressed and can't be clicked when you are already there.
    $('calToday').disabled = cyc ? td() >= cyc.start && td() <= cyc.end : days.includes(td());
    if (UI.filterCount()) sub = t('cal.filter_on');
    if (Agenda.failed()) sub += (sub ? ' · ' : '') + t('agenda.unreachable');
    $('calTitle').textContent = title;
    $('calSub').textContent = sub;
    $('calPick').value = View.date;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === View.mode));
  }

  /* ---------- chips ---------- */

  const dim = k => (UI.filterCount() && !UI.passes(k) ? 'dim' : '');
  const part = (n, i) => (n > 1 ? `<span class="p">${i}/${n}</span>` : '');
  function chip(k, src, { side = '', after = '', extra = '' } = {}) {
    return `<div class="chip ${k.doneOn ? 'done' : ''} ${Store.isLate(k) ? 'late' : ''} ${dim(k)}" draggable="true" data-task="${k.id}" data-src="${src}"${extra} style="${UI.taskStyle(k)}">
      <div class="ct">${UI.chk(k)}<span class="t">${esc(k.title)}</span><span class="cside">${UI.whoHtml(k)}${side}</span></div>${after}${UI.metaLine(k)}</div>`;
  }
  const xBtn = (attr, title) => `<button type="button" class="x" ${attr} title="${title}">×</button>`;

  /* ---------- work-period lane above the week ---------- */

  function cyPart(id, key) { const cs = Store.idx().of(id).periods; return cs.length > 1 ? part(cs.length, cs.findIndex(o => o.key === key) + 1) : ''; }
  function renderLane(days, cols) {
    const lane = $('cycleLane'); lane.style.gridTemplateColumns = cols;
    const groups = [];
    days.forEach((ds, i) => { const o = Store.periodAt(ds); if (!o) return; const g = groups[groups.length - 1]; if (g && g.o.key === o.key) g.z = i; else groups.push({ o, a: i, z: i }); });
    lane.innerHTML = groups.map(g => {
      const o = g.o, ids = Store.idx().inPeriod(o.key);
      const chips = ids.map(id => { const k = Store.task(id); return k ? chip(k, pkey(o), { side: cyPart(id, o.key) + xBtn(`data-rm="${pkey(o)}~${id}"`, t('cal.out_of_period')) }) : ''; }).join('');
      return `<div class="cycle ${days[g.a] > o.start && moreVisible(o, days.slice(g.a), true) ? 'cl' : ''} ${days[g.z] < o.end && moreVisible(o, days.slice(0, g.z + 1), false) ? 'cr' : ''}" data-block="${pkey(o)}" style="grid-column:${g.a + 2} / ${g.z + 3};grid-row:1">
        <div class="cyh"><b>${spanText(o)}</b></div>
        <div class="list">${chips || `<div class="empty">${t('cal.drop_here')}</div>`}</div></div>`;
    }).join('');
  }

  /* ---------- day and week ---------- */

  function renderWeek() {
    const days = calDays(), cols = `56px repeat(${days.length},minmax(0,1fr))`;
    const headEl = $('head'), bodyEl = $('body');
    headEl.style.gridTemplateColumns = cols; bodyEl.style.gridTemplateColumns = cols;
    headEl.innerHTML = '<div></div>' + days.map(ds => `<div class="${ds === td() ? 'today' : ''}">${cap(UI.wd(ds))}<small>${UI.dnum(ds)} ${UI.mshort(ds)}</small></div>`).join('');
    // The hours follow the blocks and meetings, at least dayStart to dayEnd (config.js).
    const bs = days.flatMap(Store.blocksOn), ms = days.flatMap(Agenda.on);
    H0 = Math.min(JAPT_CONFIG.dayStart, Math.floor(Math.min(...bs.map(b => b.start / 60), ...ms.map(m => m.start / 60), 99)));
    H1 = Math.max(JAPT_CONFIG.dayEnd, Math.ceil(Math.max(...bs.map(b => b.end / 60), ...ms.map(m => m.end / 60), 0)));
    let times = '';
    for (let h = H0; h <= H1; h++) times += `<span style="top:${(h - H0) * PX}px">${h}:00</span>`;
    let html = `<div class="times" style="height:${(H1 - H0) * PX}px">${times}</div>`;
    for (const ds of days) {
      let inner = '';
      for (const m of Agenda.on(ds)) inner += `<div class="meeting" style="top:${(m.start / 60 - H0) * PX}px;height:${Math.max(18, (m.end - m.start) / 60 * PX)}px"><b>${esc(m.title)}</b>${UI.span(UI.fmt(m.start), UI.fmt(m.end))}</div>`;
      const blocks = Store.blocksOn(ds);
      for (const b of blocks) {
        const key = ds + '|' + b.id, ids = Store.idx().inBlock(key);
        const chips = ids.map(id => {
          const k = Store.task(id); if (!k) return '';
          const bl = Store.idx().of(id).blocks, pos = bl.findIndex(x => x.key === key) + 1;
          return chip(k, key, { side: part(bl.length, pos) + xBtn(`data-rm="${key}~${id}"`, t('cal.out_of_block')) });
        }).join('');
        inner += `<div class="block" data-block="${key}" style="top:${(b.start / 60 - H0) * PX}px;height:${(b.end - b.start) / 60 * PX}px">
          <div class="bh">${b.label ? `<span>${esc(b.label)}</span>` : ''}<span>${UI.span(UI.fmt(b.start), UI.fmt(b.end))}</span></div>
          <div class="list">${chips || `<div class="empty">${t('cal.drop_here')}</div>`}</div></div>`;
      }
      html += `<div class="col ${ds === td() ? 'today' : ''} ${blocks.length ? '' : 'off'} ${ds < td() ? 'past' : ''}" style="--px:${PX}px;height:${(H1 - H0) * PX}px">${inner}</div>`;
    }
    bodyEl.innerHTML = html;
    renderLane(days, cols);
    fitBlocks();
  }
  // Blocks where the tasks don't fit get compact rows instead of a scrollbar.
  function fitBlocks() {
    document.querySelectorAll('#body .block').forEach(b => {
      b.classList.remove('tight', 'snug');
      const l = b.querySelector('.list'), over = () => l && l.scrollHeight > l.clientHeight + 1;
      if (over()) { b.classList.add('snug'); if (over()) { b.classList.remove('snug'); b.classList.add('tight'); } }
    });
  }

  /* ---------- work-period view ---------- */

  function cyHintSync() {   // phone: the title shows the period in view (1 of 4)
    if (!UI.PHONE()) return;
    const cv = $('cycleView'), win = cycleWindow(); if (!cv || !win.length) return;
    const n = win.length, i = Math.min(n - 1, cv.clientWidth ? Math.round(cv.scrollLeft / cv.clientWidth) : 0), o = win[i], y = d => d.slice(0, 4);
    $('calTitle').textContent = t('time.span', { a: `${UI.dnum(o.start)} ${UI.mshort(o.start)}${y(o.start) !== y(o.end) ? ' ' + y(o.start) : ''}`, z: `${UI.dnum(o.end)} ${UI.mshort(o.end)}${yrTxt(o.end)}` });
    $('calSub').textContent = (n > 1 ? `${i > 0 ? '‹ ' : ''}${t('cal.n_of', { i: i + 1, n })}${i < n - 1 ? ' ›' : ''}` : '') + (UI.filterCount() ? (n > 1 ? ' · ' : '') + t('cal.filter_on') : '');
  }
  function renderCycleView() {
    const win = cycleWindow(), tpl = win.map(o => `minmax(150px,${o.weight}fr)`).join(' ');
    const head = win.map(o => `<div class="${td() >= o.start && td() <= o.end ? 'today' : ''}">${UI.fmtDay(o.start)}<small>${t('time.until', { z: UI.fmtSp(o.end) })}</small></div>`).join('');
    const chipHtml = (id, src, dated, per) => {
      const k = Store.task(id); if (!k) return '';
      const mine = dated ? Store.idx().of(id).blocks.filter(b => b.date >= per.start && b.date <= per.end) : [];
      const day = mine.length ? `<div class="meta"><div class="mrow plan"><span class="k">${t(mine.length > 1 ? 'meta.days' : 'meta.day')}</span><span class="v">${mine.map(b => `${UI.fmtDay(b.date)} · ${UI.span(UI.fmt(b.start), UI.fmt(b.end))}`).join('<br>')}</span></div></div>` : '';
      return chip(k, src, {
        side: (dated ? '' : cyPart(id, per.key)) + xBtn(dated ? `data-rmall="${pkey(per)}~${id}"` : `data-rm="${src}~${id}"`, t(dated ? (mine.length > 1 ? 'cal.out_of_blocks' : 'cal.out_of_block') : 'cal.out_of_period')),
        after: day, extra: dated ? ` data-srcp="${pkey(per)}"` : ''
      });
    };
    const cols = win.map(o => {
      // first the period's own tasks (free to order), then the tasks on a block (fixed on their day)
      const first = new Map();
      for (let d = o.start; d <= o.end; d = M.addDays(d, 1)) for (const b of Store.blocksOn(d)) for (const id of Store.idx().inBlock(d + '|' + b.id)) if (!first.has(id)) first.set(id, d + '|' + b.id);
      const dated = [...first].map(([id, src]) => chipHtml(id, src, true, o));
      const own = Store.idx().inPeriod(o.key).map(id => chipHtml(id, pkey(o), false, o)).join('');
      const body = (own ? `<div class="cyown">${own}</div>` : '') + (dated.length && own ? `<div class="cysep">${t('cal.on_fixed_days')}</div>` : '') + (dated.length ? `<div class="cydated">${dated.join('')}</div>` : '');
      return `<div class="cycol ${td() >= o.start && td() <= o.end ? 'today' : ''}"><div class="cyblock" data-block="${pkey(o)}">${body || `<div class="empty">${t('cal.drop_here')}</div>`}</div></div>`;
    }).join('');
    $('cycleView').innerHTML = `<div class="cyhead" style="--n:${win.length};grid-template-columns:${tpl}">${head}</div><div class="cybody" style="--n:${win.length};grid-template-columns:${tpl}">${cols}</div>`;
    cyHintSync();
  }

  /* ---------- list view ---------- */

  // Planned tasks in time order (per period first the fixed days, then the period itself), then the
  // backlog. The order within a block, a period and the backlog is your own order.
  function renderListFilter() {
    UI.msRender('lfWho', 'who', 'list'); UI.msRender('lfGoal', 'goal', 'list'); UI.msRender('lfClient', 'client', 'list');
    const q = $('lfQ'); if (document.activeElement !== q) q.value = View.filter.q;
    const fc = UI.filterCount(), lt = $('lfToggle'), cb = lt.querySelector('.fcount');
    $('lfClear').disabled = fc === 0;
    lt.classList.toggle('active', fc > 0); cb.hidden = !fc; cb.textContent = fc;
    $('lFilter').classList.toggle('open', !!listFilterOpen); lt.setAttribute('aria-expanded', !!listFilterOpen);
  }
  let listFilterOpen = false;
  function renderListView() {
    renderListFilter();
    const ok = id => { const k = Store.task(id); return k && !k.doneOn && UI.passes(k); };
    const card = id => UI.taskCard(Store.task(id), { noPlan: true });
    const I = Store.idx(), ev = [];
    const dates = [...new Set(Store.tasks().flatMap(k => (ok(k.id) ? I.of(k.id).blocks : []).map(b => b.date)))];
    dates.forEach(d => { const o = Store.periodAt(d); ev.push({ pos: o ? o.start : d, per: o, type: 0, date: d }); });
    const pers = new Map();
    Store.tasks().forEach(k => { if (ok(k.id)) I.of(k.id).periods.forEach(o => pers.set(o.key, o)); });
    pers.forEach(o => ev.push({ pos: o.start, per: o, type: 1, key: o.key }));
    ev.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.type - b.type || (a.date || '').localeCompare(b.date || '')));
    const dayHtml = d => {
      const ids = [...new Set(Store.blocksOn(d).flatMap(b => I.inBlock(d + '|' + b.id)))].filter(ok);
      return `<div class="lgrp"><h4 class="${d === td() ? 'today' : ''}">${UI.fmtDay(d)}${d === td() ? `<span>${t('cal.today_small')}</span>` : ''}</h4><div class="list-tasks">${ids.map(card).join('')}</div></div>`;
    };
    let html = '', i = 0;
    while (i < ev.length) {
      const o = ev[i].per, grp = [], same = e => (o ? !!e.per && e.per.key === o.key : !e.per);
      while (i < ev.length && same(ev[i])) { grp.push(ev[i]); i++; }
      const inner = grp.map(e => (e.type === 0 ? dayHtml(e.date) : `<div class="lgrp"><h4>${t('cal.whole_period')}</h4><div class="list-tasks">${I.inPeriod(e.key).filter(ok).map(card).join('')}</div></div>`)).join('');
      html += o ? `<section class="lsec per"><h3>${t('meta.period')} ${spanText(o)}${td() >= o.start && td() <= o.end ? `<small>${t('cal.running')}</small>` : ''}</h3>${inner}</section>` : `<section class="lsec">${inner}</section>`;
    }
    const bk = Store.itemsOf('backlog', UI.passes);
    if (bk.length) html += `<section class="lsec"><h3>${t('list.backlog')}<small>${bk.length}</small></h3><div class="list-tasks">${bk.map(k => UI.taskCard(k)).join('')}</div></section>`;
    $('listView').innerHTML = html || `<div class="none-msg">${t('cal.list_empty')}</div>`;
  }

  /* ---------- render ---------- */

  function render() {
    if (View.mode === 'cycle' && !Store.periodActive()) View.mode = 'workweek';   // without an active period that view doesn't exist
    $('modeCycle').hidden = !Store.periodActive();
    App.syncSide();
    const wv = $('weekView'), inCy = View.mode === 'cycle';
    wv.classList.toggle('cymode', inCy);
    wv.classList.toggle('listmode', View.mode === 'list');
    wv.classList.toggle('daymode', View.mode === 'day');
    wv.classList.toggle('wkmode', View.mode === 'week' || View.mode === 'workweek');
    if (inCy && !Store.periodAt(View.date)) View.date = Store.segments()[0].from;
    closePop();   // before the views are redrawn: the open card lives in a column that is about to be replaced
    Agenda.ensure(View.mode === 'cycle' || View.mode === 'list' ? [] : calDays());
    renderBar();
    if (inCy) renderCycleView();
    else if (View.mode === 'list') renderListView();
    else renderWeek();
    reapplyFocus();
  }

  /* ---------- the open task ---------- */

  // Click on a task in the calendar: a card with everything, the rest dims, the sidebar shows the task
  // and remembers where it was. focusHost: after a jump, only the task in that block or period is marked.
  let focusId = null, focusHost = null, savedSide = null, jumpHold = null;
  const pop = () => $('pop');
  function closePop(restore = false) {
    const was = focusId !== null;
    jumpHold = null;
    // The card sits inside a day column while open; parked back under <body> when closed, so redrawing the
    // calendar never removes it (that broke every later drag: dragstart closes the card first).
    const p = pop(); p.hidden = true; p.innerHTML = ''; delete p.dataset.task;
    if (p.parentElement !== document.body) document.body.appendChild(p);
    focusId = null; reapplyFocus();
    if (was && restore && savedSide) Tasks.restoreSide(savedSide);
    savedSide = null;
  }
  function openPop(el) {
    const id = el.dataset.task, k = Store.task(id); if (!k) return;
    const bl = Store.idx().of(id).blocks, p = pop();
    p.setAttribute('style', UI.taskStyle(k)); p.dataset.task = id;
    p.innerHTML = `<div class="pt">${UI.chk(k)}<b>${esc(k.title)}</b>${UI.whoHtml(k)}<button type="button" class="pen" data-edit="${id}" title="${t('task.edit')}">✎</button></div>
      ${k.note ? `<div class="pd">${esc(k.note)}</div>` : ''}${UI.metaLine(k)}
      ${bl.length > 1 ? `<div class="pn"><div class="k">${t('pop.also_on')}</div>${bl.filter(b => b.key !== el.dataset.src).map(b => `<div class="pr"><span class="pday">${UI.fmtDay(b.date)}</span><span>${UI.span(UI.fmt(b.start), UI.fmt(b.end))}</span></div>`).join('')}</div>` : ''}`;
    const col = el.closest('.col') || el.closest('.cycles') || el.closest('.cyblock'), colR = col.getBoundingClientRect(), r = el.getBoundingClientRect();
    const wr = $('weekView').getBoundingClientRect(), w = Math.max(r.width, 270);
    let left = r.left - colR.left;
    const over = r.left + w - (wr.right - 6); if (over > 0) left -= over;
    p.style.width = w + 'px'; p.style.left = left + 'px'; p.style.top = (r.top - colR.top) + 'px';
    col.appendChild(p); p.hidden = false;
  }
  function reapplyFocus() {
    document.querySelectorAll('.hl,.same').forEach(x => x.classList.remove('hl', 'same'));
    const on = focusId !== null;
    document.body.classList.toggle('hov', on);
    if (!on) focusHost = null;
    if (on) document.querySelectorAll(`[data-task="${focusId}"]`).forEach(x => {
      if (focusHost && x.classList.contains('chip')) { const h = x.closest('[data-block]'); if (h && h.dataset.block !== focusHost) { x.classList.add('same'); return; } }
      x.classList.add('hl');
    });
  }
  function focusTask(el) {
    const id = el.dataset.task, k = Store.task(id); if (!k) return;
    if (!savedSide) savedSide = Tasks.sideState();
    focusId = id; focusHost = null;
    openPop(el);
    Tasks.reveal(id);
    reapplyFocus();
  }

  /* ---------- jumping from a Plan line to the calendar ---------- */

  function jump(key, id) {
    if (View.mode === 'list') View.mode = key.startsWith('cy@') ? 'cycle' : 'workweek';
    if (key.startsWith('cy@')) {
      const pr = Store.periodAt(key.slice(3));
      const visible = View.mode === 'cycle' ? cycleWindow().some(o => pkey(o) === key) : calDays().some(ds => pr && ds >= pr.start && ds <= pr.end);
      if (pr && !visible) View.date = View.mode === 'cycle' ? pr.start : td() >= pr.start && td() <= pr.end ? td() : pr.start;
    } else if (View.mode === 'cycle' && Store.periodAt(key.split('|')[0])) {
      const pr = Store.periodAt(key.split('|')[0]);
      if (!cycleWindow().some(o => o.key === pr.key)) View.date = pr.start;
    } else { View.date = key.split('|')[0]; if (View.mode === 'cycle') View.mode = 'workweek'; }
    View.save();
    if (View.page !== 'tasks') App.show('tasks');
    App.navigated(); render();
    const hostKey = View.mode === 'cycle' && !key.startsWith('cy@') ? pkey(Store.periodAt(key.split('|')[0])) : key;
    const el = document.querySelector(`[data-block="${hostKey}"] [data-task="${id}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focusId = id; jumpHold = id; focusHost = hostKey; reapplyFocus();   // stays until the mouse leaves the card
    }
  }

  /* ---------- dragging ---------- */

  // The shared drag state; the Inbox has its own drop targets but uses this to know what is dragged.
  let drag = null;
  const SORTABLE = ['open', 'backlog'];
  let dropMark = null, springKey = null, springTimer = null;
  const dragging = () => drag;
  function clearMarks() { document.querySelectorAll('.ins-before,.ins-after').forEach(x => x.classList.remove('ins-before', 'ins-after')); dropMark = null; }
  function clearSpring() { clearTimeout(springTimer); springTimer = null; springKey = null; }
  function dragReset() { drag = null; clearMarks(); clearSpring(); document.body.classList.remove('dragging-any'); document.querySelectorAll('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); }
  const dropTarget = e => e.target.closest && (e.target.closest('.dz') || e.target.closest('.cycle') || e.target.closest('.cyblock') || e.target.closest('.block') || e.target.closest('#tasks .sec:not([data-list="planned"]):not([data-list="done"])') || e.target.closest('#tasks .sec[data-list="done"]'));
  // Where in a sidebar list: on a card (upper or lower half), on the head (before the first), below (after the last).
  function markFor(e, sec) {
    const cards = [...sec.querySelectorAll('.task')].filter(c => c.dataset.task !== drag.task);
    if (!cards.length) return null;
    const card = e.target.closest('.task');
    if (card && card.dataset.task !== drag.task) { const r = card.getBoundingClientRect(); return { id: card.dataset.task, after: e.clientY > r.top + r.height / 2, el: card }; }
    if (card) return null;
    if (e.target.closest('.sh')) return { id: cards[0].dataset.task, after: false, el: cards[0] };
    return { id: cards[cards.length - 1].dataset.task, after: true, el: cards[cards.length - 1] };
  }
  // Where in a block or period: between two tasks (the top one is the most important).
  function markForChips(e, blk) {
    const chips = [...blk.querySelectorAll(blk.querySelector('.cydated,.cyown') ? '.cyown .chip' : '.chip')].filter(c => c.dataset.task !== drag.task);
    if (!chips.length) return null;
    if (blk.classList.contains('cycle')) {   // side by side: the nearest task, left or right of it
      let best = null, bd = 1e9;
      for (const c of chips) { const r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(e.clientX - cx, (e.clientY - cy) * 2); if (d < bd) { bd = d; best = { c, cx }; } }
      return { id: best.c.dataset.task, after: e.clientX > best.cx, el: best.c };
    }
    const c = e.target.closest('.cyown .chip, .chip');
    if (c && c.dataset.task !== drag.task && chips.includes(c)) { const r = c.getBoundingClientRect(); return { id: c.dataset.task, after: e.clientY > r.top + r.height / 2, el: c }; }
    if (c) return null;
    const first = chips[0].getBoundingClientRect();
    if (e.clientY < first.top) return { id: chips[0].dataset.task, after: false, el: chips[0] };
    return { id: chips[chips.length - 1].dataset.task, after: true, el: chips[chips.length - 1] };
  }
  // A task on a block is fixed among the other dated tasks of its period: dropping there does nothing.
  function sameDated(e, tg) {
    if (!drag || !tg.classList.contains('cyblock') || !e.target.closest('.cydated') || !drag.src.includes('|')) return false;
    const pr = Store.periodAt(drag.src.split('|')[0]); return !!pr && pkey(pr) === tg.dataset.block;
  }
  const toKey = k => (k && k.startsWith('cy@') ? k.slice(3) : k);

  function initDrag() {
    document.addEventListener('dragstart', e => {
      const el = e.target.closest && e.target.closest('[data-task]'); if (!el) return;
      drag = { task: el.dataset.task, src: el.dataset.src, srcp: el.dataset.srcp };   // first, so a later problem can't leave an old drag behind
      closePop();
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag.task);
      setTimeout(() => { el.classList.add('dragging'); document.body.classList.add('dragging-any'); }, 0);
    });
    document.addEventListener('dragend', dragReset);
    document.addEventListener('dragover', e => {
      if (View.page === 'inbox') { clearMarks(); clearSpring(); return; }
      const tg = dropTarget(e);
      if (tg && drag && sameDated(e, tg)) { clearMarks(); document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); return; }
      if (!tg || !drag) { clearMarks(); clearSpring(); return; }
      e.preventDefault();
      document.querySelectorAll('.over').forEach(x => { if (x !== tg) x.classList.remove('over'); });
      tg.classList.add('over'); clearMarks();
      // A closed list opens when you hover over it with a task; dropping without waiting works too.
      if (tg.dataset.list && tg.classList.contains('closed')) {
        if (springKey !== tg.dataset.list) {
          clearSpring(); springKey = tg.dataset.list;
          springTimer = setTimeout(() => { if (drag) Tasks.springOpen(springKey); springKey = null; }, 500);
        }
      } else clearSpring();
      if (tg.dataset.list && SORTABLE.includes(tg.dataset.list)) { const m = markFor(e, tg); if (m) { dropMark = { id: m.id, after: m.after }; m.el.classList.add(m.after ? 'ins-after' : 'ins-before'); } }
      else if (tg.dataset.block) { const m = markForChips(e, tg); if (m) { dropMark = { id: m.id, after: m.after }; m.el.classList.add(m.after ? 'ins-after' : 'ins-before'); } }
    });
    document.addEventListener('drop', async e => {
      const tg = dropTarget(e);
      if (!tg || !drag || View.page === 'inbox') return;
      e.preventDefault();
      const d = drag, mark = dropMark;
      dragReset();
      if (sameDated(e, tg)) return;
      let res;
      if (tg.dataset.dropdock || tg.dataset.list) {
        const list = tg.dataset.dropdock || tg.dataset.list;
        res = await UI.act(() => Store.moveToList(d.task, list, SORTABLE.includes(list) ? mark : null));
      } else {
        const key = tg.dataset.block;
        const target = key.startsWith('cy@') ? { period: key.slice(3) } : { date: key.split('|')[0], blockId: key.split('|')[1] };
        res = await UI.act(() => Store.plan(d.task, target, d.src === 'new' ? 'new' : toKey(d.src), d.srcp ? d.srcp.slice(3) : null, mark));
      }
      if (res) Tasks.notes(res.notes, d.task);
    });
  }

  /* ---------- clicks ---------- */

  function initClicks() {
    document.addEventListener('click', e => {
      const ctl = e.target.closest('input,button,select,a');
      if (e.target.closest('#pop')) { if (!ctl) closePop(true); return; }
      const c = e.target.closest('#weekView .chip');
      if (c) { if (!ctl) focusTask(c); return; }
      // a button elsewhere stops the focus and leaves the sidebar; a click in the calendar puts it back
      closePop(!ctl && !e.target.closest('.side') && !!e.target.closest('#weekView'));
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(true); });
    document.addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('list')) closePop(true); }, true);
    document.addEventListener('click', async e => {
      const g = e.target.closest('[data-goblock]');
      if (g) { jump(g.dataset.goblock, g.dataset.gotask); return; }
      const rma = e.target.closest('[data-rmall]');
      if (rma) { const [per, id] = rma.dataset.rmall.split('~'); await UI.act(() => Store.unplanBlocksInPeriod(per.slice(3), id)); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { const [key, id] = rm.dataset.rm.split('~'); await UI.act(() => (key.startsWith('cy@') ? Store.unplanPeriod(key.slice(3), id) : Store.unplanBlock(key, id))); }
    });
    document.addEventListener('mousemove', e => {
      if (jumpHold === null) return;
      if (e.target.closest && e.target.closest(`.side .task[data-task="${jumpHold}"]`)) return;
      const id = jumpHold; jumpHold = null;
      if (focusId === id && pop().hidden) { focusId = null; reapplyFocus(); }
    });
    $('cycleView').addEventListener('scroll', cyHintSync, { passive: true });
    window.addEventListener('resize', fitBlocks);
  }

  /* ---------- the bar ---------- */

  const step = () => (View.mode === 'day' ? 1 : 7);
  const go = ds => { View.date = ds; App.navigated(); render(); };
  function initBar() {
    $('calPrev').onclick = () => {
      if (View.mode === 'cycle') { const pr = Store.periodAt(View.date), q = pr && Store.periodAt(M.addDays(pr.start, -1)); if (q) go(q.start); }
      else go(M.addDays(View.date, -step()));
    };
    $('calNext').onclick = () => {
      if (View.mode === 'cycle') { const pr = Store.periodAt(View.date); if (pr) go(M.addDays(pr.end, 1)); }
      else go(M.addDays(View.date, step()));
    };
    $('calToday').onclick = () => go(td());
    $('calOpen').onclick = () => { const pk = $('calPick'); try { pk.showPicker(); } catch (err) { pk.focus(); pk.click(); } };
    $('calPick').onchange = e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) go(e.target.value); };
    $('modeSeg').onclick = e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      View.mode = b.dataset.mode; View.save(); viewOpen = false; syncViewToggle(); App.navigated(); render();
    };
    $('lfToggle').onclick = () => { listFilterOpen = !listFilterOpen; renderListFilter(); };
    $('vwToggle').onclick = () => { viewOpen = !viewOpen; syncViewToggle(); };
    $('lfQ').oninput = e => { View.filter.q = e.target.value.trim(); View.save(); App.render(); };
    $('lfClear').onclick = () => { UI.clearFilter(); App.render(); };
  }
  let viewOpen = false;
  function syncViewToggle() { $('modeSeg').classList.toggle('open', viewOpen); $('vwToggle').setAttribute('aria-expanded', viewOpen); }

  /* ---------- swiping on a phone ---------- */

  // Day, Werkweek and Week follow your finger: left for the next day or week, right for the previous.
  // Past a quarter of the screen (or a fast swipe) it changes, otherwise it springs back.
  function initSwipe() {
    const wv = $('weekView'), coarse = () => matchMedia('(pointer:coarse)').matches;
    const els = () => ['head', 'body'].map($);
    const setX = (x, animate, op) => els().forEach(el => { el.style.transition = animate ? 'transform .17s ease-out, opacity .17s ease-out' : 'none'; el.style.transform = x ? `translateX(${x}px)` : ''; el.style.opacity = op == null ? '' : op; });
    let g = null;
    wv.addEventListener('touchstart', e => {
      g = (e.touches.length === 1 && coarse() && ['day', 'workweek', 'week'].includes(View.mode) && !e.target.closest('#cycleLane, input, select, textarea, .calbar, .gp, dialog, #pop'))
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now(), lock: null, dx: 0 } : null;
    }, { passive: true });
    wv.addEventListener('touchmove', e => {
      if (!g) return; const tt = e.touches[0], dx = tt.clientX - g.x, dy = tt.clientY - g.y;
      if (!g.lock && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) g.lock = Math.abs(dx) > 1.3 * Math.abs(dy) ? 'h' : 'v';
      if (g.lock === 'h') { g.dx = dx; setX(dx * 0.9, false, Math.max(0.35, 1 - Math.abs(dx) / (wv.clientWidth * 1.4))); }
    }, { passive: true });
    wv.addEventListener('touchend', () => {
      if (!g || g.lock !== 'h') { g = null; return; }
      const dx = g.dx, w = wv.clientWidth, fast = Math.abs(dx) / Math.max(1, Date.now() - g.at) > 0.5; g = null;
      const btn = $(dx < 0 ? 'calNext' : 'calPrev');
      if (btn.disabled || !(Math.abs(dx) > w * 0.25 || (fast && Math.abs(dx) > 40))) { setX(0, true); return; }
      const dir = dx < 0 ? -1 : 1;
      setX(dir * w * 0.7, true, 0);
      setTimeout(() => { btn.click(); setX(-dir * w * 0.25, false, 0); void wv.offsetWidth; setX(0, true, 1); }, 160);
    }, { passive: true });
    wv.addEventListener('touchcancel', () => { if (g && g.lock === 'h') setX(0, true); g = null; }, { passive: true });
  }

  function init() { initBar(); initDrag(); initClicks(); initSwipe(); }

  return { init, render, spanText, closePop, dragging, dragReset, reapplyFocus, calDays };
})();
