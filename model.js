/**
 * JAPT Model - the rules, as pure functions.
 *
 * Responsibilities:
 *   - Dates: local calendar days as 'YYYY-MM-DD', today, weeks from the shared first day
 *   - Work blocks: which blocks exist on a date (a block has a validity), fitting and checking times
 *   - Work periods: which period a date falls in, from the segments in Beheer
 *   - Places (a block on a date, or a work period) and their one text form
 *   - The plan index: where every task is planned, built once from the placements
 *   - Which list a task is in, due soon, planned late, only planned in the past
 *   - Repeats: the next deadline
 *   - Manual order: a position between two neighbours
 *   - Filters and goal colours
 *
 * No DOM, no storage: everything here is testable with node (tests/model.test.js).
 * The Store calls these functions; the rules themselves are described in docs/design.md.
 */

function createModel(CFG) {
  /* ---------- dates ---------- */

  // A date is a calendar day 'YYYY-MM-DD'. Arithmetic runs in UTC so that daylight saving never
  // shifts a day; "today" is the local day, so just after midnight in Belgium it is already the new day.
  const parseD = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const toDs = d => d.toISOString().slice(0, 10);
  const addDays = (ds, n) => { const d = parseD(ds); d.setUTCDate(d.getUTCDate() + n); return toDs(d); };
  const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  // The same day in another month; a short month keeps its last day (31 January + 1 month = 28 February).
  function addMonths(ds, n) {
    const d = parseD(ds), t = d.getUTCFullYear() * 12 + d.getUTCMonth() + n, y = Math.floor(t / 12), m = t - y * 12;
    return toDs(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), daysIn(y, m)))));
  }
  const weekday = ds => parseD(ds).getUTCDay();     // 0 = Sunday ... 6 = Saturday
  const pad2 = n => String(n).padStart(2, '0');
  const localDs = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  let fixedToday = null;
  const today = () => fixedToday || localDs(new Date());
  const setToday = ds => { fixedToday = ds; };      // tests and the test page only

  let weekStart = CFG.weekStart;
  const setWeekStart = n => { weekStart = n; };
  const getWeekStart = () => weekStart;
  const weekFirst = ds => addDays(ds, -((weekday(ds) - weekStart + 7) % 7));
  const weekDays = ds => { const f = weekFirst(ds); return Array.from({ length: 7 }, (_, i) => addDays(f, i)); };
  const isWeekend = ds => weekday(ds) === 0 || weekday(ds) === 6;
  // The weekdays in the order of the first day of the week, for Beheer and the date picker.
  const weekOrder = () => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);

  /* ---------- time of day ---------- */

  // Times are minutes after midnight. Blocks snap to quarters.
  const SNAP = 15, MINLEN = 15;
  const snap = m => Math.round(m / SNAP) * SNAP;
  const hhmm = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const hhmm2 = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const parseHm = v => { const [h, m] = String(v).split(':').map(Number); return h * 60 + (m || 0); };

  /* ---------- work blocks ---------- */

  // A block is a weekly pattern {id, day, start, end, label, validFrom, validTo}. A change makes a new
  // block from today on, so past weeks keep the blocks they had (docs/design.md, Work blocks).
  const blockOnDate = (b, ds) =>
    b.day === weekday(ds) && (!b.validFrom || b.validFrom <= ds) && (!b.validTo || b.validTo >= ds);
  const blocksOn = (blocks, ds) => blocks.filter(b => blockOnDate(b, ds)).sort((a, b) => a.start - b.start);
  const currentBlocks = (blocks, day) => blocks.filter(b => !b.validTo && (day === undefined || b.day === day));

  // What a change to a block means for the stored rows: a block made today has no past to keep and is
  // changed in place; an older one ends yesterday and a copy with the change starts today.
  function blockRevision(b, change, td = today()) {
    if (b.validFrom && b.validFrom >= td) return { inPlace: true };
    return { inPlace: false, closeOn: addDays(td, -1), newFrom: td };
  }

  function blockProblem(blocks, day, id, s, e) {
    if (!(e > s)) return 'block.end_after_start';
    if (currentBlocks(blocks, day).some(o => o.id !== id && s < o.end && o.start < e)) return 'block.overlap';
    return '';
  }

  // A new place for a block while dragging in Beheer, within the room between its neighbours:
  // {start, end}, or null when there is no room. mode: create, move, top, bottom.
  function fitBlock(blocks, day, id, mode, ref, cur) {
    const ns = currentBlocks(blocks, day).filter(o => o.id !== id);
    if (mode === 'move') {
      const len = ref.end - ref.start, s0 = Math.max(0, Math.min(cur, 1440 - len)), e0 = s0 + len;
      return ns.some(o => s0 < o.end && o.start < e0) ? null : { start: s0, end: e0 };
    }
    const low = a => Math.max(0, ...ns.filter(o => o.end <= a).map(o => o.end));
    const up = a => Math.min(1440, ...ns.filter(o => o.start >= a).map(o => o.start));
    if (mode === 'top') return { start: Math.max(low(ref.start), Math.min(cur, ref.end - MINLEN)), end: ref.end };
    if (mode === 'bottom') return { start: ref.start, end: Math.min(up(ref.end), Math.max(cur, ref.start + MINLEN)) };
    const a = ref.start, lo = low(a), hi = up(a);
    if (ns.some(o => a >= o.start && a < o.end)) return null;   // started inside another block
    let s0 = Math.max(lo, Math.min(a, cur)), e0 = Math.min(hi, Math.max(a, cur));
    if (e0 - s0 < MINLEN) e0 = s0 + MINLEN;
    return e0 <= hi && s0 >= lo ? { start: s0, end: e0 } : null;
  }

  // Meetings that overlap in time stand side by side, so one never hides the other. For items {start, end}
  // (minutes), in the same order: {lane, lanes}: its place, and how many stand next to each other in its
  // group. Items that touch only at the edge don't overlap. Earlier in the list goes further left.
  function sideBySide(items) {
    const out = items.map(() => ({ lane: 0, lanes: 1 }));
    const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start);
    let group = [], laneEnds = [], groupEnd = -Infinity;
    const closeGroup = () => { group.forEach(i => { out[i].lanes = laneEnds.length; }); group = []; laneEnds = []; };
    for (const i of order) {
      if (items[i].start >= groupEnd) { closeGroup(); groupEnd = -Infinity; }
      let lane = laneEnds.findIndex(end => end <= items[i].start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = items[i].end;
      out[i].lane = lane;
      group.push(i);
      groupEnd = Math.max(groupEnd, items[i].end);
    }
    closeGroup();
    return out;
  }

  /* ---------- work periods ---------- */

  // Segments {from, length, unit}: unit 'd' (length in days) or 'm' (months). Each segment is a row of
  // periods that follow each other from 'from'; a later segment starts a new row (docs/design.md).
  // Returns {start, end, key, weight} for the period a date is in, or undefined before the first one.
  function periodIn(ds, segs) {
    if (!segs || !segs.length) return;
    const sorted = segs.slice().sort((a, b) => (a.from < b.from ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      const sg = sorted[i], nf = i + 1 < sorted.length ? sorted[i + 1].from : null;
      if (ds < sg.from) return;
      if (nf && ds >= nf) continue;
      let st, nx;
      if (sg.unit === 'm') {
        const d = parseD(ds), f = parseD(sg.from);
        const monthsApart = (d.getUTCFullYear() - f.getUTCFullYear()) * 12 + d.getUTCMonth() - f.getUTCMonth();
        let k = Math.max(0, Math.floor(monthsApart / sg.length));
        while (k > 0 && addMonths(sg.from, k * sg.length) > ds) k--;
        while (addMonths(sg.from, (k + 1) * sg.length) <= ds) k++;
        st = addMonths(sg.from, k * sg.length); nx = addMonths(sg.from, (k + 1) * sg.length);
      } else {
        const k = Math.floor(daysBetween(sg.from, ds) / sg.length);
        st = addDays(sg.from, k * sg.length); nx = addDays(st, sg.length);
      }
      const natural = addDays(nx, -1);
      const end = nf && natural >= nf ? addDays(nf, -1) : natural;   // a new segment ends the running period
      // Width in the period view: a full period counts as its set length (a month is a month).
      const weight = end === natural ? (sg.unit === 'm' ? sg.length * 30 : sg.length) : daysBetween(st, end) + 1;
      return { start: st, end, key: st, weight };
    }
  }
  // The first period that hasn't started yet: where a change in Beheer takes effect.
  function nextPeriodStart(segs, td = today()) {
    const p = periodIn(td, segs);
    return p ? addDays(p.end, 1) : segs[0].from;
  }

  /* ---------- places ---------- */

  // Where a task can be planned: {date, blockId} (a block on a date) or {period} (a work period, by
  // its first day). This is the only place that turns a place into text and back:
  //   placeKey   how the plan index files it: 'date|blockId', or the period's first day
  //   placeText  one text for both kinds, for the screen (data attributes, where a drag started):
  //              'block:date|blockId' or 'period:date', so the two can never be mistaken
  const placeKey = p => (p.period ? p.period : `${p.date}|${p.blockId}`);
  const placeText = p => (p.period ? 'period:' + p.period : 'block:' + placeKey(p));
  function parsePlace(s) {
    const per = /^period:(\d{4}-\d{2}-\d{2})$/.exec(s || '');
    if (per) return { period: per[1] };
    const blk = /^block:(\d{4}-\d{2}-\d{2})\|(.+)$/.exec(s || '');
    return blk ? { date: blk[1], blockId: blk[2] } : null;
  }
  const samePlace = (a, b) => !!a && !!b && !!a.period === !!b.period && placeKey(a) === placeKey(b);

  /* ---------- the plan index ---------- */

  // Where every task is planned, from the stored placements:
  //   blockPlacements  {taskId, date, blockId, position}
  //   periodPlacements {taskId, periodStart, position}
  // Placements in a block that doesn't exist on that date, or in a period that no longer matches the
  // setting, don't count (they are what's left after a change; the Store cleans them up).
  // Every entry carries its place, so a screen never has to build one by hand.
  function planIndex({ blocks, blockPlacements, periodPlacements, segments, periodActive }) {
    const blockById = Object.fromEntries(blocks.map(b => [b.id, b]));
    const byTask = new Map(), byBlock = new Map(), byPeriod = new Map();
    const t = id => { if (!byTask.has(id)) byTask.set(id, { blocks: [], periods: [] }); return byTask.get(id); };
    for (const p of blockPlacements) {
      const b = blockById[p.blockId];
      if (!b || !blockOnDate(b, p.date)) continue;
      const place = { date: p.date, blockId: p.blockId };
      const slot = { ...p, start: b.start, end: b.end, key: placeKey(place), place };
      t(p.taskId).blocks.push(slot);
      if (!byBlock.has(slot.key)) byBlock.set(slot.key, []);
      byBlock.get(slot.key).push(slot);
    }
    if (periodActive) for (const p of periodPlacements) {
      const per = periodIn(p.periodStart, segments);
      if (!per || per.key !== p.periodStart) continue;
      t(p.taskId).periods.push({ ...p, ...per, place: { period: per.key } });
      if (!byPeriod.has(per.key)) byPeriod.set(per.key, []);
      byPeriod.get(per.key).push(p);
    }
    const byPos = (a, b) => a.position - b.position;
    for (const v of byTask.values()) {
      v.blocks.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
      v.periods.sort((a, b) => (a.start < b.start ? -1 : 1));
    }
    byBlock.forEach(v => v.sort(byPos)); byPeriod.forEach(v => v.sort(byPos));
    const EMPTY = { blocks: [], periods: [] };
    const rows = place => (place.period ? byPeriod : byBlock).get(placeKey(place)) || [];
    return {
      of: id => byTask.get(id) || EMPTY,
      // the tasks in a place, in their order, and the stored row of one task there
      tasksIn: place => rows(place).map(p => p.taskId),
      placement: (place, taskId) => rows(place).find(p => p.taskId === taskId)
    };
  }

  /* ---------- lists ---------- */

  // Where a task was put (stored), and the list it shows in (worked out, see listOf).
  const STAGE = Object.freeze({ INBOX: 'inbox', OPEN: 'open', BACKLOG: 'backlog' });
  const LIST = Object.freeze({ INBOX: 'inbox', OPEN: 'open', PLANNED: 'planned', DONE: 'done', BACKLOG: 'backlog' });

  // Calculated, never stored: done wins; then planned (a block, or a period that exists); else the stage.
  // A task only planned in the past still counts as planned (accepted for now, docs/design.md).
  function listOf(task, idx) {
    if (task.doneOn) return LIST.DONE;
    if (task.stage === STAGE.INBOX) return LIST.INBOX;
    const p = idx.of(task.id);
    if (p.blocks.length || p.periods.length) return LIST.PLANNED;
    return task.stage === STAGE.BACKLOG ? LIST.BACKLOG : LIST.OPEN;
  }
  // A deadline within the reminder days brings a task to the top of Nog niet ingepland.
  const dueSoon = (task, days, td = today()) => !!task.deadline && !task.doneOn && td >= addDays(task.deadline, -days);
  // Planned after its deadline: allowed, but shown. A block is late on a day after the deadline; a work
  // period only when it starts after the deadline, because a period that holds the deadline still
  // leaves days to finish in time (docs/design.md, Deadlines and repeats).
  const isLate = (task, idx) => {
    if (!task.deadline || task.doneOn) return false;
    const p = idx.of(task.id);
    return p.blocks.some(b => b.date > task.deadline) || p.periods.some(o => o.start > task.deadline);
  };
  // Open, and every block and period it is in lies before today. Not shown yet (Possible future).
  const onlyPlannedInPast = (task, idx, td = today()) => {
    if (task.doneOn) return false;
    const p = idx.of(task.id);
    if (!p.blocks.length && !p.periods.length) return false;
    return p.blocks.every(b => b.date < td) && p.periods.every(o => o.end < td);
  };
  // The list a task shows in: a due-soon backlog task is shown in Nog niet ingepland, its stage stays.
  const shownList = (task, idx, days, td) => {
    const l = listOf(task, idx);
    return l === LIST.BACKLOG && dueSoon(task, days, td) ? LIST.OPEN : l;
  };

  // Planning in the past checks a task off, on the day of the block or the last day of the period.
  const pastDoneDate = (target, td = today()) => {
    if (target.date) return target.date < td ? target.date : null;
    if (target.period) return target.period.end < td ? target.period.end : null;
    return null;
  };

  /* ---------- repeats ---------- */

  // A repeat is 'n:u' with u = d (days), w (weeks) or m (months), for example '3:m'.
  const parseRepeat = r => {
    if (!r) return null;
    const [n, u] = String(r).split(':');
    return +n > 0 && u && 'dwm'.includes(u) ? { n: +n, u } : null;
  };
  // The first deadline after today, counted from the previous one: a task done far too late
  // doesn't leave a pile of overdue repeats.
  function nextDeadline(deadline, repeat, td = today()) {
    const p = parseRepeat(repeat); if (!p || !deadline) return null;
    for (let i = 1; i < 5000; i++) {
      const c = p.u === 'm' ? addMonths(deadline, i * p.n) : addDays(deadline, i * p.n * (p.u === 'w' ? 7 : 1));
      if (c > td) return c;
    }
    return null;
  }

  /* ---------- manual order ---------- */

  // A position between two neighbours, so a move writes only the moved row (docs/design.md,
  // Working at the same time). null means "no neighbour on that side".
  function between(before, after) {
    if (before == null && after == null) return 1024;
    if (before == null) return after - 1024;
    if (after == null) return before + 1024;
    return (before + after) / 2;
  }
  // The position for dropping next to a neighbour in an ordered list of {id, position}.
  function positionAt(list, targetId, after) {
    const items = list.slice().sort((a, b) => a.position - b.position);
    if (targetId == null) return between(items.length ? items[items.length - 1].position : null, null);
    const i = items.findIndex(x => x.id === targetId);
    if (i < 0) return between(items.length ? items[items.length - 1].position : null, null);
    return after ? between(items[i].position, i + 1 < items.length ? items[i + 1].position : null)
                 : between(i > 0 ? items[i - 1].position : null, items[i].position);
  }

  /* ---------- filters ---------- */

  // OR within one filter (An or Vincent), AND between filters (An and Klant A).
  // who: member ids or 'none'; goal: goal ids or 'none'; client: client ids or 'intern'.
  function passes(task, f, goalOf, whoOf) {
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!(task.title.toLowerCase().includes(q) || (task.note || '').toLowerCase().includes(q))) return false;
    }
    const who = whoOf(task.id);
    if (f.who.length && !f.who.some(v => (v === 'none' ? !who.length : who.includes(v)))) return false;
    if (f.goal.length && !f.goal.some(v => (v === 'none' ? task.goalId == null : task.goalId === v))) return false;
    if (f.client.length) {
      const g = task.goalId != null ? goalOf(task.goalId) : null;
      if (!f.client.some(v => (v === 'intern' ? !!(g && g.clientId == null) : !!(g && g.clientId === v)))) return false;
    }
    return true;
  }
  const filterCount = f => (f.q ? 1 : 0) + ['who', 'goal', 'client'].filter(k => f[k].length).length;

  /* ---------- goal colours ---------- */

  // Hues with the same lightness and saturation, never green (blocks, 90-165) or purple (work periods,
  // 215-280), so a task never looks like a block or a period. -1 is the brownish grey.
  const GOAL_HUES = [8, 32, 55, 185, 208, 325];
  const GREY = -1;
  const nearestHue = h => (h === GREY ? h : GOAL_HUES.slice().sort((a, b) => {
    const d = x => { const v = Math.abs(x - h) % 360; return Math.min(v, 360 - v); };
    return d(a) - d(b);
  })[0]);
  const goalHue = g => (g && g.hue != null ? nearestHue(g.hue) : GREY);
  // A new goal gets the hue that is used least.
  const freshHue = goals => GOAL_HUES
    .map(h => ({ h, n: goals.filter(g => goalHue(g) === h).length }))
    .sort((a, b) => a.n - b.n)[0].h;

  /* ---------- colours of people ---------- */

  // Distinct, readable on white and dark; a new person gets the first one nobody has yet (it can be
  // changed in Beheer). With more people than colours, they are reused in order.
  const MEMBER_COLOURS = ['#cf6a52', '#4f80bd', '#4f9d6b', '#b07cc6', '#d1a03a', '#3fa0a8', '#c25b8a', '#7a7f8c'];
  const freshColour = members =>
    MEMBER_COLOURS.find(c => !members.some(u => u.color === c)) || MEMBER_COLOURS[members.length % MEMBER_COLOURS.length];

  return {
    parseD, toDs, addDays, addMonths, daysBetween, daysIn, weekday, today, setToday, localDs,
    setWeekStart, getWeekStart, weekFirst, weekDays, isWeekend, weekOrder,
    SNAP, MINLEN, snap, hhmm, hhmm2, parseHm,
    sideBySide, blockOnDate, blocksOn, currentBlocks, blockRevision, blockProblem, fitBlock,
    periodIn, nextPeriodStart,
    placeKey, placeText, parsePlace, samePlace,
    planIndex, STAGE, LIST, listOf, dueSoon, isLate, onlyPlannedInPast, shownList, pastDoneDate,
    parseRepeat, nextDeadline,
    between, positionAt,
    passes, filterCount,
    GOAL_HUES, GREY, nearestHue, goalHue, freshHue,
    MEMBER_COLOURS, freshColour
  };
}

const Model = typeof JAPT_CONFIG !== 'undefined' ? createModel(JAPT_CONFIG) : null;
if (typeof module !== 'undefined') module.exports = createModel;
