/**
 * JAPT - Just A Planning Tool
 *
 * Weekly planning for a small team: tasks under goals, goals under clients, planned in the team's work
 * blocks or in a longer work period, with the meetings from the team's agenda in between.
 *
 * Structure (one file per task):
 *   config.js            - settings that change rarely (live address, defaults, Bin days)
 *   version.js           - app version and the database version it needs
 *   i18n/nl.js, i18n.js  - all interface text, by key
 *   model.js             - pure rules: dates, blocks, periods, lists, deadlines, repeats, order, filters
 *   id.js                - new ids, made in the app
 *   tables.js            - the names of the database tables
 *   deployment.js        - what makes this installation this one: addresses, backend, Supabase project
 *   data-local.js        - storage in this browser (testing)
 *   data-supabase.js     - storage in Supabase
 *   data-service.js      - picks the data layer, and the contract every data layer offers
 *   store.js             - data in memory, every action as one save with its undo
 *   ui.js                - shared pieces: view memory, cards, windows, Escape, toast
 *   figures.js           - the small figures that sometimes walk by when a task is checked off
 *   filter-picker.js, goal-picker.js, deadline-picker.js - the fold-out lists to choose with
 *   drag.js              - dragging a task: one handler, drop zones per screen
 *   agenda.js            - meetings from the agenda link
 *   calendar-views.js    - the table of calendar views and what they share
 *   calendar-week.js, -period.js, -list.js, -card.js - the calendar's views and the open task card
 *   calendar.js          - Taken page, right: the bar, drawing, dropping, swiping
 *   tasks.js             - Taken page, left: the lists, the task form, checking off
 *   goals.js             - Doelen page
 *   inbox.js             - Inbox page
 *   manage-blocks.js, -period.js, -other.js - the tabs of Beheer
 *   manage.js            - Beheer window: tabs and drawing
 *   export.js            - backup and analysis export
 *   app.js               - this file: starting, version check, pages, reloading at natural moments
 */

