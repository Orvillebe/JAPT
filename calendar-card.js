/**
 * JAPT Calendar card - the open task, and jumping from a Plan line to the calendar.
 *
 * Responsibilities:
 *   - The open task: a card over the task, the rest dimmed, the sidebar showing it
 *   - The marks on the focused task (.hl, .same)
 *   - Jumping to the place a task is planned in, and how long that mark stays
 *
 * The only owner of the open card, the focused task, the saved sidebar and the jump hold.
 * After a jump it asks Calendar.render to draw again; that is the only call back into calendar.js.
 */

const CalendarCard = (() => {
  const M = Model, { $, esc, View, MODE, html } = UI;
  const P = M.placeText;
  const td = () => M.today();

  /* ---------- the open task ---------- */

  // Click on a task in the calendar: a card with everything, the rest dims, the sidebar shows the task
  // and remembers where it was. focusHost: after a jump, only the task in that place is marked.
  const CARD_MIN_W = 270, CARD_EDGE = 6;   // the card is at least this wide, and stays this far from the edge
  let focusId = null, focusHost = null, savedSide = null, jumpHold = null;
  // The open card exists only while it is open: opening makes it, closing removes it. It sits in the day
  // column so it scrolls with the day; when the calendar is redrawn it is closed first.
  let card = null;
  const isOpen = () => card !== null;
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
      ? CalendarViews.inPeriodWindow(place.period)
      : CalendarViews.calDays().some(day => period && day >= period.start && day <= period.end);
    if (period && !visible) View.date = !periodView && CalendarViews.isRunning(period) ? td() : period.start;
  }
  function moveToBlockPlace(place, period) {
    if (View.mode === MODE.PERIOD && period) {
      if (!CalendarViews.inPeriodWindow(period.key)) View.date = period.start;
      return;
    }
    View.date = place.date;
    if (View.mode === MODE.PERIOD) View.mode = MODE.WORKWEEK;
  }
  function markJumpTarget(place, period, id) {
    // in the period view a task on a block is shown in its period's column
    const host = P(View.mode === MODE.PERIOD && !place.period ? CalendarViews.periodPlace(period) : place);
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
    Calendar.render();
    markJumpTarget(place, period, id);
  }
  // The mark after a jump ends when the mouse leaves that task's card in the sidebar.
  function onJumpHoldMove(e) {
    if (jumpHold === null) return;
    if (e.target.closest && e.target.closest(`.side .task[data-task="${jumpHold}"]`)) return;
    const id = jumpHold;
    jumpHold = null;
    if (focusId === id && !card) { focusId = null; reapplyFocus(); }
  }

  return { isOpen, closePop, reapplyFocus, focusTask, jump, onJumpHoldMove };
})();
