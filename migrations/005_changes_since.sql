-- JAPT migration 005: reloading only what changed.
-- After the first load the app asks what changed since its previous load, instead of loading everything
-- again (docs/design.md, Working at the same time). A changed row shows by its changed_at. A removed row
-- leaves nothing behind, so every removal is noted in removed_rows.
-- Run once in the SQL Editor, after 004.

begin;

-- One note per removed row, kept 30 days (purge_bin clears older ones; an app that hasn't asked for that
-- long loads everything). No reference to teams: when a team is deleted its rows are removed while these
-- notes are written, and a note of a team that is gone harms nothing.
create table removed_rows (
  team_id text not null,
  table_name text not null,
  id text not null,
  removed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, table_name, id)
);
create index removed_rows_at on removed_rows (team_id, removed_at);

-- Read by the team, written only by the trigger below.
alter table removed_rows enable row level security;
create policy "team only" on removed_rows for select to authenticated using (team_id in (select my_team_ids()));

-- Writes the note. Runs with the rights of its owner, because nobody may write removed_rows directly;
-- it only ever notes a row the user was allowed to remove.
create or replace function note_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.removed_rows (team_id, table_name, id) values (old.team_id, tg_table_name, old.id)
  on conflict (team_id, table_name, id) do update set removed_at = clock_timestamp();
  return old;
end;
$$;

-- Every table that holds team data (tables.js, TABLES): the trigger, and an index for "changed since".
do $$
declare
  t text;
begin
  foreach t in array array['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks',
                           'block_placements', 'period_segments', 'period_placements', 'calendars', 'app_settings'] loop
    execute format('create trigger note_removed after delete on public.%I
                    for each row execute function note_removed()', t);
    execute format('create index %I on public.%I (team_id, changed_at)', t || '_changed', t);
  end loop;
end;
$$;

-- What changed in a team since p_since, in one answer:
--   { until, rows: { table: [rows changed since] }, removed: [{ table, id }] }
-- The app sends the until of its previous answer back as p_since next time. Rows are read 2 minutes
-- further back than asked: a save that was still busy when the previous answer was made is caught this way.
-- Binned rows come along (with deleted_at), so the app can take them away. With a task that changed, all its
-- rows of task_members, block_placements and period_placements come along too: a task back from the Bin
-- brings its places in the calendar, which themselves didn't change.
-- p_since null: everything, the first load. Further back than removed_rows is kept: null, load everything.
create or replace function changes_since(p_team text, p_since timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  overlap constant interval := interval '2 minutes';
  kept constant interval := interval '30 days';
  since timestamptz := coalesce(p_since - overlap, '-infinity');
  t text;
  part jsonb;
  rows jsonb := '{}';
begin
  if p_team not in (select public.my_team_ids()) then
    raise exception 'Not a member of this team' using errcode = '42501';
  end if;
  if p_since is not null and p_since < now() - kept + overlap then
    return null;
  end if;
  foreach t in array array['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks',
                           'block_placements', 'period_segments', 'period_placements', 'calendars', 'app_settings'] loop
    if t in ('task_members', 'block_placements', 'period_placements') then
      execute format('select coalesce(jsonb_agg(to_jsonb(r.*) order by r.id), ''[]'') from public.%I r
                      where r.team_id = $1 and (r.changed_at > $2 or r.task_id in
                        (select k.id from public.tasks k where k.team_id = $1 and k.changed_at > $2))', t)
        into part using p_team, since;
    else
      execute format('select coalesce(jsonb_agg(to_jsonb(r.*) order by r.id), ''[]'') from public.%I r
                      where r.team_id = $1 and r.changed_at > $2', t)
        into part using p_team, since;
    end if;
    rows := rows || jsonb_build_object(t, part);
  end loop;
  return jsonb_build_object(
    'until', now(),
    'rows', rows,
    'removed', (select coalesce(jsonb_agg(jsonb_build_object('table', d.table_name, 'id', d.id)), '[]')
                from public.removed_rows d where d.team_id = p_team and d.removed_at > since)
  );
end;
$$;

-- Emptying the Bin also clears the notes the app no longer needs.
create or replace function purge_bin(p_team text, p_before timestamptz)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_team not in (select my_team_ids()) then
    raise exception 'Not a member of this team' using errcode = '42501';
  end if;
  update tasks t set goal_id = null, stage = 'inbox'
  where t.team_id = p_team and t.deleted_at is null and t.done_on is null
    and t.goal_id in (select g.id from goals g where g.team_id = p_team and g.deleted_at is not null);
  delete from tasks where team_id = p_team and deleted_at < p_before;
  delete from goals where team_id = p_team and deleted_at < p_before;
  delete from clients where team_id = p_team and deleted_at < p_before;
  perform clear_removed_notes(p_team);
end;
$$;

-- Notes older than 30 days. Runs with the rights of its owner, because nobody may delete from removed_rows
-- directly; it only ever clears old notes of your own team.
create or replace function clear_removed_notes(p_team text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.removed_rows
  where team_id = p_team and team_id in (select public.my_team_ids()) and removed_at < now() - interval '30 days';
$$;

revoke execute on function note_removed(), clear_removed_notes(text), changes_since(text, timestamptz)
  from public, anon;
grant execute on function clear_removed_notes(text), changes_since(text, timestamptz) to authenticated;

insert into schema_migrations (version, name) values (5, 'changes_since');

commit;
