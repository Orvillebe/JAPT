/**
 * JAPT Config - settings that change rarely and only on purpose.
 *
 * This is the single place for these defaults. Invalid values fall back to the default and are
 * logged in the console. Settings the team changes in Beheer (first day of the week, deadline
 * reminder, work period) are data; the values here are only their starting values.
 */

const JAPT_CONFIG = (() => {
  const DEFAULTS = {
    // First day of the week until it is changed in Beheer. 0 = Sunday, 1 = Monday ... 6 = Saturday
    // (the numbering of Date.getDay). Monday, as in the mockup.
    weekStart: 1,

    // Deadline reminder until it is changed in Beheer: this many days before its deadline a task
    // comes to the top of Nog niet ingepland. A week gives time to plan it in the week before.
    deadlineDays: 7,

    // Days an item stays in the Bin before it is removed for good. The same as JAFT.
    binDays: 30,

    // Chance that a small figure walks by when a task is checked off (0 = never, 1 = always).
    // 0.3 as in the mockup: often enough to be a surprise, rare enough not to bother.
    figureChance: 0.3,

    // The calendar shows at least these hours; blocks and meetings outside them widen it.
    dayStart: 8,
    dayEnd: 18,

    // How long a loaded agenda is kept before it is read again (minutes). docs/design.md, Meetings.
    agendaMinutes: 10,

    // How often the team's changes are loaded while the app is in view, and the shortest time between two
    // loads when you move through weeks or come back to the app (seconds). It sets how late a colleague's
    // change shows up; saving never overwrites it either way. Asking what changed costs about 1 kB, so this
    // can be short. At least 5, so moving quickly through weeks counts as one load.
    // docs/design.md, Working at the same time.
    reloadSeconds: 20,

    // How long one request to the database may take (seconds). Saves wait their turn, so one that never
    // answers would hold up every click after it. Long enough for a slow phone connection.
    requestSeconds: 15,

    // Photos on a task are made smaller in the browser before they are stored: the long side at most this
    // many pixels, as JPEG of this quality (0 to 1). 1200 keeps handwriting on a whiteboard and text on a
    // screenshot readable on a tablet; 0.7 is where JPEG artefacts stay out of sight. Together about 120 kB
    // a photo, so the free 500 MB database holds about three years at five photos a working day.
    // docs/design.md, Photos.
    photoMaxSide: 1200,
    photoQuality: 0.7
  };

  // Change values here. Leave a key out to use the default.
  const SETTINGS = {};

  const int = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi;
  const CHECKS = {
    weekStart: int(0, 6),
    deadlineDays: int(0, 90),
    binDays: int(1, 365),
    figureChance: v => typeof v === 'number' && v >= 0 && v <= 1,
    dayStart: int(0, 23),
    dayEnd: int(1, 24),
    agendaMinutes: int(1, 1440),
    reloadSeconds: int(5, 3600),
    requestSeconds: int(1, 300),
    photoMaxSide: int(320, 4000),
    photoQuality: v => typeof v === 'number' && v >= 0.3 && v <= 1
  };

  const cfg = { ...DEFAULTS };
  for (const [k, v] of Object.entries(SETTINGS)) {
    if (CHECKS[k] && CHECKS[k](v)) cfg[k] = v;
    else console.warn(`JAPT config: invalid value for ${k}, default used`, v);
  }
  // The data layer follows from where the app runs, never from a setting someone might forget
  // (deployment.js explains the three cases).
  const deployment = typeof JAPT_DEPLOYMENT !== 'undefined'
    ? JAPT_DEPLOYMENT
    : { productionHosts: [], backend: 'local' };
  const here = typeof location !== 'undefined' ? location : { hostname: '', search: '' };
  const OWN_MACHINE = [/^$/, /^localhost$/, /^127\./, /^\[::1\]$/, /\.local$/, /^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];
  const isOwnMachine = OWN_MACHINE.some(re => re.test(here.hostname));
  const wantsLive = /[?&]db=live(&|$)/.test(here.search);
  if (deployment.productionHosts.includes(here.hostname)) cfg.backend = deployment.backend;
  else if (isOwnMachine) cfg.backend = wantsLive ? deployment.backend : 'local';
  else cfg.backend = 'unknown address';
  return Object.freeze(cfg);
})();

if (typeof module !== 'undefined') module.exports = JAPT_CONFIG;
