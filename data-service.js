/**
 * JAPT Data Service - picks the data layer: the one named in deployment.js, or the local one for testing
 * (config.js decides from the address).
 *
 * The rest of the app only talks to DataService, never to a database or localStorage directly. What every
 * data layer must offer is in docs/data-layer.md, and tests/contract.js checks it.
 *
 * Another backend: write data-<name>.js, add it to LAYERS below and to index.html, and set backend: '<name>'
 * in deployment.js. Nothing else changes.
 */

const DataService = (() => {
  const LAYERS = {
    local: () => createLocalData(),
    supabase: () => createSupabaseData()
  };
  const { backend } = JAPT_CONFIG;
  if (LAYERS[backend]) return LAYERS[backend]();
  // An address this installation doesn't know: better no app than an app that saves in one browser only.
  document.getElementById('loading').textContent = t('app.unknown_address', { host: location.hostname });
  throw new Error(`JAPT: no data layer for "${backend}" on this address; see deployment.js`);
})();
