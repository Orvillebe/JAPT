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
 *   data-local.js        - storage in this browser (testing)
 *   data-service.js      - picks the data layer (Supabase on the live address: next build step)
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
    document.body.classList.toggle('inbox-open', page === 'inbox');
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
  // Something that arrives by itself (the agenda) never redraws under a drag: it waits until you let go.
  let afterDrag = false;
  function renderWhenFree() { if (Drag.current()) afterDrag = true; else render(); }
  Drag.onEnd(() => { if (afterDrag) { afterDrag = false; setTimeout(render, 0); } });
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

  async function start() {
    $('loading').hidden = false;
    try {
      if (!await checkVersion()) return;
      if (!await DataService.hasAccess()) { $('loading').hidden = true; $('accessScreen').hidden = false; return; }
      await Store.load();
      loadedAt = Date.now();
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

  // Colleagues' changes are loaded when the app opens, when you come back to the tab, and when you move
  // to another day, week or period (docs/design.md, Working at the same time). Never during a drag.
  async function reloadIfStale(force) {
    if (!started || Drag.current()) return;
    if (!force && Date.now() - loadedAt < JAPT_CONFIG.reloadSeconds * 1000) return;
    loadedAt = Date.now();
    try { if (!await checkVersion()) return; await Store.reload(); }
    catch (e) { console.error('Reloading failed', e); }
  }
  const navigated = () => { reloadIfStale(false); };

  async function init() {
    setTheme(theme());
    I18N.applyTranslations();
    document.title = t('app.title');
    $('localNote').hidden = DataService.needsLogin;
    $('versionReload').onclick = () => location.reload();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reloadIfStale(true);
    });
    await start();
  }

  const versions = () => ({ app: APP_VERSION, db: dbVersion });
  return { init, show, render, renderWhenFree, syncSide, navigated, versions, theme, setTheme };
})();

App.init();
