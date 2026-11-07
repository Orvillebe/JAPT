/**
 * JAPT Calendar - the Taken page on the right: Dag, Werkweek, Week, Werkperiode and Lijst.
 *
 * Responsibilities:
 *   - The bar on top: previous, today, next, go to a date, filter (list view), view mode
 *   - Day and week views: work blocks with their tasks, meetings, the work-period lane on top
 *   - The work-period view (periods side by side) and the list view (planned tasks in time order)
 *   - The open task: a card over the task, the rest dimmed, the sidebar showing it
 *   - The drop zone for blocks and periods (drag.js); the sidebar lists have their own (tasks.js)
 *   - Jumping from a Plan line in a card to that day or period
 *   - Swiping on a phone to the previous or next day or week
 *
 * Blocks and periods carry their place in data-place, chips where they sit in data-from (model.js,
 * places). Saving goes through the Store; the rules are in docs/design.md (Planning).
 */

const Calendar = (() => {
  const M = Model, { $, esc, cap, View } = UI;
  const P = M.placeText;
  const PX = 88;                 // pixels per hour: a half-hour block still fits one task
  const CYCLES_SHOWN = 4;        // periods side by side in the period view
  const TIMES_W = 56;            // width of the hours column (px)
  const MEETING_MIN_H = 18;      // a short meeting is still tall enough for its title (px)
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
  const periodPlace = o => ({ period: o.key });

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
  // A task in a block or period. from: the place it sits in; fromPeriod: shown in that period's column.
  function chip(k, from, { side = '', after = '', fromPeriod = null } = {}) {
    return `<div class="chip ${k.doneOn ? 'done' : ''} ${Store.isLate(k) ? 'late' : ''} ${dim(k)}" draggable="true" data-task="${k.id}" data-from="${P(from)}"${fromPeriod ? ` data-from-period="${fromPeriod}"` : ''} style="${UI.taskStyle(k)}">
      <div class="ct">${UI.chk(k)}<span class="t">${esc(k.title)}</span><span class="cside">${UI.whoHtml(k)}${side}</span></div>${after}${UI.metaLine(k)}</div>`;
  }
  const xBtn = (attr, title) => `<button type="button" class="x" ${attr} title="${title}">×</button>`;

  /* ---------- work-period lane above the week ---------- */

  // "2/3": the task's second of three periods (or blocks).
  function cyPart(id, key) { const cs = Store.idx().of(id).periods; return cs.length > 1 ? part(cs.length, cs.findIndex(o => o.key === key) + 1) : ''; }
  function renderLane(days, cols) {
    const lane = $('cycleLane'); lane.style.gridTemplateColumns = cols;
    const groups = [];
    days.forEach((ds, i) => { const o = Store.periodAt(ds); if (!o) return; const g = groups[groups.length - 1]; if (g && g.o.key === o.key) g.z = i; else groups.push({ o, a: i, z: i }); });
    lane.innerHTML = groups.map(g => {
      const o = g.o, place = periodPlace(o), ids = Store.idx().tasksIn(place);
      const chips = ids.map(id => { const k = Store.task(id); return k ? chip(k, place, { side: cyPart(id, o.key) + xBtn(`data-unplan="${P(place)}"`, t('cal.out_of_period')) }) : ''; }).join('');
      return `<div class="cycle ${days[g.a] > o.start && moreVisible(o, days.slice(g.a), true) ? 'cl' : ''} ${days[g.z] < o.end && moreVisible(o, days.slice(0, g.z + 1), false) ? 'cr' : ''}" data-place="${P(place)}" style="grid-column:${g.a + 2} / ${g.z + 3};grid-row:1">
        <div class="cyh"><b>${spanText(o)}</b></div>
        <div class="list">${chips || `<div class="empty">${t('cal.drop_here')}</div>`}</div></div>`;
    }).join('');
  }

  /* ---------- day and week ---------- */

  function renderWeek() {
    const days = calDays(), cols = `${TIMES_W}px repeat(${days.length},minmax(0,1fr))`;
    const headEl = $('head'), bodyEl = $('body');
    headEl.style.gridTemplateColumns = cols; bodyEl.style.gridTemplateColumns = cols;
    headEl.innerHTML = '<div></div>' + days.map(ds => `<div class="${ds === td() ? 'today' : ''}">${cap(UI.wd(ds))}<small>${UI.dnum(ds)} ${UI.mshort(ds)}</small></div>`).join('');
    // The hours follow the blocks and meetings, at least dayStart to dayEnd (config.js).
    const bs = days.flatMap(Store.blocksOn), ms = days.flatMap(Agenda.on);
    const H0 = Math.min(JAPT_CONFIG.dayStart, Math.floor(Math.min(...bs.map(b => b.start / 60), ...ms.map(m => m.start / 60), 24)));
    const H1 = Math.max(JAPT_CONFIG.dayEnd, Math.ceil(Math.max(...bs.map(b => b.end / 60), ...ms.map(m => m.end / 60), 0)));
    let times = '';
    for (let h = H0; h <= H1; h++) times += `<span style="top:${(h - H0) * PX}px">${h}:00</span>`;
    let html = `<div class="times" style="height:${(H1 - H0) * PX}px">${times}</div>`;
    for (const ds of days) {
      let inner = '';
      for (const m of Agenda.on(ds)) inner += `<div class="meeting" style="top:${(m.start / 60 - H0) * PX}px;height:${Math.max(MEETING_MIN_H, (m.end - m.start) / 60 * PX)}px"><b>${esc(m.title)}</b>${UI.span(UI.fmt(m.start), UI.fmt(m.end))}</div>`;
      const blocks = Store.blocksOn(ds);
      for (const b of blocks) {
        const place = { date: ds, blockId: b.id }, key = M.placeKey(place), ids = Store.idx().tasksIn(place);
        const chips = ids.map(id => {
          const k = Store.task(id); if (!k) return '';
          const bl = Store.idx().of(id).blocks, pos = bl.findIndex(x => x.key === key) + 1;
          return chip(k, place, { side: part(bl.length, pos) + xBtn(`data-unplan="${P(place)}"`, t('cal.out_of_block')) });
        }).join('');
        inner += `<div class="block" data-place="${P(place)}" style="top:${(b.start / 60 - H0) * PX}px;height:${(b.end - b.start) / 60 * PX}px">
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
    // A task of the period itself, or a task on one or more blocks in it (shown once, with its days).
    const ownChip = (id, per) => { const k = Store.task(id); return k ? chip(k, periodPlace(per), { side: cyPart(id, per.key) + xBtn(`data-unplan="${P(periodPlace(per))}"`, t('cal.out_of_period')) }) : ''; };
    const datedChip = (id, from, per) => {
      const k = Store.task(id); if (!k) return '';
      const mine = Store.idx().of(id).blocks.filter(b => b.date >= per.start && b.date <= per.end);
      const day = `<div class="meta"><div class="mrow plan"><span class="k">${t(mine.length > 1 ? 'meta.days' : 'meta.day')}</span><span class="v">${mine.map(b => `${UI.fmtDay(b.date)} · ${UI.span(UI.fmt(b.start), UI.fmt(b.end))}`).join('<br>')}</span></div></div>`;
      return chip(k, from, { side: xBtn(`data-unplan-days="${per.key}"`, t(mine.length > 1 ? 'cal.out_of_blocks' : 'cal.out_of_block')), after: day, fromPeriod: per.key });
    };
    const cols = win.map(o => {
      // first the period's own tasks (free to order), then the tasks on a block (fixed on their day)
      const first = new Map();
      for (let d = o.start; d <= o.end; d = M.addDays(d, 1)) for (const b of Store.blocksOn(d)) { const pl = { date: d, blockId: b.id }; for (const id of Store.idx().tasksIn(pl)) if (!first.has(id)) first.set(id, pl); }
      const dated = [...first].map(([id, from]) => datedChip(id, from, o));
      const own = Store.idx().tasksIn(periodPlace(o)).map(id => ownChip(id, o)).join('');
      const body = (own ? `<div class="cyown">${own}</div>` : '') + (dated.length && own ? `<div class="cysep">${t('cal.on_fixed_days')}</div>` : '') + (dated.length ? `<div class="cydated">${dated.join('')}</div>` : '');
      return `<div class="cycol ${td() >= o.start && td() <= o.end ? 'today' : ''}"><div class="cyblock" data-place="${P(periodPlace(o))}">${body || `<div class="empty">${t('cal.drop_here')}</div>`}</div></div>`;
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
      const ids = [...new Set(Store.blocksOn(d).flatMap(b => I.tasksIn({ date: d, blockId: b.id })))].filter(ok);
      return `<div class="lgrp"><h4 class="${d === td() ? 'today' : ''}">${UI.fmtDay(d)}${d === td() ? `<span>${t('cal.today_small')}</span>` : ''}</h4><div class="list-tasks">${ids.map(card).join('')}</div></div>`;
    };
    let html = '', i = 0;
    while (i < ev.length) {
      const o = ev[i].per, grp = [], same = e => (o ? !!e.per && e.per.key === o.key : !e.per);
      while (i < ev.length && same(ev[i])) { grp.push(ev[i]); i++; }
      const inner = grp.map(e => (e.type === 0 ? dayHtml(e.date) : `<div class="lgrp"><h4>${t('cal.whole_period')}</h4><div class="list-tasks">${I.tasksIn({ period: e.key }).filter(ok).map(card).join('')}</div></div>`)).join('');
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
    // An open card lives in a column that is about to be replaced: it closes first. A mark after a
    // jump has no card and stays.
    if (card) closePop(true);
    Agenda.ensure(View.mode === 'cycle' || View.mode === 'list' ? [] : calDays());
    renderBar();
    // Only the view on screen has content; the others are emptied, not left hidden.
    const inList = View.mode === 'list';
    if (inCy) renderCycleView(); else $('cycleView').innerHTML = '';
    if (inList) renderListView(); else $('listView').innerHTML = '';
    if (!inCy && !inList) renderWeek(); else ['head', 'body', 'cycleLane'].forEach(id => { $(id).innerHTML = ''; });
    reapplyFocus();
  }

  /* ---------- the open task ---------- */

  // Click on a task in the calendar: a card with everything, the rest dims, the sidebar shows the task
  // and remembers where it was. focusHost: after a jump, only the task in that place is marked.
  const CARD_MIN_W = 270, CARD_EDGE = 6;   // the card is at least this wide, and stays this far from the edge
  let focusId = null, focusHost = null, savedSide = null, jumpHold = null;
  // The open card exists only while it is open: opening makes it, closing removes it. It sits in the day
  // column so it scrolls with the day; when the calendar is redrawn it is closed first.
  let card = null;
  // restore: put the sidebar back as it was before the card opened.
  function closePop(restore = false) {
    const was = focusId !== null;
    jumpHold = null;
    if (card) { card.remove(); card = null; }
    focusId = null; reapplyFocus();
    if (was && restore && savedSide) Tasks.restoreSide(savedSide);
    savedSide = null;
    return was;
  }
  function openPop(el) {
    const id = el.dataset.task, k = Store.task(id); if (!k) return;
    if (card) card.remove();
    const bl = Store.idx().of(id).blocks, from = M.parsePlace(el.dataset.from);
    const others = bl.filter(b => !M.samePlace(b.place, from));
    card = document.createElement('div');
    card.id = 'pop'; card.setAttribute('style', UI.taskStyle(k)); card.dataset.task = id;
    card.innerHTML = `<div class="pt">${UI.chk(k)}<b>${esc(k.title)}</b>${UI.whoHtml(k)}<button type="button" class="pen" data-edit="${id}" title="${t('task.edit')}">✎</button></div>
      ${k.note ? `<div class="pd">${esc(k.note)}</div>` : ''}${UI.metaLine(k)}
      ${bl.length > 1 ? `<div class="pn"><div class="k">${t('pop.also_on')}</div>${others.map(b => `<div class="pr"><span class="pday">${UI.fmtDay(b.date)}</span><span>${UI.span(UI.fmt(b.start), UI.fmt(b.end))}</span></div>`).join('')}</div>` : ''}`;
    const col = el.closest('.col') || el.closest('.cycles') || el.closest('.cyblock'), colR = col.getBoundingClientRect(), r = el.getBoundingClientRect();
    const wr = $('weekView').getBoundingClientRect(), w = Math.max(r.width, CARD_MIN_W);
    let left = r.left - colR.left;
    const over = r.left + w - (wr.right - CARD_EDGE); if (over > 0) left -= over;
    card.style.width = w + 'px'; card.style.left = left + 'px'; card.style.top = (r.top - colR.top) + 'px';
    col.appendChild(card);
  }
  function reapplyFocus() {
    document.querySelectorAll('.hl,.same').forEach(x => x.classList.remove('hl', 'same'));
    const on = focusId !== null;
    document.body.classList.toggle('hov', on);
    if (!on) focusHost = null;
    if (on) document.querySelectorAll(`[data-task="${focusId}"]`).forEach(x => {
      if (focusHost && x.classList.contains('chip')) { const h = x.closest('[data-place]'); if (h && h.dataset.place !== focusHost) { x.classList.add('same'); return; } }
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

  // To the place a task is planned in, and mark the task there (until the mouse leaves its card).
  function jump(place, id) {
    const per = place.period ? Store.periodAt(place.period) : Store.periodAt(place.date);
    if (View.mode === 'list') View.mode = place.period ? 'cycle' : 'workweek';
    if (place.period) {
      const visible = View.mode === 'cycle' ? cycleWindow().some(o => o.key === place.period) : calDays().some(ds => per && ds >= per.start && ds <= per.end);
      if (per && !visible) View.date = View.mode === 'cycle' ? per.start : td() >= per.start && td() <= per.end ? td() : per.start;
    } else if (View.mode === 'cycle' && per) {
      if (!cycleWindow().some(o => o.key === per.key)) View.date = per.start;
    } else { View.date = place.date; if (View.mode === 'cycle') View.mode = 'workweek'; }
    View.save();
    if (View.page !== 'tasks') App.show('tasks');
    App.navigated(); render();
    // in the period view a task on a block is shown in its period's column
    const host = P(View.mode === 'cycle' && !place.period ? periodPlace(per) : place);
    const el = document.querySelector(`[data-place="${host}"] [data-task="${id}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focusId = id; jumpHold = id; focusHost = host; reapplyFocus();
    }
  }

  /* ---------- dropping on blocks and periods ---------- */

  // Where in a block or period: between two tasks (the top one is the most important).
  function spotIn(e, host, drag) {
    const chips = [...host.querySelectorAll(host.querySelector('.cydated,.cyown') ? '.cyown .chip' : '.chip')].filter(c => c.dataset.task !== drag.task);
    if (!chips.length) return null;
    if (host.classList.contains('cycle')) {   // side by side: the nearest task; rows count double, so one in the same row wins
      let best = null, bd = Infinity;
      for (const c of chips) { const r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = Math.hypot(e.clientX - cx, (e.clientY - cy) * 2); if (d < bd) { bd = d; best = { c, cx }; } }
      return { el: best.c, after: e.clientX > best.cx };
    }
    const c = e.target.closest('.chip');
    if (c && c.dataset.task !== drag.task && chips.includes(c)) { const r = c.getBoundingClientRect(); return { el: c, after: e.clientY > r.top + r.height / 2 }; }
    if (c) return null;
    if (e.clientY < chips[0].getBoundingClientRect().top) return { el: chips[0], after: false };
    return { el: chips[chips.length - 1], after: true };
  }
  // A task on a block is fixed among the other dated tasks of its period: dropping it there does nothing.
  function amongItsDated(e, host, drag) {
    if (!host.classList.contains('cyblock') || !e.target.closest('.cydated') || !drag.from || drag.from.period) return false;
    const pr = Store.periodAt(drag.from.date), to = M.parsePlace(host.dataset.place);
    return !!pr && M.samePlace(periodPlace(pr), to);
  }
  const placeZone = {
    find: el => el.closest('#weekView [data-place]'),
    accepts: d => { const k = Store.task(d.task); return !!k && k.stage !== 'inbox'; },
    over: (e, host, d) => (amongItsDated(e, host, d) ? false : spotIn(e, host, d)),
    async drop(host, d, spot) {
      const mark = spot ? { id: spot.el.dataset.task, after: spot.after } : null;
      const res = await UI.act(() => Store.plan(d.task, M.parsePlace(host.dataset.place), { from: d.from, fromPeriod: d.fromPeriod, mark }));
      if (res) Tasks.notes(res.notes, d.task);
    }
  };

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
    UI.onEscape(() => closePop(true));
    document.addEventListener('scroll', e => { if (e.target.classList && e.target.classList.contains('list')) closePop(true); }, true);
    document.addEventListener('click', async e => {
      const g = e.target.closest('[data-goto]');
      if (g) { jump(M.parsePlace(g.dataset.goto), g.dataset.gotask); return; }
      const ud = e.target.closest('[data-unplan-days]');
      if (ud) { await UI.act(() => Store.unplanBlocksInPeriod(ud.dataset.unplanDays, ud.closest('[data-task]').dataset.task)); return; }
      const un = e.target.closest('[data-unplan]');
      if (un) await UI.act(() => Store.unplan(M.parsePlace(un.dataset.unplan), un.closest('[data-task]').dataset.task));
    });
    document.addEventListener('mousemove', e => {
      if (jumpHold === null) return;
      if (e.target.closest && e.target.closest(`.side .task[data-task="${jumpHold}"]`)) return;
      const id = jumpHold; jumpHold = null;
      if (focusId === id && !card) { focusId = null; reapplyFocus(); }
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
  const SWIPE = {
    lockPx: 10,          // movement before deciding between swiping and scrolling
    sideways: 1.3,       // a swipe: at least this much more sideways than up or down
    follow: 0.9,         // the view moves a bit less than the finger, so it feels attached, not loose
    fadeMin: 0.35,       // the view fades while it moves, to this opacity at most
    fadeOver: 1.4,       // ... over this many screen widths
    changeAt: 0.25,      // part of the screen width that changes the day or week
    fastPxPerMs: 0.5,    // a fast flick also changes it ...
    fastMinPx: 40,       // ... once it has moved this far
    outPart: 0.7,        // the old view leaves this far, the new one comes in from inPart
    inPart: 0.25,
    ms: 170              // the length of one leg of the slide
  };
  function initSwipe() {
    const wv = $('weekView'), coarse = () => matchMedia('(pointer:coarse)').matches;
    const els = () => ['head', 'body'].map($);
    const setX = (x, animate, op) => els().forEach(el => { el.style.transition = animate ? `transform ${SWIPE.ms}ms ease-out, opacity ${SWIPE.ms}ms ease-out` : 'none'; el.style.transform = x ? `translateX(${x}px)` : ''; el.style.opacity = op == null ? '' : op; });
    let g = null;
    wv.addEventListener('touchstart', e => {
      g = (e.touches.length === 1 && coarse() && ['day', 'workweek', 'week'].includes(View.mode) && !e.target.closest('#cycleLane, input, select, textarea, .calbar, .gp, dialog, #pop'))
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now(), lock: null, dx: 0 } : null;
    }, { passive: true });
    wv.addEventListener('touchmove', e => {
      if (!g) return; const tt = e.touches[0], dx = tt.clientX - g.x, dy = tt.clientY - g.y;
      if (!g.lock && (Math.abs(dx) > SWIPE.lockPx || Math.abs(dy) > SWIPE.lockPx)) g.lock = Math.abs(dx) > SWIPE.sideways * Math.abs(dy) ? 'h' : 'v';
      if (g.lock === 'h') { g.dx = dx; setX(dx * SWIPE.follow, false, Math.max(SWIPE.fadeMin, 1 - Math.abs(dx) / (wv.clientWidth * SWIPE.fadeOver))); }
    }, { passive: true });
    wv.addEventListener('touchend', () => {
      if (!g || g.lock !== 'h') { g = null; return; }
      const dx = g.dx, w = wv.clientWidth, fast = Math.abs(dx) / Math.max(1, Date.now() - g.at) > SWIPE.fastPxPerMs; g = null;
      const btn = $(dx < 0 ? 'calNext' : 'calPrev');
      if (btn.disabled || !(Math.abs(dx) > w * SWIPE.changeAt || (fast && Math.abs(dx) > SWIPE.fastMinPx))) { setX(0, true); return; }
      const dir = dx < 0 ? -1 : 1;
      setX(dir * w * SWIPE.outPart, true, 0);
      setTimeout(() => { btn.click(); setX(-dir * w * SWIPE.inPart, false, 0); void wv.offsetWidth; setX(0, true, 1); }, SWIPE.ms);
    }, { passive: true });
    wv.addEventListener('touchcancel', () => { if (g && g.lock === 'h') setX(0, true); g = null; }, { passive: true });
  }

  function init() {
    initBar(); initClicks(); initSwipe();
    Drag.zone(placeZone);
    Drag.onStart(() => closePop());
  }

  return { init, render, spanText, closePop, reapplyFocus, calDays };
})();
