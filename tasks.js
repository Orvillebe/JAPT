/**
 * JAPT Tasks - the task list on the left of the Taken page, and the task form.
 *
 * Responsibilities:
 *   - The four lists under each other (Nog niet ingepland, Ingepland, Gedaan, Backlog), folded by
 *     content unless you fold them yourself; search, filters and grouping by goal or client
 *   - Showing the task that is open in the calendar, and putting the sidebar back afterwards
 *   - The task form: new, edit, delete (to the Bin, with Ongedaan)
 *   - Checking off anywhere, with what follows (a repeat, back to the Inbox, a figure)
 *
 * The rules are in docs/design.md (Which list a task is in, Deadlines and repeats).
 */

const Tasks = (() => {
  const M = Model, { $, esc, View } = UI;
  const LISTS = ['open', 'planned', 'done', 'backlog'];

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
    if (!items.length) return `<div class="none-msg">${t('list.empty')}</div>`;
    const mode = View.groupBy, card = k => UI.taskCard(k);
    if (mode === 'none') return `<div class="list-tasks">${items.map(card).join('')}</div>`;
    let groups;
    if (mode === 'goal') {
      groups = Store.goals().map(g => ({ head: `<span class="gname">${esc(g.name)}</span>${g.achievedOn ? `<span class="gc">${t('goal.achieved_small')}</span>` : ''}${Store.client(g.clientId) ? `<span class="gc">${esc(Store.client(g.clientId).name)}</span>` : ''}`, tasks: items.filter(k => k.goalId === g.id) }));
      groups.push({ head: `<span class="gname">${t('goal.none')}</span>`, tasks: items.filter(k => !Store.goal(k.goalId)) });
    } else {
      groups = Store.clients().map(c => ({ head: `<span class="gname">${esc(c.name)}</span>`, tasks: items.filter(k => { const g = Store.goal(k.goalId); return g && g.clientId === c.id; }) }));
      groups.push({ head: `<span class="gname">${t('client.intern')}</span>`, tasks: items.filter(k => { const g = Store.goal(k.goalId); return g && g.clientId == null; }) });
      groups.push({ head: `<span class="gname">${t('goal.none')}</span>`, tasks: items.filter(k => !Store.goal(k.goalId)) });
    }
    return groups.filter(g => g.tasks.length).map(g => {
      const used = new Set(); g.tasks.forEach(k => Store.idx().of(k.id).blocks.forEach(b => used.add(b.key)));
      return `<div class="group"><div class="gh">${g.head}<span class="gn">${UI.tn('count.blocks', used.size)}</span></div><div class="list-tasks">${g.tasks.map(card).join('')}</div></div>`;
    }).join('');
  }
  const secBody = key => { const items = itemsOf(key); return `<div class="sb">${items.length ? renderItems(items) : `<div class="none-msg">${t(key === 'open' ? 'list.open_empty' : 'list.empty')}</div>`}</div>`; };

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
    $('tasks').innerHTML = LISTS.map(key => {
      const items = itemsOf(key), closed = isClosed(key);
      return `<div class="sec ${closed ? 'closed' : ''}" data-list="${key}">
        <div class="sh" data-fold="${key}"><span class="chev">▸</span><span class="sl">${t('list.' + key)}</span><span class="cnt">${items.length}</span></div>
        ${closed ? '' : secBody(key)}</div>`;
    }).join('');
    Calendar.reapplyFocus();
  }
  function springOpen(key) {
    const sec = document.querySelector(`#tasks .sec[data-list="${key}"]`);
    if (!sec || !sec.classList.contains('closed')) return;
    View.fold[key] = false; sec.classList.remove('closed'); sec.insertAdjacentHTML('beforeend', secBody(key));
  }
  let showFilters = false;

  // The open task in the calendar: its list opens and the card scrolls into view; afterwards back.
  const side = () => document.querySelector('.side');
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

  /* ---------- after a save ---------- */

  // What a save means for the user, said once.
  function notes(list, id) {
    const k = Store.task(id);
    if (list.includes('repeat')) UI.toast(t('toast.repeat_next'));
    if (list.includes('inbox') && k) UI.toast(t('toast.back_in_inbox', { title: k.title }));
  }

  /* ---------- the task form ---------- */

  let editId = null, dlgWho = [], delArmed = false;
  const dlg = () => $('taskDlg');
  const inInbox = () => editId !== null && Store.task(editId) && Store.task(editId).stage === 'inbox';
  function drawWho() {
    $('dlgWho').innerHTML = Store.members().concat(dlgWho.filter(id => !Store.members().some(m => m.id === id)).map(Store.member).filter(Boolean))
      .map(u => `<button type="button" class="wtog ${dlgWho.includes(u.id) ? 'on' : ''}" style="${UI.pstyle(u.id)}" data-dwho="${u.id}">${esc(u.name)}</button>`).join('');
  }
  function fillGoal(selected, keepId) {
    const ib = inInbox();
    $('newTaskGoalLbl').textContent = t(ib ? 'form.goal_optional' : 'form.goal');
    $('newTaskGoal').innerHTML = UI.goalOptions(t(ib ? 'goal.not_yet' : 'goal.choose'), !ib, keepId);
    $('newTaskGoal').value = selected == null ? '' : selected;
    UI.gpBuild('newTaskGoal');
  }
  function setMode(edit) {
    $('taskDlgTitle').textContent = t(edit ? 'task.edit_title' : 'task.new_title');
    $('taskSubmit').textContent = t(edit ? 'form.save' : 'form.add');
    $('newListRow').hidden = edit;
    const del = $('taskDelete'); del.hidden = !edit; del.classList.remove('confirm'); del.textContent = t('task.delete'); delArmed = false;
  }
  function openNew() {
    editId = null; setMode(false);
    $('newTask').value = ''; $('newDesc').value = '';
    UI.setDeadline('newDeadline', '', '');
    dlgWho = []; drawWho(); fillGoal(null, null);
    $('newList').value = 'open';
    dlg().showModal(); $('newTask').focus();
  }
  function openEdit(id) {
    const k = Store.task(id); if (!k) return;
    Calendar.closePop();
    editId = id; setMode(true);
    $('newTask').value = k.title; $('newDesc').value = k.note || '';
    UI.setDeadline('newDeadline', k.deadline, k.repeat);
    dlgWho = Store.whoOf(id).slice(); drawWho(); fillGoal(k.goalId, k.goalId);
    dlg().showModal(); $('newTask').focus();
  }
  // Changing a repeating task works for all following times: say so, only when something changes.
  function repHint() {
    const h = $('repHint'), i = $('newDeadline'), k = editId !== null ? Store.task(editId) : null;
    let msg = '';
    if (k && k.repeat) {
      const rep = i.value ? i.dataset.rep || '' : '';
      if (!rep) msg = t('repeat.hint_stop'); else if (rep !== k.repeat) msg = t('repeat.hint_all'); else if (i.value !== k.deadline) msg = t('repeat.hint_shift');
    }
    h.innerHTML = msg ? `${UI.REP_ICON}<span>${esc(msg)}</span>` : ''; h.hidden = !msg;
  }
  async function submit(e) {
    e.preventDefault();
    const title = $('newTask').value.trim(), gv = $('newTaskGoal').value, goalId = gv || null;
    const needGoal = goalId === null && !inInbox();   // outside the Inbox every task has a goal
    if (!title || needGoal) {
      if (!title) UI.needField('newTask', t('form.need_task'));
      if (needGoal) UI.needField('newTaskGoal', t('form.need_goal'), !!title);
      return;
    }
    const fields = { title, note: $('newDesc').value.trim(), goalId, who: dlgWho.slice(), deadline: $('newDeadline').value || null, repeat: $('newDeadline').dataset.rep || null };
    const id = editId;
    dlg().close(); editId = null;
    if (id !== null) { await UI.act(() => Store.updateTask(id, fields)); return; }
    const stage = $('newList').value;
    View.fold[stage] = false;   // the list the new task goes into opens
    await UI.act(() => Store.createTask({ ...fields, stage }));
  }
  async function remove() {
    const del = $('taskDelete');
    if (!delArmed) {
      const n = Store.idx().of(editId).blocks.length;
      delArmed = true; del.classList.add('confirm');
      del.textContent = n ? UI.tn('task.delete_sure_blocks', n) : t('task.delete_sure');
      return;
    }
    const id = editId, k = Store.task(id);
    dlg().close(); editId = null;
    const res = await UI.act(() => Store.binTask(id));
    if (res) UI.toast(t('toast.to_bin', { title: k.title }), res.undo);
  }

  /* ---------- checking off ---------- */

  async function check(box) {
    const id = box.dataset.check, k = Store.task(id); if (!k) return;
    if (box.checked) UI.figureMaybe(box);
    if (k.stage === 'inbox') { await Inbox.process(id, 'done'); return; }
    const res = await UI.act(() => Store.setDone(id, box.checked));
    if (res) notes(res.notes, id);
  }

  function init() {
    $('btnNewTask').onclick = openNew;
    $('taskCancel').onclick = () => { editId = null; dlg().close(); };
    $('taskDelete').onclick = remove;
    $('taskForm').onsubmit = submit;
    $('dlgWho').onclick = e => {
      const b = e.target.closest('[data-dwho]'); if (!b) return;
      const p = b.dataset.dwho, on = dlgWho.includes(p);
      dlgWho = on ? dlgWho.filter(x => x !== p) : [...dlgWho, p];
      drawWho();
    };
    UI.wrapDeadline('newDeadline');
    $('newDeadline').addEventListener('dxsync', repHint);
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
  }

  return { init, render, springOpen, sideState, restoreSide, reveal, notes, openEdit };
})();
