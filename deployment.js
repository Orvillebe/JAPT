/**
 * JAPT Deployment - what makes this installation this installation.
 *
 * The one file someone changes who runs JAPT on their own database. Nothing else here changes between
 * installations, so updates of the code never clash with it.
 *
 * productionHosts  the addresses where this installation runs. There the app uses the backend below.
 *                  On your own computer or network it uses local test data, unless the address ends in
 *                  ?db=live. On any other address it refuses to start, so a forgotten address can't look
 *                  like it works while saving only in one browser.
 * backend          the data layer: 'supabase', or the name of another one (see data-service.js)
 * supabaseUrl, supabaseKey
 *                  Supabase project (Settings > API). The publishable key may be in the code: the rules in
 *                  the database decide what it can reach. Never put the secret key here.
 */

const JAPT_DEPLOYMENT = {
  productionHosts: ['orvillebe.github.io'],
  backend: 'supabase',
  supabaseUrl: 'https://vrznsyvvoiaanfyfdupa.supabase.co',
  supabaseKey: 'sb_publishable_lz9rBaoHXrd1Hn9WFk9Tgw_mKiyd-ba'
};
