/**
 * JAPT Tables - the names of the database tables, for the Store and every data layer.
 *
 * TABLES         everything the app loads and saves
 * BINNED_TABLES  the tables with a Bin (deleted_at): a binned row stays out of what is loaded
 * TASK_TABLES    rows that belong to one task: they are not loaded for a binned task, and go with it
 * Adding a table: add it here and in a new file in migrations/.
 */

const TABLES = ['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks', 'block_placements',
  'period_segments', 'period_placements', 'calendars', 'app_settings'];
const BINNED_TABLES = ['clients', 'goals', 'tasks'];
const TASK_TABLES = ['task_members', 'block_placements', 'period_placements'];

if (typeof module !== 'undefined') module.exports = { TABLES, BINNED_TABLES, TASK_TABLES };
