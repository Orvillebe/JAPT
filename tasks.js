/**
 * JAPT Tasks - the task list on the left of the Taken page, and the task form.
 *
 * Responsibilities:
 *   - The four lists under each other (Nog niet ingepland, Ingepland, Gedaan, Backlog), folded by
 *     content unless you fold them yourself; search, filters and grouping by goal or client
 *   - Showing the task that is open in the calendar, and putting the sidebar back afterwards
 *   - The drop zone for these lists and the dock (drag.js): a closed list opens while you hover
 *   - The task form: new, edit, delete (to the Bin, with Ongedaan); a window made when it opens, that
 *     stays open until the save succeeded
 *   - Checking off anywhere, with what follows (a repeat, back to the Inbox, a figure)
 *
 * The rules are in docs/design.md (Which list a task is in, Deadlines and repeats).
 */

const Tasks = (() => {
  const M = Model, { $, esc, View, html } = UI;
  const LISTS = [M.LIST.OPEN, M.LIST.PLANNED, M.LIST.DONE, M.LIST.BACKLOG];
  const SORTABLE = [M.LIST.OPEN, M.LIST.BACKLOG];   // lists in your own order; Gedaan and Ingepland follow the dates
  const SPRING_MS = 500;                            // hovering this long with a task over a closed list opens it

  /* ---------- folding ---------- */

  const itemsOf = key => Store.itemsOf(key, UI.passes);
  // Only Nog niet ingepland is open; when it's empty, only Ingepland. With a search or filter, every list
  // with results is open. A manual choice wins until the situation changes.
  const defaultOpenKey = () => {
    if (itemsOf(M.LIST.OPEN).length) return M.LIST.OPEN;
    return itemsOf(M.LIST.PLANNED).length ? M.LIST.PLANNED : null;
  };
  const defaultSig = () => (
    UI.filterCount() ? 'f' + LISTS.map(k => (itemsOf(k).length ? 1 : 0)).join('') : String(defaultOpenKey())
  );
  const defaultClosed = key => (UI.filterCount() ? !itemsOf(key).length : key !== defaultOpenKey());
  const isClosed = key => (View.fold[key] !== undefined ? View.fold[key] : defaultClosed(key));
  let foldSig;

  /* ---------- the lists ---------- */

  const cardsHtml = tasks => tasks.map(k => UI.taskCard(k)).join('');
  const nameHead = text => `<span class="gname">${text}</span>`;

  function goalHead(g) {
    const client = Store.client(g.clientId);
    return html`${nameHead(esc(g.name))}
      ${g.achievedOn ? `<span class="gc">${t('goal.achieved_small')}</span>` : ''}
      ${client ? `<span class="gc">${esc(client.name)}</span>` : ''}`;
  }

  // Grouped by goal or by client; the tasks without a goal come last, under their own head.
  function groupsOf(items, mode) {
    const goalOf = k => Store.goal(k.goalId);
    let groups;
    if (mode === 'goal') {
      groups = Store.goals().map(g => ({ head: goalHead(g), tasks: items.filter(k => k.goalId === g.id) }));
    } else {
      groups = Store.clients().map(c => ({
        head: nameHead(esc(c.name)),
        tasks: items.filter(k => goalOf(k) && goalOf(k).clientId === c.id)
      }));
      groups.push({
        head: nameHead(t('client.intern')),
        tasks: items.filter(k => goalOf(k) && goalOf(k).clientId == null)
      });
    }
    groups.push({ head: nameHead(t('goal.none')), tasks: items.filter(k => !goalOf(k)) });
    return groups.filter(g => g.tasks.length);
  }

  function groupHtml(group) {
    const used = new Set();
    group.tasks.forEach(k => Store.idx().of(k.id).blocks.forEach(b => used.add(b.key)));
    return html`<div class="group">
      <div class="gh">${group.head}<span class="gn">${UI.tn('count.blocks', used.size)}</span></div>
      <div class="list-tasks">${cardsHtml(group.tasks)}</div>
    </div>`;
  }

  function renderItems(items) {
    const mode = View.groupBy;
    if (mode === 'none') return `<div class="list-tasks">${cardsHtml(items)}</div>`;
    return groupsOf(items, mode).map(groupHtml).join('');
  }

  function sectionBody(key, items) {
    const emptyText = t(key === M.LIST.OPEN ? 'list.open_empty' : 'list.empty');
    return `<div class="sb">${items.length ? renderItems(items) : `<div class="none-msg">${emptyText}</div>`}</div>`;
  }

  // One list: its head always, its tasks only while it is open.
  function sectionHtml(key) {
    const items = itemsOf(key), closed = isClosed(key);
    return html`<div class="sec ${closed ? 'closed' : ''}" data-list="${key}">
      <div class="sh" data-fold="${key}">
        <span class="chev">▸</span>
        <span class="sl">${t('list.' + key)}</span>
        <span class="cnt">${items.length}</span>
      </div>
      ${closed ? '' : sectionBody(key, items)}
    </div>`;
  }

  let showFilters = false;
  function render() {
    const fq = $('fq');
    if (document.activeElement !== fq) fq.value = View.filter.q;
    UI.msRender('fWho', 'who', 'side');
    UI.msRender('fGoal', 'goal', 'side');
    UI.msRender('fClient', 'client', 'side');
    $('fpanel').hidden = !showFilters;
    const fc = UI.filterCount(), fb = $('btnFilter');
    fb.innerHTML = fc ? `${t('filter.button')}<span class="fcount">${fc}</span>` : t('filter.button');
    fb.classList.toggle('active', fc > 0);
    $('fClear').disabled = fc === 0;
    document.querySelectorAll('#groupSeg button').forEach(b => {
      b.classList.toggle('active', b.dataset.group === View.groupBy);
    });
    const sig = defaultSig();
    if (foldSig !== undefined && foldSig !== sig) View.fold = {};
    foldSig = sig;
    $('tasks').innerHTML = LISTS.map(sectionHtml).join('');
    Calendar.reapplyFocus();
  }
  // Opening one list while a task is dragged: only that list is drawn again, so the card being dragged
  // (which may sit in another list) stays where it is.
  function springOpen(key) {
    const sec = document.querySelector(`#tasks .sec[data-list="${key}"]`);
    if (!sec || !isClosed(key)) return;
    View.fold[key] = false;
    sec.outerHTML = sectionHtml(key);
    Calendar.reapplyFocus();
  }

  // The open task in the calendar: its list opens and the card scrolls into view; afterwards back.
  const side = () => $('sidebar');
  const sideState = () => ({ top: side().scrollTop, fold: { ...View.fold } });
  function restoreSide(s) {
    View.fold = s.fold;
    render();
    side().scrollTo({ top: s.top, behavior: 'smooth' });
  }
  function reveal(id) {
    const k = Store.task(id); if (!k) return;
    const key = Store.shownList(k);
    if (isClosed(key)) { View.fold[key] = false; render(); }
    const card = document.querySelector(`#tasks .task[data-task="${id}"]`), sd = side();
    if (!card || sd.hidden) return;
    const r = card.getBoundingClientRect(), sr = sd.getBoundingClientRect();
    if (r.top < sr.top || r.bottom > sr.bottom) {
      sd.scrollTo({ top: sd.scrollTop + (r.top - sr.top) - (sd.clientHeight - r.height) / 2, behavior: 'smooth' });
    }
  }

  /* ---------- dropping on the lists and the dock ---------- */

  // Where in a list: on a card (upper or lower half), on the head (before the first), below (after the last).
  function spotIn(e, sec, drag) {
    const cards = [...sec.querySelectorAll('.task')].filter(c => c.dataset.task !== drag.task);
    if (!cards.length) return null;
    const c = e.target.closest('.task');
    if (c && c.dataset.task !== drag.task) {
      const r = c.getBoundingClientRect();
      return { el: c, after: e.clientY > r.top + r.height / 2 };
    }
    if (c) return null;
    if (e.target.closest('.sh')) return { el: cards[0], after: false };
    return { el: cards[cards.length - 1], after: true };
  }
  let springKey = null, springTimer = null;
  function stopSpring() { clearTimeout(springTimer); springTimer = null; springKey = null; }
  function startSpring(key) {
    if (springKey === key) return;
    stopSpring();
    springKey = key;
    springTimer = setTimeout(() => { if (Drag.current()) springOpen(key); springKey = null; }, SPRING_MS);
  }
  const listZone = {
    // Ingepland is not a target: a task gets there by being planned
    find: el => el.closest('#dock .dz') || el.closest(`#tasks .sec:not([data-list="${M.LIST.PLANNED}"])`),
    accepts: d => { const k = Store.task(d.task); return !!k && k.stage !== M.STAGE.INBOX; },
    over(e, tg, d) {
      const key = tg.dataset.list;
      if (key && isClosed(key)) startSpring(key); else stopSpring();
      return key && SORTABLE.includes(key) ? spotIn(e, tg, d) : null;
    },
    leave: stopSpring,
    async drop(tg, d, spot) {
      const list = tg.dataset.dropdock || tg.dataset.list;
      const mark = spot && SORTABLE.includes(list) ? { id: spot.el.dataset.task, after: spot.after } : null;
      const res = await UI.act(() => Store.moveToList(d.task, list, mark));
      if (res) notes(res.notes, d.task);
    }
  };

  /* ---------- after a save ---------- */

  // What a save means for the user, said once.
  function notes(list, id) {
    const k = Store.task(id);
    if (list.includes('repeat')) UI.toast(t('toast.repeat_next'));
    if (list.includes('inbox') && k) UI.toast(t('toast.back_in_inbox', { title: k.title }));
  }

  /* ---------- the task form ---------- */

  const formField = (label, control) => `<label class="f"><span class="fl">${label}</span>${control}</label>`;

  // A new task only: which list it starts in. The values are stages, because that is what gets saved.
  function putInFieldHtml() {
    const option = stage => `<option value="${stage}">${t('list.' + stage)}</option>`;
    const select = `<select name="list">${option(M.STAGE.OPEN)}${option(M.STAGE.BACKLOG)}</select>`;
    return formField(t('form.put_in'), select);
  }

  function formButtonsHtml(k) {
    return html`<div class="btns">
      ${k ? `<button type="button" class="danger" data-del>${t('task.delete')}</button>` : ''}
      <button type="button" data-cancel>${t('form.cancel')}</button>
      <button type="submit" class="primary">${t(k ? 'form.save' : 'form.add')}</button>
    </div>`;
  }

  function formHtml(k) {
    const inInbox = !!k && k.stage === M.STAGE.INBOX;
    const title = esc(k ? k.title : ''), hint = t('task.ph');
    const titleInput = `<input type="text" name="title" autocomplete="off" placeholder="${hint}" value="${title}">`;
    const noteArea = `<textarea name="note">${esc(k ? k.note || '' : '')}</textarea>`;
    const goals = UI.goalOptions(t(inInbox ? 'goal.not_yet' : 'goal.choose'), !inInbox, k ? k.goalId : null);
    return html`<form>
      <h3>${t(k ? 'task.edit_title' : 'task.new_title')}</h3>
      ${formField(t('form.task'), titleInput)}
      ${formField(t('form.note'), noteArea)}
      ${formField(t(inInbox ? 'form.goal_optional' : 'form.goal'), `<select name="goal">${goals}</select>`)}
      ${formField(t('form.deadline'), '<input type="date" name="deadline">')}
      <div data-rephint></div>
      <div class="f"><span class="fl">${t('form.who_long')}</span><div class="wrow" data-who></div></div>
      ${k ? '' : putInFieldHtml()}
      ${formButtonsHtml(k)}
    </form>`;
  }

  // The people still on the team, plus who is on this task already (a removed person stays visible).
  function drawWho(state) {
    const { who, q } = state;
    const removed = who.filter(m => !Store.members().some(x => x.id === m)).map(Store.member).filter(Boolean);
    q('[data-who]').innerHTML = Store.members().concat(removed).map(u => {
      const on = who.includes(u.id) ? 'on' : '', style = UI.pstyle(u.id);
      return `<button type="button" class="wtog ${on}" style="${style}" data-dwho="${u.id}">${esc(u.name)}</button>`;
    }).join('');
  }

  function toggleWho(state, e) {
    const b = e.target.closest('[data-dwho]'); if (!b) return;
    const m = b.dataset.dwho;
    state.who = state.who.includes(m) ? state.who.filter(x => x !== m) : [...state.who, m];
    drawWho(state);
  }

  // Which hint a change to a repeating task needs, or '' when nothing about the repeat changes.
  function repeatHintText(k, deadlineEl) {
    if (!k || !k.repeat) return '';
    const rep = deadlineEl.value ? deadlineEl.dataset.rep || '' : '';
    if (!rep) return t('repeat.hint_stop');
    if (rep !== k.repeat) return t('repeat.hint_all');
    return deadlineEl.value !== k.deadline ? t('repeat.hint_shift') : '';
  }

  // Changing a repeating task works for all following times: say so, only when something changes.
  function drawRepeatHint(state) {
    const msg = repeatHintText(state.task, state.deadlineEl);
    const hint = msg ? `<div class="rephint">${UI.REP_ICON}<span>${esc(msg)}</span></div>` : '';
    state.q('[data-rephint]').innerHTML = hint;
  }

  function readFields(state) {
    const { titleEl, goalEl, deadlineEl, q } = state;
    return {
      title: titleEl.value.trim(),
      note: q('[name=note]').value.trim(),
      goalId: goalEl.value || null,
      who: state.who.slice(),
      deadline: deadlineEl.value || null,
      repeat: deadlineEl.dataset.rep || null
    };
  }

  async function saveForm(state, e) {
    e.preventDefault(); if (state.busy) return;
    const { id, task: k, q } = state;
    const fields = readFields(state);
    const stage = k ? k.stage : q('[name=list]').value;
    if (UI.showProblems(Store.taskProblems(fields, stage), { title: state.titleEl, goal: state.goalEl })) return;
    state.busy = true;
    const res = await UI.act(() => (k ? Store.updateTask(id, fields) : Store.createTask({ ...fields, stage })));
    state.busy = false;
    if (!res) return;   // not saved: the form stays as you left it
    if (!k) View.fold[stage] = false;   // the list the new task goes into opens
    state.dlg.close();
  }

  // Two clicks: the first arms the button and says what will go, the second sends the task to the Bin.
  async function deleteFromForm(state) {
    const { id, task: k, q } = state;
    if (!state.delArmed) {
      const del = q('[data-del]'), n = Store.idx().of(id).blocks.length;
      state.delArmed = true;
      del.classList.add('confirm');
      del.textContent = n ? UI.tn('task.delete_sure_blocks', n) : t('task.delete_sure');
      return;
    }
    if (state.busy) return;
    state.busy = true;
    const res = await UI.act(() => Store.binTask(id));
    state.busy = false;
    if (!res) return;
    state.dlg.close();
    UI.toast(t('toast.to_bin', { title: k.title }), res.undo);
  }

  // New (id null) or edit. The window is made here and removed when it closes; it closes only after the
  // save succeeded, so nothing you typed is lost when saving fails.
  function openForm(id) {
    const k = id ? Store.task(id) : null; if (id && !k) return;
    Calendar.closePop();
    const dlg = UI.dialog();
    dlg.innerHTML = formHtml(k);
    const f = dlg.querySelector('form'), q = sel => f.querySelector(sel);
    const state = {
      id, task: k, dlg, q,
      titleEl: q('[name=title]'), goalEl: q('[name=goal]'), deadlineEl: q('[name=deadline]'),
      who: k ? Store.whoOf(id).slice() : [],
      delArmed: false, busy: false
    };

    state.goalEl.value = k && k.goalId != null ? k.goalId : '';
    UI.gpBuild(state.goalEl);
    UI.wrapDeadline(state.deadlineEl);
    if (k) UI.setDeadline(state.deadlineEl, k.deadline, k.repeat);

    drawWho(state);
    q('[data-who]').onclick = e => toggleWho(state, e);
    state.deadlineEl.addEventListener('dxsync', () => drawRepeatHint(state));

    q('[data-cancel]').onclick = () => dlg.close();
    f.onsubmit = e => saveForm(state, e);
    if (k) q('[data-del]').onclick = () => deleteFromForm(state);
    state.titleEl.focus();
  }
  const openNew = () => openForm(null);
  const openEdit = id => openForm(id);

  /* ---------- checking off ---------- */

  async function check(box) {
    const id = box.dataset.check, k = Store.task(id); if (!k) return;
    if (box.checked) Figures.maybe(box);
    if (k.stage === M.STAGE.INBOX) {
      if (!await Inbox.process(id, M.LIST.DONE)) box.checked = !box.checked;
      return;
    }
    const res = await UI.act(() => Store.setDone(id, box.checked));
    if (res) notes(res.notes, id); else box.checked = !box.checked;   // not saved: the box shows what is stored
  }

  function init() {
    $('btnNewTask').onclick = openNew;
    $('fq').oninput = e => { View.filter.q = e.target.value.trim(); View.save(); App.render(); };
    $('btnFilter').onclick = () => { showFilters = !showFilters; render(); };
    $('fClear').onclick = () => { UI.clearFilter(); $('fq').value = ''; App.render(); };
    $('groupSeg').onclick = e => {
      const b = e.target.closest('[data-group]');
      if (b) { View.groupBy = b.dataset.group; View.save(); render(); }
    };
    $('btnHideSide').onclick = () => { View.sbHidden = true; View.save(); App.syncSide(); };
    $('btnShowSide').onclick = () => { View.sbHidden = false; View.save(); App.syncSide(); render(); };
    document.addEventListener('click', e => {
      const fo = e.target.closest('[data-fold]');
      if (fo) { const key = fo.dataset.fold; View.fold[key] = !isClosed(key); render(); return; }
      const ed = e.target.closest('[data-edit]');
      if (ed) openEdit(ed.dataset.edit);
    });
    document.addEventListener('change', e => { const c = e.target.closest('[data-check]'); if (c) check(c); });
    Drag.zone(listZone);
  }

  return { init, render, sideState, restoreSide, reveal, notes, openEdit };
})();
