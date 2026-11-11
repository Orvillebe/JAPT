/**
 * JAPT Data - Supabase implementation.
 *
 * Responsibilities:
 *   - Login and logout (Supabase Auth; users are invited, registration is off)
 *   - The same functions as data-local.js (the contract is in data-service.js)
 *   - The team: everything is read and written for the team you are a member of
 *   - Translating between database columns and app fields
 *   - Hiding binned rows in one place: loadAll never returns them
 *   - Reloading only what changed since the previous load (changes_since in migrations/005)
 *   - Photos: sent as base64 inside the save of their task, read back one at a time as bytes (migrations/006, 007)
 *
 * Everything that knows about Supabase is in this file and in migrations/. What you may reach is decided
 * in the database (Row Level Security), not here.
 */

function createSupabaseData() {
  // supabase-js has no time limit of its own. Stopping with abort() and not AbortSignal.timeout: the library
  // tries a read again after a TimeoutError, which would make the wait four times as long. The timer keeps
  // running after the first bytes, so an answer that stalls halfway is stopped too.
  function fetchWithLimit(url, init) {
    const limit = new AbortController();
    setTimeout(() => limit.abort(), JAPT_CONFIG.requestSeconds * 1000);
    return fetch(url, { ...init, signal: limit.signal });
  }
  const sb = window.supabase.createClient(JAPT_DEPLOYMENT.supabaseUrl, JAPT_DEPLOYMENT.supabaseKey, {
    global: { fetch: fetchWithLimit }
  });
  let teamId = null;   // set by hasAccess, which the app calls before anything is loaded
  let loadedUntil = null;   // the database's time of the last load: the next reload asks what changed since

  /* ---------- columns and fields ---------- */

  // Words SQL reserves, or that would read badly as a column; everything else is snake_case <-> camelCase.
  const COLUMN_OF = { start: 'start_min', end: 'end_min', from: 'from_date', date: 'on_date' };
  const FIELD_OF = Object.fromEntries(Object.entries(COLUMN_OF).map(([field, column]) => [column, field]));
  const toColumn = k => COLUMN_OF[k] || k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  const toField = k => FIELD_OF[k] || k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  // Filled in by the database, never by the app.
  const META = new Set(['createdAt', 'createdBy', 'changedAt', 'changedBy', 'teamId']);

  const fromDb = r => (r ? Object.fromEntries(
    Object.entries(r).filter(([k]) => k !== 'team_id').map(([k, v]) => [toField(k), v])
  ) : null);
  const toDb = r => (r ? Object.fromEntries(
    Object.entries(r).filter(([k, v]) => !META.has(k) && v !== undefined).map(([k, v]) => [toColumn(k), v])
  ) : undefined);

  // The database gives a code with everything it refuses. Without one the request got no verdict: the
  // connection fell away or the time ran out, and the change may or may not have been stored.
  function check(error) {
    if (!error) return;
    if (!error.code) throw Object.assign(new Error(error.message), { code: 'no-answer' });
    throw error;
  }

  /* ---------- reading ---------- */

  // Supabase returns at most 1000 rows per request, so larger tables come in pages. The order must be
  // unique, or a row could fall between two pages.
  const PAGE = 1000;
  async function all(table, build = q => q) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const query = build(sb.from(table).select('*').eq('team_id', teamId));
      const { data, error } = await query.order('id').range(from, from + PAGE - 1);
      check(error);
      rows.push(...data);
      if (data.length < PAGE) return rows.map(fromDb);
    }
  }
  const isBinned = (table, row) => BINNED_TABLES.includes(table) && !!row.deletedAt;
  // What changed in the team since a moment, in one request; since null is everything. Null back: that
  // moment is too long ago to tell, load everything.
  async function changesSince(since) {
    const { data, error } = await sb.rpc('changes_since', { p_team: teamId, p_since: since });
    check(error);
    if (data) loadedUntil = data.until;
    return data;
  }
  const inBin = q => q.not('deleted_at', 'is', null);

  /* ---------- login ---------- */

  async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session ? { userId: session.user.id, email: session.user.email } : null;
  }

  // Saving: a change someone else got to first comes back as JP001 (migrations/001_initial.sql).
  const CONFLICT = 'JP001';
  const toBatchOp = o => ({
    op: o.op, table: o.table, id: o.id, row: toDb(o.row), fields: toDb(o.fields),
    if_changed_at: o.ifChangedAt, if_new: o.ifNew
  });

  return {
    needsLogin: true,
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      check(error);
    },
    async signOut() {
      const { error } = await sb.auth.signOut();
      check(error);
    },
    getSession,

    // On the access list of a team? Your own row is always readable. With several teams, the first; choosing
    // between teams is for later (docs/design.md, Teams).
    async hasAccess() {
      const session = await getSession();
      if (!session) return false;
      const { data, error } = await sb.from('members').select('team_id')
        .eq('user_id', session.userId).eq('allowed', true).is('removed_at', null).order('team_id').limit(1);
      check(error);
      teamId = data.length ? data[0].team_id : null;
      return teamId !== null;
    },

    // The highest migration that has run. 0 only when the version table doesn't exist yet (a new, empty
    // database). Anything else, such as no connection, is thrown: it says nothing about the version.
    async schemaVersion() {
      const { data, error } = await sb.from('schema_migrations').select('version')
        .order('version', { ascending: false }).limit(1);
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) return 0;
      check(error);
      return data.length ? data[0].version : 0;
    },

    async loadAll() {
      const { rows } = await changesSince(null);
      const out = Object.fromEntries(TABLES.map(t => [t, (rows[t] || []).map(fromDb).filter(r => !isBinned(t, r))]));
      const live = new Set(out.tasks.map(k => k.id));
      for (const t of TASK_TABLES) out[t] = out[t].filter(r => live.has(r.taskId));
      return out;
    },

    // Rows changed since the previous load, and the rows that are gone (removed or binned).
    async loadChanges() {
      if (!loadedUntil) return null;
      const answer = await changesSince(loadedUntil);
      if (!answer) { loadedUntil = null; return null; }
      const rows = {}, removed = answer.removed.slice();
      for (const t of TABLES) {
        for (const row of (answer.rows[t] || []).map(fromDb)) {
          if (isBinned(t, row)) removed.push({ table: t, id: row.id });
          else (rows[t] = rows[t] || []).push(row);
        }
      }
      return { rows, removed };
    },

    async loadBin() {
      const rows = await Promise.all(BINNED_TABLES.map(t => all(t, inBin)));
      return Object.fromEntries(BINNED_TABLES.map((t, i) => [t, rows[i]]));
    },

    async batch(ops) {
      const { data, error } = await sb.rpc('apply_batch', { p_team: teamId, p_ops: ops.map(toBatchOp) });
      if (error && error.code === CONFLICT) {
        const conflict = new Error(error.message);
        conflict.code = 'conflict';
        throw conflict;
      }
      check(error);
      return data.map(fromDb);
    },

    async purgeBin(beforeIso) {
      const { error } = await sb.rpc('purge_bin', { p_team: teamId, p_before: beforeIso });
      check(error);
    },

    // One photo as a JPEG, or null when it is gone. Asked as bytes through task_photo (migrations/007), not
    // through the library: as JSON a photo would come as text, a third or twice as large.
    async loadPhoto(id) {
      const { data: { session } } = await sb.auth.getSession();
      const url = `${JAPT_DEPLOYMENT.supabaseUrl}/rest/v1/rpc/task_photo`
        + `?p_team=${encodeURIComponent(teamId)}&p_id=${encodeURIComponent(id)}`;
      let answer;
      try {
        answer = await fetchWithLimit(url, { headers: {
          apikey: JAPT_DEPLOYMENT.supabaseKey,
          Authorization: `Bearer ${session ? session.access_token : JAPT_DEPLOYMENT.supabaseKey}`,
          Accept: 'image/jpeg'
        } });
      } catch (e) {
        throw Object.assign(new Error(e.message), { code: 'no-answer' });
      }
      if (!answer.ok) throw Object.assign(new Error(`Photo ${id}: ${answer.status}`), { code: String(answer.status) });
      const blob = await answer.blob();
      return blob.size ? new Blob([blob], { type: 'image/jpeg' }) : null;
    },

    // Everything for the backup; the photos as {id, data} with base64, a page at a time.
    async exportAll() {
      const rows = await Promise.all(TABLES.map(t => all(t)));
      const out = Object.fromEntries(TABLES.map((t, i) => [t, rows[i]]));
      out.photo_data = [];
      for (let after = null; ;) {
        const { data, error } = await sb.rpc('photos_for_backup', { p_team: teamId, p_after: after, p_count: 20 });
        check(error);
        out.photo_data.push(...data);
        if (data.length < 20) return out;
        after = data[data.length - 1].id;
      }
    },

    // Only the local version has meetings without an agenda link.
    async testMeetings() { return []; }
  };
}
