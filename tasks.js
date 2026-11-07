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
  const M = Model, { $, esc, View } = UI;
  const LISTS = ['open', 'planned', 'done', 'backlog'];
  const SORTABLE = ['open', 'backlog'];   // lists in your own order; Gedaan and Ingepland follow the dates
  const SPRING_MS = 500;                  // hovering this long with a task over a closed list opens it

  /* ---------- folding ---------- */

  const itemsOf = key => Store.itemsOf(key, UI.passes);
  // Only Nog niet ingepland is open; when it's empty, only Ingepland. With a search or filter, every list
  // with results is open. A manual choice wins until the situation changes.
  const defaultOpenKey = () => (itemsOf('open').length ? 'open' : itemsOf('planned').length ? 'planned' : null);
  const defaultSig = () => (UI.filterCount() ? 'f' + LISTS.map(k => (itemsOf(k).length ? 1 : 0)).join('') : String(defaultOpenKey()));
  const defaultClosed = key => (UI.filterCount() ? !itemsOf(key).length : key !== defaultOpenKey());
  const isClosed = key => (View.fold[key] !== undefined ? View.fold[key] : defaultClosed(key));
  let foldSig;

  /* ---------- the lists ---------- */

  function renderItems(items) {
    const mode = View.groupBy, card = k => UI.taskCard(k);
    if (mode === 'none') return `<div class="list-tasks">${items.map(card).join('')}</div>`;
    const goalOf = k => Store.goal(k.goalId);
    let groups;
    if (mode === 'goal') {
      groups = Store.goals().map(g => ({ head: `<span class="gname">${esc(g.name)}</span>${g.achievedOn ? `<span class="gc">${t('goal.achieved_small')}</span>` : ''}${Store.client(g.clientId) ? `<span class="gc">${esc(Store.client(g.clientId).name)}</span>` : ''}`, tasks: items.filter(k => k.goalId === g.id) }));
    } else {
      groups = Store.clients().map(c => ({ head: `<span class="gname">${esc(c.name)}</span>`, tasks: items.filter(k => goalOf(k) && goalOf(k).clientId === c.id) }));
      groups.push({ head: `<span class="gname">${t('client.intern')}</span>`, tasks: items.filter(k => goalOf(k) && goalOf(k).clientId == null) });
    }
    groups.push({ head: `<span class="gname">${t('goal.none')}</span>`, tasks: items.filter(k => !goalOf(k)) });
    return groups.filter(g => g.tasks.length).map(g => {
      const used = new Set(); g.tasks.forEach(k => Store.idx().of(k.id).blocks.forEach(b => used.add(b.key)));
      return `<div class="group"><div class="gh">${g.head}<span class="gn">${UI.tn('count.blocks', used.size)}</span></div><div class="list-tasks">${g.tasks.map(card).join('')}</div></div>`;
    }).join('');
  }
  // One list: its head always, its tasks only while it is open.
  function sectionHtml(key) {
    const items = itemsOf(key), closed = isClosed(key);
    const body = closed ? '' : `<div class="sb">${items.length ? renderItems(items) : `<div class="none-msg">${t(key === 'open' ? 'list.open_empty' : 'list.empty')}</div>`}</div>`;
    return `<div class="sec ${closed ? 'closed' : ''}" data-list="${key}">
      <div class="sh" data-fold="${key}"><span class="chev">▸</span><span class="sl">${t('list.' + key)}</span><span class="cnt">${items.length}</span></div>${body}</div>`;
  }

  let showFilters = false;
  function render() {
    const fq = $('fq'); if (document.activeElement !== fq) fq.value = View.filter.q;
    UI.msRender('fWho', 'who', 'side'); UI.msRender('fGoal', 'goal', 'side'); UI.msRender('fClient', 'client', 'side');
    $('fpanel').hidden = !showFilters;
    const fc = UI.filterCount(), fb = $('btnFilter');
    fb.innerHTML = fc ? `${t('filter.button')}<span class="fcount">${fc}</span>` : t('filter.button');
    fb.classList.toggle('active', fc > 0);
    $('fClear').disabled = fc === 0;
    document.querySelectorAll('#groupSeg button').forEach(b => b.classList.toggle('active', b.dataset.group === View.groupBy));
    const sig = defaultSig(); if (foldSig !== undefined && foldSig !== sig) View.fold = {}; foldSig = sig;
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
  function restoreSide(s) { View.fold = s.fold; render(); side().scrollTo({ top: s.top, behavior: 'smooth' }); }
  function reveal(id) {
    const k = Store.task(id); if (!k) return;
    const key = Store.shownList(k);
    if (isClosed(key)) { View.fold[key] = false; render(); }
    const card = document.querySelector(`#tasks .task[data-task="${id}"]`), sd = side(); if (!card || sd.hidden) return;
    const r = card.getBoundingClientRect(), sr = sd.getBoundingClientRect();
    if (r.top < sr.top || r.bottom > sr.bottom) sd.scrollTo({ top: sd.scrollTop + (r.top - sr.top) - (sd.clientHeight - r.height) / 2, behavior: 'smooth' });
  }

  /* ---------- dropping on the lists and the dock ---------- */

  // Where in a list: on a card (upper or lower half), on the head (before the first), below (after the last).
  function spotIn(e, sec, drag) {
    const cards = [...sec.querySelectorAll('.task')].filter(c => c.dataset.task !== drag.task);
    if (!cards.length) return null;
    const c = e.target.closest('.task');
    if (c && c.dataset.task !== drag.task) { const r = c.getBoundingClientRect(); return { el: c, after: e.clientY > r.top + r.height / 2 }; }
    if (c) return null;
    if (e.target.closest('.sh')) return { el: cards[0], after: false };
    return { el: cards[cards.length - 1], after: true };
  }
  let springKey = null, springTimer = null;
  function stopSpring() { clearTimeout(springTimer); springTimer = null; springKey = null; }
  const listZone = {
    // Ingepland is not a target: a task gets there by being planned
    find: el => el.closest('#dock .dz') || el.closest('#tasks .sec:not([data-list="planned"])'),
    accepts: d => { const k = Store.task(d.task); return !!k && k.stage !== 'inbox'; },
    over(e, tg, d) {
      const key = tg.dataset.list;
      if (key && isClosed(key)) {
        if (springKey !== key) { stopSpring(); springKey = key; springTimer = setTimeout(() => { if (Drag.current()) springOpen(key); springKey = null; }, SPRING_MS); }
      } else stopSpring();
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

  // New (id null) or edit. The window is made here and removed when it closes; it closes only after the
  // save succeeded, so nothing you typed is lost when saving fails.
  function openForm(id) {
    const k = id ? Store.task(id) : null; if (id && !k) return;
    Calendar.closePop();
    const ib = !!k && k.stage === 'inbox';
    let who = k ? Store.whoOf(id).slice() : [], delArmed = false, busy = false;
    const dlg = UI.dialog();
    dlg.innerHTML = `<form>
      <h3>${t(k ? 'task.edit_title' : 'task.new_title')}</h3>
      <label class="f"><span class="fl">${t('form.task')}</span><input type="text" name="title" autocomplete="off" placeholder="${t('task.ph')}" value="${esc(k ? k.title : '')}"></label>
      <label class="f"><span class="fl">${t('form.note')}</span><textarea name="note">${esc(k ? k.note || '' : '')}</textarea></label>
      <label class="f"><span class="fl">${t(ib ? 'form.goal_optional' : 'form.goal')}</span><select name="goal">${UI.goalOptions(t(ib ? 'goal.not_yet' : 'goal.choose'), !ib, k ? k.goalId : null)}</select></label>
      <label class="f"><span class="fl">${t('form.deadline')}</span><input type="date" name="deadline"></label>
      <div data-rephint></div>
      <div class="f"><span class="fl">${t('form.who_long')}</span><div class="wrow" data-who></div></div>
      ${k ? '' : `<label class="f"><span class="fl">${t('form.put_in')}</span><select name="list"><option value="open">${t('list.open')}</option><option value="backlog">${t('list.backlog')}</option></select></label>`}
      <div class="btns">${k ? `<button type="button" class="danger" data-del>${t('task.delete')}</button>` : ''}<button type="button" data-cancel>${t('form.cancel')}</button><button type="submit" class="primary">${t(k ? 'form.save' : 'form.add')}</button></div>
    </form>`;
    const f = dlg.querySelector('form'), q = sel => f.querySelector(sel);
    const el = { title: q('[name=title]'), goal: q('[name=goal]'), deadline: q('[name=deadline]') };

    el.goal.value = k && k.goalId != null ? k.goalId : '';
    UI.gpBuild(el.goal);
    UI.wrapDeadline(el.deadline);
    if (k) UI.setDeadline(el.deadline, k.deadline, k.repeat);

    // the people still on the team, plus who is on this task already (a removed person stays visible)
    const drawWho = () => {
      const shown = Store.members().concat(who.filter(m => !Store.members().some(x => x.id === m)).map(Store.member).filter(Boolean));
      q('[data-who]').innerHTML = shown.map(u => `<button type="button" class="wtog ${who.includes(u.id) ? 'on' : ''}" style="${UI.pstyle(u.id)}" data-dwho="${u.id}">${esc(u.name)}</button>`).join('');
    };
    drawWho();
    q('[data-who]').onclick = e => { const b = e.target.closest('[data-dwho]'); if (!b) return; const m = b.dataset.dwho; who = who.includes(m) ? who.filter(x => x !== m) : [...who, m]; drawWho(); };

    // Changing a repeating task works for all following times: say so, only when something changes.
    const repHint = () => {
      let msg = '';
      if (k && k.repeat) {
        const rep = el.deadline.value ? el.deadline.dataset.rep || '' : '';
        if (!rep) msg = t('repeat.hint_stop'); else if (rep !== k.repeat) msg = t('repeat.hint_all'); else if (el.deadline.value !== k.deadline) msg = t('repeat.hint_shift');
      }
      q('[data-rephint]').innerHTML = msg ? `<div class="rephint">${UI.REP_ICON}<span>${esc(msg)}</span></div>` : '';
    };
    el.deadline.addEventListener('dxsync', repHint);

    q('[data-cancel]').onclick = () => dlg.close();
    f.onsubmit = async e => {
      e.preventDefault(); if (busy) return;
      const fields = { title: el.title.value.trim(), note: q('[name=note]').value.trim(), goalId: el.goal.value || null, who: who.slice(), deadline: el.deadline.value || null, repeat: el.deadline.dataset.rep || null };
      const stage = k ? k.stage : q('[name=list]').value;
      if (UI.showProblems(Store.taskProblems(fields, stage), { title: el.title, goal: el.goal })) return;
      busy = true;
      const res = await UI.act(() => (k ? Store.updateTask(id, fields) : Store.createTask({ ...fields, stage })));
      busy = false;
      if (!res) return;   // not saved: the form stays as you left it
      if (!k) View.fold[stage] = false;   // the list the new task goes into opens
      dlg.close();
    };
    if (k) q('[data-del]').onclick = async () => {
      const del = q('[data-del]');
      if (!delArmed) {
        const n = Store.idx().of(id).blocks.length;
        delArmed = true; del.classList.add('confirm');
        del.textContent = n ? UI.tn('task.delete_sure_blocks', n) : t('task.delete_sure');
        return;
      }
      if (busy) return; busy = true;
      const res = await UI.act(() => Store.binTask(id));
      busy = false;
      if (!res) return;
      dlg.close();
      UI.toast(t('toast.to_bin', { title: k.title }), res.undo);
    };
    el.title.focus();
  }
  const openNew = () => openForm(null);
  const openEdit = id => openForm(id);

  /* ---------- checking off ---------- */

  async function check(box) {
    const id = box.dataset.check, k = Store.task(id); if (!k) return;
    if (box.checked) UI.figureMaybe(box);
    if (k.stage === 'inbox') { await Inbox.process(id, 'done'); return; }
    const res = await UI.act(() => Store.setDone(id, box.checked));
    if (res) notes(res.notes, id); else box.checked = !box.checked;   // not saved: the box shows what is stored
  }

  function init() {
    $('btnNewTask').onclick = openNew;
    $('fq').oninput = e => { View.filter.q = e.target.value.trim(); View.save(); App.render(); };
    $('btnFilter').onclick = () => { showFilters = !showFilters; render(); };
    $('fClear').onclick = () => { UI.clearFilter(); $('fq').value = ''; App.render(); };
    $('groupSeg').onclick = e => { const b = e.target.closest('[data-group]'); if (b) { View.groupBy = b.dataset.group; View.save(); render(); } };
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
