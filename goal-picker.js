/**
 * JAPT goal picker - the fold-out list of goals over a <select>.
 *
 * Responsibilities:
 *   - The button that shows the chosen goal, and the list grouped as on Doelen
 *   - Making the list when it opens and removing it when it closes
 *   - The <option>s for a goal select
 */

const GoalPicker = (() => {
  const { esc, html, goalDot, byClient, FULLSCREEN_POPUP_QUERY, onEscape, onWindowClose } = UI;

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
    onWindowClose(gpClose);
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

  return { build: gpBuild, init: initGoalPicker, options: goalOptions, close: gpClose };
})();
