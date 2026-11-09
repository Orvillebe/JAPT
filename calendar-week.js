/**
 * JAPT Calendar week - the day and week views (Dag, Werkweek, Week).
 *
 * Responsibilities:
 *   - Drawing a task in a block or period (the chips); the period view uses these too
 *   - The work-period lane above the week
 *   - The day columns: hours, meetings, work blocks with their tasks
 *   - Compact rows in a block where the tasks don't fit
 *
 */

const CalendarWeek = (() => {
  const M = Model, { $, esc, cap, html } = UI;
  const P = M.placeText;
  const PX_PER_HOUR = 88;        // a half-hour block still fits one task
  const HOURS_COL_W = 56;        // width of the hours column (px)
  const MEETING_MIN_H = 18;      // a short meeting is still tall enough for its title (px)
  const MINUTES_PER_HOUR = 60;
  const HOURS_PER_DAY = 24;
  const td = () => M.today();

  /* ---------- chips ---------- */

  const dim = k => (FilterPicker.count() && !FilterPicker.passes(k) ? 'dim' : '');
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
    const side = periodPart(id, period.key) + unplanBtn(CalendarViews.periodPlace(period), t('cal.out_of_period'));
    return chip(k, CalendarViews.periodPlace(period), { side });
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
    const place = CalendarViews.periodPlace(period);
    const continuesLeft = days[from] > period.start && CalendarViews.moreVisible(period, days.slice(from), true);
    const continuesRight = days[to] < period.end && CalendarViews.moreVisible(period, days.slice(0, to + 1), false);
    const chips = Store.idx().tasksIn(place).map(id => periodTaskChip(id, period)).join('');
    // Grid lines count from 1 and the hours take the first column: from + 2 up to the line after to.
    const gridPos = `grid-column:${from + 2} / ${to + 3};grid-row:1`;
    const classes = ['cycle', continuesLeft ? 'cl' : '', continuesRight ? 'cr' : ''].join(' ');
    return html`
      <div class="${classes}" data-place="${P(place)}" style="${gridPos}">
        <div class="cyh"><b>${CalendarViews.spanText(period)}</b></div>
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
  // Across the column: only when something else stands next to it, otherwise the stylesheet's full width.
  const COLUMN_MARGIN = 5, LANE_GAP = 3;
  function sideStyle({ lane, lanes }) {
    if (lanes === 1) return '';
    const room = `(100% - ${2 * COLUMN_MARGIN + (lanes - 1) * LANE_GAP}px) / ${lanes}`;
    const left = `calc(${COLUMN_MARGIN}px + ${lane} * (${room} + ${LANE_GAP}px))`;
    return `;left:${left};right:auto;width:calc(${room})`;
  }
  function meetingHtml(meeting, firstHour, side) {
    const height = Math.max(MEETING_MIN_H, heightPx(meeting));
    const position = `top:${topPx(meeting.start, firstHour)}px;height:${height}px${sideStyle(side)}`;
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
  // In the past a covered block keeps what was planned in it (from today on it goes back to the list); this
  // says so, because the meeting is in front of it.
  function coveredTasksHtml(ids) {
    if (!ids.length) return '';
    const titles = ids.map(id => (Store.task(id) || {}).title).filter(Boolean).join(', ');
    return `<div class="covered" title="${esc(titles)}">${UI.tn('cal.covered_tasks', ids.length)}</div>`;
  }
  const SHORT_MINUTES = 45;   // shorter has room for one task, or for its times, not both: the task goes first
  function blockPiece(place, from, to, firstHour, label, content, { noRoom = false, part = false } = {}) {
    const position = `top:${topPx(from, firstHour)}px;height:${(to - from) / 60 * PX_PER_HOUR}px`;
    const short = to - from < SHORT_MINUTES ? 'short' : '';
    const times = UI.span(UI.fmt(from), UI.fmt(to));
    return html`
      <div class="block ${short} ${noRoom ? 'noroom' : ''}" ${noRoom ? 'data-noroom' : ''} title="${short ? times : ''}"
        ${part ? `data-part-from="${from}" data-part-to="${to}"` : ''} data-place="${P(place)}" style="${position}">
        <div class="bh">${label}<span>${UI.span(UI.fmt(from), UI.fmt(to))}</span></div>
        ${content}
      </div>`;
  }
  // A block with a meeting in it acts as separate blocks, one per free part. Every task starts in the first;
  // fitBlocks spreads them.
  function blockHtml(day, block, firstHour, meetings) {
    const place = { date: day, blockId: block.id };
    const ids = Store.idx().tasksIn(place), chips = ids.map(id => blockChip(id, place)).join('');
    const label = block.label ? `<span>${esc(block.label)}</span>` : '';
    const parts = M.freeParts(block, meetings);
    if (!parts.length) {
      return blockPiece(place, block.start, block.end, firstHour, label, coveredTasksHtml(ids), { noRoom: true });
    }
    const isPart = parts.length > 1 || parts[0].start !== block.start || parts[0].end !== block.end;
    return parts.map((part, i) => {
      const content = `<div class="list">${i === 0 ? chips || dropHere() : dropHere()}</div>`;
      return blockPiece(place, part.start, part.end, firstHour, i === 0 ? label : '', content, { part: isPart });
    }).join('');
  }
  function dayColumnHtml(day, firstHour, lastHour) {
    const blocks = Store.blocksOn(day);
    const today = day === td() ? 'today' : '', off = blocks.length ? '' : 'off', past = day < td() ? 'past' : '';
    const meetings = Agenda.on(day), sides = M.sideBySide(meetings);
    const meetingsHtml = meetings.map((meeting, i) => meetingHtml(meeting, firstHour, sides[i])).join('');
    const blocksHtml = blocks.map(block => blockHtml(day, block, firstHour, meetings)).join('');
    const height = (lastHour - firstHour) * PX_PER_HOUR;
    return html`
      <div class="col ${today} ${off} ${past}" style="--px:${PX_PER_HOUR}px;height:${height}px">
        ${meetingsHtml}${blocksHtml}
      </div>`;
  }
  function renderWeek() {
    const days = CalendarViews.calDays(), cols = `${HOURS_COL_W}px repeat(${days.length},minmax(0,1fr))`;
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
  const overflows = list => list.scrollHeight > list.clientHeight + ROUNDING_TOLERANCE_PX;

  // More tasks than room: smaller cards first, each piece for itself.
  function fitPiece(piece) {
    const list = piece.querySelector('.list');
    if (!list || !overflows(list)) return;
    piece.classList.add('snug');
    if (overflows(list)) { piece.classList.remove('snug'); piece.classList.add('tight'); }
  }
  // Each task goes to the part it was put in; one that was never put in a part fills from the top. A piece first
  // makes its cards smaller; only what then still doesn't fit moves on to the next piece, in order.
  function fitOverPieces(pieces) {
    const lists = pieces.map(piece => piece.querySelector('.list'));
    const place = M.parsePlace(pieces[0].dataset.place), I = Store.idx();
    const parts = pieces.map(p => ({ start: +p.dataset.partFrom, end: +p.dataset.partTo }));
    const chips = new Map(pieces.flatMap(p => [...p.querySelectorAll('.chip')]).map(c => [c.dataset.task, c]));
    I.tasksIn(place).filter(id => chips.has(id)).forEach(id => {
      const part = M.partFor(parts, I.placement(place, id).partStart);
      lists[part === null ? 0 : part].appendChild(chips.get(id));
    });
    pieces.forEach((piece, i) => {
      const list = lists[i], next = lists[i + 1];
      if (list.querySelector('.chip')) list.querySelectorAll('.empty').forEach(el => el.remove());
      fitPiece(piece);
      while (next && overflows(list) && list.querySelectorAll('.chip').length > 1) {
        next.prepend(list.lastElementChild);
        piece.classList.remove('snug', 'tight');
        fitPiece(piece);
      }
    });
    lists.filter(list => !list.children.length).forEach(list => { list.innerHTML = dropHere(); });
  }

  function fitBlocks() {
    const byPlace = new Map();
    document.querySelectorAll('#body .block').forEach(piece => {
      piece.classList.remove('tight', 'snug');
      if (!byPlace.has(piece.dataset.place)) byPlace.set(piece.dataset.place, []);
      byPlace.get(piece.dataset.place).push(piece);
    });
    byPlace.forEach(pieces => (pieces.length > 1 ? fitOverPieces(pieces) : pieces.forEach(fitPiece)));
  }

  return { renderWeek, fitBlocks, chip, xBtn, dropHere, periodTaskChip };
})();
