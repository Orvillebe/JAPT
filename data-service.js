/**
 * JAPT Data Service - picks the data layer (config.js says which, from deployment.js and the address).
 *
 * Every data layer offers the same functions, the contract the rest of the app relies on:
 *   needsLogin                    whether there is a login
 *   signIn(email, password), signOut(), getSession() -> {userId, email} or null
 *   hasAccess()                   logged in and on the access list; must run before anything is loaded
 *   schemaVersion()               the number of the last migration that has run; 0 for an empty database
 *   loadAll()                     every table in tables.js, without binned rows or the rows of binned tasks
 *   loadBin()                     {clients, goals, tasks} that are in the Bin
 *   batch(ops)                    several changes, all or nothing (see data-local.js for the shape); a row
 *                                 changed since ifChangedAt is refused with an error with code 'conflict'
 *   purgeBin(beforeIso), exportAll(), testMeetings()
 * The rest of the app only talks to DataService, never to Supabase or localStorage directly.
 * tests/store.test.js shows what the behaviour must be.
 */

const DataService = (() => {
  const { backend } = JAPT_CONFIG;
  if (backend === 'local') return createLocalData();
  if (backend === 'supabase') return createSupabaseData();
  // An address this installation doesn't know: better no app than an app that saves in one browser only.
  document.getElementById('loading').textContent = t('app.unknown_address', { host: location.hostname });
  throw new Error(`JAPT: no data layer for "${backend}" on this address; see deployment.js`);
})();
