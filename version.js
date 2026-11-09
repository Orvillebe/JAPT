/**
 * JAPT Version - which release this is, and which database it needs.
 *
 * APP_VERSION     shown in Beheer. Raise it with every release (major.minor.patch), together with
 *                 the ?v= on every file in index.html (tests/release.test.js checks they match).
 * SCHEMA_VERSION  the database version this code needs: the number of the last file in
 *                 migrations/. Raise it only together with a new migration file.
 *
 * At startup the app compares SCHEMA_VERSION with the database (see App.checkVersion):
 *   database older -> the migration still has to run; the app stops before saving anything
 *   database newer -> this copy of the app is outdated; the app asks to reload
 * Release order and rules: docs/design.md.
 */

const APP_VERSION = '0.3.4';
const SCHEMA_VERSION = 1;

if (typeof module !== 'undefined') module.exports = { APP_VERSION, SCHEMA_VERSION };