const App = (() => {
  const { $, View } = UI;
  let dbVersion = null, loadedAt = 0, started = false, renderQueued = false;

  /* ---------- the look ---------- */

  const THEME_KEY = 'japt_theme';
  const theme = () => { try { return localStorage.getItem(THEME_KEY) || ''; } catch (e) { return ''; } };
  function setTheme(v) {
    try {
      if (v) localStorage.setItem(THEME_KEY, v); else localStorage.removeItem(THEME_KEY);
    } catch (e) { /* only this session */ }
    if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
  }

  /* ---------- pages ---------- */

  // No sidebar on Doelen, Inbox and the list view.
  function syncSide() {
    const list = View.page === 'tasks' && View.mode === UI.MODE.LIST;
    const noSide = View.page !== 'tasks' || View.sbHidden || list;
    $('sidebar').hidden = noSide;
    document.querySelector('.app').classList.toggle('nosb', noSide);
    $('btnShowSide').hidden = !View.sbHidden || list || View.page !== 'tasks';
  }
  function show(page) {
    View.page = page; View.save();
    Drag.end(); Calendar.closePop();
    $('weekView').hidden = page !== 'tasks';
    $('goalsView').hidden = page !== 'goals';
    $('inboxView').hidden = page !== 'inbox';
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === page));
    syncSide();
    render();
  }
  function render() {
    if (!started) return;
    FilterPicker.prune();
    Tasks.render();
    if (View.page === 'tasks') Calendar.render();
    if (View.page === 'goals') Goals.render();
    if (View.page === 'inbox') Inbox.render();
    Inbox.badge();
  }
  // Something that arrives by itself (the agenda, a reload) never redraws under a drag or an open task
  // card, which would take them away from under your hand: it waits until they are done.
  let renderWaiting = false, reloadWaiting = false;
  const busy = () => Drag.current() || CalendarCard.isOpen();
  function renderWhenFree() { if (busy()) renderWaiting = true; else render(); }
  function catchUp() {
    if (renderWaiting) { renderWaiting = false; setTimeout(render, 0); }
    if (reloadWaiting) { reloadWaiting = false; reloadIfStale(true); }
  }
  Drag.onEnd(catchUp);
  CalendarCard.onClosed(catchUp);
  // Saves change memory; draw once afterwards, not once per change.
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }

  /* ---------- starting ---------- */

  // The database must be exactly the version this code was built for (version.js). Older: the migration
  // hasn't run yet. Newer: this copy of the app is outdated. Either way nothing is loaded or saved.
  async function checkVersion() {
    dbVersion = await DataService.schemaVersion();
    if (dbVersion === SCHEMA_VERSION) return true;
    $('loading').hidden = true; $('main').hidden = true;
    const key = dbVersion < SCHEMA_VERSION ? 'version.db_older' : 'version.app_older';
    $('versionText').textContent = t(key, { db: dbVersion, app: SCHEMA_VERSION });
    $('versionReload').hidden = dbVersion < SCHEMA_VERSION;
    $('versionScreen').hidden = false;
    return false;
  }

  function setPasswordShown(shown) {
    const label = t(shown ? 'login.hide_password' : 'login.show_password');
    $('loginPassword').type = shown ? 'text' : 'password';
    $('loginEye').classList.toggle('shown', shown);
    $('loginEye').title = label;
    $('loginEye').setAttribute('aria-label', label);
  }
  function showLogin() {
    $('loading').hidden = true;
    $('loginScreen').hidden = false;
    setPasswordShown(false);
    $('loginEmail').focus();
  }
  async function login(e) {
    e.preventDefault();
    const email = $('loginEmail').value.trim(), password = $('loginPassword').value;
    if (!email || !password) { $('loginError').textContent = t('login.fill_in'); return; }
    $('loginBtn').disabled = true;
    $('loginError').textContent = '';
    try {
      await DataService.signIn(email, password);
      $('loginScreen').hidden = true;
      setPasswordShown(false);   // never left readable behind the app
      await start();
    } catch (err) {
      console.error(err);
      $('loginError').textContent = t('login.failed');
    } finally {
      $('loginBtn').disabled = false;
    }
  }
  async function logout() {
    try { await DataService.signOut(); } catch (e) { console.error(e); }
    location.reload();
  }

  async function start() {
    $('loading').hidden = false;
    try {
      if (!await checkVersion()) return;
      if (!await DataService.hasAccess()) { $('loading').hidden = true; $('accessScreen').hidden = false; return; }
      await Store.load();
      loaded();
    } catch (e) {
      console.error(e);
      $('loading').textContent = t('error.load', { reason: e.message || e });
      return;
    }
    $('loading').hidden = true; $('main').hidden = false;
    if (!started) {
      started = true;
      Calendar.init(); Tasks.init(); Goals.init(); Inbox.init(); Manage.init();
      FilterPicker.init(render); GoalPicker.init();
      Store.onChange(queueRender);
      document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
        show(b.dataset.view);
        if (View.page === 'inbox' && View.ibTab === 'add') $('ibIn').focus();
      }));
    }
    // On a phone the Inbox opens, and Taken shows the list; on a laptop the calendar stays (as the mockup).
    if (UI.PHONE()) { View.page = 'inbox'; if (View.mode !== UI.MODE.DAY) View.mode = UI.MODE.LIST; }
    if (location.hash === '#inbox') View.page = 'inbox';   // a bookmark for on the way
    show(View.page);
  }

  // Colleagues' changes are loaded when you come back to the tab, when you move to another day, week or
  // period, and by themselves while the app is in view, at most once per reloadSeconds (docs/design.md,
  // Working at the same time). Never during a drag or with a task card open: a reload that was due then
  // happens right after. Only the opening loads everything; these ask what changed (Store.reload).
  async function reloadIfStale(force) {
    if (!started) return;
    if (!force && Date.now() - loadedAt < JAPT_CONFIG.reloadSeconds * 1000) return;
    if (busy()) { reloadWaiting = true; return; }
    loaded();
    try { if (!await checkVersion()) return; await Store.reload(); }
    catch (e) { console.error('Reloading failed', e); }
  }
  // After every load the next one is planned. Out of view nothing is loaded; coming back does that.
  // Only with a shared database: on this machine nobody else changes anything.
  let nextReload = null;
  function loaded() {
    loadedAt = Date.now();
    clearTimeout(nextReload);
    if (!DataService.needsLogin) return;
    nextReload = setTimeout(() => {
      if (document.visibilityState === 'visible') reloadIfStale(false);
    }, JAPT_CONFIG.reloadSeconds * 1000);
  }
  const navigated = () => { reloadIfStale(false); };

  async function init() {
    setTheme(theme());
    I18N.applyTranslations();
    document.title = t('app.title');
    $('localNote').hidden = DataService.needsLogin;
    $('versionReload').onclick = () => location.reload();
    $('loginScreen').onsubmit = login;
    $('loginEye').onclick = () => setPasswordShown($('loginPassword').type === 'password');
    $('btnLogout').hidden = !DataService.needsLogin;
    $('btnLogout').onclick = logout;
    $('accessLogout').onclick = logout;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reloadIfStale(false);
    });
    if (await DataService.getSession()) await start();
    else showLogin();
  }

  const versions = () => ({ app: APP_VERSION, db: dbVersion });
  return { init, show, render, renderWhenFree, syncSide, navigated, versions, theme, setTheme };
})();

App.init();
