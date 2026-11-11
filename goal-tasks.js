/**
 * JAPT Goal tasks - the tasks in the open goal (the large goal view), per list.
 *
 * Responsibilities:
 *   - The lists under each other, as in the task list: Ingepland, Nog niet ingepland, Backlog, Gedaan.
 *     A task still in the Inbox waits under Backlog (Store.goalListOf). Gedaan starts closed
 *   - A task on one line: check box, title, its note on at most two lines, who, and when: the days it
 *     is planned, else its deadline. A click opens it into the full card, as in the task list; another
 *     click closes it
 *   - "+ Taak" under Nog niet ingepland and Backlog: the task form with this goal and that list
 *   - Dragging within and between Nog niet ingepland and Backlog (drag.js). It is the one order of those
 *     lists, the same as in the task list: a task moves among the tasks of other goals too
 *
 * Folding and the open tasks last as long as the goal view is open. goals.js owns the view and draws it
 * again after a change; the clicks inside it come here first (click).
 */

const GoalTasks = (() => {
  const M = Model, { esc, html } = UI, L = M.LIST;
  const SHOWN = [L.PLANNED, L.OPEN, L.BACKLOG, L.DONE];
  const SORTABLE = [L.OPEN, L.BACKLOG];   // your own order; Ingepland follows the dates, Gedaan the day it was done

  // The goal shown, which lists are folded, and which tasks are opened into their card.
  let goalId = null, fold = {}, opened = new Set();
  function reset(id) { goalId = id; fold = {}; opened = new Set(); }
  const isFolded = list => (fold[list] !== undefined ? fold[list] : list === L.DONE);

  /* ---------- the lists ---------- */

  const firstDay = k => {
    const p = Store.idx().of(k.id);
    return [...p.blocks.map(b => b.date), ...p.periods.map(o => o.start)].sort()[0] || '';
  };
  // The tasks of a goal in one list, in the order of that list.
  function tasksIn(id, list) {
    const mine = Store.tasksOfGoal(id).filter(k => Store.goalListOf(k) === list);
    if (list === L.PLANNED) return mine.sort((a, b) => firstDay(a).localeCompare(firstDay(b)));
    if (list === L.DONE) return mine.sort((a, b) => b.doneOn.localeCompare(a.doneOn));
    const order = Store.itemsOf(list, k => k.goalId === id).map(k => k.id);
    const at = k => (order.includes(k.id) ? order.indexOf(k.id) : order.length);   // the Inbox last
    return mine.sort((a, b) => at(a) - at(b));
  }

  // When, on the right of a line: the days it is planned, else its deadline; a task in the Inbox says so.
  function whenText(k) {
    if (k.stage === M.STAGE.INBOX) return t('list.inbox');
    if (k.doneOn) return UI.fmtDay(k.doneOn);
    const p = Store.idx().of(k.id);
    if (p.blocks.length || p.periods.length) {
      return p.blocks.map(b => UI.fmtDay(b.date)).concat(p.periods.map(() => t('meta.period'))).join(', ');
    }
    return k.deadline ? t('goal.row_deadline', { d: UI.fmtDay(k.deadline) }) : '';
  }

  // Can be dragged: in a list with your own order, and not in the Inbox (it has no place in a list yet).
  const sortable = (k, list) => SORTABLE.includes(list) && k.stage !== M.STAGE.INBOX;

  function lineHtml(k, list, g) {
    const drag = sortable(k, list) ? `draggable="true" data-task="${k.id}" data-gvsort` : '';
    const note = k.note ? `<span class="gvtn">${esc(k.note)}</span>` : '';
    return html`<div class="gvt ${k.doneOn ? 'done' : ''}" data-gvt="${k.id}" ${drag} style="${UI.goalStyle(g)}">
      ${UI.chk(k)}
      <span class="gvtb"><span class="gvtt">${esc(k.title)}</span>${note}</span>
      <span class="who">${Photos.mark(k)}${UI.whoHtml(k)}</span>
      <span class="gvts">${esc(whenText(k))}</span>
    </div>`;
  }
  // Opened: the card of the task list, with everything on it.
  const openedHtml = (k, list) =>
    `<div class="gvopen" data-gvt="${k.id}" ${sortable(k, list) ? 'data-gvsort' : ''}>${UI.taskCard(k)}</div>`;

  function sectionHtml(g, list) {
    const items = tasksIn(g.id, list), canAdd = !g.achievedOn && SORTABLE.includes(list);
    if (!items.length && !canAdd) return '';
    const folded = isFolded(list);
    const lines = items.map(k => (opened.has(k.id) ? openedHtml(k, list) : lineHtml(k, list, g))).join('');
    const add = canAdd ? `<button type="button" class="gvadd" data-gvnew="${list}">${t('goal.add_task')}</button>` : '';
    return html`<div class="sec ${folded ? 'closed' : ''}" data-list="${list}" data-gvlist="${list}">
      <div class="sh" data-gvfold="${list}">
        <span class="chev">▸</span>
        <span class="sl">${t('list.' + list)}</span>
        <span class="cnt">${items.length}</span>
      </div>
      ${folded ? '' : `<div class="sb"><div class="gvlist">${lines}</div>${add}</div>`}
    </div>`;
  }

  // The lists of goal g, for the goal view. Fill the photo marks with Photos.fill once it is in the page.
  const listsHtml = g => SHOWN.map(list => sectionHtml(g, list)).join('');

  /* ---------- clicks ---------- */

  // A click in the goal view. Returns true when the view must be drawn again, close() closes it.
  function click(e, close) {
    const has = sel => e.target.closest(sel);
    if (has('[data-goto]')) { close(); return false; }   // the calendar jumps there (calendar.js)
    const f = has('[data-gvfold]');
    if (f) { fold[f.dataset.gvfold] = !isFolded(f.dataset.gvfold); return true; }
    const n = has('[data-gvnew]');
    if (n) { Tasks.openNew({ goalId, stage: n.dataset.gvnew }); return false; }
    if (has('input,button,select,a,textarea')) return false;   // checking off, the pencil: as everywhere
    const line = has('[data-gvt]');
    if (!line) return false;
    const id = line.dataset.gvt;
    if (opened.has(id)) opened.delete(id); else opened.add(id);
    return true;
  }

  /* ---------- dropping ---------- */

  // Where in a list: on a line (upper or lower half), on the head (before the first), below (after the last).
  function spotIn(e, sec, drag) {
    const lines = [...sec.querySelectorAll('[data-gvsort]')].filter(x => x.dataset.gvt !== drag.task);
    if (!lines.length) return null;
    const on = e.target.closest('[data-gvsort]');
    if (on && on.dataset.gvt !== drag.task) {
      const r = on.getBoundingClientRect();
      return { el: on, after: e.clientY > r.top + r.height / 2 };
    }
    if (on) return null;
    if (e.target.closest('.sh')) return { el: lines[0], after: false };
    return { el: lines[lines.length - 1], after: true };
  }
  const zone = {
    find: el => el.closest(SORTABLE.map(l => `dialog.gvw .sec[data-gvlist="${l}"]`).join(',')),
    accepts(d) {
      const k = Store.task(d.task);
      return !!k && k.goalId === goalId && sortable(k, Store.goalListOf(k));
    },
    over: (e, sec, d) => (isFolded(sec.dataset.gvlist) ? null : spotIn(e, sec, d)),
    async drop(sec, d, spot) {
      const mark = spot ? { id: spot.el.dataset.gvt, after: spot.after } : null;
      const res = await UI.act(() => Store.moveToList(d.task, sec.dataset.gvlist, mark));
      if (res) Tasks.notes(res.notes, d.task);
    }
  };

  function init() { Drag.zone(zone); }

  return { init, reset, listsHtml, click };
})();
