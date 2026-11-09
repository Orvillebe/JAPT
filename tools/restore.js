/**
 * JAPT Restore - turns a backup file into an SQL script that puts it back into a team in the database.
 *
 * Responsibilities:
 *   - Check the backup (a JAPT backup, not from a newer database version than this code knows)
 *   - Bring older backups up to this version with the same steps as the local data (LOCAL_MIGRATIONS)
 *   - Write one SQL script, run in the Supabase SQL Editor as the database owner, that:
 *       stops unless the database is at this version (SCHEMA_VERSION),
 *       stops unless there is exactly one team with that name,
 *       stops if that team already holds planning, unless you chose to replace it,
 *       puts everything back as it was: ids, dates, who made it, what was in the Bin.
 *     All in one transaction: if anything fails, nothing changes. That is why replacing is part of this
 *     script and not a separate step: a team is never left empty by a restore that failed.
 *
 * People: a person from the backup is matched to someone already in the team, by login or else by name, and
 * takes over that login. In a new project logins have new ids, so without a match by name the person comes
 * back without a login; link them in Table Editor > members.
 *
 * Pure: no DOM and no network, so tests/restore.test.js can check it. tools/restore.html is the page.
 */

function buildRestoreSql(backup, upgradeBackup, schemaVersion, typedTeamName, { replace = false } = {}) {
  const teamName = String(typedTeamName || '').trim();   // a space or a capital typed differently is no other team
  if (!backup || backup.app !== 'JAPT' || !backup.data) throw new Error('Dit is geen back-upbestand van JAPT.');
  const from = backup.schemaVersion || 0;
  if (from > schemaVersion) {
    throw new Error(`De back-up komt van databaseversie ${from}; deze code kent tot versie ${schemaVersion}. Werk de code eerst bij.`);
  }
  if (!teamName) throw new Error('Vul de naam van het team in.');
  const db = upgradeBackup(backup);

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const text = v => `'${String(v).replace(/'/g, "''")}'`;

  // Fields whose column has another name (the same as in data-supabase.js); the rest is camelCase <-> snake_case.
  const FIELD_OF = { start_min: 'start', end_min: 'end', from_date: 'from', on_date: 'date' };
  const fieldOf = column => FIELD_OF[column] || column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

  // Columns per table, as in migrations/ up to this version. Kinds:
  //   T text, '' when missing     t text or null     n number or null     N number, 0 when missing
  //   d date    ts timestamp or null    b boolean    j json    u a login id, or null when it is no valid id
  const WHO_AND_WHEN = { created_by: 'u', created_at: 'TS', changed_by: 'u', changed_at: 'TS' };
  const BIN = { deleted_at: 'ts', delete_group: 't' };
  const TABLE_COLUMNS = {
    clients: { id: 'T', name: 'T', ...BIN },
    goals: { id: 'T', name: 'T', note: 'T', client_id: 't', hue: 'n', achieved_on: 'd', ...BIN },
    tasks: {
      id: 'T', title: 'T', note: 'T', goal_id: 't', stage: 'T', done_on: 'd', deadline: 'd', repeat: 't',
      next_task_id: 't', position: 'N', ...BIN
    },
    task_members: { id: 'T', task_id: 'T', member_id: 'T' },
    work_blocks: { id: 'T', day: 'N', start_min: 'N', end_min: 'N', label: 'T', valid_from: 'd', valid_to: 'd', owner: 't' },
    block_placements: { id: 'T', task_id: 'T', block_id: 'T', on_date: 'd', position: 'N', part_start: 'n' },
    period_segments: { id: 'T', from_date: 'd', length: 'N', unit: 'T' },
    period_placements: { id: 'T', task_id: 'T', period_start: 'd', position: 'N' },
    calendars: { id: 'T', name: 'T', url: 'T', owner: 't' },
    app_settings: { id: 'T', value: 'j' }
  };
  const PLANNING_TABLES = ['clients', 'goals', 'tasks', 'work_blocks', 'period_segments', 'calendars'];

  function value(kind, v) {
    const missing = v === null || v === undefined || v === '';
    switch (kind) {
      case 'T': return text(v ?? '');
      case 't': return missing ? 'null' : text(v);
      case 'n': return missing || isNaN(Number(v)) ? 'null' : String(Number(v));
      case 'N': return missing || isNaN(Number(v)) ? '0' : String(Number(v));
      case 'd': return missing ? 'null' : `${text(v)}::date`;
      case 'ts': return missing ? 'null' : `${text(v)}::timestamptz`;
      case 'TS': return missing ? 'now()' : `${text(v)}::timestamptz`;
      case 'b': return v ? 'true' : 'false';
      case 'u': return typeof v === 'string' && UUID.test(v) ? `${text(v)}::uuid` : 'null';
      case 'j': return `${text(JSON.stringify(v ?? null))}::jsonb`;
    }
    throw new Error('Unknown column kind ' + kind);
  }

  const tuple = (columns, row) => {
    const cells = Object.keys(columns).map(c => value(columns[c], row[fieldOf(c)]));
    return `  (${cells.join(', ')})`;
  };
  const columnList = columns => Object.keys(columns).map(c => `"${c}"`).join(', ');

  function inserts(table) {
    const rows = db[table] || [];
    if (!rows.length) return `-- ${table}: nothing in the backup`;
    const columns = { ...TABLE_COLUMNS[table], ...WHO_AND_WHEN };
    const TEAM = '(select id from restore_team)';
    // Directly into the table, so a column with only empty values still gets the column's own type.
    return [
      `insert into public.${table} (team_id, ${columnList(columns)}) values`,
      rows.map(r => tuple(columns, r).replace('(', `(${TEAM}, `)).join(',\n') + ';'
    ].join('\n');
  }

  // People first into a side table, so someone already in the team can be matched and take over their login.
  const MEMBER_COLUMNS = {
    id: 'T', user_id: 'u', name: 'T', color: 'T', allowed: 'b', removed_at: 'ts', ...WHO_AND_WHEN
  };
  const members = db.members || [];
  const memberRows = members.map(m => tuple(MEMBER_COLUMNS, m)).join(',\n');
  const matchMembers = !members.length ? ['-- members: nothing in the backup'] : [
    `create temp table restore_members (id text, user_id uuid, name text, color text, allowed boolean, removed_at timestamptz,
  created_by uuid, created_at timestamptz, changed_by uuid, changed_at timestamptz) on commit drop;`,
    `insert into restore_members (${columnList(MEMBER_COLUMNS)}) values`,
    `${memberRows};`,
    '',
    '-- A login from the backup only counts when it exists here; otherwise a match by name brings the login.',
    `update restore_members b set user_id = (select u.id from auth.users u where u.id = b.user_id);`,
    `update restore_members b set user_id = (
  select m.user_id from public.members m
  where m.team_id = (select id from restore_team) and lower(btrim(m.name)) = lower(btrim(b.name)) limit 1
) where b.user_id is null;`,
    `delete from public.members m where m.team_id = (select id from restore_team) and exists (
  select 1 from restore_members b where b.user_id = m.user_id or lower(btrim(b.name)) = lower(btrim(m.name))
);`,
    `insert into public.members (team_id, ${columnList(MEMBER_COLUMNS)})`,
    `select (select id from restore_team), ${columnList(MEMBER_COLUMNS)} from restore_members;`
  ];

  const countOf = t => (db[t] || []).length;
  const TABLES_SHOWN = ['members', ...Object.keys(TABLE_COLUMNS)];
  const contents = TABLES_SHOWN.map(t => `${countOf(t)} ${t}`).join(', ');
  const isEmptyCheck = PLANNING_TABLES
    .map(t => `exists (select 1 from public.${t} where team_id = (select id from restore_team))`).join('\n     or ');
  const checks = TABLES_SHOWN
    .map(t => `select '${t}' as tabel, count(*) from public.${t} where team_id = (select id from public.teams where lower(name) = lower(${text(teamName)}))`)
    .join('\nunion all ');

  return [
    `-- JAPT restore of the backup from ${backup.exportedAt || 'an unknown date'}, into team ${teamName.replace(/\n/g, ' ')}`,
    `-- Backup database version ${from}, restored as version ${schemaVersion}.`,
    `-- Contents: ${contents}.`,
    ...(replace ? [`-- REPLACES all planning now in this team by this backup. Everything made after the backup is gone.`] : []),
    `-- Run in the Supabase SQL Editor. One transaction: if anything fails, nothing changes.`,
    '',
    'begin;',
    '',
    `create temp table restore_team on commit drop as select id from public.teams where lower(name) = lower(${text(teamName)});`,
    '',
    '-- Stop unless the database is at this version and the team exists once and holds no planning yet.',
    'do $$',
    'begin',
    `  if (select coalesce(max(version), 0) from public.schema_migrations) <> ${schemaVersion} then`,
    `    raise exception 'The database is not at version ${schemaVersion}. Run the migrations first, then this script.';`,
    '  end if;',
    `  if (select count(*) from restore_team) <> 1 then`,
    `    raise exception 'No team named "%", or more than one. Make the team first (tools/first-team.sql).', ${text(teamName)};`,
    '  end if;',
    ...(replace ? [] : [
      `  if ${isEmptyCheck} then`,
      `    raise exception 'This team already holds planning. A restore only goes into an empty team, so nothing gets mixed.';`,
      '  end if;'
    ]),
    'end $$;',
    '',
    ...(replace ? [
      '-- What is in the team now goes first; what hangs under it goes along. In this same transaction.',
      ...['tasks', 'goals', 'clients', 'work_blocks', 'period_segments', 'calendars']
        .map(t => `delete from public.${t} where team_id = (select id from restore_team);`),
      ''
    ] : []),
    ...matchMembers,
    '',
    '-- Settings: replaced by those from the backup.',
    'delete from public.app_settings where team_id = (select id from restore_team);',
    inserts('app_settings'),
    '',
    ...Object.keys(TABLE_COLUMNS).filter(t => t !== 'app_settings').flatMap(t => [inserts(t), '']),
    'commit;',
    '',
    '-- Check: these counts should match the contents listed at the top (people may be more, not fewer).',
    `${checks};`,
    ''
  ].join('\n');
}

if (typeof module !== 'undefined') module.exports = buildRestoreSql;
