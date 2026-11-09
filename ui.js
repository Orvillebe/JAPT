/**
 * JAPT UI - what several screens share.
 *
 * Responsibilities:
 *   - View: what this device remembers (page, calendar mode, grouping, filters, folded lists)
 *   - Formatting dates and times in Dutch, colours of people and goals, avatars
 *   - The task card and its meta lines (sidebar, list view, Inbox, goal view)
 *   - Windows (dialogs) that exist only while open, and the one Escape key handler
 *   - The filter pickers (shared by the sidebar and the list view), the goal picker, the deadline picker:
 *     their fold-outs are made when they open and removed when they close
 *   - Toast with Ongedaan, problems shown at their field, saving with the changed_at check (act)
 *   - The small figures that sometimes walk by when a task is checked off
 *
 * Screens own their own DOM and events; this file only offers pieces.
 */

const UI = (() => {
  const M = Model;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
  // For HTML over several lines: the line breaks and indents of the code don't end up in the page.
  // Values are put in as they are, so typed text still goes through esc().
  const html = (strings, ...values) =>
    strings.map((s, i) => s.replace(/\n\s*/g, '') + (i < values.length ? values[i] : '')).join('');
  const tn = (key, n, vars = {}) => t(key + (n === 1 ? '.one' : '.many'), { n, ...vars });
  // The phone layout, the same width as the @media rules in style.css. Pop-ups also go full screen on a
  // low screen (a phone turned sideways).
  const PHONE_QUERY = '(max-width:700px)', FULLSCREEN_POPUP_QUERY = '(max-width:700px),(max-height:500px)';
  const PHONE = () => matchMedia(PHONE_QUERY).matches;

  /* ---------- what this device remembers ---------- */

  // Personal view settings stay on the device, never in the database (docs/design.md).
  const VIEW_KEY = 'japt_view';
  const MODE = Object.freeze({ DAY: 'day', WORKWEEK: 'workweek', WEEK: 'week', PERIOD: 'cycle', LIST: 'list' });
  const NO_FILTER = () => ({ q: '', who: [], goal: [], client: [] });
  const View = (() => {
    const d = { page: 'tasks', mode: 'workweek', groupBy: 'none', filter: NO_FILTER(), fold: {}, sbHidden: false, showAchieved: false, ibTab: 'add' };
    let v = d;
    try { v = { ...d, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') }; v.filter = { ...d.filter, ...v.filter }; } catch (e) { /* private window: defaults */ }
    v.date = M.today();
    v.save = () => { try { const { date, save, ...keep } = v; localStorage.setItem(VIEW_KEY, JSON.stringify(keep)); } catch (e) { /* not stored, still works */ } };
    return v;
  })();

  /* ---------- dates and times ---------- */

  const wd = ds => t('wd.' + M.weekday(ds));                // ma
  const wdLong = n => t('wdlong.' + n);                      // Maandag
  const mshort = ds => t('ms.' + M.parseD(ds).getUTCMonth()); // nov
  const mname = ds => t('mo.' + M.parseD(ds).getUTCMonth());  // november
  const dnum = ds => M.parseD(ds).getUTCDate();
  const fmtSp = ds => `${wd(ds)} ${dnum(ds)} ${mshort(ds)}`;           // ma 2 nov
  const fmtDay = ds => `${cap(wd(ds))} ${dnum(ds)} ${mshort(ds)}`;     // Ma 2 nov
  const fmt = M.hhmm;
  const span = (a, z) => t('time.span', { a, z });                     // 9:00 tot 12:30

  /* ---------- colours ---------- */

  // A person's light colour: their colour mixed 55% towards white (dashed borders, unselected chips).
  const LIGHT_MIX = 0.55;
  const lightOf = hex => { const n = parseInt(hex.slice(1), 16); return '#' + [16, 8, 0].map(sh => { const c = (n >> sh) & 255; return Math.round(c + (255 - c) * LIGHT_MIX).toString(16).padStart(2, '0'); }).join(''); };
  const pstyle = id => { const m = Store.member(id); const c = m ? m.color : '#999999'; return `--pc:${c};--pcl:${lightOf(c)}`; };
  const uname = id => (Store.member(id) || { name: '?' }).name;
  const avatar = id => `<span class="wd" style="${pstyle(id)}" title="${esc(uname(id))}">${esc(uname(id).charAt(0).toUpperCase())}</span>`;
  const NOGOAL = '--tb:var(--grey-b);--tbg:var(--grey-bg);--tbd:var(--grey-d)';
  const hueStyle = h => (h === M.GREY ? NOGOAL : `--tb:hsl(${h} 55% 45%);--tbg:hsl(${h} var(--goal-bg-s) var(--goal-bg-l));--tbd:hsl(${h} 55% var(--goal-d-l))`);
  const goalStyle = g => (g ? hueStyle(M.goalHue(g)) : NOGOAL);
  const taskStyle = k => goalStyle(k && Store.goal(k.goalId));
  const hueColour = h => (h === M.GREY ? 'var(--grey-b)' : `hsl(${h} 55% 45%)`);
  const goalDot = g => `<i class="gpd" style="background:${hueColour(M.goalHue(g))}"></i>`;

  /* ---------- the task card ---------- */

  const REP_ICON = '<svg class="repi" width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9"/><path d="M14.5 2.8v2.7h-2.7"/></svg>';
  const repText = r => { const p = M.parseRepeat(r); if (!p) return ''; return p.n === 1 ? t('repeat.every_one.' + p.u) : t('repeat.every_n.' + p.u, { n: p.n }); };

  // Goal, client and deadline of a task; changing them only through the pencil.
  function metaLine(k) {
    const g = Store.goal(k.goalId), c = Store.clientOfTask(k.id);
    let out = '';
    if (g) out += `<div class="mrow goal"><span class="k">${t('meta.goal')}</span><span class="v">${esc(g.name)}</span></div>`;
    if (c) out += `<div class="mrow client"><span class="k">${t('meta.client')}</span><span class="v">${esc(c.name)}</span></div>`;
    if (k.deadline) {
      const late = Store.isLate(k), due = Store.dueSoon(k);
      const rep = k.repeat ? ` <span class="dkrep">${REP_ICON} ${repText(k.repeat)}</span>` : '';
      out += `<div class="mrow deadline ${late ? 'late' : due ? 'due' : ''}"><span class="k">${t('meta.deadline')}</span><span class="v">${fmtDay(k.deadline)}${rep}${late ? ' · ' + t('meta.planned_late') : ''}</span></div>`;
    }
    return out ? `<div class="meta">${out}</div>` : '';
  }
  const chk = k => `<input type="checkbox" class="chk" data-check="${k.id}" ${k.doneOn ? 'checked' : ''} title="${t('task.check')}">`;
  const whoHtml = k => Store.whoOf(k.id).map(avatar).join('');

  // The Plan line: a link per period and per block the task is in; it jumps there (Calendar.jump).
  function planLinks(k) {
    const p = Store.idx().of(k.id);
    if (!p.blocks.length && !p.periods.length) return '';
    const link = (place, title, text) => `<button type="button" class="gl" data-goto="${M.placeText(place)}" data-gotask="${k.id}" title="${title}">${text}</button>`;
    const links = p.periods.map(o => link(o.place, t('meta.go_period'), `${t('meta.period')} · ${Calendar.spanText(o)}`)).join('')
      + p.blocks.map(b => link(b.place, t('meta.go_day'), `${fmtDay(b.date)} · ${span(fmt(b.start), fmt(b.end))}`)).join('');
    return `<div class="meta"><div class="mrow plan"><span class="k">${t('meta.plan')}</span><span class="v links">${links}</span></div></div>`;
  }
  // A card in a list. extra: more buttons; noPen: no pencil; noPlan: without the Plan line.
  function taskCard(k, { extra = '', noPen = false, noPlan = false } = {}) {
    return `<div class="task ${k.doneOn ? 'done' : ''} ${Store.isLate(k) ? 'late' : ''}" draggable="true" data-task="${k.id}" style="${taskStyle(k)}">
    ${chk(k)}
    <div class="body"><div class="trow"><div class="title">${esc(k.title)}</div><div class="who">${whoHtml(k)}</div></div>
    ${k.note ? `<div class="desc">${esc(k.note)}</div>` : ''}${metaLine(k)}${noPlan ? '' : planLinks(k)}</div>
    <div class="acts">${noPen ? '' : `<button type="button" title="${t('task.edit')}" data-edit="${k.id}">✎</button>`}${extra}</div></div>`;
  }

  /* ---------- Escape ---------- */

  // One handler for the whole app. Each piece that can be open registers a function that closes it and
  // says whether something was open; the first one that was open is closed, one per press. Pieces
  // register from inner to outer (pickers before the calendar card). A dialog closes itself (the
  // browser does that) when nothing inside it was open.
  const escapers = [];
  const onEscape = fn => { escapers.push(fn); };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (escapers.some(fn => fn())) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ---------- windows ---------- */

  // A window that exists only while it is open: made here, removed when it closes (by a button, Escape,
  // or a click beside it when closeOutside allows that). Returns the <dialog>; fill it after this call.
  function dialog({ cls = '', closeOutside = () => false, onClose = null } = {}) {
    const d = document.createElement('dialog');
    if (cls) d.className = cls;
    d.addEventListener('click', e => { if (e.target === d && closeOutside()) d.close(); });
    d.addEventListener('close', () => { dkClose(); gpClose(); d.remove(); if (onClose) onClose(); });
    document.body.appendChild(d);
    d.showModal();
    return d;
  }

  /* ---------- filter pickers ---------- */

  // A filter is a fold-out list with checkboxes, in the same look as the pickers in the forms. Only one
  // is open at a time; its list exists only while it is open.
  let msOpen = null;                 // id of the open picker
  const msShown = new Map();         // id -> {elId, key}: where each picker is drawn, to draw it again
  const MS = {
    who: { all: 'filter.everyone', kind: 'chips', opts: () => [...Store.members().map(u => ({ v: u.id, t: u.name, who: u.id })), { v: 'none', t: t('filter.nobody'), who: null }] },
    goal: { all: 'filter.all_goals', kind: 'rows', opts: () => byClient(Store.openGoals()).flatMap(x => [{ head: x.name }, ...x.goals.map(g => ({ v: g.id, t: g.name, dot: g }))]) },
    client: { all: 'filter.all_clients', kind: 'rows', opts: () => [...Store.clients().map(c => ({ v: c.id, t: c.name })), { v: 'intern', t: t('client.intern') }] }
  };
  // Goals grouped as on Doelen: clients by name, then Intern; groups without goals left out.
  const byClient = goals => [...Store.clients().map(c => ({ name: c.name, goals: goals.filter(g => g.clientId === c.id) })), { name: t('client.intern'), goals: goals.filter(g => g.clientId == null) }].filter(x => x.goals.length);
  const choices = key => MS[key].opts().filter(o => !o.head);

  function msRender(elId, key, host) {
    const m = MS[key], id = host + '-' + key, sel = View.filter[key], open = msOpen === id;
    msShown.set(id, { elId, key });
    const names = choices(key).filter(o => sel.includes(o.v)).map(o => o.t);
    let list = '';
    if (open) {
      const opts = m.opts(), box = o => `<input type="checkbox" data-msk="${key}" value="${esc(o.v)}" ${sel.includes(o.v) ? 'checked' : ''}>`;
      const body = m.kind === 'chips'
        ? opts.map(o => `<label class="mswho" style="${o.who != null ? pstyle(o.who) : '--pc:var(--grey-d);--pcl:var(--grey-b)'}">${box(o)}<span>${esc(o.t)}</span></label>`).join('')
        : opts.map(o => (o.head ? `<div class="gph">${esc(o.head)}</div>` : `<label class="msr">${o.dot ? goalDot(o.dot) : ''}<span class="gpt">${esc(o.t)}</span>${box(o)}</label>`)).join('');
      list = `<div class="msbk"></div><div class="msb ${m.kind}">${body || `<div class="none-msg">${t('filter.nothing')}</div>`}</div>`;
    }
    $(elId).innerHTML = `<div class="ms ${open ? 'open' : ''}" data-msid="${id}"><button type="button" class="mss ${names.length ? 'on' : ''}" aria-expanded="${open}">${names.length ? esc(names.join(', ')) : t(m.all)}</button>${list}</div>`;
  }
  function msRedraw(id) { const s = msShown.get(id); if (s && $(s.elId)) msRender(s.elId, s.key, id.split('-')[0]); }
  function msClose() { if (!msOpen) return false; const id = msOpen; msOpen = null; msRedraw(id); return true; }
  const clearFilter = () => { View.filter = NO_FILTER(); View.save(); };
  // A filter on something that no longer exists (an achieved or deleted goal, a removed person, a
  // deleted client) is dropped. App.render calls this once before drawing.
  function pruneFilter() {
    let changed = false;
    for (const key of Object.keys(MS)) {
      const ok = choices(key).map(o => o.v), keep = View.filter[key].filter(v => ok.includes(v));
      if (keep.length !== View.filter[key].length) { View.filter[key] = keep; changed = true; }
    }
    if (changed) View.save();
  }
  function initFilters(onChange) {
    document.addEventListener('click', e => {
      if (e.target.closest('.msbk')) { msClose(); return; }
      const b = e.target.closest('.ms > .mss');
      if (b) { const id = b.parentElement.dataset.msid, was = msOpen === id; msClose(); if (!was) { msOpen = id; msRedraw(id); } return; }
      if (!e.target.closest('.ms')) msClose();
    });
    onEscape(msClose);
    document.addEventListener('change', e => {
      const c = e.target.closest('input[data-msk]'); if (!c) return;
      const a = View.filter[c.dataset.msk], i = a.indexOf(c.value);
      if (c.checked && i < 0) a.push(c.value); else if (!c.checked && i >= 0) a.splice(i, 1);
      View.save(); onChange();
    });
  }
  const passes = k => M.passes(k, View.filter, Store.goal, Store.whoOf);
  const filterCount = () => M.filterCount(View.filter);

  /* ---------- the goal picker ---------- */

  // Over a <select> (which keeps the value and is what forms read): a button showing the goal, and a
  // list grouped as on Doelen, made when it opens and removed when it closes.
  let gpOpen = null;   // the .gp element whose list is open
  const gpSelect = w => w.previousElementSibling;
  function gpBuild(sel) {
    let w = sel.nextElementSibling;
    if (!w || !w.classList.contains('gp')) { w = document.createElement('div'); w.className = 'gp'; sel.classList.add('gpsel'); sel.after(w); }
    if (gpOpen === w) gpClose();
    const first = sel.options[0], cur = Store.goal(sel.value);
    w.innerHTML = `<button type="button" class="gpb" aria-haspopup="listbox" aria-expanded="false">${cur ? goalDot(cur) : ''}<span class="gpn ${cur ? '' : 'ph'}">${cur ? esc(cur.name) : esc(first ? first.textContent : '')}</span></button>`;
  }
  function gpShow(w) {
    gpClose();
    const sel = gpSelect(w), first = sel.options[0], blank = first && first.value === '';
    const goals = [...sel.options].map(o => o.value).filter(v => v !== '').map(v => Store.goal(v)).filter(Boolean);
    const cur = goals.find(g => g.id === sel.value);
    const row = g => `<button type="button" class="gpo ${cur && cur.id === g.id ? 'on' : ''}" data-gpv="${g.id}">${goalDot(g)}<span class="gpt">${esc(g.name)}${g.achievedOn ? ' ' + t('goal.achieved_paren') : ''}</span><i class="gpr"></i></button>`;
    const none = blank && !first.disabled ? `<button type="button" class="gpo none ${!cur ? 'on' : ''}" data-gpv=""><span class="gpt">${esc(first.textContent)}</span><i class="gpr"></i></button>` : '';
    w.insertAdjacentHTML('beforeend', `<div class="gpbk" data-gpclose></div><div class="gpp" role="listbox">${none}${byClient(goals).map(x => `<div class="gph">${esc(x.name)}</div>${x.goals.map(row).join('')}`).join('')}</div>`);
    w.classList.add('open'); w.querySelector('.gpb').setAttribute('aria-expanded', 'true');
    gpOpen = w;
    if (!matchMedia(FULLSCREEN_POPUP_QUERY).matches) w.querySelector('.gpp').scrollIntoView({ block: 'nearest' });
  }
  function gpClose() {
    if (!gpOpen) return false;
    const w = gpOpen; gpOpen = null;
    w.querySelectorAll('.gpbk,.gpp').forEach(x => x.remove());
    w.classList.remove('open');
    const b = w.querySelector('.gpb'); if (b) b.setAttribute('aria-expanded', 'false');
    return true;
  }
  function initGoalPicker() {
    document.addEventListener('click', e => {
      const w = e.target.closest('.gp');
      if (!w || e.target.closest('[data-gpclose]')) { gpClose(); return; }
      const o = e.target.closest('[data-gpv]');
      if (o) { const sel = gpSelect(w); sel.value = o.dataset.gpv; sel.dispatchEvent(new Event('change', { bubbles: true })); gpBuild(sel); return; }
      if (e.target.closest('.gpb')) { e.preventDefault(); if (gpOpen === w) gpClose(); else gpShow(w); }
    });
    onEscape(gpClose);
  }
  // Options for a goal select: open goals (plus keepId, for an achieved goal a task already has).
  function goalOptions(blankLabel, blankDisabled, keepId) {
    return `<option value="" ${blankDisabled ? 'disabled' : ''}>${esc(blankLabel)}</option>` + Store.goals().filter(g => !g.achievedOn || g.id === keepId).map(g => {
      const c = Store.client(g.clientId);
      return `<option value="${g.id}">${esc(g.name)}${c ? ' (' + esc(c.name) + ')' : ''}</option>`;
    }).join('');
  }

  /* ---------- the deadline picker ---------- */

  // Its own calendar with a row Herhalen. The hidden date field holds the value (.value the date,
  // .dataset.rep the repeat 'n:u'); the button shows them. The calendar exists only while it is open.
  const DK_PRESETS = [['', 'repeat.never'], ['1:w', 'repeat.week'], ['2:w', 'repeat.two_weeks'], ['1:m', 'repeat.month'], ['3:m', 'repeat.three_months']];
  const DK_YEARS_BACK = 1, DK_YEARS = 9;   // the year list: last year and the eight after it
  let dk = null;
  function dkText(i) {
    if (!i.value) return `<span class="dkph">${t('deadline.pick')}</span>`;
    const r = i.dataset.rep;
    return `<span>${fmtDay(i.value)} ${M.parseD(i.value).getUTCFullYear()}</span>${r ? `<span class="dkrep">${REP_ICON} ${repText(r)}</span>` : ''}`;
  }
  function dxSync(i) {
    const w = i.parentElement;
    w.classList.toggle('has', !!i.value);
    w.querySelector('.dkf').innerHTML = dkText(i);
    i.dispatchEvent(new Event('dxsync', { bubbles: true }));
  }
  function setDeadline(i, date, rep) { i.value = date || ''; i.dataset.rep = date ? rep || '' : ''; dxSync(i); }
  function wrapDeadline(i) {
    const w = document.createElement('span'); w.className = 'dwrap';
    i.before(w); w.appendChild(i); i.hidden = true; i.tabIndex = -1;
    const f = document.createElement('button'); f.type = 'button'; f.className = 'dkf'; f.setAttribute('aria-haspopup', 'dialog'); w.insertBefore(f, i);
    f.addEventListener('click', e => { e.preventDefault(); dkOpen(i); });
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dclr'; b.textContent = '×'; b.setAttribute('aria-label', t('deadline.clear_aria')); w.appendChild(b);
    b.addEventListener('click', e => { e.preventDefault(); setDeadline(i, '', ''); });
    dxSync(i);
  }
  function dkClose() { if (!dk) return false; dk.bk.remove(); dk.pop.remove(); dk = null; return true; }
  function dkOpen(i) {
    dkClose();
    const host = i.closest('dialog') || document.body, base = i.value || M.today();
    const st = { i, sel: i.value || '', rep: i.dataset.rep || '', y: M.parseD(base).getUTCFullYear(), m: M.parseD(base).getUTCMonth() };
    st.custom = !!st.rep && !DK_PRESETS.some(p => p[0] === st.rep);
    const bk = document.createElement('div'); bk.className = 'dkbk';
    const pop = document.createElement('div'); pop.className = 'dkpop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', t('deadline.aria'));
    host.append(bk, pop); dk = { st, bk, pop };
    bk.addEventListener('click', dkClose);
    pop.addEventListener('click', dkClick); pop.addEventListener('change', dkChange); pop.addEventListener('input', dkInput);
    dkDraw();
  }
  const dkq = sel => dk.pop.querySelector(sel);
  function dkDraw() {
    const { st, pop } = dk, y0 = M.parseD(M.today()).getUTCFullYear() - DK_YEARS_BACK, ws = M.getWeekStart();
    const years = Array.from({ length: DK_YEARS }, (_, n) => y0 + n); if (!years.includes(st.y)) years.push(st.y);
    const first = new Date(Date.UTC(st.y, st.m, 1)).getUTCDay(), off = (first - ws + 7) % 7, n = M.daysIn(st.y, st.m);
    let cells = '<span></span>'.repeat(off);
    for (let d = 1; d <= n; d++) { const ds = M.toDs(new Date(Date.UTC(st.y, st.m, d))); cells += `<button type="button" class="dkd ${ds === M.today() ? 'today' : ''} ${ds === st.sel ? 'sel' : ''}" data-dkd="${ds}" ${ds === st.sel ? 'aria-pressed="true"' : ''}>${d}</button>`; }
    const p = M.parseRepeat(st.rep), noDate = !st.sel;
    const monthName = k => { const m = t('mo.' + k); return m.length > 7 ? m.slice(0, 3) : m; };   // long names shortened, so the bar fits
    pop.innerHTML = `<div class="dkh"><button type="button" data-dk="prev" aria-label="${t('deadline.prev')}">‹</button>
      <select data-dkm aria-label="${t('deadline.month')}">${Array.from({ length: 12 }, (_, k) => `<option value="${k}" ${k === st.m ? 'selected' : ''}>${monthName(k)}</option>`).join('')}</select>
      <select data-dky aria-label="${t('deadline.year')}">${years.sort().map(y => `<option ${y === st.y ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <button type="button" data-dk="next" aria-label="${t('deadline.next')}">›</button></div>
      <div class="dkw">${Array.from({ length: 7 }, (_, k) => `<span>${cap(t('wd.' + (ws + k) % 7))}</span>`).join('')}</div>
      <div class="dkg">${cells}</div>
      <div class="dkl">${REP_ICON} ${t('repeat.label')}</div>
      <div class="dkpills">${DK_PRESETS.map(([v, k]) => `<button type="button" class="dkpill ${!st.custom && st.rep === v ? 'on' : ''}" data-dkr="${v}" ${noDate ? 'disabled' : ''}>${t(k)}</button>`).join('')}<button type="button" class="dkpill ${st.custom ? 'on' : ''}" data-dkr="custom" ${noDate ? 'disabled' : ''}>${t('repeat.custom')}</button></div>
      ${st.custom ? `<div class="dkcus"><span>${t('repeat.every')}</span><input type="number" data-dkn min="1" max="99" value="${p ? p.n : 2}" aria-label="${t('repeat.count')}"><select data-dku aria-label="${t('repeat.unit')}">${['d', 'w', 'm'].map(u => `<option value="${u}" ${(p ? p.u : 'w') === u ? 'selected' : ''}>${t('unit.' + u)}</option>`).join('')}</select></div>` : ''}
      <div class="dkbtns"><button type="button" data-dk="clear">${t('deadline.clear')}</button><button type="button" class="primary" data-dk="ok">${t('deadline.ok')}</button></div>`;
  }
  function dkCommit() { const { st } = dk; setDeadline(st.i, st.sel, st.rep); dkClose(); }
  function dkClick(e) {
    const { st } = dk, b = e.target.closest('button'); if (!b) return;
    if (b.dataset.dkd) { st.sel = b.dataset.dkd; dkDraw(); return; }
    if (b.dataset.dkr !== undefined) {
      if (b.dataset.dkr === 'custom') { st.custom = true; if (!st.rep) st.rep = '2:w'; } else { st.custom = false; st.rep = b.dataset.dkr; }
      dkDraw(); return;
    }
    const a = b.dataset.dk;
    if (a === 'prev' || a === 'next') { st.m += a === 'next' ? 1 : -1; if (st.m < 0) { st.m = 11; st.y--; } if (st.m > 11) { st.m = 0; st.y++; } dkDraw(); }
    else if (a === 'clear') { st.sel = ''; st.rep = ''; dkCommit(); }
    else if (a === 'ok') dkCommit();
  }
  function dkChange(e) {
    const { st } = dk, d = e.target.dataset;
    if (d.dkm !== undefined) { st.m = +e.target.value; dkDraw(); }
    else if (d.dky !== undefined) { st.y = +e.target.value; dkDraw(); }
    else if (d.dku !== undefined) dkInput();
  }
  function dkInput() { const { st } = dk, n = dkq('[data-dkn]'), u = dkq('[data-dku]'); if (!n || !u) return; st.rep = `${Math.max(1, Math.min(99, Math.round(+n.value) || 1))}:${u.value}`; }
  onEscape(dkClose);   // registered first: the innermost pop-up

  /* ---------- toast, problems at their field, saving ---------- */

  // Long enough to read; with Ongedaan longer, so there is time to click it.
  const TOAST_MS = 3500, TOAST_UNDO_MS = 6000;
  let toastTimer = null, toastUndo = null;
  function toast(msg, undo) {
    const el = $('toast');
    toastUndo = undo || null;
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" data-toastundo>${t('toast.undo')}</button>` : ''}`;
    el.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; el.innerHTML = ''; toastUndo = null; }, undo ? TOAST_UNDO_MS : TOAST_MS);
    if (undo) el.querySelector('[data-toastundo]').onclick = async () => { el.hidden = true; el.innerHTML = ''; const u = toastUndo; toastUndo = null; await act(u); };
  }

  // A problem with a field: a red border and a short sentence under it, until the field changes.
  function needField(el, msg) {
    const box = el.closest('.f') || el.parentElement;
    box.classList.add('bad');
    let m = box.querySelector(':scope > .ferr'); if (!m) { m = document.createElement('div'); m.className = 'ferr'; m.setAttribute('role', 'alert'); box.appendChild(m); }
    m.textContent = msg;
    const clr = () => { box.classList.remove('bad'); m.remove(); };
    (el.tagName === 'SELECT' ? ['change', 'click'] : ['input']).forEach(ev => box.addEventListener(ev, clr, { once: true }));
  }
  // The Store's problems ({field: key}) at their fields (fields: {field: element}); the cursor goes to
  // the first. Returns true when there were problems.
  function showProblems(problems, fields) {
    if (!problems) return false;
    let first = null;
    for (const [f, key] of Object.entries(problems)) {
      const el = fields[f]; if (!el) { toast(t(key)); continue; }
      needField(el, t(key));
      if (!first) first = el.tagName === 'SELECT' ? (el.nextElementSibling && el.nextElementSibling.querySelector('.gpb')) || el : el;
    }
    if (first) first.focus();
    return true;
  }

  // Every save goes through here. Returns what the action returned, or null when it was not saved:
  //   someone else changed the same thing meanwhile -> reload and say so
  //   the Store refused it (a rule)                  -> say why (screens normally ask first)
  //   anything else                                  -> "not saved"
  async function act(fn) {
    try { return await fn(); }
    catch (e) {
      console.error(e);
      if (e && e.code === 'conflict') { toast(t('error.conflict')); try { await Store.reload(); } catch (e2) { console.error(e2); } }
      else if (e && e.code === 'rule') toast(t(Object.values(e.problems)[0]));
      else toast(t('error.save'));
      return null;
    }
  }

  /* ---------- figures ---------- */

  // When checking off, sometimes a small figure comes by: robot, chicken, lamb, vacuum cleaner or cat.
  // In its own layer above the page (position fixed), so redrawing doesn't wipe it. One at a time, and
  // never with reduced motion.
  const FX_SVG = {
    robot: `<svg viewBox="0 0 40 40"><line x1="20" y1="3" x2="20" y2="9" stroke="#8a93a0" stroke-width="1.6"/><circle class="light" cx="20" cy="3" r="2.4" fill="#cf6a52"/><rect x="2.5" y="17" width="3.5" height="9" rx="1.7" fill="#8a93a0"/><rect x="6" y="9" width="28" height="25" rx="8" fill="#dfe4ea" stroke="#8a93a0" stroke-width="1.4"/><rect x="10" y="14" width="20" height="13" rx="5" fill="#2f3744"/><circle class="eye" cx="16" cy="20" r="2.3" fill="#9fe3b0"/><circle class="eye" cx="24" cy="20" r="2.3" fill="#9fe3b0"/><path d="M17 24 q3 2.2 6 0" stroke="#9fe3b0" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="11.5" cy="24" r="1.6" fill="#f4b9a8" opacity=".8"/><circle cx="28.5" cy="24" r="1.6" fill="#f4b9a8" opacity=".8"/><g class="arm"><rect x="34" y="18" width="3.4" height="9" rx="1.7" fill="#8a93a0"/><circle cx="35.7" cy="17" r="3.4" fill="#dfe4ea" stroke="#8a93a0" stroke-width="1.2"/></g></svg>`,
    chicken: `<svg viewBox="0 0 46 42"><path d="M10 24q-7-7-2-14 3 6 7 10z" fill="#fff" stroke="#d9d2c3" stroke-width="1.2"/><ellipse cx="23" cy="28" rx="15" ry="11" fill="#fff" stroke="#d9d2c3" stroke-width="1.2"/><ellipse cx="22" cy="28" rx="7" ry="5" fill="#f3efe6" stroke="#d9d2c3"/><circle cx="33" cy="15" r="8" fill="#fff" stroke="#d9d2c3" stroke-width="1.2"/><circle cx="30" cy="7" r="2.5" fill="#cf6a52"/><circle cx="33.5" cy="5.5" r="2.7" fill="#cf6a52"/><circle cx="37" cy="7" r="2.4" fill="#cf6a52"/><polygon points="40,14 46,16 40,18" fill="#e5a53a"/><circle cx="35.5" cy="13" r="1.5" fill="#232323"/><circle cx="35" cy="12.5" r=".5" fill="#fff"/><circle cx="31.5" cy="18" r="2" fill="#f4b9a8" opacity=".8"/><ellipse cx="38.5" cy="20.5" rx="1.8" ry="2.6" fill="#cf6a52"/><path d="M19 38v4M27 38v4" stroke="#e5a53a" stroke-width="2" stroke-linecap="round"/></svg>`,
    egg: `<svg viewBox="0 0 14 18"><ellipse cx="7" cy="10" rx="5.6" ry="7.2" fill="#f6ead3" stroke="#d9c9a6" stroke-width="1.2"/><ellipse cx="5" cy="7.5" rx="1.4" ry="2" fill="#fff" opacity=".7"/></svg>`,
    lamb: `<svg viewBox="0 0 46 34"><g fill="#fff" stroke="#d3cec2" stroke-width="1.6"><circle cx="12" cy="16" r="8"/><circle cx="20" cy="11" r="8"/><circle cx="29" cy="12" r="8"/><circle cx="35" cy="19" r="7.5"/><circle cx="24" cy="21" r="9"/><circle cx="14" cy="23" r="7"/></g><g fill="#fff"><circle cx="12" cy="16" r="8"/><circle cx="20" cy="11" r="8"/><circle cx="29" cy="12" r="8"/><circle cx="35" cy="19" r="7.5"/><circle cx="24" cy="21" r="9"/><circle cx="14" cy="23" r="7"/></g><g fill="#4a4640"><rect x="15" y="27" width="2.8" height="7" rx="1.4"/><rect x="22" y="28" width="2.8" height="6" rx="1.4"/><rect x="29" y="27" width="2.8" height="7" rx="1.4"/><rect x="35" y="27" width="2.8" height="6.5" rx="1.4"/><ellipse cx="40" cy="19" rx="5.5" ry="5"/><ellipse cx="35.5" cy="16" rx="3" ry="1.6" transform="rotate(-25 35.5 16)"/></g><circle cx="41.5" cy="17.8" r="1.1" fill="#fff"/><circle cx="38" cy="21.5" r="1.4" fill="#f4b9a8" opacity=".8"/></svg>`,
    vac: `<svg viewBox="0 0 38 22"><ellipse cx="19" cy="20.5" rx="7" ry="1.6" fill="#6b675d"/><ellipse cx="19" cy="14" rx="18" ry="6.5" fill="#dfe4ea" stroke="#8a93a0" stroke-width="1.3"/><path d="M8 13a11 10 0 0 1 22 0z" fill="#eef1f4" stroke="#8a93a0" stroke-width="1.3"/><circle cx="19" cy="3.6" r="1.8" fill="#cf6a52"/><circle cx="14.5" cy="9" r="1.9" fill="#2f3744"/><circle cx="23.5" cy="9" r="1.9" fill="#2f3744"/><path d="M17 11.2q2 1.6 4 0" stroke="#2f3744" stroke-width="1.2" fill="none" stroke-linecap="round"/><circle cx="9.5" cy="12" r="1.5" fill="#f4b9a8" opacity=".8"/><circle cx="28.5" cy="12" r="1.5" fill="#f4b9a8" opacity=".8"/></svg>`,
    cat: `<svg viewBox="0 0 34 30"><polygon points="5,13 6,2 15,8" fill="#e9b27c" stroke="#c98f58" stroke-width="1.2" stroke-linejoin="round"/><polygon points="29,13 28,2 19,8" fill="#e9b27c" stroke="#c98f58" stroke-width="1.2" stroke-linejoin="round"/><polygon points="7,10 7.5,5 11,8" fill="#f2b7a8"/><polygon points="27,10 26.5,5 23,8" fill="#f2b7a8"/><ellipse cx="17" cy="19" rx="13.5" ry="10.5" fill="#e9b27c" stroke="#c98f58" stroke-width="1.2"/><path d="M14 10v3M17 9.5v3.5M20 10v3" stroke="#c98f58" stroke-width="1.2" stroke-linecap="round"/><path d="M10.5 19q2-2.8 4 0M19.5 19q2-2.8 4 0" stroke="#232323" stroke-width="1.6" fill="none" stroke-linecap="round"/><polygon points="15.6,21.5 18.4,21.5 17,23" fill="#e58f86"/><path d="M17 23q-1.8 2-3.8.2M17 23q1.8 2 3.8.2" stroke="#232323" stroke-width="1" fill="none" stroke-linecap="round"/><path d="M5 20l-5-1M5 22.5l-5 2M29 20l5-1M29 22.5l5 2" stroke="#c98f58" stroke-width=".9" stroke-linecap="round"/></svg>`
  };
  let fxBusy = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const anim = (el, kf, o) => el.animate(kf, Object.assign({ fill: 'forwards', easing: 'ease' }, o || {}));
  function figureMaybe(box) {
    if (fxBusy || matchMedia('(prefers-reduced-motion:reduce)').matches || Math.random() >= JAPT_CONFIG.figureChance) return;
    const row = box.closest('.task,.chip,.pt,.gvt') || box.parentElement; if (!row) return;
    const r = row.getBoundingClientRect(), c = box.getBoundingClientRect(); if (r.width < 60) return;
    const kinds = ['robot', 'chicken', 'lamb', 'vac', 'cat'];
    playFigure(kinds[Math.floor(Math.random() * kinds.length)], r, c).catch(() => {});
  }
  async function playFigure(kind, r, c) {
    fxBusy = true;
    const W = r.width, layers = [];
    const layer = h => { const d = document.createElement('div'); d.style.cssText = `position:fixed;left:${r.left}px;top:${r.top - 46}px;width:${W}px;height:${h}px;overflow:hidden;pointer-events:none;z-index:9000`; document.body.appendChild(d); layers.push(d); return d; };
    const add = (host, svg, css) => { const e = document.createElement('div'); e.style.cssText = 'position:absolute;' + css; e.innerHTML = svg; e.firstElementChild.style.cssText = 'display:block;width:100%;height:100%;overflow:visible'; host.appendChild(e); return e; };
    const behind = layer(46), UP = 'translateY(52px)';
    try {
      if (kind === 'robot') {
        const e = add(behind, FX_SVG.robot, 'left:64%;top:6px;width:40px;height:40px;transform:' + UP);
        await anim(e, [{ transform: UP }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,1.3,.5,1)' }).finished;
        const arm = e.querySelector('.arm'); arm.style.cssText = 'transform-box:fill-box;transform-origin:50% 100%';
        anim(arm, [{ transform: 'rotate(0)' }, { transform: 'rotate(-35deg)' }], { duration: 350, iterations: 4, direction: 'alternate' });
        anim(e.querySelector('.light'), [{ opacity: 1 }, { opacity: 0.15 }], { duration: 300, iterations: 4, direction: 'alternate' });
        e.querySelectorAll('.eye').forEach(x => { x.style.cssText = 'transform-box:fill-box;transform-origin:center'; anim(x, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)' }, { transform: 'scaleY(1)' }], { duration: 240, delay: 600 }); });
        await sleep(1500);
        await anim(e, [{ transform: 'none' }, { transform: UP }], { duration: 350, easing: 'ease-in' }).finished;
      }
      if (kind === 'chicken') {
        const h = add(behind, FX_SVG.chicken, 'left:52%;top:4px;width:46px;height:42px;transform:' + UP), egg = add(behind, FX_SVG.egg, 'left:calc(52% - 17px);top:28px;width:14px;height:18px;opacity:0');
        await anim(h, [{ transform: UP }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,1.3,.5,1)' }).finished;
        anim(h, [{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }], { duration: 700 });
        await sleep(650);
        anim(egg, [{ opacity: 0, transform: 'translateY(-8px) scale(.4)' }, { opacity: 1, transform: 'translateY(0) scale(1.15)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 450 });
        await sleep(1100);
        anim(egg, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 200 });
        await anim(h, [{ transform: 'none' }, { transform: UP }], { duration: 350, easing: 'ease-in' }).finished;
        await sleep(300);
      }
      if (kind === 'lamb') {
        const l = add(behind, FX_SVG.lamb, 'left:0;top:12px;width:46px;height:34px;opacity:0');
        anim(l, [{ opacity: 1, transform: 'translate(-56px,0)' }, { opacity: 1, transform: `translate(${W + 10}px,0)` }], { duration: 2200, easing: 'linear' });
        const hop = []; for (let i = 0; i <= 10; i++) hop.push({ transform: i % 2 ? 'translateY(-14px)' : 'translateY(0)', offset: i / 10 });
        anim(l.firstElementChild, hop, { duration: 2200, easing: 'ease-out' });
        await sleep(2250);
      }
      if (kind === 'vac') {
        const v = add(behind, FX_SVG.vac, 'left:0;top:24px;width:38px;height:22px;opacity:0');
        await anim(v, [{ opacity: 1, transform: 'translateX(-44px)' }, { opacity: 1, transform: `translateX(${W + 10}px)` }], { duration: 2100, easing: 'linear' }).finished;
      }
      if (kind === 'cat') {
        const cx = Math.max(0, Math.min(W - 34, c.left - r.left + c.width / 2 - 17));
        const head = add(behind, FX_SVG.cat, `left:${cx}px;top:16px;width:34px;height:30px;transform:${UP}`);
        await anim(head, [{ transform: UP }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,1.3,.5,1)' }).finished;
        await anim(head, [{ transform: 'rotate(0)' }, { transform: 'rotate(-7deg)' }, { transform: 'rotate(7deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }], { duration: 900 }).finished;
        await sleep(250);
        await anim(head, [{ transform: 'none' }, { transform: UP }], { duration: 350, easing: 'ease-in' }).finished;
      }
    } finally { layers.forEach(d => d.remove()); fxBusy = false; }
  }

  return {
    html, MODE,
    $, esc, cap, tn, PHONE, View,
    wd, wdLong, mshort, mname, dnum, fmtSp, fmtDay, fmt, span,
    lightOf, pstyle, uname, avatar, goalStyle, taskStyle, hueStyle, hueColour, goalDot, NOGOAL,
    REP_ICON, repText, metaLine, taskCard, chk, whoHtml,
    onEscape, dialog,
    msRender, msClose, initFilters, passes, filterCount, clearFilter, pruneFilter,
    gpBuild, initGoalPicker, goalOptions,
    wrapDeadline, setDeadline,
    toast, needField, showProblems, act, figureMaybe
  };
})();
