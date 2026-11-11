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
 *   - Photos (photo_data) under a key of their own, so the rest isn't read and written with them every time.
 *     localStorage holds about 5 MB: some 30 photos. Enough for testing; a save that doesn't fit is refused.
 *
 * Used everywhere except on the live address (productionHosts in deployment.js), so local testing never
 * touches the real database. There is no login: everything is saved as one local member.
 * tests/load-testdata.html fills this storage with a test data set.
 */

function createLocalData() {
  const KEY = 'japt_local_v1';
  const PHOTOS_KEY = 'japt_local_photos_v1';   // {id: JPEG as base64}
  const ME = 'local-user';
  const LOCAL_TABLES = [...TABLES, 'test_meetings'];   // meetings from the test data, only here
  const now = () => new Date().toISOString();
  const copy = o => JSON.parse(JSON.stringify(o));

  // The same steps as the files in migrations/, for data in this browser. Step n brings data from
  // version n - 1 to version n. Never change a step that has shipped; add a new one.
  const LOCAL_MIGRATIONS = {
    1: db => { LOCAL_TABLES.forEach(t => { db[t] = db[t] || []; }); },
    2: () => {},   // migration 002 only adds a check to the real database
    3: () => {},   // migration 003 adds an optional field
    4: () => {},   // migration 004 only hardens the real database
    5: () => {},   // migration 005 only notes removals in the real database
    6: db => { db.task_photos = db.task_photos || []; },
    7: () => {}    // migration 007 only adds how the real database answers with a photo
  };

  function upgrade(db) {
    let v = db.schemaVersion || 0;
    while (v < SCHEMA_VERSION && LOCAL_MIGRATIONS[v + 1]) { LOCAL_MIGRATIONS[v + 1](db); v++; }
    db.schemaVersion = v;
    return db;
  }

  // An empty start: one local member, so there is someone to put on tasks.
  function seed() {
    const db = Object.fromEntries(LOCAL_TABLES.map(t => [t, []]));
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
        LOCAL_TABLES.forEach(t => { db[t] = db[t] || []; });
        if (db.schemaVersion !== before) write(db);
        return db;
      }
    } catch (e) { console.error('Local data unreadable, starting empty', e); }
    const db = seed(); write(db); return db;
  }
  function write(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function readPhotos() {
    try { return JSON.parse(localStorage.getItem(PHOTOS_KEY)) || {}; } catch (e) { return {}; }
  }
  const writePhotos = photos => localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos));
  // Both or neither: when the data doesn't fit after the photos were written, the photos go back.
  function writeBoth(db, photos, photosBefore) {
    writePhotos(photos);
    try { write(db); } catch (e) { writePhotos(photosBefore); throw e; }
  }

  class Conflict extends Error {
    constructor(table, id) { super(`Changed meanwhile: ${table} ${id}`); this.code = 'conflict'; }
  }

  // Apply one change to db. Throws on a missing row or a conflict, so the whole batch is refused.
  // A photo only arrives (photo_data) and leaves with its task_photos row.
  function applyOp(db, photos, o, at) {
    if (o.table === 'photo_data') {
      if (o.op !== 'insert') throw new Error('A photo is only added');
      if (!(o.ifNew && photos[o.row.id])) photos[o.row.id] = o.row.data;
      return { id: o.row.id };
    }
    if (o.table === 'task_photos' && o.op === 'remove') delete photos[o.id];
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
      if (i < 0) {
        const full = { createdAt: at, createdBy: ME, changedAt: at, changedBy: ME, id: o.id, ...o.fields };
        rows.push(full); return full;
      }
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
      for (const t of LOCAL_TABLES) out[t] = BINNED_TABLES.includes(t) ? db[t].filter(r => !r.deletedAt) : db[t];
      const live = new Set(out.tasks.map(k => k.id));
      for (const t of TASK_TABLES) out[t] = out[t].filter(r => live.has(r.taskId));
      return copy(out);
    },

    // This browser has no colleagues to wait for: reloading everything is as quick.
    async loadChanges() { return null; },

    async loadBin() {
      const db = read();
      return copy(Object.fromEntries(BINNED_TABLES.map(t => [t, db[t].filter(r => r.deletedAt)])));
    },

    // Several changes at once, all or nothing:
    //   {op:'insert', table, row, ifNew?}  {op:'update', table, id, fields, ifChangedAt?}
    //   {op:'upsert', table, id, fields}   {op:'remove', table, id, ifChangedAt?}
    // Returns the stored rows (null for removals), in the same order.
    async batch(ops) {
      const db = read(), at = now(), before = readPhotos(), photos = { ...before };
      const out = ops.map(o => applyOp(db, photos, o, at));
      writeBoth(db, photos, before);
      return copy(out);
    },

    // One photo as a JPEG, or null when it is gone.
    async loadPhoto(id) {
      const data = readPhotos()[id];
      if (!data) return null;
      const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
      return new Blob([bytes], { type: 'image/jpeg' });
    },

    // Remove for good what has been in the Bin longer than the bin period.
    async purgeBin(beforeIso) {
      const db = read(), old = r => r.deletedAt && r.deletedAt < beforeIso;
      // A task alive under a deleted goal goes to the Inbox (the same as purge_bin in migrations/004).
      const binnedGoals = new Set(db.goals.filter(g => g.deletedAt).map(g => g.id));
      db.tasks.filter(k => !k.deletedAt && !k.doneOn && binnedGoals.has(k.goalId))
        .forEach(k => { k.goalId = null; k.stage = 'inbox'; });
      const gone = new Set(db.tasks.filter(old).map(k => k.id));
      for (const t of BINNED_TABLES) db[t] = db[t].filter(r => !old(r));
      for (const t of TASK_TABLES) db[t] = db[t].filter(r => !gone.has(r.taskId));
      const before = readPhotos(), photos = { ...before };
      Object.keys(photos).filter(id => !db.task_photos.some(p => p.id === id)).forEach(id => delete photos[id]);
      writeBoth(db, photos, before);
    },

    async schemaVersion() { return read().schemaVersion; },
    // The access list only exists in the real database; locally there are no logins.
    async hasAccess() { return true; },
    // Meetings for testing without an agenda link (tests/testdata.js).
    async testMeetings() { return copy(read().test_meetings); },

    // Everything, exactly as stored, for the backup export; the photos as {id, data} with base64.
    async exportAll() {
      const db = copy(read()); delete db.schemaVersion; delete db.test_meetings;
      db.photo_data = Object.entries(readPhotos()).map(([id, data]) => ({ id, data }));
      return db;
    },

    // Testing only: replace the local data with a data set or a backup, then upgrade it.
    importBackup(backup) {
      const db = this.upgradeBackup(backup);
      writeBoth(db, Object.fromEntries((backup.data.photo_data || []).map(p => [p.id, p.data])), readPhotos());
      return db;
    },
    upgradeBackup(backup) {
      const db = { ...copy(backup.data), schemaVersion: backup.schemaVersion || 0 };
      delete db.schema_migrations;
      delete db.photo_data;
      upgrade(db);
      LOCAL_TABLES.forEach(t => { db[t] = db[t] || []; });
      return db;
    },
    clear() { localStorage.removeItem(KEY); localStorage.removeItem(PHOTOS_KEY); }
  };
}

if (typeof module !== 'undefined') module.exports = createLocalData;
