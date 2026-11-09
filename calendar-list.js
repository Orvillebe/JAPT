/**
 * JAPT Calendar list - the list view: planned tasks in time order, then the backlog.
 *
 * Responsibilities:
 *   - The filter above the list, and whether it is unfolded
 *   - The planned tasks per period and day, then the backlog
 *
 */

const CalendarList = (() => {
  const M = Model, { $, View, html } = UI;
  const td = () => M.today();

  /* ---------- list view ---------- */

  let listFilterOpen = false;
  function renderListFilter() {
    FilterPicker.render('lfWho', 'who', 'list');
    FilterPicker.render('lfGoal', 'goal', 'list');
    FilterPicker.render('lfClient', 'client', 'list');
    const query = $('lfQ');
    if (document.activeElement !== query) query.value = View.filter.q;
    const filters = FilterPicker.count(), toggle = $('lfToggle'), badge = toggle.querySelector('.fcount');
    $('lfClear').disabled = filters === 0;
    toggle.classList.toggle('active', filters > 0);
    badge.hidden = !filters;
    badge.textContent = filters;
    $('lFilter').classList.toggle('open', listFilterOpen);
    toggle.setAttribute('aria-expanded', listFilterOpen);
  }
  function toggleFilter() { listFilterOpen = !listFilterOpen; renderListFilter(); }

  // The kinds of line in the list, by sort order: within a period first the fixed days, then the period.
  const ENTRY_DAY = 0, ENTRY_PERIOD = 1;

  const isListed = id => {
    const k = Store.task(id);
    return k && !k.doneOn && FilterPicker.passes(k);
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
    const running = CalendarViews.isRunning(period) ? `<small>${t('cal.running')}</small>` : '';
    return html`
      <section class="lsec per">
        <h3>${t('meta.period')} ${CalendarViews.spanText(period)}${running}</h3>
        ${inner}
      </section>`;
  }
  function listBacklogHtml() {
    const tasks = Store.itemsOf(M.LIST.BACKLOG, FilterPicker.passes);
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

  return { renderListView, toggleFilter };
})();
