/**
 * JAPT Calendar - the Taken page on the right: Dag, Werkweek, Week, Werkperiode and Lijst.
 *
 * Responsibilities:
 *   - The bar on top: previous, today, next, go to a date, filter (list view), view mode
 *   - Drawing the current view; the table of views and what they share are in calendar-views.js, the
 *     views themselves in calendar-week.js, calendar-period.js and calendar-list.js, the open task and
 *     the jump in calendar-card.js (these load first)
 *   - The drop zone for blocks and periods (drag.js); the sidebar lists have their own (tasks.js)
 *   - The clicks in the calendar
 *   - Swiping on a phone to the previous or next day or week
 *
 * Blocks and periods carry their place in data-place, chips where they sit in data-from (model.js,
 * places). Saving goes through the Store; the rules are in docs/design.md (Planning).
 */

const Calendar = (() => {
  const M = Model, { $, View, MODE } = UI;
  const {
    SURFACE, currentView, viewClasses, calDays, isRunning, periodWindow, periodPlace, yearOf, yearSuffix
  } = CalendarViews;
  const { renderWeek, fitBlocks } = CalendarWeek;
  const { renderPeriodView, syncPeriodHint } = CalendarPeriod;
  const { renderListView, toggleFilter } = CalendarList;
  const { closePop, reapplyFocus, focusTask, jump, onJumpHoldMove } = CalendarCard;
  const td = () => M.today();

  // The parts of the page views draw in. Only the view on screen has content; the others are emptied,
  // not left hidden.
  const SURFACES = [
    { name: SURFACE.PERIOD, draw: renderPeriodView, elements: ['cycleView'] },
    { name: SURFACE.LIST, draw: renderListView, elements: ['listView'] },
    { name: SURFACE.WEEK, draw: renderWeek, elements: ['head', 'body', 'cycleLane'] }
  ];

  /* ---------- the bar on top ---------- */

  function periodWindowTitle() {
    const periods = periodWindow(), from = periods[0].start, to = periods[periods.length - 1].end;
    const fromYear = yearOf(from) !== yearOf(to) ? ' ' + yearOf(from) : '';
    return t('time.span', {
      a: `${UI.dnum(from)} ${UI.mname(from)}${fromYear}`,
      z: `${UI.dnum(to)} ${UI.mname(to)} ${yearOf(to)}`
    });
  }
  function dayTitle(day) {
    if (UI.PHONE()) return `${UI.fmtDay(day)}${yearSuffix(day)}`;
    return `${UI.wdLong(M.weekday(day))} ${UI.dnum(day)} ${UI.mname(day)} ${yearOf(day)}`;
  }
  // A range of days; the first month is left out when the range stays in one month.
  function rangeTitle(first, last) {
    const phone = UI.PHONE(), month = phone ? UI.mshort : UI.mname;
    const year = phone ? yearSuffix(last) : ' ' + yearOf(last);
    return t('time.span', {
      a: month(first) === month(last) ? UI.dnum(first) : `${UI.dnum(first)} ${month(first)}`,
      z: `${UI.dnum(last)} ${month(last)}${year}`
    });
  }
  function barTitle(period, first, last) {
    if (period) return periodWindowTitle();
    return View.mode === MODE.DAY ? dayTitle(first) : rangeTitle(first, last);
  }
  function barSubtitle() {
    let sub = FilterPicker.count() ? t('cal.filter_on') : '';
    if (Agenda.failed()) sub += (sub ? ' · ' : '') + t('agenda.unreachable');
    return sub;
  }
  function renderBar() {
    const days = calDays();
    const period = View.mode === MODE.PERIOD ? Store.periodAt(View.date) : null;
    $('calPrev').disabled = !!period && !Store.periodAt(M.addDays(period.start, -1));
    // Vandaag is pressed and can't be clicked when you are already there.
    $('calToday').disabled = period ? isRunning(period) : days.includes(td());
    $('calTitle').textContent = barTitle(period, days[0], days[days.length - 1]);
    $('calSub').textContent = barSubtitle();
    $('calPick').value = View.date;
    document.querySelectorAll('[data-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.mode === View.mode);
    });
  }

  /* ---------- render ---------- */

  function drawCurrentView() {
    const shown = currentView().surface;
    for (const surface of SURFACES) {
      if (surface.name === shown) surface.draw();
      else surface.elements.forEach(id => { $(id).innerHTML = ''; });
    }
  }
  function render() {
    // Without an active period that view doesn't exist.
    if (View.mode === MODE.PERIOD && !Store.periodActive()) View.mode = MODE.WORKWEEK;
    $('modeCycle').hidden = !Store.periodActive();
    App.syncSide();
    const weekView = $('weekView'), { cssClass } = currentView();
    viewClasses.forEach(name => weekView.classList.toggle(name, name === cssClass));
    if (View.mode === MODE.PERIOD && !Store.periodAt(View.date)) View.date = Store.segments()[0].from;
    // An open card lives in a column that is about to be replaced: it closes first. A mark after a
    // jump has no card and stays.
    if (CalendarCard.isOpen()) closePop(true);
    Agenda.ensure(currentView().needsAgenda ? calDays() : []);
    renderBar();
    drawCurrentView();
    reapplyFocus();
  }

  /* ---------- dropping on blocks and periods ---------- */

  const ROW_DISTANCE_WEIGHT = 2;   // in the lane, a task in the same row wins from a nearer one in another row

  const middleX = rect => rect.left + rect.width / 2;
  const middleY = rect => rect.top + rect.height / 2;

  // Tasks side by side: next to the nearest task.
  function spotBesideNearest(e, chips) {
    let nearest = null, nearestDistance = Infinity;
    for (const c of chips) {
      const rect = c.getBoundingClientRect(), x = middleX(rect), y = middleY(rect);
      const distance = Math.hypot(e.clientX - x, (e.clientY - y) * ROW_DISTANCE_WEIGHT);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = { c, x }; }
    }
    return { el: nearest.c, after: e.clientX > nearest.x };
  }
  // Tasks under each other: above or below the task under the pointer, or at the top or bottom of the stack.
  function spotInStack(e, chips, drag) {
    const c = e.target.closest('.chip');
    if (c && c.dataset.task !== drag.task && chips.includes(c)) {
      return { el: c, after: e.clientY > middleY(c.getBoundingClientRect()) };
    }
    if (c) return null;
    if (e.clientY < chips[0].getBoundingClientRect().top) return { el: chips[0], after: false };
    return { el: chips[chips.length - 1], after: true };
  }
  // Where in a block or period: between two tasks (the top one is the most important).
  function spotIn(e, host, drag) {
    const selector = host.querySelector('.cydated,.cyown') ? '.cyown .chip' : '.chip';
    const chips = [...host.querySelectorAll(selector)].filter(c => c.dataset.task !== drag.task);
    if (!chips.length) return null;
    return host.classList.contains('cycle') ? spotBesideNearest(e, chips) : spotInStack(e, chips, drag);
  }
  // A task on a block is fixed among the other dated tasks of its period: dropping it there does nothing.
  function amongItsDated(e, host, drag) {
    if (!host.classList.contains('cyblock') || !e.target.closest('.cydated')) return false;
    if (!drag.from || drag.from.period) return false;
    const period = Store.periodAt(drag.from.date), to = M.parsePlace(host.dataset.place);
    return !!period && M.samePlace(periodPlace(period), to);
  }
  const placeZone = {
    find: el => el.closest('#weekView [data-place]'),
    accepts: d => {
      const k = Store.task(d.task);
      return !!k && k.stage !== M.STAGE.INBOX;
    },
    // A block a meeting covers completely has no room for a task.
    over: (e, host, d) => (amongItsDated(e, host, d) || 'noroom' in host.dataset ? false : spotIn(e, host, d)),
    async drop(host, d, spot) {
      const mark = spot ? { id: spot.el.dataset.task, after: spot.after } : null;
      const place = M.parsePlace(host.dataset.place);
      const partStart = host.dataset.partFrom !== undefined ? +host.dataset.partFrom : undefined;
      const options = { from: d.from, fromPeriod: d.fromPeriod, mark, partStart };
      const res = await UI.act(() => Store.plan(d.task, place, options));
      if (res) Tasks.notes(res.notes, d.task);
    }
  };

  /* ---------- clicks ---------- */

  function onFocusClick(e) {
    const control = e.target.closest('input,button,select,a');
    if (e.target.closest('#pop')) { if (!control) closePop(true); return; }
    const c = e.target.closest('#weekView .chip');
    if (c) { if (!control) focusTask(c); return; }
    // a button elsewhere stops the focus and leaves the sidebar; a click in the calendar puts it back
    closePop(!control && !e.target.closest('.side') && !!e.target.closest('#weekView'));
  }
  async function onPlanClick(e) {
    const goto = e.target.closest('[data-goto]');
    if (goto) { jump(M.parsePlace(goto.dataset.goto), goto.dataset.gotask); return; }
    const taskOf = el => el.closest('[data-task]').dataset.task;
    const unplanDays = e.target.closest('[data-unplan-days]');
    if (unplanDays) {
      await UI.act(() => Store.unplanBlocksInPeriod(unplanDays.dataset.unplanDays, taskOf(unplanDays)));
      return;
    }
    const unplan = e.target.closest('[data-unplan]');
    if (unplan) await UI.act(() => Store.unplan(M.parsePlace(unplan.dataset.unplan), taskOf(unplan)));
  }
  function initClicks() {
    document.addEventListener('click', onFocusClick);
    UI.onEscape(() => closePop(true));
    document.addEventListener('scroll', e => {
      if (e.target.classList && e.target.classList.contains('list')) closePop(true);
    }, true);
    document.addEventListener('click', onPlanClick);
    document.addEventListener('mousemove', onJumpHoldMove);
    $('cycleView').addEventListener('scroll', syncPeriodHint, { passive: true });
    window.addEventListener('resize', fitBlocks);
  }

  /* ---------- the bar ---------- */

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  let viewOpen = false;   // phone: the choice of view mode is unfolded

  const go = date => { View.date = date; App.navigated(); render(); };
  function stepCalendar(direction) {
    const date = currentView().step(View.date, direction);
    if (date !== null) go(date);
  }
  function openDatePicker() {
    const picker = $('calPick');
    try { picker.showPicker(); } catch { picker.focus(); picker.click(); }   // not in every browser
  }
  function syncViewToggle() {
    $('modeSeg').classList.toggle('open', viewOpen);
    $('vwToggle').setAttribute('aria-expanded', viewOpen);
  }
  function onModeChoice(e) {
    const button = e.target.closest('[data-mode]');
    if (!button) return;
    View.mode = button.dataset.mode;
    View.save();
    viewOpen = false;
    syncViewToggle();
    App.navigated();
    render();
  }
  function initBar() {
    $('calPrev').onclick = () => stepCalendar(-1);
    $('calNext').onclick = () => stepCalendar(1);
    $('calToday').onclick = () => go(td());
    $('calOpen').onclick = openDatePicker;
    $('calPick').onchange = e => { if (ISO_DATE.test(e.target.value)) go(e.target.value); };
    $('modeSeg').onclick = onModeChoice;
    $('lfToggle').onclick = toggleFilter;
    $('vwToggle').onclick = () => { viewOpen = !viewOpen; syncViewToggle(); };
    $('lfQ').oninput = e => { View.filter.q = e.target.value.trim(); View.save(); App.render(); };
    $('lfClear').onclick = () => { FilterPicker.clear(); App.render(); };
  }

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
  const SWIPE_FREE_ZONES = '#cycleLane, input, select, textarea, .calbar, .gp, dialog, #pop';
  const LOCK_SIDEWAYS = 'h', LOCK_UPDOWN = 'v';

  // Moves the day or week; without an opacity it goes back to the one from style.css.
  function slideWeek(x, animate, opacity) {
    ['head', 'body'].map($).forEach(el => {
      el.style.transition = animate ? `transform ${SWIPE.ms}ms ease-out, opacity ${SWIPE.ms}ms ease-out` : 'none';
      el.style.transform = x ? `translateX(${x}px)` : '';
      el.style.opacity = opacity == null ? '' : opacity;
    });
  }
  function canSwipeFrom(e) {
    return e.touches.length === 1 && matchMedia('(pointer:coarse)').matches
      && currentView().swipes && !e.target.closest(SWIPE_FREE_ZONES);
  }
  function swipeChanges(dx, startedAt, width) {
    const distance = Math.abs(dx);
    const fast = distance / Math.max(1, Date.now() - startedAt) > SWIPE.fastPxPerMs;
    return distance > width * SWIPE.changeAt || (fast && distance > SWIPE.fastMinPx);
  }
  // The old view slides out, the button changes the date, the new view slides in from the other side.
  function slideToNeighbour(weekView, button, direction) {
    const width = weekView.clientWidth;
    slideWeek(direction * width * SWIPE.outPart, true, 0);
    setTimeout(() => {
      button.click();
      slideWeek(-direction * width * SWIPE.inPart, false, 0);
      void weekView.offsetWidth;   // forces layout, so the slide in starts from that position
      slideWeek(0, true, 1);
    }, SWIPE.ms);
  }
  function initSwipe() {
    const weekView = $('weekView');
    let swipe = null;   // the touch in progress: where it started, and whether it is locked to a direction
    weekView.addEventListener('touchstart', e => {
      const touch = e.touches[0];
      swipe = canSwipeFrom(e) ? { x: touch.clientX, y: touch.clientY, at: Date.now(), lock: null, dx: 0 } : null;
    }, { passive: true });
    weekView.addEventListener('touchmove', e => {
      if (!swipe) return;
      const dx = e.touches[0].clientX - swipe.x, dy = e.touches[0].clientY - swipe.y;
      if (!swipe.lock && (Math.abs(dx) > SWIPE.lockPx || Math.abs(dy) > SWIPE.lockPx)) {
        swipe.lock = Math.abs(dx) > SWIPE.sideways * Math.abs(dy) ? LOCK_SIDEWAYS : LOCK_UPDOWN;
      }
      if (swipe.lock !== LOCK_SIDEWAYS) return;
      swipe.dx = dx;
      const fade = 1 - Math.abs(dx) / (weekView.clientWidth * SWIPE.fadeOver);
      slideWeek(dx * SWIPE.follow, false, Math.max(SWIPE.fadeMin, fade));
    }, { passive: true });
    weekView.addEventListener('touchend', () => {
      if (!swipe || swipe.lock !== LOCK_SIDEWAYS) { swipe = null; return; }
      const { dx, at } = swipe;
      swipe = null;
      const button = $(dx < 0 ? 'calNext' : 'calPrev');
      if (button.disabled || !swipeChanges(dx, at, weekView.clientWidth)) { slideWeek(0, true); return; }
      slideToNeighbour(weekView, button, dx < 0 ? -1 : 1);
    }, { passive: true });
    weekView.addEventListener('touchcancel', () => {
      if (swipe && swipe.lock === LOCK_SIDEWAYS) slideWeek(0, true);
      swipe = null;
    }, { passive: true });
  }

  function init() {
    initBar();
    initClicks();
    initSwipe();
    Drag.zone(placeZone);
    Drag.onStart(() => closePop());
  }

  return {
    init, render, closePop, reapplyFocus
  };
})();
