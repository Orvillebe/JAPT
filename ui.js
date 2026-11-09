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
 *
 * Screens own their own DOM and events; this file only offers pieces.
 */

const UI = (() => {
  const M = Model;
  const $ = id => document.getElementById(id);
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ESCAPES[c]);
  const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
  // For HTML over several lines: the line breaks and indents of the code don't end up in the page.
  // Values are put in as they are, so typed text still goes through esc().
  const html = (strings, ...values) =>
    strings.map((s, i) => s.replace(/\n\s*/g, '') + (i < values.length ? values[i] : '')).join('');
  const tn = (key, n, vars = {}) => t(key + (n === 1 ? '.one' : '.many'), { n, ...vars });
  // The phone layout, the same width as the @media rules in style.css. Pop-ups also go full screen on a
  // low screen (a phone turned sideways).
  const PHONE_QUERY = '(max-width:700px)';
  const FULLSCREEN_POPUP_QUERY = '(max-width:700px),(max-height:500px)';
  const PHONE = () => matchMedia(PHONE_QUERY).matches;

  /* ---------- what this device remembers ---------- */

  // Personal view settings stay on the device, never in the database (docs/design.md).
  const VIEW_KEY = 'japt_view';
  const MODE = Object.freeze({ DAY: 'day', WORKWEEK: 'workweek', WEEK: 'week', PERIOD: 'cycle', LIST: 'list' });
  const NO_FILTER = () => ({ q: '', who: [], goal: [], client: [] });
  const View = (() => {
    const defaults = {
      page: 'tasks', mode: 'workweek', groupBy: 'none', filter: NO_FILTER(),
      fold: {}, sbHidden: false, showAchieved: false, ibTab: 'add'
    };
    let view = defaults;
    try {
      view = { ...defaults, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
      view.filter = { ...defaults.filter, ...view.filter };
    } catch (e) { /* private window: defaults */ }
    view.date = M.today();
    view.save = () => {
      try {
        const { date, save, ...keep } = view;
        localStorage.setItem(VIEW_KEY, JSON.stringify(keep));
      } catch (e) { /* not stored, still works */ }
    };
    return view;
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
  // For an id that is not (or no longer) a member.
  const UNKNOWN_PERSON_COLOUR = '#999999';
  function lightOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lighten = shift => {
      const c = (n >> shift) & 255;
      return Math.round(c + (255 - c) * LIGHT_MIX).toString(16).padStart(2, '0');
    };
    return '#' + [16, 8, 0].map(lighten).join('');
  }
  const pstyle = id => {
    const m = Store.member(id);
    const c = m ? m.color : UNKNOWN_PERSON_COLOUR;
    return `--pc:${c};--pcl:${lightOf(c)}`;
  };
  const uname = id => (Store.member(id) || { name: '?' }).name;
  const avatar = id => {
    const name = uname(id);
    return `<span class="wd" style="${pstyle(id)}" title="${esc(name)}">${esc(name.charAt(0).toUpperCase())}</span>`;
  };
  const NOGOAL = '--tb:var(--grey-b);--tbg:var(--grey-bg);--tbd:var(--grey-d)';
  const hueStyle = h => (h === M.GREY
    ? NOGOAL
    : `--tb:hsl(${h} 55% 45%);--tbg:hsl(${h} var(--goal-bg-s) var(--goal-bg-l));--tbd:hsl(${h} 55% var(--goal-d-l))`);
  const goalStyle = g => (g ? hueStyle(M.goalHue(g)) : NOGOAL);
  const taskStyle = k => goalStyle(k && Store.goal(k.goalId));
  const hueColour = h => (h === M.GREY ? 'var(--grey-b)' : `hsl(${h} 55% 45%)`);
  const goalDot = g => `<i class="gpd" style="background:${hueColour(M.goalHue(g))}"></i>`;

  /* ---------- the task card ---------- */

  const REP_ICON = '<svg class="repi" width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9"/><path d="M14.5 2.8v2.7h-2.7"/></svg>';

  function repText(r) {
    const p = M.parseRepeat(r);
    if (!p) return '';
    return p.n === 1 ? t('repeat.every_one.' + p.u) : t('repeat.every_n.' + p.u, { n: p.n });
  }

  const metaRow = (rowCls, label, value, valueCls = 'v') =>
    `<div class="mrow ${rowCls}"><span class="k">${label}</span><span class="${valueCls}">${value}</span></div>`;

  function deadlineRow(k) {
    const late = Store.isLate(k), due = Store.dueSoon(k);
    const rep = k.repeat ? ` <span class="dkrep">${REP_ICON} ${repText(k.repeat)}</span>` : '';
    const lateNote = late ? ' · ' + t('meta.planned_late') : '';
    const state = late ? 'late' : due ? 'due' : '';
    return metaRow(`deadline ${state}`, t('meta.deadline'), fmtDay(k.deadline) + rep + lateNote);
  }

  // Goal, client and deadline of a task; changing them only through the pencil.
  function metaLine(k) {
    const g = Store.goal(k.goalId), c = Store.clientOfTask(k.id);
    let rows = '';
    if (g) rows += metaRow('goal', t('meta.goal'), esc(g.name));
    if (c) rows += metaRow('client', t('meta.client'), esc(c.name));
    if (k.deadline) rows += deadlineRow(k);
    return rows ? `<div class="meta">${rows}</div>` : '';
  }

  function chk(k) {
    const checked = k.doneOn ? 'checked' : '';
    return `<input type="checkbox" class="chk" data-check="${k.id}" ${checked} title="${t('task.check')}">`;
  }
  const whoHtml = k => Store.whoOf(k.id).map(avatar).join('');

  // The Plan line: a link per period and per block the task is in; it jumps there (Calendar.jump).
  function planLinks(k) {
    const p = Store.idx().of(k.id);
    if (!p.blocks.length && !p.periods.length) return '';
    const link = (place, title, text) => html`
      <button type="button" class="gl" data-goto="${M.placeText(place)}" data-gotask="${k.id}" title="${title}">
        ${text}
      </button>`;
    const periodLink = o => link(o.place, t('meta.go_period'), `${t('meta.period')} · ${Calendar.spanText(o)}`);
    const blockLink = b => link(b.place, t('meta.go_day'), `${fmtDay(b.date)} · ${span(fmt(b.start), fmt(b.end))}`);
    const links = p.periods.map(periodLink).join('') + p.blocks.map(blockLink).join('');
    return `<div class="meta">${metaRow('plan', t('meta.plan'), links, 'v links')}</div>`;
  }

  // A card in a list. extra: more buttons; noPen: no pencil; noPlan: without the Plan line.
  function taskCard(k, { extra = '', noPen = false, noPlan = false } = {}) {
    const classes = `task ${k.doneOn ? 'done' : ''} ${Store.isLate(k) ? 'late' : ''}`;
    const note = k.note ? `<div class="desc">${esc(k.note)}</div>` : '';
    const pen = noPen ? '' : `<button type="button" title="${t('task.edit')}" data-edit="${k.id}">✎</button>`;
    return html`
      <div class="${classes}" draggable="true" data-task="${k.id}" style="${taskStyle(k)}">
        ${chk(k)}
        <div class="body">
          <div class="trow"><div class="title">${esc(k.title)}</div><div class="who">${whoHtml(k)}</div></div>
          ${note}${metaLine(k)}${noPlan ? '' : planLinks(k)}
        </div>
        <div class="acts">${pen}${extra}</div>
      </div>`;
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
    if (escapers.some(fn => fn())) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  /* ---------- windows ---------- */

  // A window that exists only while it is open: made here, removed when it closes (by a button, Escape,
  // or a click beside it when closeOutside allows that). Returns the <dialog>; fill it after this call.
  function dialog({ cls = '', closeOutside = () => false, onClose = null } = {}) {
    const d = document.createElement('dialog');
    if (cls) d.className = cls;
    d.addEventListener('click', e => {
      if (e.target === d && closeOutside()) d.close();
    });
    d.addEventListener('close', () => {
      dkClose();
      gpClose();
      d.remove();
      if (onClose) onClose();
    });
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
    who: {
      all: 'filter.everyone',
      kind: 'chips',
      opts: () => [
        ...Store.members().map(u => ({ v: u.id, t: u.name, who: u.id })),
        { v: 'none', t: t('filter.nobody'), who: null }
      ]
    },
    goal: {
      all: 'filter.all_goals',
      kind: 'rows',
      opts: () => byClient(Store.openGoals()).flatMap(x => [
        { head: x.name },
        ...x.goals.map(g => ({ v: g.id, t: g.name, dot: g }))
      ])
    },
    client: {
      all: 'filter.all_clients',
      kind: 'rows',
      opts: () => [
        ...Store.clients().map(c => ({ v: c.id, t: c.name })),
        { v: 'intern', t: t('client.intern') }
      ]
    }
  };

  // Goals grouped as on Doelen: clients by name, then Intern; groups without goals left out.
  const byClient = goals => [
    ...Store.clients().map(c => ({ name: c.name, goals: goals.filter(g => g.clientId === c.id) })),
    { name: t('client.intern'), goals: goals.filter(g => g.clientId == null) }
  ].filter(x => x.goals.length);
  const choices = key => MS[key].opts().filter(o => !o.head);

  function msBox(key, option) {
    const checked = View.filter[key].includes(option.v) ? 'checked' : '';
    return `<input type="checkbox" data-msk="${key}" value="${esc(option.v)}" ${checked}>`;
  }

  // "Nobody" is not a person, so it has no colour of its own.
  function msChip(key, option) {
    const colours = option.who != null ? pstyle(option.who) : '--pc:var(--grey-d);--pcl:var(--grey-b)';
    return `<label class="mswho" style="${colours}">${msBox(key, option)}<span>${esc(option.t)}</span></label>`;
  }

  function msRow(key, option) {
    if (option.head) return `<div class="gph">${esc(option.head)}</div>`;
    const dot = option.dot ? goalDot(option.dot) : '';
    return `<label class="msr">${dot}<span class="gpt">${esc(option.t)}</span>${msBox(key, option)}</label>`;
  }

  function msList(key) {
    const m = MS[key];
    const drawOption = m.kind === 'chips' ? msChip : msRow;
    const body = m.opts().map(option => drawOption(key, option)).join('');
    return html`
      <div class="msbk"></div>
      <div class="msb ${m.kind}">${body || `<div class="none-msg">${t('filter.nothing')}</div>`}</div>`;
  }

  function msRender(elId, key, host) {
    const id = host + '-' + key, sel = View.filter[key], open = msOpen === id;
    msShown.set(id, { elId, key });
    const names = choices(key).filter(o => sel.includes(o.v)).map(o => o.t);
    const label = names.length ? esc(names.join(', ')) : t(MS[key].all);
    $(elId).innerHTML = html`
      <div class="ms ${open ? 'open' : ''}" data-msid="${id}">
        <button type="button" class="mss ${names.length ? 'on' : ''}" aria-expanded="${open}">${label}</button>
        ${open ? msList(key) : ''}
      </div>`;
  }

  function msRedraw(id) {
    const shown = msShown.get(id);
    if (shown && $(shown.elId)) msRender(shown.elId, shown.key, id.split('-')[0]);
  }

  function msClose() {
    if (!msOpen) return false;
    const id = msOpen;
    msOpen = null;
    msRedraw(id);
    return true;
  }

  function msToggle(id) {
    const wasOpen = msOpen === id;
    msClose();
    if (!wasOpen) {
      msOpen = id;
      msRedraw(id);
    }
  }

  const clearFilter = () => {
    View.filter = NO_FILTER();
    View.save();
  };

  // A filter on something that no longer exists (an achieved or deleted goal, a removed person, a
  // deleted client) is dropped. App.render calls this once before drawing.
  function pruneFilter() {
    let changed = false;
    for (const key of Object.keys(MS)) {
      const ok = choices(key).map(o => o.v), keep = View.filter[key].filter(v => ok.includes(v));
      if (keep.length !== View.filter[key].length) {
        View.filter[key] = keep;
        changed = true;
      }
    }
    if (changed) View.save();
  }

  function onFilterClick(e) {
    if (e.target.closest('.msbk')) { msClose(); return; }
    const button = e.target.closest('.ms > .mss');
    if (button) { msToggle(button.parentElement.dataset.msid); return; }
    if (!e.target.closest('.ms')) msClose();
  }

  function applyFilterBox(box) {
    const values = View.filter[box.dataset.msk], i = values.indexOf(box.value);
    if (box.checked && i < 0) values.push(box.value);
    else if (!box.checked && i >= 0) values.splice(i, 1);
  }

  function initFilters(onChange) {
    document.addEventListener('click', onFilterClick);
    onEscape(msClose);
    document.addEventListener('change', e => {
      const box = e.target.closest('input[data-msk]');
      if (!box) return;
      applyFilterBox(box);
      View.save();
      onChange();
    });
  }

  const passes = k => M.passes(k, View.filter, Store.goal, Store.whoOf);
  const filterCount = () => M.filterCount(View.filter);

  /* ---------- the goal picker ---------- */

  // Over a <select> (which keeps the value and is what forms read): a button showing the goal, and a
  // list grouped as on Doelen, made when it opens and removed when it closes.
  let gpOpen = null;   // the .gp element whose list is open
  const gpSelect = w => w.previousElementSibling;

  function gpWrapper(sel) {
    const next = sel.nextElementSibling;
    if (next && next.classList.contains('gp')) return next;
    const w = document.createElement('div');
    w.className = 'gp';
    sel.classList.add('gpsel');
    sel.after(w);
    return w;
  }

  function gpBuild(sel) {
    const w = gpWrapper(sel);
    if (gpOpen === w) gpClose();
    const first = sel.options[0], cur = Store.goal(sel.value);
    const name = cur ? esc(cur.name) : esc(first ? first.textContent : '');
    w.innerHTML = html`
      <button type="button" class="gpb" aria-haspopup="listbox" aria-expanded="false">
        ${cur ? goalDot(cur) : ''}<span class="gpn ${cur ? '' : 'ph'}">${name}</span>
      </button>`;
  }

  function gpGoalRow(g, cur) {
    const achieved = g.achievedOn ? ' ' + t('goal.achieved_paren') : '';
    return html`
      <button type="button" class="gpo ${cur && cur.id === g.id ? 'on' : ''}" data-gpv="${g.id}">
        ${goalDot(g)}<span class="gpt">${esc(g.name)}${achieved}</span><i class="gpr"></i>
      </button>`;
  }

  function gpBlankRow(option, cur) {
    return html`
      <button type="button" class="gpo none ${!cur ? 'on' : ''}" data-gpv="">
        <span class="gpt">${esc(option.textContent)}</span><i class="gpr"></i>
      </button>`;
  }

  function gpList(sel) {
    const first = sel.options[0], blank = first && first.value === '';
    const goals = [...sel.options].map(o => o.value).filter(v => v !== '').map(v => Store.goal(v)).filter(Boolean);
    const cur = goals.find(g => g.id === sel.value);
    const none = blank && !first.disabled ? gpBlankRow(first, cur) : '';
    const group = x => `<div class="gph">${esc(x.name)}</div>${x.goals.map(g => gpGoalRow(g, cur)).join('')}`;
    return html`
      <div class="gpbk" data-gpclose></div>
      <div class="gpp" role="listbox">${none}${byClient(goals).map(group).join('')}</div>`;
  }

  function gpShow(w) {
    gpClose();
    w.insertAdjacentHTML('beforeend', gpList(gpSelect(w)));
    w.classList.add('open');
    w.querySelector('.gpb').setAttribute('aria-expanded', 'true');
    gpOpen = w;
    if (!matchMedia(FULLSCREEN_POPUP_QUERY).matches) w.querySelector('.gpp').scrollIntoView({ block: 'nearest' });
  }

  function gpClose() {
    if (!gpOpen) return false;
    const w = gpOpen;
    gpOpen = null;
    w.querySelectorAll('.gpbk,.gpp').forEach(x => x.remove());
    w.classList.remove('open');
    const button = w.querySelector('.gpb');
    if (button) button.setAttribute('aria-expanded', 'false');
    return true;
  }

  function gpPick(w, value) {
    const sel = gpSelect(w);
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    gpBuild(sel);
  }

  function onGoalPickerClick(e) {
    const w = e.target.closest('.gp');
    if (!w || e.target.closest('[data-gpclose]')) { gpClose(); return; }
    const option = e.target.closest('[data-gpv]');
    if (option) { gpPick(w, option.dataset.gpv); return; }
    if (e.target.closest('.gpb')) {
      e.preventDefault();
      if (gpOpen === w) gpClose();
      else gpShow(w);
    }
  }

  function initGoalPicker() {
    document.addEventListener('click', onGoalPickerClick);
    onEscape(gpClose);
  }

  function goalOption(g) {
    const c = Store.client(g.clientId);
    return `<option value="${g.id}">${esc(g.name)}${c ? ' (' + esc(c.name) + ')' : ''}</option>`;
  }

  // Options for a goal select: open goals (plus keepId, for an achieved goal a task already has).
  function goalOptions(blankLabel, blankDisabled, keepId) {
    const blank = `<option value="" ${blankDisabled ? 'disabled' : ''}>${esc(blankLabel)}</option>`;
    const goals = Store.goals().filter(g => !g.achievedOn || g.id === keepId);
    return blank + goals.map(goalOption).join('');
  }

  /* ---------- the deadline picker ---------- */

  // Its own calendar with a row Herhalen. The hidden date field holds the value (.value the date,
  // .dataset.rep the repeat 'n:u'); the button shows them. The calendar exists only while it is open.
  const DK_PRESETS = [
    ['', 'repeat.never'],
    ['1:w', 'repeat.week'],
    ['2:w', 'repeat.two_weeks'],
    ['1:m', 'repeat.month'],
    ['3:m', 'repeat.three_months']
  ];
  const DK_YEARS_BACK = 1, DK_YEARS = 9;   // the year list: last year and the eight after it
  const DK_CUSTOM_COUNT = 2, DK_CUSTOM_UNIT = 'w';   // where Aangepast starts when nothing is chosen yet
  const DK_MAX_COUNT = 99;                 // "every 99 months" is already far beyond any real use
  const DK_MONTH_NAME_MAX = 7;             // longer month names are shortened, so the bar fits
  const MONTHS_IN_YEAR = 12, DAYS_IN_WEEK = 7;
  let dk = null;

  function dkText(i) {
    if (!i.value) return `<span class="dkph">${t('deadline.pick')}</span>`;
    const rep = i.dataset.rep;
    const repeat = rep ? `<span class="dkrep">${REP_ICON} ${repText(rep)}</span>` : '';
    return `<span>${fmtDay(i.value)} ${M.parseD(i.value).getUTCFullYear()}</span>${repeat}`;
  }

  function dxSync(i) {
    const w = i.parentElement;
    w.classList.toggle('has', !!i.value);
    w.querySelector('.dkf').innerHTML = dkText(i);
    i.dispatchEvent(new Event('dxsync', { bubbles: true }));
  }

  function setDeadline(i, date, rep) {
    i.value = date || '';
    i.dataset.rep = date ? rep || '' : '';
    dxSync(i);
  }

  function dkFieldButton(i) {
    const field = document.createElement('button');
    field.type = 'button';
    field.className = 'dkf';
    field.setAttribute('aria-haspopup', 'dialog');
    field.addEventListener('click', e => {
      e.preventDefault();
      dkOpen(i);
    });
    return field;
  }

  function dkClearButton(i) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'dclr';
    clear.textContent = '×';
    clear.setAttribute('aria-label', t('deadline.clear_aria'));
    clear.addEventListener('click', e => {
      e.preventDefault();
      setDeadline(i, '', '');
    });
    return clear;
  }

  function wrapDeadline(i) {
    const w = document.createElement('span');
    w.className = 'dwrap';
    i.before(w);
    w.appendChild(i);
    i.hidden = true;
    i.tabIndex = -1;
    w.insertBefore(dkFieldButton(i), i);
    w.appendChild(dkClearButton(i));
    dxSync(i);
  }

  function dkClose() {
    if (!dk) return false;
    dk.bk.remove();
    dk.pop.remove();
    dk = null;
    return true;
  }

  function dkState(i) {
    const base = M.parseD(i.value || M.today()), rep = i.dataset.rep || '';
    return {
      i,
      sel: i.value || '',
      rep,
      y: base.getUTCFullYear(),
      m: base.getUTCMonth(),
      custom: !!rep && !DK_PRESETS.some(p => p[0] === rep)
    };
  }

  function dkOpen(i) {
    dkClose();
    const bk = document.createElement('div');
    bk.className = 'dkbk';
    const pop = document.createElement('div');
    pop.className = 'dkpop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', t('deadline.aria'));
    const host = i.closest('dialog') || document.body;
    host.append(bk, pop);
    dk = { st: dkState(i), bk, pop };
    bk.addEventListener('click', dkClose);
    pop.addEventListener('click', dkClick);
    pop.addEventListener('change', dkChange);
    pop.addEventListener('input', dkInput);
    dkDraw();
  }

  const dkq = sel => dk.pop.querySelector(sel);

  function dkMonthSelect(st) {
    const monthName = k => {
      const name = t('mo.' + k);
      return name.length > DK_MONTH_NAME_MAX ? name.slice(0, 3) : name;
    };
    const option = k => `<option value="${k}" ${k === st.m ? 'selected' : ''}>${monthName(k)}</option>`;
    const options = Array.from({ length: MONTHS_IN_YEAR }, (_, k) => option(k)).join('');
    return `<select data-dkm aria-label="${t('deadline.month')}">${options}</select>`;
  }

  function dkYearSelect(st) {
    const firstYear = M.parseD(M.today()).getUTCFullYear() - DK_YEARS_BACK;
    const years = Array.from({ length: DK_YEARS }, (_, n) => firstYear + n);
    if (!years.includes(st.y)) years.push(st.y);
    const options = years.sort().map(y => `<option ${y === st.y ? 'selected' : ''}>${y}</option>`).join('');
    return `<select data-dky aria-label="${t('deadline.year')}">${options}</select>`;
  }

  function dkWeekdayHeads() {
    const weekStart = M.getWeekStart();
    const head = k => `<span>${cap(t('wd.' + (weekStart + k) % DAYS_IN_WEEK))}</span>`;
    return Array.from({ length: DAYS_IN_WEEK }, (_, k) => head(k)).join('');
  }

  function dkDayButton(ds, day, selected) {
    const isSelected = ds === selected;
    const classes = `dkd ${ds === M.today() ? 'today' : ''} ${isSelected ? 'sel' : ''}`;
    const pressed = isSelected ? 'aria-pressed="true"' : '';
    return `<button type="button" class="${classes}" data-dkd="${ds}" ${pressed}>${day}</button>`;
  }

  // Empty cells first, so the 1st lands under its weekday.
  function dkDayCells({ y, m, sel }) {
    const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay();
    let cells = '<span></span>'.repeat((firstWeekday - M.getWeekStart() + DAYS_IN_WEEK) % DAYS_IN_WEEK);
    const lastDay = M.daysIn(y, m);
    for (let day = 1; day <= lastDay; day++) {
      cells += dkDayButton(M.toDs(new Date(Date.UTC(y, m, day))), day, sel);
    }
    return cells;
  }

  // Repeating needs a date to count from, so without one the pills are off.
  function dkPills(st) {
    const disabled = !st.sel ? 'disabled' : '';
    const pill = (value, on, label) =>
      `<button type="button" class="dkpill ${on ? 'on' : ''}" data-dkr="${value}" ${disabled}>${label}</button>`;
    const presets = DK_PRESETS.map(([value, key]) => pill(value, !st.custom && st.rep === value, t(key)));
    return presets.join('') + pill('custom', st.custom, t('repeat.custom'));
  }

  function dkCustomRow(st) {
    const p = M.parseRepeat(st.rep);
    const count = p ? p.n : DK_CUSTOM_COUNT, chosenUnit = p ? p.u : DK_CUSTOM_UNIT;
    const unitOption = u => `<option value="${u}" ${chosenUnit === u ? 'selected' : ''}>${t('unit.' + u)}</option>`;
    return html`
      <div class="dkcus">
        <span>${t('repeat.every')}</span>
        <input type="number" data-dkn min="1" max="${DK_MAX_COUNT}" value="${count}" aria-label="${t('repeat.count')}">
        <select data-dku aria-label="${t('repeat.unit')}">${['d', 'w', 'm'].map(unitOption).join('')}</select>
      </div>`;
  }

  function dkDraw() {
    const { st, pop } = dk;
    pop.innerHTML = html`
      <div class="dkh">
        <button type="button" data-dk="prev" aria-label="${t('deadline.prev')}">‹</button>
        ${dkMonthSelect(st)}
        ${dkYearSelect(st)}
        <button type="button" data-dk="next" aria-label="${t('deadline.next')}">›</button>
      </div>
      <div class="dkw">${dkWeekdayHeads()}</div>
      <div class="dkg">${dkDayCells(st)}</div>
      <div class="dkl">${REP_ICON} ${t('repeat.label')}</div>
      <div class="dkpills">${dkPills(st)}</div>
      ${st.custom ? dkCustomRow(st) : ''}
      <div class="dkbtns">
        <button type="button" data-dk="clear">${t('deadline.clear')}</button>
        <button type="button" class="primary" data-dk="ok">${t('deadline.ok')}</button>
      </div>`;
  }

  function dkCommit() {
    const { st } = dk;
    setDeadline(st.i, st.sel, st.rep);
    dkClose();
  }

  function dkChooseRepeat(st, choice) {
    if (choice === 'custom') {
      st.custom = true;
      if (!st.rep) st.rep = `${DK_CUSTOM_COUNT}:${DK_CUSTOM_UNIT}`;
    } else {
      st.custom = false;
      st.rep = choice;
    }
  }

  function dkStepMonth(st, step) {
    st.m += step;
    if (st.m < 0) { st.m = MONTHS_IN_YEAR - 1; st.y--; }
    if (st.m >= MONTHS_IN_YEAR) { st.m = 0; st.y++; }
  }

  function dkClick(e) {
    const { st } = dk, b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dkd) {
      st.sel = b.dataset.dkd;
      dkDraw();
      return;
    }
    if (b.dataset.dkr !== undefined) {
      dkChooseRepeat(st, b.dataset.dkr);
      dkDraw();
      return;
    }
    const action = b.dataset.dk;
    if (action === 'prev' || action === 'next') {
      dkStepMonth(st, action === 'next' ? 1 : -1);
      dkDraw();
    } else if (action === 'clear') {
      st.sel = '';
      st.rep = '';
      dkCommit();
    } else if (action === 'ok') {
      dkCommit();
    }
  }

  function dkChange(e) {
    const { st } = dk, d = e.target.dataset;
    if (d.dkm !== undefined) { st.m = +e.target.value; dkDraw(); }
    else if (d.dky !== undefined) { st.y = +e.target.value; dkDraw(); }
    else if (d.dku !== undefined) dkInput();
  }

  function dkInput() {
    const { st } = dk, countField = dkq('[data-dkn]'), unitField = dkq('[data-dku]');
    if (!countField || !unitField) return;
    const count = Math.max(1, Math.min(DK_MAX_COUNT, Math.round(+countField.value) || 1));
    st.rep = `${count}:${unitField.value}`;
  }

  onEscape(dkClose);   // registered first: the innermost pop-up

  /* ---------- toast, problems at their field, saving ---------- */

  // Long enough to read; with Ongedaan longer, so there is time to click it.
  const TOAST_MS = 3500, TOAST_UNDO_MS = 6000;
  let toastTimer = null, toastUndo = null;

  // Hides the toast and hands back the undo it offered.
  function clearToast(el) {
    el.hidden = true;
    el.innerHTML = '';
    const undo = toastUndo;
    toastUndo = null;
    return undo;
  }

  function toast(msg, undo) {
    const el = $('toast');
    toastUndo = undo || null;
    const undoButton = undo ? `<button type="button" data-toastundo>${t('toast.undo')}</button>` : '';
    el.innerHTML = `<span>${esc(msg)}</span>${undoButton}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => clearToast(el), undo ? TOAST_UNDO_MS : TOAST_MS);
    if (undo) el.querySelector('[data-toastundo]').onclick = () => act(clearToast(el));
  }

  function fieldMessage(box) {
    let message = box.querySelector(':scope > .ferr');
    if (!message) {
      message = document.createElement('div');
      message.className = 'ferr';
      message.setAttribute('role', 'alert');
      box.appendChild(message);
    }
    return message;
  }

  // A problem with a field: a red border and a short sentence under it, until the field changes.
  function needField(el, msg) {
    const box = el.closest('.f') || el.parentElement;
    box.classList.add('bad');
    const message = fieldMessage(box);
    message.textContent = msg;
    const clear = () => {
      box.classList.remove('bad');
      message.remove();
    };
    const events = el.tagName === 'SELECT' ? ['change', 'click'] : ['input'];
    events.forEach(type => box.addEventListener(type, clear, { once: true }));
  }

  // A goal select is hidden behind its picker, so the cursor goes to the picker's button.
  function focusTarget(el) {
    if (el.tagName !== 'SELECT') return el;
    const picker = el.nextElementSibling;
    return (picker && picker.querySelector('.gpb')) || el;
  }

  // The Store's problems ({field: key}) at their fields (fields: {field: element}); the cursor goes to
  // the first. Returns true when there were problems.
  function showProblems(problems, fields) {
    if (!problems) return false;
    let first = null;
    for (const [field, key] of Object.entries(problems)) {
      const el = fields[field];
      if (!el) { toast(t(key)); continue; }
      needField(el, t(key));
      if (!first) first = focusTarget(el);
    }
    if (first) first.focus();
    return true;
  }

  async function reportSaveError(e) {
    if (e && e.code === 'conflict') {
      toast(t('error.conflict'));
      try { await Store.reload(); } catch (reloadError) { console.error(reloadError); }
    } else if (e && e.code === 'rule') {
      toast(t(Object.values(e.problems)[0]));
    } else {
      toast(t('error.save'));
    }
  }

  // Every save goes through here. Returns what the action returned, or null when it was not saved:
  //   someone else changed the same thing meanwhile -> reload and say so
  //   the Store refused it (a rule)                  -> say why (screens normally ask first)
  //   anything else                                  -> "not saved"
  async function act(fn) {
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      await reportSaveError(e);
      return null;
    }
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
    toast, needField, showProblems, act
  };
})();
