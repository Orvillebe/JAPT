/**
 * JAPT Data Service - picks the data layer: Supabase on the live address, local data everywhere else
 * (see productionHosts in config.js).
 *
 * Both implementations offer the same functions:
 *   needsLogin, signIn, signOut, getSession, hasAccess, schemaVersion
 *   loadAll, loadBin, batch, purgeBin, exportAll
 *   testMeetings (local only: meetings from the test data)
 * The rest of the app only talks to DataService, never to Supabase or localStorage directly.
 *
 * The Supabase layer (data-supabase.js) is the next build step; until it exists the live address
 * says so instead of silently falling back to local data.
 */

const DataService = (() => {
  if (JAPT_CONFIG.backend !== 'supabase') return createLocalData();
  if (typeof createSupabaseData === 'function') return createSupabaseData();
  throw new Error('JAPT: the Supabase data layer is not built yet');
})();
