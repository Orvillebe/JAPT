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
  const { $, esc, html, View } = UI;
  const { STAGE } = Model;

  const IBMINCOL = 230, IBGAP = 14;   // a client column is at least this wide (px), with this gap
  const IB_FALLBACK_W = 900;          // the board's width before it is drawn for the first time
  // How tall a client block counts when spreading them over columns: its heading, and each goal card.
  const CLIENT_HEAD_WEIGHT = 1, GOAL_CARD_WEIGHT = 3;
  const RECENT_SHOWN = 5;             // the "just added" list stays short, so the form stays in view
  const MORE_MARGIN = 20;             // px: the end of the form counts as in view a little before the screen edge
  const TO_BIN = 'deleted';           // what Store.processInbox takes for "to the Bin"; not a stage
  const BUCKETS = [[STAGE.OPEN, 'inbox.to_plan'], [STAGE.BACKLOG, 'list.backlog']];   // stage, and its label
  const TRASH_ICON = html`
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" 
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 7v4M9.2 7v4"/>
    </svg>`;

  let who = [], recent = [], log = [];
  let groups = [];

  function badge() {
    const n = Store.inbox().length;
    $('ibBadge').textContent = n || '';
    $('ibTabBadge').textContent = n || '';
  }

  // Clients in as many columns as fit; each block goes into the shortest column, so there are no gaps.
  function layout() {
    const el = $('ibClients');
    if (!el) return;
    const width = el.clientWidth || IB_FALLBACK_W;
    const n = Math.max(1, Math.min(groups.length, Math.floor((width + IBGAP) / (IBMINCOL + IBGAP))));
    const cols = Array.from({ length: n }, () => ({ h: 0, html: '' }));
    groups.forEach(g => {
      const shortest = cols.reduce((a, b) => (b.h < a.h ? b : a));
      shortest.html += g.html;
      shortest.h += g.w;
    });
    el.innerHTML = cols.map(c => `<div class="ibcolm">${c.html}</div>`).join('');
  }

  const whoButton = u => html`
    <button type="button" class="wtog ${who.includes(u.id) ? 'on' : ''}" style="${UI.pstyle(u.id)}" data-iwho="${u.id}">
      ${esc(u.name)}
    </button>`;
  function drawWho() { $('ibWho').innerHTML = Store.members().map(whoButton).join(''); }

  function fillGoal() {
    const sel = $('ibGoal'), cur = sel.value;
    sel.innerHTML = GoalPicker.options(t('goal.not_yet'), false, null);
    sel.value = Store.goal(cur) && !Store.goal(cur).achievedOn ? cur : '';
    GoalPicker.build(sel);
  }

  /* ---------- drawing ---------- */

  function showActiveTab() {
    const tabButtons = document.querySelectorAll('#ibTabs button');
    tabButtons.forEach(b => b.classList.toggle('active', b.dataset.ibtab === View.ibTab));
    $('ibAdd').hidden = View.ibTab !== 'add';
    $('ibSort').hidden = View.ibTab !== 'sort';
  }

  const recentRow = k => html`
    <div class="ibrec">
      <span class="t">${esc(k.title)}</span>
      <button class="x" data-ibdel="${k.id}" title="${t('form.delete')}" aria-label="${t('form.delete')}">×</button>
    </div>`;
  function drawRecent() {
    const rec = recent.map(Store.task).filter(k => k && k.stage === STAGE.INBOX).slice(-RECENT_SHOWN).reverse();
    $('ibRecent').innerHTML = rec.length
      ? `<h3 class="ibh2">${t('inbox.just_added')}</h3>` + rec.map(recentRow).join('')
      : '';
  }

  const trashButton = id => html`
    <button type="button" title="${t('form.delete')}" data-ibtrash="${id}" aria-label="${t('form.delete')}">
      ${TRASH_ICON}
    </button>`;
  const sourceItem = k => `<div class="ibitem">${UI.taskCard(k, { extra: trashButton(k.id), noPen: true })}</div>`;
  function sourceColumn() {
    const items = Store.inbox();
    const content = items.length
      ? `<div class="list-tasks">${items.map(sourceItem).join('')}</div>`
      : `<div class="none-msg">${t('inbox.empty')}</div>`;
    return html`
      <div class="sec ibsrc">
        <div class="sh"><span class="sl">${t('view.inbox')}</span><span class="cnt">${items.length}</span></div>
        <div class="sb">${content}</div>
      </div>`;
  }

  const bucket = (goalId, [stage, label]) => html`
    <button type="button" class="ibbk" data-ibdrop="${stage}" data-ibgoal="${goalId}">
      <span>${t(label)}</span>
    </button>`;
  const goalCard = g => html`
    <div class="gcard" style="${UI.goalStyle(g)}">
      <div class="gtop"><b class="gname" title="${esc(g.name)}">${esc(g.name)}</b></div>
      <div class="ibbks">${BUCKETS.map(b => bucket(g.id, b)).join('')}</div>
    </div>`;
  const clientBlock = c => html`
    <div class="ibclient">
      <div class="cghead"><span class="cn" title="${esc(c.name)}">${esc(c.name)}</span></div>
      <div class="ibgoals2">${c.goals.map(goalCard).join('')}</div>
    </div>`;

  // The open goals per client, then those without a client; a client without open goals isn't shown.
  function clientsWithGoals() {
    const open = Store.openGoals();
    const perClient = Store.clients().map(c => ({ name: c.name, goals: open.filter(g => g.clientId === c.id) }));
    const internal = { name: t('client.intern'), goals: open.filter(g => g.clientId == null) };
    return [...perClient, internal].filter(x => x.goals.length);
  }

  function drawBoard() {
    groups = clientsWithGoals().map(c => ({
      w: CLIENT_HEAD_WEIGHT + c.goals.length * GOAL_CARD_WEIGHT,
      html: clientBlock(c)
    }));
    $('ibBoard').innerHTML = sourceColumn() + '<div class="ibclients" id="ibClients"></div>';
    layout();
  }

  function drawUndo() {
    const last = log[log.length - 1], btn = $('ibUndoBtn');
    btn.disabled = !last;
    if (!last) { btn.title = t('inbox.nothing_to_undo'); return; }
    const where = last.sub ? ' ' + t('inbox.at', { goal: last.sub }) : '';
    btn.title = t('inbox.undo_title', { title: last.title, what: t('inbox.did.' + last.to) + where });
  }

  function render() {
    showActiveTab();
    badge();
    fillGoal();
    drawWho();
    drawRecent();
    drawBoard();
    drawUndo();
  }

  /* ---------- adding and processing ---------- */

  // The fields are emptied only once the task is stored, so nothing typed is lost when saving fails.
  let adding = false;
  async function add() {
    if (adding) return;
    const inp = $('ibIn'), dl = $('ibDeadline');
    const fields = {
      title: inp.value.trim(),
      note: $('ibDesc').value.trim(),
      goalId: $('ibGoal').value || null,
      who: who.slice(),
      deadline: dl.value || null,
      repeat: dl.dataset.rep || null
    };
    if (UI.showProblems(Store.taskProblems(fields, STAGE.INBOX), { title: inp })) return;
    adding = true;
    await noteEditor.ready();   // a photo still being made smaller goes along
    fields.photos = noteEditor.changes();
    const res = await UI.act(() => Store.addInboxTask(fields));
    adding = false;
    if (res) {
      noteEditor.saved();
      noteEditor.reset();
      recent.push(res.id);
      inp.value = '';
      $('ibDesc').value = '';
      $('ibGoal').value = '';
      DeadlinePicker.set(dl, '', '');
      who = [];
      render();
    }
    inp.focus();
  }

  // One processing step, kept for Ongedaan maken until the page reloads.
  // Returns whether it was saved.
  async function process(id, to, goalId) {
    const k = Store.task(id);
    if (!k) return false;
    const res = await UI.act(() => Store.processInbox(id, to, goalId));
    if (!res) return false;
    const g = Store.goal(goalId || k.goalId);
    const sub = to === STAGE.OPEN || to === STAGE.BACKLOG ? (g ? g.name : '') : '';
    log.push({ id, title: k.title, to, sub, undo: res.undo });
    render();
    return true;
  }
  async function undoLast() {
    const last = log.pop();
    if (last) { await UI.act(last.undo); render(); }
  }

  /* ---------- events ---------- */

  function toggleWho(e) {
    const b = e.target.closest('[data-iwho]');
    if (!b) return;
    const person = b.dataset.iwho;
    who = who.includes(person) ? who.filter(x => x !== person) : [...who, person];
    drawWho();
  }

  function switchInboxTab(e) {
    const b = e.target.closest('[data-ibtab]');
    if (!b) return;
    View.ibTab = b.dataset.ibtab;
    View.save();
    render();
    if (View.ibTab === 'add') $('ibIn').focus();
  }

  async function binRecent(e) {
    const b = e.target.closest('[data-ibdel]');
    if (!b) return;
    recent = recent.filter(x => x !== b.dataset.ibdel);
    await UI.act(() => Store.binTask(b.dataset.ibdel));
  }

  // Ctrl+Z (Cmd+Z) undoes the last step, while sorting and not typing in a field.
  function onUndoKey(e) {
    if (View.page !== 'inbox' || View.ibTab !== 'sort') return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
    if (e.target.closest && e.target.closest('input,textarea,select,dialog')) return;
    e.preventDefault();
    undoLast();
  }

  function onViewClick(e) {
    const b = e.target.closest('button');
    if (b) {
      if (b.dataset.ibtrash) process(b.dataset.ibtrash, TO_BIN);
      return;
    }
    if (e.target.closest('input,[data-edit],[data-check]')) return;
    const c = e.target.closest('#ibBoard .ibitem .task');
    if (c) Tasks.openEdit(c.dataset.task);   // clicking a task opens the form
  }

  // The buckets on the goals are the drop zone for Inbox tasks (drag.js).
  function setUpDropZone() {
    Drag.zone({
      find: el => el.closest('#inboxView [data-ibdrop]'),
      accepts: d => { const k = Store.task(d.task); return !!k && k.stage === STAGE.INBOX; },
      over: () => null,
      drop: (tg, d) => process(d.task, tg.dataset.ibdrop, tg.dataset.ibgoal)
    });
  }

  // phone: the hint "Meer velden hieronder" goes once the end of the form is in view
  function syncMoreHint() {
    const f = $('ibForm');
    if (!f || !f.offsetParent) return;
    const r = f.querySelector('.ibextra').getBoundingClientRect();
    f.querySelector('.ibsubmit').classList.toggle('more', r.bottom > innerHeight - MORE_MARGIN);
  }

  let noteEditor = null;   // the note with its photos (photos.js)
  function init() {
    $('ibNote').outerHTML = Photos.noteFieldHtml({ id: 'ibDesc', rows: 2, cls: 'f full' });
    noteEditor = Photos.editor($('ibDesc').closest('.f'), $('ibForm'), null);
    $('ibForm').onsubmit = e => { e.preventDefault(); add(); };
    $('ibWho').onclick = toggleWho;
    DeadlinePicker.wrap($('ibDeadline'));
    $('ibUndoBtn').onclick = undoLast;
    $('ibTabs').onclick = switchInboxTab;
    $('ibRecent').onclick = binRecent;
    document.addEventListener('keydown', onUndoKey);
    $('inboxView').addEventListener('click', onViewClick);
    setUpDropZone();
    window.addEventListener('resize', () => { if (View.page === 'inbox' && View.ibTab === 'sort') layout(); });
    addEventListener('scroll', syncMoreHint, { passive: true });
    addEventListener('resize', syncMoreHint);
    setTimeout(syncMoreHint, 0);
  }

  return { init, render, badge, process };
})();
