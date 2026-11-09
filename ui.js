/**
 * JAPT UI - what several screens share.
 *
 * Responsibilities:
 *   - View: what this device remembers (page, calendar mode, grouping, filters, folded lists)
 *   - Formatting dates and times in Dutch, colours of people and goals, avatars
 *   - The task card and its meta lines (sidebar, list view, Inbox, goal view)
 *   - Windows (dialogs) that exist only while open, what else closes with them, and the one Escape key handler
 *   - What the pickers (filter-picker.js, goal-picker.js, deadline-picker.js) build on
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

  // The Plan line: a link per period and per block the task is in; it jumps there (calendar-card.js).
  function planLinks(k) {
    const p = Store.idx().of(k.id);
    if (!p.blocks.length && !p.periods.length) return '';
    const link = (place, title, text) => html`
      <button type="button" class="gl" data-goto="${M.placeText(place)}" data-gotask="${k.id}" title="${title}">
        ${text}
      </button>`;
    const periodLink = o => link(o.place, t('meta.go_period'), `${t('meta.period')} · ${CalendarViews.spanText(o)}`);
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
  // are asked in the order they registered: the deadline picker first. A dialog closes itself (the
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

  // What else closes when a window closes. This file loads first and does not know the pickers, so
  // they register here; run in the order registered.
  const windowClosers = [];
  const onWindowClose = fn => { windowClosers.push(fn); };

  // A window that exists only while it is open: made here, removed when it closes (by a button, Escape,
  // or a click beside it when closeOutside allows that). Returns the <dialog>; fill it after this call.
  function dialog({ cls = '', closeOutside = () => false, onClose = null } = {}) {
    const d = document.createElement('dialog');
    if (cls) d.className = cls;
    d.addEventListener('click', e => {
      if (e.target === d && closeOutside()) d.close();
    });
    d.addEventListener('close', () => {
      windowClosers.forEach(fn => fn());
      d.remove();
      if (onClose) onClose();
    });
    document.body.appendChild(d);
    d.showModal();
    return d;
  }

  /* ---------- goals by client ---------- */

  // Goals grouped as on Doelen: clients by name, then Intern; groups without goals left out.
  const byClient = goals => [
    ...Store.clients().map(c => ({ name: c.name, goals: goals.filter(g => g.clientId === c.id) })),
    { name: t('client.intern'), goals: goals.filter(g => g.clientId == null) }
  ].filter(x => x.goals.length);

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
    html, MODE, NO_FILTER, FULLSCREEN_POPUP_QUERY,
    $, esc, cap, tn, PHONE, View,
    wd, wdLong, mshort, mname, dnum, fmtSp, fmtDay, fmt, span,
    lightOf, pstyle, uname, avatar, goalStyle, taskStyle, hueStyle, hueColour, goalDot, NOGOAL,
    REP_ICON, repText, metaLine, taskCard, chk, whoHtml,
    byClient,
    onEscape, onWindowClose, dialog,
    toast, needField, showProblems, act
  };
})();
