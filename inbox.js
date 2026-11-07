/**
 * JAPT Inbox - collecting tasks quickly, and sorting them onto goals.
 *
 * Responsibilities:
 *   - Toevoegen: only the title is needed; note, goal, deadline and who can come along
 *   - Verwerken: drag a task onto a goal's In te plannen or Backlog (it gets that goal and goes to that
 *     list), check it off, or delete it (to the Bin)
 *   - Ongedaan maken (and Ctrl+Z) for the processing steps of this session; not stored
 *   - The count on the Inbox tab
 *
 * Adding goes through Store.addInboxTask, the one place prepared for adding without a connection
 * (docs/design.md, Inbox).
 */

const Inbox = (() => {
  const { $, esc, View } = UI;
  let who = [], recent = [], log = [];
  const IBMINCOL = 230, IBGAP = 14;   // a client column is at least this wide (px), with this gap
  const IB_FALLBACK_W = 900;          // the board's width before it is drawn for the first time
  let groups = [];

  function badge() { const n = Store.inbox().length; $('ibBadge').textContent = n || ''; $('ibTabBadge').textContent = n || ''; }

  // Clients in as many columns as fit; each block goes into the shortest column, so there are no gaps.
  function layout() {
    const el = $('ibClients'); if (!el) return;
    const width = el.clientWidth || IB_FALLBACK_W;
    const n = Math.max(1, Math.min(groups.length, Math.floor((width + IBGAP) / (IBMINCOL + IBGAP))));
    const cols = Array.from({ length: n }, () => ({ h: 0, html: '' }));
    groups.forEach(g => { const c = cols.reduce((a, b) => (b.h < a.h ? b : a)); c.html += g.html; c.h += g.w; });
    el.innerHTML = cols.map(c => `<div class="ibcolm">${c.html}</div>`).join('');
  }

  function drawWho() { $('ibWho').innerHTML = Store.members().map(u => `<button type="button" class="wtog ${who.includes(u.id) ? 'on' : ''}" style="${UI.pstyle(u.id)}" data-iwho="${u.id}">${esc(u.name)}</button>`).join(''); }
  function fillGoal() {
    const sel = $('ibGoal'), cur = sel.value;
    sel.innerHTML = UI.goalOptions(t('goal.not_yet'), false, null);
    sel.value = Store.goal(cur) && !Store.goal(cur).achievedOn ? cur : '';
    UI.gpBuild(sel);
  }

  function render() {
    const items = Store.inbox(), n = items.length;
    document.querySelectorAll('#ibTabs button').forEach(b => b.classList.toggle('active', b.dataset.ibtab === View.ibTab));
    badge();
    $('ibAdd').hidden = View.ibTab !== 'add'; $('ibSort').hidden = View.ibTab !== 'sort';
    fillGoal(); drawWho();
    const rec = recent.map(Store.task).filter(k => k && k.stage === 'inbox').slice(-5).reverse();
    $('ibRecent').innerHTML = rec.length ? `<h3 class="ibh2">${t('inbox.just_added')}</h3>` + rec.map(k => `<div class="ibrec"><span class="t">${esc(k.title)}</span><button class="x" data-ibdel="${k.id}" title="${t('form.delete')}" aria-label="${t('form.delete')}">×</button></div>`).join('') : '';
    const TRASH = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 7v4M9.2 7v4"/></svg>';
    const src = `<div class="sec ibsrc"><div class="sh"><span class="sl">${t('view.inbox')}</span><span class="cnt">${n}</span></div><div class="sb">` +
      (n ? '<div class="list-tasks">' + items.map(k => `<div class="ibitem">${UI.taskCard(k, { extra: `<button type="button" title="${t('form.delete')}" data-ibtrash="${k.id}" aria-label="${t('form.delete')}">${TRASH}</button>`, noPen: true })}</div>`).join('') + '</div>'
        : `<div class="none-msg">${t('inbox.empty')}</div>`) + '</div></div>';
    const buckets = gid => [['open', 'inbox.to_plan'], ['backlog', 'list.backlog']].map(([l, lab]) => `<button type="button" class="ibbk" data-ibdrop="${l}" data-ibgoal="${gid}"><span>${t(lab)}</span></button>`).join('');
    const goalCard = g => `<div class="gcard" style="${UI.goalStyle(g)}"><div class="gtop"><b class="gname" title="${esc(g.name)}">${esc(g.name)}</b></div><div class="ibbks">${buckets(g.id)}</div></div>`;
    const open = Store.openGoals();
    const cols = [...Store.clients().map(c => ({ name: c.name, goals: open.filter(g => g.clientId === c.id) })), { name: t('client.intern'), goals: open.filter(g => g.clientId == null) }].filter(x => x.goals.length);
    groups = cols.map(c => ({ w: 1 + c.goals.length * 3, html: `<div class="ibclient"><div class="cghead"><span class="cn">${esc(c.name)}</span></div><div class="ibgoals2">${c.goals.map(goalCard).join('')}</div></div>` }));
    $('ibBoard').innerHTML = src + '<div class="ibclients" id="ibClients"></div>';
    layout();
    const last = log[log.length - 1];
    $('ibUndoBtn').disabled = !last;
    $('ibUndoBtn').title = last ? t('inbox.undo_title', { title: last.title, what: t('inbox.did.' + last.to) + (last.sub ? ' ' + t('inbox.at', { goal: last.sub }) : '') }) : t('inbox.nothing_to_undo');
  }

  // The fields are emptied only once the task is stored, so nothing typed is lost when saving fails.
  let adding = false;
  async function add() {
    if (adding) return;
    const inp = $('ibIn'), dl = $('ibDeadline');
    const fields = { title: inp.value.trim(), note: $('ibDesc').value.trim(), goalId: $('ibGoal').value || null, who: who.slice(), deadline: dl.value || null, repeat: dl.dataset.rep || null };
    if (UI.showProblems(Store.taskProblems(fields, 'inbox'), { title: inp })) return;
    adding = true;
    const res = await UI.act(() => Store.addInboxTask(fields));
    adding = false;
    if (res) {
      recent.push(res.id);
      inp.value = ''; $('ibDesc').value = ''; $('ibGoal').value = ''; UI.setDeadline(dl, '', ''); who = [];
      render();
    }
    inp.focus();
  }

  // One processing step, kept for Ongedaan maken until the page reloads.
  async function process(id, to, goalId) {
    const k = Store.task(id); if (!k) return;
    const res = await UI.act(() => Store.processInbox(id, to, goalId));
    if (!res) return;
    const g = Store.goal(goalId || k.goalId);
    log.push({ id, title: k.title, to, sub: to === 'open' || to === 'backlog' ? (g ? g.name : '') : '', undo: res.undo });
    render();
  }
  async function undoLast() { const last = log.pop(); if (last) { await UI.act(last.undo); render(); } }

  function init() {
    $('ibForm').onsubmit = e => { e.preventDefault(); add(); };
    $('ibWho').onclick = e => { const b = e.target.closest('[data-iwho]'); if (!b) return; const p = b.dataset.iwho; who = who.includes(p) ? who.filter(x => x !== p) : [...who, p]; drawWho(); };
    UI.wrapDeadline($('ibDeadline'));
    $('ibUndoBtn').onclick = undoLast;
    $('ibTabs').onclick = e => { const b = e.target.closest('[data-ibtab]'); if (!b) return; View.ibTab = b.dataset.ibtab; View.save(); render(); if (View.ibTab === 'add') $('ibIn').focus(); };
    $('ibRecent').onclick = async e => { const b = e.target.closest('[data-ibdel]'); if (!b) return; recent = recent.filter(x => x !== b.dataset.ibdel); await UI.act(() => Store.binTask(b.dataset.ibdel)); };
    // Ctrl+Z (Cmd+Z) undoes the last step, while sorting and not typing in a field.
    document.addEventListener('keydown', e => {
      if (View.page !== 'inbox' || View.ibTab !== 'sort') return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if (e.target.closest && e.target.closest('input,textarea,select,dialog')) return;
      e.preventDefault(); undoLast();
    });
    const iv = $('inboxView');
    iv.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) { if (b.dataset.ibtrash) process(b.dataset.ibtrash, 'deleted'); return; }
      if (e.target.closest('input,[data-edit],[data-check]')) return;
      const c = e.target.closest('#ibBoard .ibitem .task');
      if (c) Tasks.openEdit(c.dataset.task);   // clicking a task opens the form
    });
    // The buckets on the goals are the drop zone for Inbox tasks (drag.js).
    Drag.zone({
      find: el => el.closest('#inboxView [data-ibdrop]'),
      accepts: d => { const k = Store.task(d.task); return !!k && k.stage === 'inbox'; },
      over: () => null,
      drop: (tg, d) => process(d.task, tg.dataset.ibdrop, tg.dataset.ibgoal)
    });
    window.addEventListener('resize', () => { if (View.page === 'inbox' && View.ibTab === 'sort') layout(); });
    // phone: the hint "Meer velden hieronder" goes once the end of the form is in view
    const MORE_MARGIN = 20;   // px: the end of the form counts as in view a little before the screen edge
    const syncMore = () => { const f = $('ibForm'); if (!f || !f.offsetParent) return; const r = f.querySelector('.ibextra').getBoundingClientRect(); f.querySelector('.ibsubmit').classList.toggle('more', r.bottom > innerHeight - MORE_MARGIN); };
    addEventListener('scroll', syncMore, { passive: true }); addEventListener('resize', syncMore);
    setTimeout(syncMore, 0);
  }

  return { init, render, badge, process };
})();
