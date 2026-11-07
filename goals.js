/**
 * JAPT Goals - the Doelen page.
 *
 * Responsibilities:
 *   - Goals per client (then Intern), open goals first, achieved ones on request
 *   - A goal in the large view: its fields, progress and tasks; Behaald (asking what happens with open
 *     tasks), Heropen, editing in the same window
 *   - The goal form: a client from the list or a new one typed, a colour, deleting (asking what happens
 *     with its tasks; to the Bin with Ongedaan)
 *   - Renaming a client
 *
 * The rules are in docs/design.md (Goals and clients).
 */

const Goals = (() => {
  const M = Model, { $, esc, View } = UI;
  const view = () => $('goalView'), gdlg = () => $('goalDlg'), form = () => $('goalForm');
  let gvId = null, gvEditing = false, confirmAch = false, achHow = null;

  /* ---------- the page ---------- */

  function card(g) {
    const st = Store.goalStats(g), pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    return `<div class="gcard ${g.achievedOn ? 'ach' : ''}" data-gopen="${g.id}" style="${UI.goalStyle(g)}" title="${t('goal.open')}">
      <div class="gtop"><b class="gname">${esc(g.name)}</b>${g.achievedOn ? `<span class="gbadge">✓ ${t('goal.achieved')}</span>` : ''}</div>
      ${g.note ? `<div class="gdesc">${esc(g.note)}</div>` : ''}
      ${st.total ? `<div class="bar"><i style="width:${pct}%"></i></div><div class="gstat">${statText(st)}</div>` : ''}</div>`;
  }
  const statText = st => t('goal.stat', { done: st.done, total: UI.tn('count.tasks', st.total) }) + (st.planned ? ' · ' + t('goal.stat_planned', { n: st.planned }) : '');
  function render() {
    $('gShowAch').checked = View.showAchieved;
    const shown = Store.goals().filter(g => View.showAchieved || !g.achievedOn), byOpen = (x, y) => (x.achievedOn ? 1 : 0) - (y.achievedOn ? 1 : 0);
    const groups = [...Store.clients().map(c => ({ id: c.id, name: c.name, goals: shown.filter(g => g.clientId === c.id).sort(byOpen) })),
      { name: t('client.intern'), goals: shown.filter(g => g.clientId == null).sort(byOpen) }].filter(x => x.goals.length);
    $('goalsList').innerHTML = groups.length ? groups.map(gr => `<div class="cgroup"><div class="cghead"><span class="cn">${esc(gr.name)}</span>
      ${gr.id ? `<button type="button" class="ico sm" data-clientedit="${gr.id}" title="${t('client.edit')}" aria-label="${t('client.edit')}">✎</button>` : ''}</div>
      <div class="gcards">${gr.goals.map(card).join('')}</div></div>`).join('')
      : `<div class="none-msg">${t(View.showAchieved ? 'goal.none_yet' : 'goal.none_open')}</div>`;
    if (view().open && !gvEditing) renderView();
  }

  /* ---------- the large view ---------- */

  function statusText(k) {
    const l = Store.listOf(k);
    if (l === 'planned') return t('list.planned') + ' · ' + Store.idx().of(k.id).blocks.map(b => UI.fmtDay(b.date)).concat(Store.idx().of(k.id).periods.map(o => t('meta.period'))).join(', ');
    return t('list.' + l);
  }
  function stashForm() { if (!gdlg().contains(form())) gdlg().appendChild(form()); view().classList.remove('editing'); gvEditing = false; }
  function renderView() {
    stashForm();
    const g = Store.goal(gvId); if (!g) { view().close(); return; }
    const st = Store.goalStats(g), c = Store.client(g.clientId);
    const order = { planned: 0, open: 1, backlog: 2, done: 3 };
    const ts = Store.tasks().filter(k => k.goalId === g.id).sort((a, b) => order[Store.listOf(a)] - order[Store.listOf(b)]);
    const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    const rows = ts.map(k => `<div class="gvt ${k.doneOn ? 'done' : ''}" style="${UI.goalStyle(g)}"><span class="gvtt">${esc(k.title)}</span><span class="who">${UI.whoHtml(k)}</span><span class="gvts">${esc(statusText(k))}</span></div>`).join('');
    const panel = confirmAch ? `<div class="gconf"><div class="gstat"><b>${UI.tn('goal.still_open', st.open)}</b> ${t('goal.what_with')}</div>
      <button type="button" class="opt ${achHow === 'done' ? 'on' : ''}" data-gachpick="done"><i></i><span>${UI.tn('goal.check_tasks', st.open)}</span></button>
      <button type="button" class="opt ${achHow === 'inbox' ? 'on' : ''}" data-gachpick="inbox"><i></i><span>${UI.tn('goal.tasks_to_inbox', st.open)}</span></button>
      <div class="gcbtns"><button type="button" data-gachcancel>${t('form.cancel')}</button><button type="button" class="primary" data-gachgo ${achHow ? '' : 'disabled'}>${t('goal.make_achieved')}</button></div></div>` : '';
    const acts = panel || `<div class="gvacts">${g.achievedOn ? `<button type="button" data-gvre>${t('goal.reopen')}</button>` : `<button type="button" class="ok" data-gvach>${t('goal.achieved')}</button>`}</div>`;
    const field = (label, html) => `<div class="f"><span class="fl">${label}</span>${html}</div>`;
    $('gvBody').innerHTML = `<div class="mhead"><h3>${esc(g.name)}</h3>
      <div class="gvtools">${g.achievedOn ? '' : `<button type="button" class="ico" data-gvedit title="${t('goal.edit')}" aria-label="${t('goal.edit')}">✎</button>`}<button type="button" class="ico" data-gvclose title="${t('form.close')}" aria-label="${t('form.close')}">✕</button></div></div>
      <div style="${UI.goalStyle(g)}">
      ${field(t('meta.client'), `<div class="gvv">${c ? esc(c.name) : t('client.intern')}</div>`)}
      ${g.achievedOn ? field(t('goal.status'), `<div class="gvv">${t('goal.achieved_on', { d: UI.fmtDay(g.achievedOn) })}</div>`) : ''}
      ${g.note ? field(t('form.note_label'), `<div class="gvv">${esc(g.note)}</div>`) : ''}
      ${st.total ? field(t('goal.progress'), `<div class="bar"><i style="width:${pct}%"></i></div><div class="gstat" style="margin-top:6px">${statText(st)}</div>`) : ''}
      </div>
      ${ts.length ? field(t('goal.tasks_n', { n: ts.length }), `<div class="gvlist">${rows}</div>`) : ''}
      ${acts}`;
  }
  function openView(id) { gvId = id; confirmAch = false; achHow = null; renderView(); if (!view().open) view().showModal(); }

  async function onViewClick(e) {
    const g = Store.goal(gvId); if (!g) return;
    const has = sel => e.target.closest(sel);
    if (has('[data-gvclose]')) { view().close(); return; }
    if (has('[data-gvedit]')) { openEdit(g.id); return; }
    if (has('[data-gvre]')) { await UI.act(() => Store.reopenGoal(g.id)); return; }
    if (has('[data-gvach]')) {
      if (Store.tasks().some(k => k.goalId === g.id && !k.doneOn)) { confirmAch = true; achHow = null; renderView(); return; }   // first choose what happens with the open tasks
      view().close(); await UI.act(() => Store.achieveGoal(g.id, null)); return;
    }
    if (has('[data-gachcancel]')) { confirmAch = false; achHow = null; renderView(); return; }
    const pk = has('[data-gachpick]');
    if (pk) { achHow = pk.dataset.gachpick; renderView(); return; }
    if (has('[data-gachgo]') && achHow) { const how = achHow; confirmAch = false; achHow = null; view().close(); await UI.act(() => Store.achieveGoal(g.id, how)); }
  }

  /* ---------- the goal form ---------- */

  let editId = null, delArmed = false, hue = M.GOAL_HUES[0], delHow = null;
  const clientInput = () => $('newGoalClient');
  function drawHues() {
    $('goalHues').innerHTML = M.GOAL_HUES.concat([M.GREY]).map(h => `<button type="button" data-hue="${h}" aria-pressed="${h === hue}" aria-label="${t(h === M.GREY ? 'goal.grey' : 'goal.colour')}" style="background:${h === M.GREY ? 'var(--grey-b)' : `hsl(${h} 55% 45%)`}"></button>`).join('');
  }
  // A client from the list, or a new name, which becomes a client on saving; the form says so first.
  function clientSuggest() {
    const text = clientInput().value.trim(), tl = text.toLowerCase(), box = $('clientSuggest'), note = $('clientNote');
    const hits = Store.clients().filter(c => !tl || c.name.toLowerCase().includes(tl)).slice(0, 8);
    const exact = text && Store.clientNamed(text);
    const n = c => Store.goals().filter(g => g.clientId === c.id).length;
    box.innerHTML = (hits.length ? `<div class="ch">${t('client.in_system')}</div>` + hits.map(c => `<button type="button" data-cid="${c.id}"><span>${esc(c.name)}</span><small>${UI.tn('count.goals', n(c))}</small></button>`).join('') : '')
      + (text && !exact ? `<button type="button" class="new-opt" data-newclient="1">${t('client.new_option', { name: esc(text) })}</button>` : '');
    box.classList.toggle('hidden', !box.innerHTML);
    note.classList.toggle('hidden', !(text && !exact));
    if (text && !exact) note.textContent = t('client.will_create', { name: text });
  }
  function setMode(edit) {
    $('goalDlgTitle').textContent = t(edit ? 'goal.edit' : 'goal.new');
    $('goalSubmit').textContent = t(edit ? 'form.save' : 'form.add');
    resetDel();
    const del = $('goalDelete'); del.hidden = !edit; del.classList.remove('confirm'); del.textContent = t('goal.delete'); delArmed = false;
    $('clientSuggest').classList.add('hidden'); $('clientNote').classList.add('hidden');
  }
  function openNew() {
    editId = null; setMode(false);
    $('newGoal').value = ''; $('newGoalDesc').value = '';
    hue = M.freshHue(Store.goals()); drawHues();
    clientInput().value = '';
    gdlg().showModal(); $('newGoal').focus();
  }
  function openEdit(id) {
    const g = Store.goal(id); if (!g || g.achievedOn) return;   // achieved goals: reopen first
    const c = Store.client(g.clientId);
    editId = id; setMode(true);
    $('newGoal').value = g.name; $('newGoalDesc').value = g.note || '';
    hue = M.goalHue(g); drawHues();
    clientInput().value = c ? c.name : '';
    if (view().open) { gvEditing = true; view().classList.add('editing'); $('gvBody').replaceChildren(form()); }   // in the same window, no second popup
    else gdlg().showModal();
    $('newGoal').focus();
  }
  function endEdit() { editId = null; if (gvEditing) renderView(); else gdlg().close(); }
  function resetDel() { delHow = null; $('goalDelPanel').classList.add('hidden'); $('goalDelPanel').innerHTML = ''; $('goalBtns').classList.remove('hidden'); }
  function renderDel() {
    const n = Store.tasks().filter(k => k.goalId === editId).length;
    $('goalDelPanel').innerHTML = `<div class="gstat"><b>${UI.tn('goal.has_tasks', n)}</b> ${t('goal.what_with')}</div>
      <button type="button" class="opt ${delHow === 'del' ? 'on' : ''}" data-gdelpick="del"><i></i><span>${UI.tn('goal.delete_tasks_too', n)}</span></button>
      <button type="button" class="opt ${delHow === 'free' ? 'on' : ''}" data-gdelpick="free"><i></i><span>${UI.tn('goal.tasks_to_inbox', n)}</span></button>
      <div class="gcbtns"><button type="button" data-gdelcancel>${t('form.cancel')}</button><button type="button" class="dgo" data-gdelgo ${delHow ? '' : 'disabled'}>${t('goal.delete')}</button></div>`;
    $('goalDelPanel').classList.remove('hidden'); $('goalBtns').classList.add('hidden');
  }
  async function doDelete(how) {
    const id = editId, g = Store.goal(id);
    editId = null; resetDel(); stashForm(); if (view().open) view().close(); if (gdlg().open) gdlg().close();
    View.filter.goal = View.filter.goal.filter(v => v !== id);
    const res = await UI.act(() => Store.deleteGoal(id, how));
    if (res) UI.toast(t('toast.to_bin', { title: g.name }), res.undo);
  }
  async function submit(e) {
    e.preventDefault();
    const name = $('newGoal').value.trim(); if (!name) { UI.needField('newGoal', t('form.need_goal_name')); return; }
    const fields = { name, note: $('newGoalDesc').value.trim(), clientName: clientInput().value.trim(), hue };
    const id = editId; editId = null;
    if (id !== null) { if (gvEditing) { await UI.act(() => Store.updateGoal(id, fields)); renderView(); } else { gdlg().close(); await UI.act(() => Store.updateGoal(id, fields)); } return; }
    gdlg().close();
    await UI.act(() => Store.createGoal(fields));
  }

  /* ---------- client ---------- */

  let clientId = null;
  function openClient(id) { const c = Store.client(id); if (!c) return; clientId = id; $('clientName').value = c.name; $('clientErr').classList.add('hidden'); $('clientDlg').showModal(); $('clientName').focus(); $('clientName').select(); }
  async function submitClient(e) {
    e.preventDefault();
    const v = $('clientName').value.trim(); if (!v) { UI.needField('clientName', t('form.need_name')); return; }
    const dup = Store.clientNamed(v);
    if (dup && dup.id !== clientId) { $('clientErr').textContent = t('client.exists'); $('clientErr').classList.remove('hidden'); return; }
    const id = clientId; clientId = null; $('clientDlg').close();
    await UI.act(() => Store.renameClient(id, v));
  }

  function init() {
    $('btnGoalNew').onclick = openNew;
    $('gShowAch').onchange = e => { View.showAchieved = e.target.checked; View.save(); render(); };
    $('goalsList').onclick = e => {
      const ce = e.target.closest('[data-clientedit]'); if (ce) { openClient(ce.dataset.clientedit); return; }
      const o = e.target.closest('[data-gopen]'); if (o) openView(o.dataset.gopen);
    };
    view().addEventListener('click', onViewClick);
    view().addEventListener('click', e => { if (e.target === view() && !gvEditing) view().close(); });   // a click beside the window closes it
    view().addEventListener('close', () => { confirmAch = false; achHow = null; stashForm(); });
    $('goalHues').onclick = e => { const b = e.target.closest('[data-hue]'); if (!b) return; hue = +b.dataset.hue; drawHues(); };
    clientInput().addEventListener('focus', clientSuggest);
    clientInput().addEventListener('input', clientSuggest);
    clientInput().addEventListener('blur', () => setTimeout(() => $('clientSuggest').classList.add('hidden'), 120));
    $('clientSuggest').addEventListener('mousedown', e => e.preventDefault());
    $('clientSuggest').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cid) { const c = Store.client(b.dataset.cid); if (c) clientInput().value = c.name; }
      clientSuggest(); $('clientSuggest').classList.add('hidden');
    });
    $('goalCancel').onclick = endEdit;
    $('goalDelete').onclick = () => {
      if (Store.tasks().some(k => k.goalId === editId)) { renderDel(); return; }   // first choose what happens with the tasks
      const del = $('goalDelete');
      if (!delArmed) { delArmed = true; del.classList.add('confirm'); del.textContent = t('goal.delete_sure'); return; }
      doDelete('free');
    };
    $('goalDelPanel').onclick = e => {
      const pk = e.target.closest('[data-gdelpick]');
      if (pk) { delHow = pk.dataset.gdelpick; renderDel(); return; }
      if (e.target.closest('[data-gdelcancel]')) { resetDel(); return; }
      if (e.target.closest('[data-gdelgo]') && delHow) doDelete(delHow);
    };
    form().onsubmit = submit;
    $('clientForm').onsubmit = submitClient;
    $('clientCancel').onclick = () => { clientId = null; $('clientDlg').close(); };
    $('clientName').addEventListener('input', () => $('clientErr').classList.add('hidden'));
  }

  return { init, render };
})();
