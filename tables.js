/**
 * JAPT Tables - the names of the database tables, for the Store and every data layer.
 *
 * TABLES         everything the app loads and saves
 * BINNED_TABLES  the tables with a Bin (deleted_at): a binned row stays out of what is loaded
 * TASK_TABLES    rows that belong to one task: they are not loaded for a binned task, and go with it
 * Adding a table: add it here and in a new file in migrations/.
 * The photos themselves (photo_data) are no table here: they are never loaded with the rest, only one at a
 * time when a task is opened (DataService.loadPhoto). A batch adds one with {op: 'insert', table: 'photo_data'}.
 */

const TABLES = ['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks', 'block_placements',
  'period_segments', 'period_placements', 'calendars', 'app_settings', 'task_photos'];
const BINNED_TABLES = ['clients', 'goals', 'tasks'];
const TASK_TABLES = ['task_members', 'block_placements', 'period_placements', 'task_photos'];

if (typeof module !== 'undefined') module.exports = { TABLES, BINNED_TABLES, TASK_TABLES };
