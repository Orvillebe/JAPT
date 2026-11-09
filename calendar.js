/**
 * JAPT Calendar - the Taken page on the right: Dag, Werkweek, Week, Werkperiode and Lijst.
 *
 * Responsibilities:
 *   - The table of view modes: per mode what differs (VIEWS, at the top)
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
  const M = Model, { $, esc, cap, View, MODE, html } = UI;
  const P = M.placeText;
  const PX_PER_HOUR = 88;        // a half-hour block still fits one task
  const PERIODS_SHOWN = 4;       // periods side by side in the period view
  const HOURS_COL_W = 56;        // width of the hours column (px)
  const PERIOD_COL_MIN_W = 150;  // a short period's column stays wide enough for its tasks (px)
  const MEETING_MIN_H = 18;      // a short meeting is still tall enough for its title (px)
  const DAYS_PER_WEEK = 7;
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;
  const td = () => M.today();

  /* ---------- the view modes ---------- */

  function oneDay(date) { return [date]; }
  function wholeWeek(date) { return M.weekDays(date); }
  function workDays(date) { return M.weekDays(date).filter(day => !M.isWeekend(day)); }

  function stepByDays(count) { return (date, direction) => M.addDays(date, direction * count); }
  // The start of the neighbouring period, or null when there is none to go to.
  function stepByPeriod(date, direction) {
    const period = Store.periodAt(date);
    if (direction > 0) return period ? M.addDays(period.end, 1) : null;
    const previous = period && Store.periodAt(M.addDays(period.start, -1));
    return previous ? previous.start : null;
  }

  // What differs per view mode. A new view is a row here and a draw function (and a SURFACES row if
  // it draws somewhere new).
  //   days          the days it shows; period and list have no days of their own, the bar still uses these
  //   hidesWeekend  Saturday and Sunday are left out of a period's span too
  //   step          the date that previous (-1) or next (1) goes to, or null to stay
  //   cssClass      the class on #weekView; style.css shows and hides the parts of the page with it
  //   needsAgenda   whether meetings are fetched for its days
  //   swipes        whether a finger can move it to the previous or next one (phone)
  //   draw          the function that draws it
  const VIEWS = {
    [MODE.DAY]: {
      days: oneDay, hidesWeekend: false, step: stepByDays(1),
      cssClass: 'daymode', needsAgenda: true, swipes: true, draw: renderWeek
    },
    [MODE.WORKWEEK]: {
      days: workDays, hidesWeekend: true, step: stepByDays(DAYS_PER_WEEK),
      cssClass: 'wkmode', needsAgenda: true, swipes: true, draw: renderWeek
    },
    [MODE.WEEK]: {
      days: wholeWeek, hidesWeekend: false, step: stepByDays(DAYS_PER_WEEK),
      cssClass: 'wkmode', needsAgenda: true, swipes: true, draw: renderWeek
    },
    [MODE.PERIOD]: {
      days: workDays, hidesWeekend: false, step: stepByPeriod,
      cssClass: 'cymode', needsAgenda: false, swipes: false, draw: renderPeriodView
    },
    [MODE.LIST]: {
      days: workDays, hidesWeekend: false, step: stepByDays(DAYS_PER_WEEK),
      cssClass: 'listmode', needsAgenda: false, swipes: false, draw: renderListView
    }
  };
  // The view settings are read back from this device unchecked, so an unknown saved mode can occur.
  const currentView = () => VIEWS[View.mode] || VIEWS[MODE.WORKWEEK];
  const VIEW_CLASSES = [...new Set(Object.values(VIEWS).map(view => view.cssClass))];

  // The parts of the page views draw in. Only the view on screen has content; the others are emptied,
  // not left hidden.
  const SURFACES = [
    { draw: renderPeriodView, elements: ['cycleView'] },
    { draw: renderListView, elements: ['listView'] },
    { draw: renderWeek, elements: ['head', 'body', 'cycleLane'] }
  ];

  const calDays = () => currentView().days(View.date);

  /* ---------- periods as shown ---------- */

  const isRunning = period => td() >= period.start && td() <= period.end;
  const isHiddenDay = day => currentView().hidesWeekend && M.isWeekend(day);

  // In Werkweek, Saturday and Sunday are hidden: a period's span then starts and ends on a weekday.
  function spanText(period) {
    let first = period.start, last = period.end;
    while (first <= last && isHiddenDay(first)) first = M.addDays(first, 1);
    while (last >= first && isHiddenDay(last)) last = M.addDays(last, -1);
    if (first > last) { first = period.start; last = period.end; }
    return t('time.span', { a: UI.fmtSp(first), z: UI.fmtSp(last) });
  }
  // Whether the period goes on, before or after these days, on a day that is shown.
  function moreVisible(period, days, back) {
    const direction = back ? -1 : 1;
    let day = M.addDays(back ? days[0] : days[days.length - 1], direction);
    while (back ? day >= period.start : day <= period.end) {
      if (!isHiddenDay(day)) return true;
      day = M.addDays(day, direction);
    }
    return false;
  }
  // The period the calendar date is in, and the next ones.
  function periodWindow() {
    const periods = [];
    let period = Store.periodAt(View.date);
    while (period && periods.length < PERIODS_SHOWN) {
      periods.push(period);
      period = Store.periodAt(M.addDays(period.end, 1));
    }
    return periods;
  }
  const inPeriodWindow = key => periodWindow().some(period => period.key === key);
  const periodPlace = period => ({ period: period.key });

  const yearOf = date => date.slice(0, 4);
  const yearSuffix = date => (yearOf(date) === yearOf(td()) ? '' : ' ' + yearOf(date));

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
    let sub = UI.filterCount() ? t('cal.filter_on') : '';
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

  /* ---------- chips ---------- */

  const dim = k => (UI.filterCount() && !UI.passes(k) ? 'dim' : '');
  const part = (n, i) => (n > 1 ? `<span class="p">${i}/${n}</span>` : '');
  const dropHere = () => `<div class="empty">${t('cal.drop_here')}</div>`;

  // A task in a block or period. from: the place it sits in; fromPeriod: shown in that period's column.
  function chip(k, from, { side = '', after = '', fromPeriod = null } = {}) {
    const classes = ['chip', k.doneOn ? 'done' : '', Store.isLate(k) ? 'late' : '', dim(k)].join(' ');
    const fromPeriodAttr = fromPeriod ? ` data-from-period="${fromPeriod}"` : '';
    const dragAttrs = `draggable="true" data-task="${k.id}" data-from="${P(from)}"${fromPeriodAttr}`;
    return html`
      <div class="${classes}" ${dragAttrs} style="${UI.taskStyle(k)}">
        <div class="ct">
          ${UI.chk(k)}<span class="t">${esc(k.title)}</span><span class="cside">${UI.whoHtml(k)}${side}</span>
        </div>
        ${after}${UI.metaLine(k)}
      </div>`;
  }
  const xBtn = (attr, title) => `<button type="button" class="x" ${attr} title="${title}">×</button>`;
  const unplanBtn = (place, title) => xBtn(`data-unplan="${P(place)}"`, title);

  // "2/3": the task's second of three periods.
  function periodPart(id, key) {
    const periods = Store.idx().of(id).periods;
    return part(periods.length, periods.findIndex(period => period.key === key) + 1);
  }
  // A task planned on a period as a whole.
  function periodTaskChip(id, period) {
    const k = Store.task(id);
    if (!k) return '';
    const side = periodPart(id, period.key) + unplanBtn(periodPlace(period), t('cal.out_of_period'));
    return chip(k, periodPlace(period), { side });
  }

  /* ---------- work-period lane above the week ---------- */

  // The days of one period together: {period, from, to}, as positions in days.
  function periodGroups(days) {
    const groups = [];
    days.forEach((day, i) => {
      const period = Store.periodAt(day);
      if (!period) return;
      const latest = groups[groups.length - 1];
      if (latest && latest.period.key === period.key) latest.to = i;
      else groups.push({ period, from: i, to: i });
    });
    return groups;
  }
  function laneGroupHtml({ period, from, to }, days) {
    const place = periodPlace(period);
    const continuesLeft = days[from] > period.start && moreVisible(period, days.slice(from), true);
    const continuesRight = days[to] < period.end && moreVisible(period, days.slice(0, to + 1), false);
    const chips = Store.idx().tasksIn(place).map(id => periodTaskChip(id, period)).join('');
    // Grid lines count from 1 and the hours take the first column: from + 2 up to the line after to.
    const gridPos = `grid-column:${from + 2} / ${to + 3};grid-row:1`;
    const classes = ['cycle', continuesLeft ? 'cl' : '', continuesRight ? 'cr' : ''].join(' ');
    return html`
      <div class="${classes}" data-place="${P(place)}" style="${gridPos}">
        <div class="cyh"><b>${spanText(period)}</b></div>
        <div class="list">${chips || dropHere()}</div>
      </div>`;
  }
  function renderLane(days, cols) {
    const lane = $('cycleLane');
    lane.style.gridTemplateColumns = cols;
    lane.innerHTML = periodGroups(days).map(group => laneGroupHtml(group, days)).join('');
  }

  /* ---------- day and week ---------- */

  const heightPx = item => (item.end - item.start) / MINUTES_PER_HOUR * PX_PER_HOUR;
  const topPx = (minutes, firstHour) => (minutes / MINUTES_PER_HOUR - firstHour) * PX_PER_HOUR;

  function dayHeadHtml(day) {
    return html`
      <div class="${day === td() ? 'today' : ''}">
        ${cap(UI.wd(day))}<small>${UI.dnum(day)} ${UI.mshort(day)}</small>
      </div>`;
  }
  // The hours follow the blocks and meetings, at least dayStart to dayEnd (config.js).
  function hourRange(days) {
    const items = [...days.flatMap(Store.blocksOn), ...days.flatMap(Agenda.on)];
    const earliest = Math.min(...items.map(item => item.start / MINUTES_PER_HOUR), HOURS_PER_DAY);
    const latest = Math.max(...items.map(item => item.end / MINUTES_PER_HOUR), 0);
    return {
      firstHour: Math.min(JAPT_CONFIG.dayStart, Math.floor(earliest)),
      lastHour: Math.max(JAPT_CONFIG.dayEnd, Math.ceil(latest))
    };
  }
  function hoursColumnHtml(firstHour, lastHour) {
    let labels = '';
    for (let hour = firstHour; hour <= lastHour; hour++) {
      labels += `<span style="top:${(hour - firstHour) * PX_PER_HOUR}px">${hour}:00</span>`;
    }
    return `<div class="times" style="height:${(lastHour - firstHour) * PX_PER_HOUR}px">${labels}</div>`;
  }
  function meetingHtml(meeting, firstHour) {
    const position = `top:${topPx(meeting.start, firstHour)}px;height:${Math.max(MEETING_MIN_H, heightPx(meeting))}px`;
    return html`
      <div class="meeting" style="${position}">
        <b>${esc(meeting.title)}</b>${UI.span(UI.fmt(meeting.start), UI.fmt(meeting.end))}
      </div>`;
  }
  function blockChip(id, place) {
    const k = Store.task(id);
    if (!k) return '';
    const blocks = Store.idx().of(id).blocks, key = M.placeKey(place);
    const position = blocks.findIndex(b => b.key === key) + 1;
    return chip(k, place, { side: part(blocks.length, position) + unplanBtn(place, t('cal.out_of_block')) });
  }
  function blockHtml(day, block, firstHour) {
    const place = { date: day, blockId: block.id };
    const chips = Store.idx().tasksIn(place).map(id => blockChip(id, place)).join('');
    const position = `top:${topPx(block.start, firstHour)}px;height:${heightPx(block)}px`;
    const label = block.label ? `<span>${esc(block.label)}</span>` : '';
    return html`
      <div class="block" data-place="${P(place)}" style="${position}">
        <div class="bh">${label}<span>${UI.span(UI.fmt(block.start), UI.fmt(block.end))}</span></div>
        <div class="list">${chips || dropHere()}</div>
      </div>`;
  }
  function dayColumnHtml(day, firstHour, lastHour) {
    const blocks = Store.blocksOn(day);
    const today = day === td() ? 'today' : '', off = blocks.length ? '' : 'off', past = day < td() ? 'past' : '';
    const meetingsHtml = Agenda.on(day).map(meeting => meetingHtml(meeting, firstHour)).join('');
    const blocksHtml = blocks.map(block => blockHtml(day, block, firstHour)).join('');
    const height = (lastHour - firstHour) * PX_PER_HOUR;
    return html`
      <div class="col ${today} ${off} ${past}" style="--px:${PX_PER_HOUR}px;height:${height}px">
        ${meetingsHtml}${blocksHtml}
      </div>`;
  }
  function renderWeek() {
    const days = calDays(), cols = `${HOURS_COL_W}px repeat(${days.length},minmax(0,1fr))`;
    const headEl = $('head'), bodyEl = $('body');
    headEl.style.gridTemplateColumns = cols;
    bodyEl.style.gridTemplateColumns = cols;
    headEl.innerHTML = '<div></div>' + days.map(dayHeadHtml).join('');
    const { firstHour, lastHour } = hourRange(days);
    bodyEl.innerHTML = hoursColumnHtml(firstHour, lastHour)
      + days.map(day => dayColumnHtml(day, firstHour, lastHour)).join('');
    renderLane(days, cols);
    fitBlocks();
  }
  const ROUNDING_TOLERANCE_PX = 1;   // scrollHeight is rounded: one pixel over still fits
  // Blocks where the tasks don't fit get compact rows instead of a scrollbar.
  function fitBlocks() {
    document.querySelectorAll('#body .block').forEach(block => {
      block.classList.remove('tight', 'snug');
      const list = block.querySelector('.list');
      const overflows = () => list && list.scrollHeight > list.clientHeight + ROUNDING_TOLERANCE_PX;
      if (!overflows()) return;
      block.classList.add('snug');
      if (overflows()) { block.classList.remove('snug'); block.classList.add('tight'); }
    });
  }

  /* ---------- work-period view ---------- */

  function phonePeriodTitle(period) {
    const { start, end } = period;
    return t('time.span', {
      a: `${UI.dnum(start)} ${UI.mshort(start)}${yearOf(start) !== yearOf(end) ? ' ' + yearOf(start) : ''}`,
      z: `${UI.dnum(end)} ${UI.mshort(end)}${yearSuffix(end)}`
    });
  }
  function phonePeriodSub(index, count) {
    const several = count > 1;
    const position = several
      ? `${index > 0 ? '‹ ' : ''}${t('cal.n_of', { i: index + 1, n: count })}${index < count - 1 ? ' ›' : ''}`
      : '';
    const filter = UI.filterCount() ? (several ? ' · ' : '') + t('cal.filter_on') : '';
    return position + filter;
  }
  // Phone: the title shows the period in view (1 of 4).
  function syncPeriodHint() {
    if (!UI.PHONE()) return;
    const scroller = $('cycleView'), periods = periodWindow();
    if (!scroller || !periods.length) return;
    const scrolled = scroller.clientWidth ? Math.round(scroller.scrollLeft / scroller.clientWidth) : 0;
    const index = Math.min(periods.length - 1, scrolled);
    $('calTitle').textContent = phonePeriodTitle(periods[index]);
    $('calSub').textContent = phonePeriodSub(index, periods.length);
  }
  function periodHeadHtml(period) {
    return html`
      <div class="${isRunning(period) ? 'today' : ''}">
        ${UI.fmtDay(period.start)}<small>${t('time.until', { z: UI.fmtSp(period.end) })}</small>
      </div>`;
  }
  // A task on one or more blocks in the period: shown once, with its days.
  function datedChip(id, from, period) {
    const k = Store.task(id);
    if (!k) return '';
    const blocks = Store.idx().of(id).blocks.filter(b => b.date >= period.start && b.date <= period.end);
    const several = blocks.length > 1;
    const when = blocks.map(b => `${UI.fmtDay(b.date)} · ${UI.span(UI.fmt(b.start), UI.fmt(b.end))}`).join('<br>');
    const after = html`
      <div class="meta">
        <div class="mrow plan">
          <span class="k">${t(several ? 'meta.days' : 'meta.day')}</span>
          <span class="v">${when}</span>
        </div>
      </div>`;
    const side = xBtn(`data-unplan-days="${period.key}"`, t(several ? 'cal.out_of_blocks' : 'cal.out_of_block'));
    return chip(k, from, { side, after, fromPeriod: period.key });
  }
  // Each task on a block in this period, with the first of those blocks: Map(task id -> place).
  function firstPlacesIn(period) {
    const first = new Map();
    for (let day = period.start; day <= period.end; day = M.addDays(day, 1)) {
      for (const block of Store.blocksOn(day)) {
        const place = { date: day, blockId: block.id };
        for (const id of Store.idx().tasksIn(place)) if (!first.has(id)) first.set(id, place);
      }
    }
    return first;
  }
  // First the period's own tasks (free to order), then the tasks on a block (fixed on their day).
  function periodColumnHtml(period) {
    const dated = [...firstPlacesIn(period)].map(([id, from]) => datedChip(id, from, period));
    const own = Store.idx().tasksIn(periodPlace(period)).map(id => periodTaskChip(id, period)).join('');
    const body = (own ? `<div class="cyown">${own}</div>` : '')
      + (dated.length && own ? `<div class="cysep">${t('cal.on_fixed_days')}</div>` : '')
      + (dated.length ? `<div class="cydated">${dated.join('')}</div>` : '');
    return html`
      <div class="cycol ${isRunning(period) ? 'today' : ''}">
        <div class="cyblock" data-place="${P(periodPlace(period))}">${body || dropHere()}</div>
      </div>`;
  }
  function renderPeriodView() {
    const periods = periodWindow();
    const columns = periods.map(period => `minmax(${PERIOD_COL_MIN_W}px,${period.weight}fr)`).join(' ');
    const gridStyle = `--n:${periods.length};grid-template-columns:${columns}`;
    $('cycleView').innerHTML = html`
      <div class="cyhead" style="${gridStyle}">${periods.map(periodHeadHtml).join('')}</div>
      <div class="cybody" style="${gridStyle}">${periods.map(periodColumnHtml).join('')}</div>`;
    syncPeriodHint();
  }

  /* ---------- list view ---------- */

  let listFilterOpen = false;
  function renderListFilter() {
    UI.msRender('lfWho', 'who', 'list');
    UI.msRender('lfGoal', 'goal', 'list');
    UI.msRender('lfClient', 'client', 'list');
    const query = $('lfQ');
    if (document.activeElement !== query) query.value = View.filter.q;
    const filters = UI.filterCount(), toggle = $('lfToggle'), badge = toggle.querySelector('.fcount');
    $('lfClear').disabled = filters === 0;
    toggle.classList.toggle('active', filters > 0);
    badge.hidden = !filters;
    badge.textContent = filters;
    $('lFilter').classList.toggle('open', listFilterOpen);
    toggle.setAttribute('aria-expanded', listFilterOpen);
  }

  // The kinds of line in the list, by sort order: within a period first the fixed days, then the period.
  const ENTRY_DAY = 0, ENTRY_PERIOD = 1;

  const isListed = id => {
    const k = Store.task(id);
    return k && !k.doneOn && UI.passes(k);
  };
  const plannedCard = id => UI.taskCard(Store.task(id), { noPlan: true });

  function compareEntries(a, b) {
    if (a.pos !== b.pos) return a.pos < b.pos ? -1 : 1;
    return a.type - b.type || (a.date || '').localeCompare(b.date || '');
  }
  // One entry per day with listed tasks on a block and per period with listed tasks, in time order.
  function plannedEntries() {
    const plans = Store.tasks().filter(k => isListed(k.id)).map(k => Store.idx().of(k.id));
    const dates = [...new Set(plans.flatMap(plan => plan.blocks.map(b => b.date)))];
    const entries = dates.map(date => {
      const period = Store.periodAt(date);
      return { pos: period ? period.start : date, period, type: ENTRY_DAY, date };
    });
    const periods = new Map();
    plans.forEach(plan => plan.periods.forEach(period => periods.set(period.key, period)));
    periods.forEach(period => entries.push({ pos: period.start, period, type: ENTRY_PERIOD, key: period.key }));
    return entries.sort(compareEntries);
  }
  const samePeriod = (a, b) => (a ? !!b && b.key === a.key : !b);
  // Entries that follow each other in the same period (or in no period) form one section.
  function sectionsOf(entries) {
    const sections = [];
    for (const entry of entries) {
      const latest = sections[sections.length - 1];
      if (latest && samePeriod(latest.period, entry.period)) latest.entries.push(entry);
      else sections.push({ period: entry.period, entries: [entry] });
    }
    return sections;
  }
  function listDayHtml(date) {
    const blocks = Store.blocksOn(date);
    const ids = [...new Set(blocks.flatMap(b => Store.idx().tasksIn({ date, blockId: b.id })))].filter(isListed);
    const isToday = date === td();
    return html`
      <div class="lgrp">
        <h4 class="${isToday ? 'today' : ''}">
          ${UI.fmtDay(date)}${isToday ? `<span>${t('cal.today_small')}</span>` : ''}
        </h4>
        <div class="list-tasks">${ids.map(plannedCard).join('')}</div>
      </div>`;
  }
  function listWholePeriodHtml(key) {
    const ids = Store.idx().tasksIn({ period: key }).filter(isListed);
    return html`
      <div class="lgrp">
        <h4>${t('cal.whole_period')}</h4>
        <div class="list-tasks">${ids.map(plannedCard).join('')}</div>
      </div>`;
  }
  function listSectionHtml({ period, entries }) {
    const inner = entries
      .map(entry => (entry.type === ENTRY_DAY ? listDayHtml(entry.date) : listWholePeriodHtml(entry.key)))
      .join('');
    if (!period) return `<section class="lsec">${inner}</section>`;
    const running = isRunning(period) ? `<small>${t('cal.running')}</small>` : '';
    return html`
      <section class="lsec per">
        <h3>${t('meta.period')} ${spanText(period)}${running}</h3>
        ${inner}
      </section>`;
  }
  function listBacklogHtml() {
    const tasks = Store.itemsOf(M.LIST.BACKLOG, UI.passes);
    if (!tasks.length) return '';
    return html`
      <section class="lsec">
        <h3>${t('list.backlog')}<small>${tasks.length}</small></h3>
        <div class="list-tasks">${tasks.map(k => UI.taskCard(k)).join('')}</div>
      </section>`;
  }
  // Planned tasks in time order (per period first the fixed days, then the period itself), then the
  // backlog. The order within a block, a period and the backlog is your own order.
  function renderListView() {
    renderListFilter();
    const planned = sectionsOf(plannedEntries()).map(listSectionHtml).join('');
    $('listView').innerHTML = planned + listBacklogHtml() || `<div class="none-msg">${t('cal.list_empty')}</div>`;
  }

  /* ---------- render ---------- */

  function drawCurrentView() {
    const { draw } = currentView();
    for (const surface of SURFACES) {
      if (surface.draw === draw) surface.draw();
      else surface.elements.forEach(id => { $(id).innerHTML = ''; });
    }
  }
  function render() {
    // Without an active period that view doesn't exist.
    if (View.mode === MODE.PERIOD && !Store.periodActive()) View.mode = MODE.WORKWEEK;
    $('modeCycle').hidden = !Store.periodActive();
    App.syncSide();
    const weekView = $('weekView'), { cssClass } = currentView();
    VIEW_CLASSES.forEach(name => weekView.classList.toggle(name, name === cssClass));
    if (View.mode === MODE.PERIOD && !Store.periodAt(View.date)) View.date = Store.segments()[0].from;
    // An open card lives in a column that is about to be replaced: it closes first. A mark after a
    // jump has no card and stays.
    if (card) closePop(true);
    Agenda.ensure(currentView().needsAgenda ? calDays() : []);
    renderBar();
    drawCurrentView();
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
    focusId = null;
    reapplyFocus();
    if (was && restore && savedSide) Tasks.restoreSide(savedSide);
    savedSide = null;
    return was;
  }
  function popAlsoOnHtml(others) {
    const rows = others.map(b => html`
      <div class="pr">
        <span class="pday">${UI.fmtDay(b.date)}</span>
        <span>${UI.span(UI.fmt(b.start), UI.fmt(b.end))}</span>
      </div>`).join('');
    return `<div class="pn"><div class="k">${t('pop.also_on')}</div>${rows}</div>`;
  }
  function popHtml(k, id, blocks, others) {
    return html`
      <div class="pt">
        ${UI.chk(k)}<b>${esc(k.title)}</b>${UI.whoHtml(k)}
        <button type="button" class="pen" data-edit="${id}" title="${t('task.edit')}">✎</button>
      </div>
      ${k.note ? `<div class="pd">${esc(k.note)}</div>` : ''}${UI.metaLine(k)}
      ${blocks.length > 1 ? popAlsoOnHtml(others) : ''}`;
  }
  // Over the task, in the column around it; pushed left when it would stick out of the calendar.
  function placeCard(el) {
    const column = el.closest('.col') || el.closest('.cycles') || el.closest('.cyblock');
    const columnRect = column.getBoundingClientRect(), rect = el.getBoundingClientRect();
    const calendarRect = $('weekView').getBoundingClientRect(), width = Math.max(rect.width, CARD_MIN_W);
    let left = rect.left - columnRect.left;
    const overshoot = rect.left + width - (calendarRect.right - CARD_EDGE);
    if (overshoot > 0) left -= overshoot;
    card.style.width = width + 'px';
    card.style.left = left + 'px';
    card.style.top = (rect.top - columnRect.top) + 'px';
    column.appendChild(card);
  }
  function openPop(el) {
    const id = el.dataset.task, k = Store.task(id);
    if (!k) return;
    if (card) card.remove();
    const blocks = Store.idx().of(id).blocks, from = M.parsePlace(el.dataset.from);
    const others = blocks.filter(b => !M.samePlace(b.place, from));
    card = document.createElement('div');
    card.id = 'pop';
    card.setAttribute('style', UI.taskStyle(k));
    card.dataset.task = id;
    card.innerHTML = popHtml(k, id, blocks, others);
    placeCard(el);
  }
  // After a jump, a chip of the marked task in another place than the one jumped to.
  function isElsewhere(el) {
    if (!focusHost || !el.classList.contains('chip')) return false;
    const host = el.closest('[data-place]');
    return !!host && host.dataset.place !== focusHost;
  }
  function reapplyFocus() {
    document.querySelectorAll('.hl,.same').forEach(el => el.classList.remove('hl', 'same'));
    const on = focusId !== null;
    document.body.classList.toggle('hov', on);
    if (!on) { focusHost = null; return; }
    document.querySelectorAll(`[data-task="${focusId}"]`).forEach(el => {
      el.classList.add(isElsewhere(el) ? 'same' : 'hl');
    });
  }
  function focusTask(el) {
    const id = el.dataset.task, k = Store.task(id);
    if (!k) return;
    if (!savedSide) savedSide = Tasks.sideState();
    focusId = id;
    focusHost = null;
    openPop(el);
    Tasks.reveal(id);
    reapplyFocus();
  }

  /* ---------- jumping from a Plan line to the calendar ---------- */

  function moveToPeriodPlace(place, period) {
    const periodView = View.mode === MODE.PERIOD;
    const visible = periodView
      ? inPeriodWindow(place.period)
      : calDays().some(day => period && day >= period.start && day <= period.end);
    if (period && !visible) View.date = !periodView && isRunning(period) ? td() : period.start;
  }
  function moveToBlockPlace(place, period) {
    if (View.mode === MODE.PERIOD && period) {
      if (!inPeriodWindow(period.key)) View.date = period.start;
      return;
    }
    View.date = place.date;
    if (View.mode === MODE.PERIOD) View.mode = MODE.WORKWEEK;
  }
  function markJumpTarget(place, period, id) {
    // in the period view a task on a block is shown in its period's column
    const host = P(View.mode === MODE.PERIOD && !place.period ? periodPlace(period) : place);
    const el = document.querySelector(`[data-place="${host}"] [data-task="${id}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    focusId = id;
    jumpHold = id;
    focusHost = host;
    reapplyFocus();
  }
  // To the place a task is planned in, and mark the task there (until the mouse leaves its card).
  function jump(place, id) {
    const period = Store.periodAt(place.period || place.date);
    if (View.mode === MODE.LIST) View.mode = place.period ? MODE.PERIOD : MODE.WORKWEEK;
    if (place.period) moveToPeriodPlace(place, period);
    else moveToBlockPlace(place, period);
    View.save();
    if (View.page !== 'tasks') App.show('tasks');
    App.navigated();
    render();
    markJumpTarget(place, period, id);
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
    over: (e, host, d) => (amongItsDated(e, host, d) ? false : spotIn(e, host, d)),
    async drop(host, d, spot) {
      const mark = spot ? { id: spot.el.dataset.task, after: spot.after } : null;
      const place = M.parsePlace(host.dataset.place);
      const res = await UI.act(() => Store.plan(d.task, place, { from: d.from, fromPeriod: d.fromPeriod, mark }));
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
  // The mark after a jump ends when the mouse leaves that task's card in the sidebar.
  function onJumpHoldMove(e) {
    if (jumpHold === null) return;
    if (e.target.closest && e.target.closest(`.side .task[data-task="${jumpHold}"]`)) return;
    const id = jumpHold;
    jumpHold = null;
    if (focusId === id && !card) { focusId = null; reapplyFocus(); }
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
    $('lfToggle').onclick = () => { listFilterOpen = !listFilterOpen; renderListFilter(); };
    $('vwToggle').onclick = () => { viewOpen = !viewOpen; syncViewToggle(); };
    $('lfQ').oninput = e => { View.filter.q = e.target.value.trim(); View.save(); App.render(); };
    $('lfClear').onclick = () => { UI.clearFilter(); App.render(); };
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

  return { init, render, spanText, closePop, reapplyFocus, calDays };
})();
