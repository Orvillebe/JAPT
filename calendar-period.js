/**
 * JAPT Calendar period - the work-period view: the periods side by side.
 *
 * Responsibilities:
 *   - A column per period: its own tasks, then the tasks on a block in it
 *   - Phone: the title shows the period in view
 *
 * Uses the chips of CalendarWeek, so it loads after calendar-week.js.
 */

const CalendarPeriod = (() => {
  const M = Model, { $, html } = UI;
  const P = M.placeText;
  const { chip, xBtn, dropHere, periodTaskChip } = CalendarWeek;
  const PERIOD_COL_MIN_W = 150;  // a short period's column stays wide enough for its tasks (px)

  /* ---------- work-period view ---------- */

  function phonePeriodTitle(period) {
    const { start, end } = period, { yearOf, yearSuffix } = CalendarViews;
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
    const filter = FilterPicker.count() ? (several ? ' · ' : '') + t('cal.filter_on') : '';
    return position + filter;
  }
  // Phone: the title shows the period in view (1 of 4).
  function syncPeriodHint() {
    if (!UI.PHONE()) return;
    const scroller = $('cycleView'), periods = CalendarViews.periodWindow();
    if (!scroller || !periods.length) return;
    const scrolled = scroller.clientWidth ? Math.round(scroller.scrollLeft / scroller.clientWidth) : 0;
    const index = Math.min(periods.length - 1, scrolled);
    $('calTitle').textContent = phonePeriodTitle(periods[index]);
    $('calSub').textContent = phonePeriodSub(index, periods.length);
  }
  function periodHeadHtml(period) {
    return html`
      <div class="${CalendarViews.isRunning(period) ? 'today' : ''}">
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
    const own = Store.idx().tasksIn(CalendarViews.periodPlace(period)).map(id => periodTaskChip(id, period)).join('');
    const body = (own ? `<div class="cyown">${own}</div>` : '')
      + (dated.length && own ? `<div class="cysep">${t('cal.on_fixed_days')}</div>` : '')
      + (dated.length ? `<div class="cydated">${dated.join('')}</div>` : '');
    return html`
      <div class="cycol ${CalendarViews.isRunning(period) ? 'today' : ''}">
        <div class="cyblock" data-place="${P(CalendarViews.periodPlace(period))}">${body || dropHere()}</div>
      </div>`;
  }
  function renderPeriodView() {
    const periods = CalendarViews.periodWindow();
    const columns = periods.map(period => `minmax(${PERIOD_COL_MIN_W}px,${period.weight}fr)`).join(' ');
    const gridStyle = `--n:${periods.length};grid-template-columns:${columns}`;
    $('cycleView').innerHTML = html`
      <div class="cyhead" style="${gridStyle}">${periods.map(periodHeadHtml).join('')}</div>
      <div class="cybody" style="${gridStyle}">${periods.map(periodColumnHtml).join('')}</div>`;
    syncPeriodHint();
  }

  return { renderPeriodView, syncPeriodHint };
})();
