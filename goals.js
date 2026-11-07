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
  const M = Model, { $, esc, View } = UI;

  /* ---------- the page ---------- */

  const statText = st => t('goal.stat', { done: st.done, total: UI.tn('count.tasks', st.total) }) + (st.planned ? ' · ' + t('goal.stat_planned', { n: st.planned }) : '');
  const pctOf = st => (st.total ? Math.round(st.done / st.total * 100) : 0);
  function card(g) {
    const st = Store.goalStats(g);
    return `<div class="gcard ${g.achievedOn ? 'ach' : ''}" data-gopen="${g.id}" style="${UI.goalStyle(g)}" title="${t('goal.open')}">
      <div class="gtop"><b class="gname">${esc(g.name)}</b>${g.achievedOn ? `<span class="gbadge">✓ ${t('goal.achieved')}</span>` : ''}</div>
      ${g.note ? `<div class="gdesc">${esc(g.note)}</div>` : ''}
      ${st.total ? `<div class="bar"><i style="width:${pctOf(st)}%"></i></div><div class="gstat">${statText(st)}</div>` : ''}</div>`;
  }
  function render() {
    $('gShowAch').checked = View.showAchieved;
    const shown = Store.goals().filter(g => View.showAchieved || !g.achievedOn), byOpen = (x, y) => (x.achievedOn ? 1 : 0) - (y.achievedOn ? 1 : 0);
    const groups = [...Store.clients().map(c => ({ id: c.id, name: c.name, goals: shown.filter(g => g.clientId === c.id).sort(byOpen) })),
      { name: t('client.intern'), goals: shown.filter(g => g.clientId == null).sort(byOpen) }].filter(x => x.goals.length);
    $('goalsList').innerHTML = groups.length ? groups.map(gr => `<div class="cgroup"><div class="cghead"><span class="cn">${esc(gr.name)}</span>
      ${gr.id ? `<button type="button" class="ico sm" data-clientedit="${gr.id}" title="${t('client.edit')}" aria-label="${t('client.edit')}">✎</button>` : ''}</div>
      <div class="gcards">${gr.goals.map(card).join('')}</div></div>`).join('')
      : `<div class="none-msg">${t(View.showAchieved ? 'goal.none_yet' : 'goal.none_open')}</div>`;
    if (gv && !gv.editing) drawView();
  }

  /* ---------- the large view ---------- */

  // The open goal view: {dlg, id, editing, confirmAch, achHow}, or null when it is closed.
  let gv = null;

  function statusText(k) {
    const l = Store.listOf(k), p = Store.idx().of(k.id);
    if (l === 'planned') return t('list.planned') + ' · ' + p.blocks.map(b => UI.fmtDay(b.date)).concat(p.periods.map(() => t('meta.period'))).join(', ');
    return t('list.' + l);
  }
  function drawView() {
    const g = Store.goal(gv.id); if (!g) { gv.dlg.close(); return; }
    const st = Store.goalStats(g), c = Store.client(g.clientId);
    const order = { planned: 0, open: 1, backlog: 2, done: 3 };
    const ts = Store.tasks().filter(k => k.goalId === g.id).sort((a, b) => order[Store.listOf(a)] - order[Store.listOf(b)]);
    const rows = ts.map(k => `<div class="gvt ${k.doneOn ? 'done' : ''}" style="${UI.goalStyle(g)}"><span class="gvtt">${esc(k.title)}</span><span class="who">${UI.whoHtml(k)}</span><span class="gvts">${esc(statusText(k))}</span></div>`).join('');
    const panel = gv.confirmAch ? `<div class="gconf"><div class="gstat"><b>${UI.tn('goal.still_open', st.open)}</b> ${t('goal.what_with')}</div>
      <button type="button" class="opt ${gv.achHow === 'done' ? 'on' : ''}" data-gachpick="done"><i></i><span>${UI.tn('goal.check_tasks', st.open)}</span></button>
      <button type="button" class="opt ${gv.achHow === 'inbox' ? 'on' : ''}" data-gachpick="inbox"><i></i><span>${UI.tn('goal.tasks_to_inbox', st.open)}</span></button>
      <div class="gcbtns"><button type="button" data-gachcancel>${t('form.cancel')}</button><button type="button" class="primary" data-gachgo ${gv.achHow ? '' : 'disabled'}>${t('goal.make_achieved')}</button></div></div>` : '';
    const acts = panel || `<div class="gvacts">${g.achievedOn ? `<button type="button" data-gvre>${t('goal.reopen')}</button>` : `<button type="button" class="ok" data-gvach>${t('goal.achieved')}</button>`}</div>`;
    const field = (label, html) => `<div class="f"><span class="fl">${label}</span>${html}</div>`;
    gv.dlg.innerHTML = `<div class="mhead"><h3>${esc(g.name)}</h3>
      <div class="gvtools">${g.achievedOn ? '' : `<button type="button" class="ico" data-gvedit title="${t('goal.edit')}" aria-label="${t('goal.edit')}">✎</button>`}<button type="button" class="ico" data-gvclose title="${t('form.close')}" aria-label="${t('form.close')}">✕</button></div></div>
      <div style="${UI.goalStyle(g)}">
      ${field(t('meta.client'), `<div class="gvv">${c ? esc(c.name) : t('client.intern')}</div>`)}
      ${g.achievedOn ? field(t('goal.status'), `<div class="gvv">${t('goal.achieved_on', { d: UI.fmtDay(g.achievedOn) })}</div>`) : ''}
      ${g.note ? field(t('form.note_label'), `<div class="gvv">${esc(g.note)}</div>`) : ''}
      ${st.total ? field(t('goal.progress'), `<div class="bar"><i style="width:${pctOf(st)}%"></i></div><div class="gstat gstat-under">${statText(st)}</div>`) : ''}
      </div>
      ${ts.length ? field(t('goal.tasks_n', { n: ts.length }), `<div class="gvlist">${rows}</div>`) : ''}
      ${acts}`;
  }
  function openView(id) {
    const dlg = UI.dialog({ cls: 'wide gvw', closeOutside: () => !!gv && !gv.editing, onClose: () => { gv = null; } });
    gv = { dlg, id, editing: false, confirmAch: false, achHow: null };
    dlg.addEventListener('click', onViewClick);
    drawView();
  }
  // Editing in the same window, no second one on top: the view makes way for the form, and comes back.
  function editInView() {
    gv.editing = true; gv.dlg.classList.add('editing');
    mountForm(gv.dlg, gv.id, () => { if (!gv) return; gv.editing = false; gv.dlg.classList.remove('editing'); drawView(); }, () => gv && gv.dlg.close());
  }

  async function onViewClick(e) {
    if (!gv || gv.editing) return;
    const v = gv, g = Store.goal(v.id); if (!g) return;
    const has = sel => e.target.closest(sel);
    if (has('[data-gvclose]')) { v.dlg.close(); return; }
    if (has('[data-gvedit]')) { editInView(); return; }
    if (has('[data-gvre]')) { await UI.act(() => Store.reopenGoal(g.id)); return; }
    if (has('[data-gvach]')) {
      if (Store.tasks().some(k => k.goalId === g.id && !k.doneOn)) { v.confirmAch = true; v.achHow = null; drawView(); return; }   // first choose what happens with the open tasks
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

  // The form, drawn fresh into host. onDone: saved or cancelled; onGone: the goal was deleted.
  function mountForm(host, id, onDone, onGone) {
    const g = id ? Store.goal(id) : null, c = g && Store.client(g.clientId);
    let hue = g ? M.goalHue(g) : M.freshHue(Store.goals()), delArmed = false, delHow = null, busy = false;
    host.innerHTML = `<form>
      <h3>${t(g ? 'goal.edit' : 'goal.new')}</h3>
      <label class="f"><span class="fl">${t('goal.what')}</span><input type="text" name="name" autocomplete="off" value="${esc(g ? g.name : '')}"></label>
      <label class="f"><span class="fl">${t('form.note')}</span><textarea name="note">${esc(g ? g.note || '' : '')}</textarea></label>
      <div class="f"><span class="fl">${t('goal.colour_label')}</span><div class="swatches" data-hues></div></div>
      <div class="f"><span class="fl">${t('goal.for_client')}</span>
        <div class="combo" data-combo><input type="text" name="client" autocomplete="off" placeholder="${t('goal.client_ph')}" value="${esc(c ? c.name : '')}"></div>
        <div data-clientnote></div></div>
      <div data-foot></div>
    </form>`;
    const f = host.querySelector('form'), q = sel => f.querySelector(sel), nameEl = q('[name=name]'), clientEl = q('[name=client]');

    const drawHues = () => {
      q('[data-hues]').innerHTML = M.GOAL_HUES.concat([M.GREY]).map(h => `<button type="button" data-hue="${h}" aria-pressed="${h === hue}" aria-label="${t(h === M.GREY ? 'goal.grey' : 'goal.colour')}" style="background:${UI.hueColour(h)}"></button>`).join('');
    };
    q('[data-hues]').onclick = e => { const b = e.target.closest('[data-hue]'); if (b) { hue = +b.dataset.hue; drawHues(); } };
    drawHues();

    // A client from the list, or a new name, which becomes a client on saving; the form says so first.
    // The list of suggestions exists only while the field has focus.
    const closeSuggest = () => { const l = q('.combolist'); if (l) l.remove(); };
    const drawClient = (withList) => {
      const text = clientEl.value.trim(), tl = text.toLowerCase(), exact = text && Store.clientNamed(text);
      const isNew = !!text && !exact;
      q('[data-clientnote]').innerHTML = isNew ? `<div class="cnote">${esc(t('client.will_create', { name: text }))}</div>` : '';
      closeSuggest();
      if (!withList) return;
      const hits = Store.clients().filter(x => !tl || x.name.toLowerCase().includes(tl)).slice(0, 8);
      const n = x => Store.goals().filter(y => y.clientId === x.id).length;
      const html = (hits.length ? `<div class="ch">${t('client.in_system')}</div>` + hits.map(x => `<button type="button" data-cid="${x.id}"><span>${esc(x.name)}</span><small>${UI.tn('count.goals', n(x))}</small></button>`).join('') : '')
        + (isNew ? `<button type="button" class="new-opt" data-newclient>${t('client.new_option', { name: esc(text) })}</button>` : '');
      if (html) q('[data-combo]').insertAdjacentHTML('beforeend', `<div class="combolist">${html}</div>`);
    };
    clientEl.addEventListener('focus', () => drawClient(true));
    clientEl.addEventListener('input', () => drawClient(true));
    clientEl.addEventListener('blur', () => drawClient(false));
    q('[data-combo]').addEventListener('mousedown', e => { if (e.target.closest('.combolist')) e.preventDefault(); });   // the field keeps focus
    q('[data-combo]').addEventListener('click', e => {
      const b = e.target.closest('.combolist button'); if (!b) return;
      if (b.dataset.cid) { const x = Store.client(b.dataset.cid); if (x) clientEl.value = x.name; }
      drawClient(false);
    });
    drawClient(false);

    // The buttons, or (deleting a goal with tasks) the question what happens with them, in their place.
    const nTasks = () => Store.tasks().filter(k => k.goalId === id).length;
    const drawFoot = (asking) => {
      const n = nTasks();
      q('[data-foot]').innerHTML = asking
        ? `<div class="gconf"><div class="gstat"><b>${UI.tn('goal.has_tasks', n)}</b> ${t('goal.what_with')}</div>
          <button type="button" class="opt ${delHow === 'del' ? 'on' : ''}" data-gdelpick="del"><i></i><span>${UI.tn('goal.delete_tasks_too', n)}</span></button>
          <button type="button" class="opt ${delHow === 'free' ? 'on' : ''}" data-gdelpick="free"><i></i><span>${UI.tn('goal.tasks_to_inbox', n)}</span></button>
          <div class="gcbtns"><button type="button" data-gdelcancel>${t('form.cancel')}</button><button type="button" class="dgo" data-gdelgo ${delHow ? '' : 'disabled'}>${t('goal.delete')}</button></div></div>`
        : `<div class="btns">${g ? `<button type="button" class="danger ${delArmed ? 'confirm' : ''}" data-gdel>${t(delArmed ? 'goal.delete_sure' : 'goal.delete')}</button>` : ''}<button type="button" data-cancel>${t('form.cancel')}</button><button type="submit" class="primary">${t(g ? 'form.save' : 'form.add')}</button></div>`;
    };
    drawFoot(false);

    async function doDelete(how) {
      if (busy) return; busy = true;
      const res = await UI.act(() => Store.deleteGoal(id, how));
      busy = false;
      if (!res) return;
      onGone();
      UI.toast(t('toast.to_bin', { title: g.name }), res.undo);
    }
    q('[data-foot]').addEventListener('click', e => {
      const has = sel => e.target.closest(sel);
      if (has('[data-cancel]')) { onDone(); return; }
      if (has('[data-gdel]')) {
        if (nTasks()) { delHow = null; drawFoot(true); return; }   // first choose what happens with the tasks
        if (!delArmed) { delArmed = true; drawFoot(false); return; }
        doDelete('free'); return;
      }
      const pk = has('[data-gdelpick]');
      if (pk) { delHow = pk.dataset.gdelpick; drawFoot(true); return; }
      if (has('[data-gdelcancel]')) { delHow = null; drawFoot(false); return; }
      if (has('[data-gdelgo]') && delHow) doDelete(delHow);
    });

    f.onsubmit = async e => {
      e.preventDefault(); if (busy) return;
      const fields = { name: nameEl.value.trim(), note: q('[name=note]').value.trim(), clientName: clientEl.value.trim(), hue };
      if (UI.showProblems(Store.goalProblems(fields), { name: nameEl })) return;
      busy = true;
      const res = await UI.act(() => (g ? Store.updateGoal(id, fields) : Store.createGoal(fields)));
      busy = false;
      if (res) onDone();
    };
    nameEl.focus();
  }

  /* ---------- client ---------- */

  function openClient(id) {
    const c = Store.client(id); if (!c) return;
    const dlg = UI.dialog();
    dlg.innerHTML = `<form>
      <h3>${t('client.edit')}</h3>
      <label class="f"><span class="fl">${t('client.name')}</span><input type="text" name="name" autocomplete="off" value="${esc(c.name)}"></label>
      <div class="btns"><button type="button" data-cancel>${t('form.cancel')}</button><button type="submit" class="primary">${t('form.save')}</button></div>
    </form>`;
    const f = dlg.querySelector('form'), nameEl = f.querySelector('[name=name]');
    let busy = false;
    f.querySelector('[data-cancel]').onclick = () => dlg.close();
    f.onsubmit = async e => {
      e.preventDefault(); if (busy) return;
      const v = nameEl.value.trim();
      if (UI.showProblems(Store.clientProblems(id, v), { name: nameEl })) return;
      busy = true;
      const res = await UI.act(() => Store.renameClient(id, v));
      busy = false;
      if (res) dlg.close();
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
