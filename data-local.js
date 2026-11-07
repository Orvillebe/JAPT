/**
 * JAPT Data - local storage implementation.
 *
 * Responsibilities:
 *   - The same functions as data-supabase.js, stored in this browser only (localStorage)
 *   - Saving a group of changes in one go (batch), all or nothing
 *   - The changed_at check: an update that expects an older version of a row is refused,
 *     so a save never silently overwrites what someone else (another tab) changed meanwhile
 *   - Hiding binned records in one place: loadAll() never returns them
 *   - Upgrading stored data to the current version, the local mirror of migrations/ (LOCAL_MIGRATIONS)
 *   - Importing a backup file, for testing a new version on a copy of real data
 *
 * Used everywhere except on the live address (productionHosts in config.js), so local testing never
 * touches the real database. There is no login: everything is saved as one local member.
 * tests/load-testdata.html fills this storage with a test data set.
 */

function createLocalData() {
  const KEY = 'japt_local_v1';
  const ME = 'local-user';
  // Tables with a Bin (deletedAt): tasks, goals, clients. The others are deleted for good.
  const TABLES = ['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks', 'block_placements',
    'period_segments', 'period_placements', 'calendars', 'app_settings', 'test_meetings'];
  const BINNED = ['clients', 'goals', 'tasks'];
  const now = () => new Date().toISOString();
  const copy = o => JSON.parse(JSON.stringify(o));

  // The same steps as the files in migrations/, for data in this browser. Step n brings data from
  // version n - 1 to version n. Never change a step that has shipped; add a new one.
  const LOCAL_MIGRATIONS = {
    1: db => { TABLES.forEach(t => { db[t] = db[t] || []; }); }
  };

  function upgrade(db) {
    let v = db.schemaVersion || 0;
    while (v < SCHEMA_VERSION && LOCAL_MIGRATIONS[v + 1]) { LOCAL_MIGRATIONS[v + 1](db); v++; }
    db.schemaVersion = v;
    return db;
  }

  // An empty start: one local member, so there is someone to put on tasks.
  function seed() {
    const db = Object.fromEntries(TABLES.map(t => [t, []]));
    db.schemaVersion = SCHEMA_VERSION;
    db.members.push({ id: ME, name: 'Lokaal', color: '#cf6a52', allowed: true, removedAt: null, createdAt: now() });
    return db;
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const db = JSON.parse(raw), before = db.schemaVersion || 0;
        upgrade(db);
        TABLES.forEach(t => { db[t] = db[t] || []; });
        if (db.schemaVersion !== before) write(db);
        return db;
      }
    } catch (e) { console.error('Local data unreadable, starting empty', e); }
    const db = seed(); write(db); return db;
  }
  function write(db) { localStorage.setItem(KEY, JSON.stringify(db)); }

  class Conflict extends Error { constructor(table, id) { super(`Changed meanwhile: ${table} ${id}`); this.code = 'conflict'; } }

  // Apply one change to db. Throws on a missing row or a conflict, so the whole batch is refused.
  function applyOp(db, o, at) {
    const rows = db[o.table];
    if (!rows) throw new Error('Unknown table ' + o.table);
    if (o.op === 'insert') {
      if (rows.some(r => r.id === o.row.id)) {
        if (o.ifNew) return null;   // already there: sending a new row twice is harmless
        throw new Error(`Exists: ${o.table} ${o.row.id}`);
      }
      const full = { createdAt: at, createdBy: ME, changedAt: at, changedBy: ME, ...o.row };
      rows.push(full); return full;
    }
    const i = rows.findIndex(r => r.id === o.id);
    if (o.op === 'upsert') {
      if (i < 0) { const full = { createdAt: at, createdBy: ME, changedAt: at, changedBy: ME, id: o.id, ...o.fields }; rows.push(full); return full; }
      Object.assign(rows[i], o.fields, { changedAt: at, changedBy: ME }); return rows[i];
    }
    if (i < 0) { if (o.op === 'remove') return null; throw new Error(`Not found: ${o.table} ${o.id}`); }
    if (o.ifChangedAt !== undefined && rows[i].changedAt !== o.ifChangedAt) throw new Conflict(o.table, o.id);
    if (o.op === 'update') { Object.assign(rows[i], o.fields, { changedAt: at, changedBy: ME }); return rows[i]; }
    if (o.op === 'remove') { rows.splice(i, 1); return null; }
    throw new Error('Unknown op ' + o.op);
  }

  return {
    needsLogin: false,
    async signIn() {},
    async signOut() {},
    async getSession() { return { userId: ME, email: '' }; },

    // Everything the app works with. Binned records stay out; only the Bin asks for them.
    async loadAll() {
      const db = read(), out = {};
      for (const t of TABLES) out[t] = BINNED.includes(t) ? db[t].filter(r => !r.deletedAt) : db[t];
      const live = new Set(out.tasks.map(k => k.id));
      for (const t of ['task_members', 'block_placements', 'period_placements']) out[t] = out[t].filter(r => live.has(r.taskId));
      return copy(out);
    },

    async loadBin() {
      const db = read();
      return copy(Object.fromEntries(BINNED.map(t => [t, db[t].filter(r => r.deletedAt)])));
    },

    // Several changes at once, all or nothing:
    //   {op:'insert', table, row, ifNew?}  {op:'update', table, id, fields, ifChangedAt?}
    //   {op:'upsert', table, id, fields}   {op:'remove', table, id, ifChangedAt?}
    // Returns the stored rows (null for removals), in the same order.
    async batch(ops) {
      const db = read(), at = now();
      const out = ops.map(o => applyOp(db, o, at));
      write(db);
      return copy(out);
    },

    // Remove for good what has been in the Bin longer than the bin period.
    async purgeBin(beforeIso) {
      const db = read(), old = r => r.deletedAt && r.deletedAt < beforeIso;
      const gone = new Set(db.tasks.filter(old).map(k => k.id));
      for (const t of BINNED) db[t] = db[t].filter(r => !old(r));
      for (const t of ['task_members', 'block_placements', 'period_placements']) db[t] = db[t].filter(r => !gone.has(r.taskId));
      write(db);
    },

    async schemaVersion() { return read().schemaVersion; },
    // The access list only exists in the real database; locally there are no logins.
    async hasAccess() { return true; },
    // Meetings for testing without an agenda link (tests/testdata.js).
    async testMeetings() { return copy(read().test_meetings); },

    // Everything, exactly as stored, for the backup export.
    async exportAll() { const db = copy(read()); delete db.schemaVersion; delete db.test_meetings; return db; },

    // Testing only: replace the local data with a data set or a backup, then upgrade it.
    importBackup(backup) { const db = this.upgradeBackup(backup); write(db); return db; },
    upgradeBackup(backup) {
      const db = { ...copy(backup.data), schemaVersion: backup.schemaVersion || 0 };
      delete db.schema_migrations;
      upgrade(db);
      TABLES.forEach(t => { db[t] = db[t] || []; });
      return db;
    },
    clear() { localStorage.removeItem(KEY); }
  };
}

if (typeof module !== 'undefined') module.exports = createLocalData;
