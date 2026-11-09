/**
 * JAPT Goals - the Doelen page.
 *
 * Responsibilities:
 *   - Goals per client (then Intern), open goals first, achieved ones on request
 *   - A goal in the large view: its fields, progress and tasks; Behaald (asking what happens with open
 *     tasks), Heropen, editing in the same window
 *   - The goal form: a client from the list or a new one typed, a colour, deleting (asking what happens
 *     with its tasks; to the Bin with Ongedaan). The same form in its own window or in the goal view.
 *   - Renaming a client
 *
 * Every window here is made when it opens and removed when it closes, and closes only after its save
 * succeeded.
 *
 * The rules are in docs/design.md (Goals and clients).
 */

const Goals = (() => {
  const M = Model, { $, esc, View, html } = UI;
  const MAX_SUGGESTIONS = 8;   // client suggestions under the field: a short list, typing narrows it down

  // Top to bottom in the large view: what still needs doing first.
  const LIST_ORDER = { [M.LIST.PLANNED]: 0, [M.LIST.OPEN]: 1, [M.LIST.BACKLOG]: 2, [M.LIST.DONE]: 3 };

  /* ---------- shared pieces ---------- */

  function statText(st) {
    const planned = st.planned ? ' · ' + t('goal.stat_planned', { n: st.planned }) : '';
    return t('goal.stat', { done: st.done, total: UI.tn('count.tasks', st.total) }) + planned;
  }
  const pctOf = st => (st.total ? Math.round(st.done / st.total * 100) : 0);
  const progressHtml = (st, statClass) =>
    `<div class="bar"><i style="width:${pctOf(st)}%"></i></div><div class="${statClass}">${statText(st)}</div>`;

  // One choice in a question about a goal's tasks; attr is the data attribute that carries the choice.
  function optionHtml(attr, value, picked, label) {
    const on = picked === value ? 'on' : '';
    return `<button type="button" class="opt ${on}" ${attr}="${value}"><i></i><span>${label}</span></button>`;
  }

  /* ---------- the page ---------- */

  function card(g) {
    const st = Store.goalStats(g);
    const attrs = `data-gopen="${g.id}" style="${UI.goalStyle(g)}" title="${t('goal.open')}"`;
    return html`<div class="gcard ${g.achievedOn ? 'ach' : ''}" ${attrs}>
      <div class="gtop">
        <b class="gname">${esc(g.name)}</b>
        ${g.achievedOn ? `<span class="gbadge">✓ ${t('goal.achieved')}</span>` : ''}
      </div>
      ${g.note ? `<div class="gdesc">${esc(g.note)}</div>` : ''}
      ${st.total ? progressHtml(st, 'gstat') : ''}
    </div>`;
  }

  function clientEditButton(clientId) {
    const label = t('client.edit'), attrs = `title="${label}" aria-label="${label}"`;
    return `<button type="button" class="ico sm" data-clientedit="${clientId}" ${attrs}>✎</button>`;
  }

  function clientGroupHtml(group) {
    return html`<div class="cgroup">
      <div class="cghead">
        <span class="cn">${esc(group.name)}</span>
        ${group.id ? clientEditButton(group.id) : ''}
      </div>
      <div class="gcards">${group.goals.map(card).join('')}</div>
    </div>`;
  }

  function render() {
    $('gShowAch').checked = View.showAchieved;
    const shown = Store.goals().filter(g => View.showAchieved || !g.achievedOn);
    const byOpen = (x, y) => (x.achievedOn ? 1 : 0) - (y.achievedOn ? 1 : 0);
    const goalsOf = c => shown.filter(g => g.clientId === c.id).sort(byOpen);
    const groups = [
      ...Store.clients().map(c => ({ id: c.id, name: c.name, goals: goalsOf(c) })),
      { name: t('client.intern'), goals: shown.filter(g => g.clientId == null).sort(byOpen) }
    ].filter(x => x.goals.length);
    $('goalsList').innerHTML = groups.length
      ? groups.map(clientGroupHtml).join('')
      : `<div class="none-msg">${t(View.showAchieved ? 'goal.none_yet' : 'goal.none_open')}</div>`;
    if (gv && !gv.editing) drawView();
  }

  /* ---------- the large view ---------- */

  // The open goal view: {dlg, id, editing, confirmAch, achHow}, or null when it is closed.
  let gv = null;

  function statusText(k) {
    const l = Store.listOf(k), p = Store.idx().of(k.id);
    if (l !== M.LIST.PLANNED) return t('list.' + l);
    const when = p.blocks.map(b => UI.fmtDay(b.date)).concat(p.periods.map(() => t('meta.period')));
    return t('list.planned') + ' · ' + when.join(', ');
  }

  function taskRowHtml(k, g) {
    return html`<div class="gvt ${k.doneOn ? 'done' : ''}" style="${UI.goalStyle(g)}">
      <span class="gvtt">${esc(k.title)}</span>
      <span class="who">${UI.whoHtml(k)}</span>
      <span class="gvts">${esc(statusText(k))}</span>
    </div>`;
  }

  // Before a goal with open tasks becomes Behaald: the question what happens with those tasks.
  function achieveQuestionHtml(st) {
    const how = gv.achHow;
    return html`<div class="gconf">
      <div class="gstat"><b>${UI.tn('goal.still_open', st.open)}</b> ${t('goal.what_with')}</div>
      ${optionHtml('data-gachpick', 'done', how, UI.tn('goal.check_tasks', st.open))}
      ${optionHtml('data-gachpick', 'inbox', how, UI.tn('goal.tasks_to_inbox', st.open))}
      <div class="gcbtns">
        <button type="button" data-gachcancel>${t('form.cancel')}</button>
        <button type="button" class="primary" data-gachgo ${how ? '' : 'disabled'}>${t('goal.make_achieved')}</button>
      </div>
    </div>`;
  }

  function viewActionsHtml(g) {
    const action = g.achievedOn
      ? `<button type="button" data-gvre>${t('goal.reopen')}</button>`
      : `<button type="button" class="ok" data-gvach>${t('goal.achieved')}</button>`;
    return `<div class="gvacts">${action}</div>`;
  }

  const iconButton = (attr, label, glyph) =>
    `<button type="button" class="ico" ${attr} title="${label}" aria-label="${label}">${glyph}</button>`;

  function viewHeadHtml(g) {
    return html`<div class="mhead">
      <h3>${esc(g.name)}</h3>
      <div class="gvtools">
        ${g.achievedOn ? '' : iconButton('data-gvedit', t('goal.edit'), '✎')}
        ${iconButton('data-gvclose', t('form.close'), '✕')}
      </div>
    </div>`;
  }

  const viewField = (label, content) => `<div class="f"><span class="fl">${label}</span>${content}</div>`;
  const viewValue = content => `<div class="gvv">${content}</div>`;

  function goalFieldsHtml(g, st) {
    const c = Store.client(g.clientId);
    const achievedOn = g.achievedOn && t('goal.achieved_on', { d: UI.fmtDay(g.achievedOn) });
    return html`<div style="${UI.goalStyle(g)}">
      ${viewField(t('meta.client'), viewValue(c ? esc(c.name) : t('client.intern')))}
      ${g.achievedOn ? viewField(t('goal.status'), viewValue(achievedOn)) : ''}
      ${g.note ? viewField(t('form.note_label'), viewValue(esc(g.note))) : ''}
      ${st.total ? viewField(t('goal.progress'), progressHtml(st, 'gstat gstat-under')) : ''}
    </div>`;
  }

  function drawView() {
    const g = Store.goal(gv.id); if (!g) { gv.dlg.close(); return; }
    const st = Store.goalStats(g);
    const tasks = Store.tasks().filter(k => k.goalId === g.id)
      .sort((a, b) => LIST_ORDER[Store.listOf(a)] - LIST_ORDER[Store.listOf(b)]);
    const rows = tasks.map(k => taskRowHtml(k, g)).join('');
    gv.dlg.innerHTML = html`${viewHeadHtml(g)}
      ${goalFieldsHtml(g, st)}
      ${tasks.length ? viewField(t('goal.tasks_n', { n: tasks.length }), `<div class="gvlist">${rows}</div>`) : ''}
      ${gv.confirmAch ? achieveQuestionHtml(st) : viewActionsHtml(g)}`;
  }

  function openView(id) {
    const dlg = UI.dialog({ cls: 'wide gvw', closeOutside: () => !!gv && !gv.editing, onClose: () => { gv = null; } });
    gv = { dlg, id, editing: false, confirmAch: false, achHow: null };
    dlg.addEventListener('click', onViewClick);
    drawView();
  }

  // Editing in the same window, no second one on top: the view makes way for the form, and comes back.
  function editInView() {
    gv.editing = true;
    gv.dlg.classList.add('editing');
    const backToView = () => {
      if (!gv) return;
      gv.editing = false;
      gv.dlg.classList.remove('editing');
      drawView();
    };
    mountForm(gv.dlg, gv.id, backToView, () => gv && gv.dlg.close());
  }

  async function onViewClick(e) {
    if (!gv || gv.editing) return;
    const v = gv, g = Store.goal(v.id); if (!g) return;
    const has = sel => e.target.closest(sel);
    if (has('[data-gvclose]')) { v.dlg.close(); return; }
    if (has('[data-gvedit]')) { editInView(); return; }
    if (has('[data-gvre]')) { await UI.act(() => Store.reopenGoal(g.id)); return; }
    if (has('[data-gvach]')) {
      // With open tasks, first choose what happens with them.
      if (Store.tasks().some(k => k.goalId === g.id && !k.doneOn)) {
        v.confirmAch = true; v.achHow = null; drawView();
        return;
      }
      if (await UI.act(() => Store.achieveGoal(g.id, null))) v.dlg.close();
      return;
    }
    if (has('[data-gachcancel]')) { v.confirmAch = false; v.achHow = null; drawView(); return; }
    const pk = has('[data-gachpick]');
    if (pk) { v.achHow = pk.dataset.gachpick; drawView(); return; }
    if (has('[data-gachgo]') && v.achHow) { if (await UI.act(() => Store.achieveGoal(g.id, v.achHow))) v.dlg.close(); }
  }

  /* ---------- the goal form ---------- */

  // In its own window (new, or edit from elsewhere).
  function openForm(id) {
    const g = id ? Store.goal(id) : null;
    if (id && (!g || g.achievedOn)) return;   // achieved goals: reopen first
    const dlg = UI.dialog({ cls: 'goaldlg' });
    mountForm(dlg, id, () => dlg.close(), () => dlg.close());
  }

  function formHtml(g, c) {
    const hint = t('goal.client_ph'), clientName = esc(c ? c.name : '');
    return html`<form>
      <h3>${t(g ? 'goal.edit' : 'goal.new')}</h3>
      <label class="f">
        <span class="fl">${t('goal.what')}</span>
        <input type="text" name="name" autocomplete="off" value="${esc(g ? g.name : '')}">
      </label>
      <label class="f">
        <span class="fl">${t('form.note')}</span>
        <textarea name="note">${esc(g ? g.note || '' : '')}</textarea>
      </label>
      <div class="f">
        <span class="fl">${t('goal.colour_label')}</span>
        <div class="swatches" data-hues></div>
      </div>
      <div class="f">
        <span class="fl">${t('goal.for_client')}</span>
        <div class="combo" data-combo>
          <input type="text" name="client" autocomplete="off" placeholder="${hint}" value="${clientName}">
        </div>
        <div data-clientnote></div>
      </div>
      <div data-foot></div>
    </form>`;
  }

  function hueButtonHtml(h, hue) {
    const label = t(h === M.GREY ? 'goal.grey' : 'goal.colour');
    const attrs = `data-hue="${h}" aria-pressed="${h === hue}" aria-label="${label}"`;
    return `<button type="button" ${attrs} style="background:${UI.hueColour(h)}"></button>`;
  }

  function drawHues(state) {
    state.q('[data-hues]').innerHTML = M.GOAL_HUES.concat([M.GREY]).map(h => hueButtonHtml(h, state.hue)).join('');
  }

  function pickHue(state, e) {
    const b = e.target.closest('[data-hue]');
    if (b) { state.hue = +b.dataset.hue; drawHues(state); }
  }

  // The existing clients that match what is typed, and the offer to make a new one.
  function suggestionsHtml(text, isNew) {
    const typed = text.toLowerCase();
    const hits = Store.clients().filter(x => !typed || x.name.toLowerCase().includes(typed)).slice(0, MAX_SUGGESTIONS);
    const goalCount = x => Store.goals().filter(y => y.clientId === x.id).length;
    const hitButton = x => html`<button type="button" data-cid="${x.id}">
      <span>${esc(x.name)}</span>
      <small>${UI.tn('count.goals', goalCount(x))}</small>
    </button>`;
    const existing = hits.length ? `<div class="ch">${t('client.in_system')}</div>` + hits.map(hitButton).join('') : '';
    const offer = t('client.new_option', { name: esc(text) });
    return existing + (isNew ? `<button type="button" class="new-opt" data-newclient>${offer}</button>` : '');
  }

  // A client from the list, or a new name, which becomes a client on saving; the form says so first.
  // The list of suggestions exists only while the field has focus.
  function drawClient(state, withList) {
    const { q } = state;
    const text = state.clientEl.value.trim();
    const isNew = !!text && !Store.clientNamed(text);
    const note = isNew ? esc(t('client.will_create', { name: text })) : '';
    q('[data-clientnote]').innerHTML = isNew ? `<div class="cnote">${note}</div>` : '';
    const open = q('.combolist');
    if (open) open.remove();
    if (!withList) return;
    const list = suggestionsHtml(text, isNew);
    if (list) q('[data-combo]').insertAdjacentHTML('beforeend', `<div class="combolist">${list}</div>`);
  }

  function pickSuggestion(state, e) {
    const b = e.target.closest('.combolist button'); if (!b) return;
    if (b.dataset.cid) {
      const x = Store.client(b.dataset.cid);
      if (x) state.clientEl.value = x.name;
    }
    drawClient(state, false);
  }

  function wireClientField(state) {
    const { clientEl, q } = state;
    clientEl.addEventListener('focus', () => drawClient(state, true));
    clientEl.addEventListener('input', () => drawClient(state, true));
    clientEl.addEventListener('blur', () => drawClient(state, false));
    // A click in the list must not take the focus from the field, or the list would close first.
    q('[data-combo]').addEventListener('mousedown', e => { if (e.target.closest('.combolist')) e.preventDefault(); });
    q('[data-combo]').addEventListener('click', e => pickSuggestion(state, e));
  }

  const taskCount = state => Store.tasks().filter(k => k.goalId === state.id).length;

  // Deleting a goal with tasks: the question what happens with them.
  function deleteQuestionHtml(state, n) {
    const how = state.delHow;
    return html`<div class="gconf">
      <div class="gstat"><b>${UI.tn('goal.has_tasks', n)}</b> ${t('goal.what_with')}</div>
      ${optionHtml('data-gdelpick', 'del', how, UI.tn('goal.delete_tasks_too', n))}
      ${optionHtml('data-gdelpick', 'free', how, UI.tn('goal.tasks_to_inbox', n))}
      <div class="gcbtns">
        <button type="button" data-gdelcancel>${t('form.cancel')}</button>
        <button type="button" class="dgo" data-gdelgo ${how ? '' : 'disabled'}>${t('goal.delete')}</button>
      </div>
    </div>`;
  }

  function deleteButtonHtml(armed) {
    const label = t(armed ? 'goal.delete_sure' : 'goal.delete');
    return `<button type="button" class="danger ${armed ? 'confirm' : ''}" data-gdel>${label}</button>`;
  }

  function footButtonsHtml(state) {
    const g = state.goal;
    return html`<div class="btns">
      ${g ? deleteButtonHtml(state.delArmed) : ''}
      <button type="button" data-cancel>${t('form.cancel')}</button>
      <button type="submit" class="primary">${t(g ? 'form.save' : 'form.add')}</button>
    </div>`;
  }

  // The buttons, or (deleting a goal with tasks) the question what happens with them, in their place.
  function drawFoot(state, asking) {
    const n = taskCount(state);
    state.q('[data-foot]').innerHTML = asking ? deleteQuestionHtml(state, n) : footButtonsHtml(state);
  }

  async function deleteFromForm(state, how) {
    if (state.busy) return;
    state.busy = true;
    const res = await UI.act(() => Store.deleteGoal(state.id, how));
    state.busy = false;
    if (!res) return;
    state.onGone();
    UI.toast(t('toast.to_bin', { title: state.goal.name }), res.undo);
  }

  function onFootClick(state, e) {
    const has = sel => e.target.closest(sel);
    if (has('[data-cancel]')) { state.onDone(); return; }
    if (has('[data-gdel]')) {
      // With tasks, first choose what happens with them.
      if (taskCount(state)) { state.delHow = null; drawFoot(state, true); return; }
      if (!state.delArmed) { state.delArmed = true; drawFoot(state, false); return; }
      deleteFromForm(state, 'free');
      return;
    }
    const pk = has('[data-gdelpick]');
    if (pk) { state.delHow = pk.dataset.gdelpick; drawFoot(state, true); return; }
    if (has('[data-gdelcancel]')) { state.delHow = null; drawFoot(state, false); return; }
    if (has('[data-gdelgo]') && state.delHow) deleteFromForm(state, state.delHow);
  }

  async function saveForm(state, e) {
    e.preventDefault(); if (state.busy) return;
    const { id, goal: g, nameEl, clientEl, q, hue } = state;
    const fields = {
      name: nameEl.value.trim(),
      note: q('[name=note]').value.trim(),
      clientName: clientEl.value.trim(),
      hue
    };
    if (UI.showProblems(Store.goalProblems(fields), { name: nameEl })) return;
    state.busy = true;
    const res = await UI.act(() => (g ? Store.updateGoal(id, fields, state.seenAt) : Store.createGoal(fields)));
    state.busy = false;
    if (res) state.onDone();
    else if (g) state.seenAt = UI.afterFormConflict(state.seenAt, Store.goal(id));
  }

  // The form, drawn fresh into host. onDone: saved or cancelled; onGone: the goal was deleted.
  function mountForm(host, id, onDone, onGone) {
    const g = id ? Store.goal(id) : null, c = g && Store.client(g.clientId);
    host.innerHTML = formHtml(g, c);
    const f = host.querySelector('form'), q = sel => f.querySelector(sel);
    const state = {
      id, goal: g, q, onDone, onGone,
      seenAt: g ? g.changedAt : undefined,   // the version this form shows
      nameEl: q('[name=name]'), clientEl: q('[name=client]'),
      hue: g ? M.goalHue(g) : M.freshHue(Store.goals()),
      delArmed: false, delHow: null, busy: false
    };

    q('[data-hues]').onclick = e => pickHue(state, e);
    drawHues(state);

    wireClientField(state);
    drawClient(state, false);

    drawFoot(state, false);
    q('[data-foot]').addEventListener('click', e => onFootClick(state, e));

    f.onsubmit = e => saveForm(state, e);
    state.nameEl.focus();
  }

  /* ---------- client ---------- */

  function clientFormHtml(c) {
    return html`<form>
      <h3>${t('client.edit')}</h3>
      <label class="f">
        <span class="fl">${t('client.name')}</span>
        <input type="text" name="name" autocomplete="off" value="${esc(c.name)}">
      </label>
      <div class="btns">
        <button type="button" data-cancel>${t('form.cancel')}</button>
        <button type="submit" class="primary">${t('form.save')}</button>
      </div>
    </form>`;
  }

  function openClient(id) {
    const c = Store.client(id); if (!c) return;
    let seenAt = c.changedAt;   // the version this window shows
    const dlg = UI.dialog();
    dlg.innerHTML = clientFormHtml(c);
    const f = dlg.querySelector('form'), nameEl = f.querySelector('[name=name]');
    let busy = false;
    f.querySelector('[data-cancel]').onclick = () => dlg.close();
    f.onsubmit = async e => {
      e.preventDefault(); if (busy) return;
      const v = nameEl.value.trim();
      if (UI.showProblems(Store.clientProblems(id, v), { name: nameEl })) return;
      busy = true;
      const res = await UI.act(() => Store.renameClient(id, v, seenAt));
      busy = false;
      if (res) dlg.close();
      else seenAt = UI.afterFormConflict(seenAt, Store.client(id));
    };
    nameEl.focus(); nameEl.select();
  }

  function init() {
    $('btnGoalNew').onclick = () => openForm(null);
    $('gShowAch').onchange = e => { View.showAchieved = e.target.checked; View.save(); render(); };
    $('goalsList').onclick = e => {
      const ce = e.target.closest('[data-clientedit]'); if (ce) { openClient(ce.dataset.clientedit); return; }
      const o = e.target.closest('[data-gopen]'); if (o) openView(o.dataset.gopen);
    };
  }

  return { init, render };
})();
