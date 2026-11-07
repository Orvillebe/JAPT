/**
 * JAPT Config - settings that change rarely and only on purpose.
 *
 * This is the single place for these defaults. Invalid values fall back to the default and are
 * logged in the console. Settings the team changes in Beheer (first day of the week, deadline
 * reminder, work period) are data; the values here are only their starting values.
 */

const JAPT_CONFIG = (() => {
  const DEFAULTS = {
    // The addresses where the live app runs. Only there does the app use the real database
    // (Supabase). Everywhere else (localhost, the local network, a file) it uses local test data
    // in the browser, so testing can never touch the real database by accident.
    productionHosts: [],

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

    // The shortest time between two reloads of the team's changes (seconds), so moving through
    // weeks quickly doesn't reload on every click. docs/design.md, Working at the same time.
    reloadSeconds: 20
  };

  // Change values here. Leave a key out to use the default.
  const SETTINGS = { productionHosts: ['orvillebe.github.io'] };

  const int = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi;
  const CHECKS = {
    productionHosts: v => Array.isArray(v) && v.every(h => typeof h === 'string'),
    weekStart: int(0, 6),
    deadlineDays: int(0, 90),
    binDays: int(1, 365),
    figureChance: v => typeof v === 'number' && v >= 0 && v <= 1,
    dayStart: int(0, 23),
    dayEnd: int(1, 24),
    agendaMinutes: int(1, 1440),
    reloadSeconds: int(0, 3600)
  };

  const cfg = { ...DEFAULTS };
  for (const [k, v] of Object.entries(SETTINGS)) {
    if (CHECKS[k] && CHECKS[k](v)) cfg[k] = v;
    else console.warn(`JAPT config: invalid value for ${k}, default used`, v);
  }
  // The data layer follows from where the app runs, never from a setting someone might forget.
  const host = typeof location !== 'undefined' ? location.hostname : '';
  cfg.backend = cfg.productionHosts.includes(host) ? 'supabase' : 'local';
  return Object.freeze(cfg);
})();

if (typeof module !== 'undefined') module.exports = JAPT_CONFIG;
