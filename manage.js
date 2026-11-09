/**
 * JAPT Manage - the Beheer window.
 *
 * Responsibilities:
 *   - The window: made when it opens and removed when it closes
 *   - The tab bar, the error line and the confirmation that waits for a second click
 *   - Drawing the open tab; redrawing after a change keeps the field you are in
 *   - The one dispatcher for clicks, changes and forms, combining what the tabs list
 *
 * The tabs are in manage-blocks.js (Werkblokken), manage-period.js (Werkperiode) and manage-other.js (the rest),
 * loaded before this file; each gets TAB_SHELL once. What may be saved is the Store's to say (Store ...Problems).
 * The rules are in docs/design.md (Work blocks, Work period, Users, Meetings, Bin).
 */

const Manage = (() => {
  const { $, esc, html } = UI;
  const TABS = ['blocks', 'cycles', 'deadlines', 'week', 'users', 'agenda', 'bin', 'look', 'backup'];

  let tab = 'blocks', err = '';
  let win = null;   // the open window, or null

  // What waits for a second click before it happens: { kind, id } or null. Only one thing at a time.
  const CONFIRM = Object.freeze({ BLOCK: 'block', DAY: 'day', COPY: 'copy', USER: 'user' });
  let confirmDel = null;
  const awaiting = (kind, id) => !!confirmDel && confirmDel.kind === kind && confirmDel.id === id;
  const askConfirm = (kind, id) => { confirmDel = { kind, id }; render(); };
  const setConfirm = asked => { confirmDel = asked; };
  const getConfirm = () => confirmDel;

  const body = () => win.querySelector('[data-mbody]');

  /* ---------- pieces every tab uses ---------- */

  const sectionHead = (titleKey, hint) => html`
    <div class="msec big">${t(titleKey)}</div>
    <p class="mhint">${hint}</p>`;
  const errorBox = msg => (msg ? `<div class="merr" role="alert">${esc(msg)}</div>` : '');

  /* ---------- drawing ---------- */

  const VIEWS = { blocks: ManageBlocks.draw, cycles: ManagePeriod.draw, ...ManageOther.views };

  // The field you are in, by its id or its first data- attribute, so it can be found again after drawing.
  function focusSelector(el) {
    if (!el || !body().contains(el)) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const a = [...el.attributes].find(x => x.name.startsWith('data-'));
    return a ? `[${a.name}="${CSS.escape(a.value)}"]` : null;
  }

  const tabButton = k => html`
    <button type="button" data-mtab="${k}" class="${tab === k ? 'active' : ''}">${t('manage.tab.' + k)}</button>`;

  function render() {
    if (!win) return;
    const fsel = focusSelector(document.activeElement);
    body().innerHTML = `<div class="seg mtabs mtabbar">${TABS.map(tabButton).join('')}</div>`
      + `<div data-merr>${errorBox(err)}</div>` + VIEWS[tab]();
    const back = fsel && body().querySelector(fsel);
    if (back) back.focus();
    const dayPanel = body().querySelector('.dayconf');
    if (dayPanel) dayPanel.scrollIntoView({ block: 'nearest' });
  }
  // A problem shown above the tab without drawing it again, so what you typed stays.
  const showErr = msg => {
    err = msg;
    body().querySelector('[data-merr]').innerHTML = errorBox(msg);
  };
  const done = () => { err = ''; App.render(); render(); };

  /* ---------- what every tab gets ---------- */

  const setErr = msg => { err = msg; };
  const showing = k => tab === k && !!win;
  const TAB_SHELL = Object.freeze({
    render, done, body, showErr, setErr, showing,
    awaiting, askConfirm, setConfirm, getConfirm, CONFIRM, sectionHead
  });
  [ManageBlocks, ManagePeriod, ManageOther].forEach(m => m.start(TAB_SHELL));

  /* ---------- clicks: any tab ---------- */

  function switchTab(el) {
    tab = el.dataset.mtab;
    confirmDel = null;
    err = '';
    if (tab === 'bin') ManageOther.reset();
    render();
  }
  function closeWindow() { win.close(); }

  /* ---------- the click tables ---------- */

  const ANY_TAB_CLICKS = [['[data-mtab]', switchTab], ['[data-mclose]', closeWindow]];

  // Per tab: selector -> what a click on it does.
  const TAB_CLICKS = { blocks: ManageBlocks.clicks, cycles: ManagePeriod.clicks, ...ManageOther.clicks };

  async function onClick(e) {
    for (const [selector, handle] of [...ANY_TAB_CLICKS, ...TAB_CLICKS[tab]]) {
      const el = e.target.closest(selector);
      if (el) { await handle(el); return; }
    }
  }

  /* ---------- changes ---------- */

  async function onChange(e) {
    const field = e.target;
    const quiet = ManagePeriod.changeQuiet(field) || ManageOther.changeQuiet(field);
    if (quiet) { await quiet; return; }
    // Changing anything else also drops a question that was still open and an old message.
    confirmDel = null;
    err = '';
    await (ManageBlocks.change(field) || ManageOther.change(field));
  }

  /* ---------- the window ---------- */

  function open() {
    confirmDel = null; err = ''; ManageBlocks.reset(); ManageOther.reset();
    const onClose = () => { win = null; ManageBlocks.cancelDrag(); };
    win = UI.dialog({ cls: 'wide', closeOutside: () => true, onClose });
    const closeLabel = t('form.close');
    win.innerHTML = html`
      <div class="mhead">
        <h3>${t('manage.button')}</h3>
        <button type="button" class="ico" data-mclose title="${closeLabel}" aria-label="${closeLabel}">✕</button>
      </div>
      <div data-mbody></div>`;
    win.addEventListener('pointerdown', ManageBlocks.pointerDown);
    win.addEventListener('click', onClick);
    win.addEventListener('change', onChange);
    win.addEventListener('input', e => { ManagePeriod.changeQuiet(e.target); });
    win.addEventListener('submit', ManageOther.onSubmit);
    render();
  }
  function init() { $('btnManage').onclick = open; }
  return { init, render };
})();
