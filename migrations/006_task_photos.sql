-- JAPT migration 006: photos on a task.
-- A photo is two rows: task_photos says which task it belongs to and how large it is, and is loaded with
-- everything else; photo_data holds the JPEG itself and is only read when a task is opened, one photo at a
-- time (docs/design.md, Photos). The JPEG is stored as bytes. On the way in it travels as base64 inside the
-- same save as the task, so a task and its photos are saved together or not at all; on the way out it is
-- read as bytes (migration 007 adds how).
-- Run once in the SQL Editor, after 005.

begin;

create table task_photos (
  team_id text not null references teams(id) on delete cascade,
  id text not null,
  task_id text not null,
  width int not null check (width between 1 and 4000),
  height int not null check (height between 1 and 4000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  constraint task_photos_id_form check (id ~ '^[A-Za-z0-9_-]+$'),
  foreign key (team_id, task_id) references tasks(team_id, id) on delete cascade deferrable initially deferred
);
create index task_photos_task on task_photos (team_id, task_id);
create index task_photos_changed on task_photos (team_id, changed_at);

-- The JPEG. Goes when its task_photos row goes, and with it when its task is removed for good.
-- At most 1 MB: the app sends about 120 kB (config.js, photoMaxSide), this only stops what isn't a photo.
create table photo_data (
  team_id text not null,
  id text not null,
  data bytea not null check (octet_length(data) <= 1048576),
  primary key (team_id, id),
  foreign key (team_id, id) references task_photos(team_id, id) on delete cascade deferrable initially deferred
);

do $$
declare
  t text;
begin
  foreach t in array array['task_photos', 'photo_data'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "team only" on public.%I for all to authenticated
                    using (team_id in (select public.my_team_ids()))
                    with check (team_id in (select public.my_team_ids()))', t);
  end loop;
end;
$$;
-- Supabase gives new tables every right by default; here only what is needed. A photo is never changed,
-- only added and removed (removing its task_photos row removes it, with the rights of the table's owner).
revoke all on task_photos, photo_data from anon, authenticated;
grant select, insert, update, delete on task_photos to authenticated;
grant select, insert on photo_data to authenticated;

create trigger task_photos_created before insert on task_photos for each row execute function set_created();
create trigger task_photos_changed before update on task_photos for each row execute function set_changed();
create trigger note_removed after delete on task_photos for each row execute function note_removed();

-- The same as in 001, with two changes for photos: photo_data arrives as base64 text and is stored as bytes,
-- and what comes back never holds a photo (it would be sent back for nothing).
create or replace function apply_batch(p_team text, p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  o jsonb;
  tbl text;
  row_id text;
  fields jsonb;
  seen timestamptz;
  cols text;
  stored jsonb;
  results jsonb := '[]'::jsonb;
begin
  if p_team not in (select my_team_ids()) then
    raise exception 'Not a member of this team' using errcode = '42501';
  end if;

  for o in select * from jsonb_array_elements(p_ops) loop
    tbl := o->>'table';
    if tbl is null or not tbl = any (array['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks',
        'block_placements', 'period_segments', 'period_placements', 'calendars', 'app_settings',
        'task_photos', 'photo_data']) then
      raise exception 'Unknown table %', tbl;
    end if;
    row_id := o->>'id';
    seen := (o->>'if_changed_at')::timestamptz;
    fields := coalesce(o->'fields', o->'row') - 'team_id';
    if tbl = 'photo_data' and fields ? 'data' then
      fields := fields || jsonb_build_object('data', '\x' || encode(decode(fields->>'data', 'base64'), 'hex'));
    end if;
    stored := null;

    if o->>'op' = 'insert' or o->>'op' = 'upsert' then
      if o->>'op' = 'upsert' then
        fields := fields || jsonb_build_object('id', row_id);
        select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(fields - 'id') k;
        execute format('update public.%I as t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1))
                        where t.team_id = $2 and t.id = $3 returning to_jsonb(t.*) - ''data''', tbl, cols, cols, tbl)
          into stored using fields, p_team, row_id;
      end if;
      if stored is null then
        select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(fields) k;
        execute format('insert into public.%I as t (team_id, %s)
                        select $1, %s from jsonb_populate_record(null::public.%I, $2) %s returning to_jsonb(t.*) - ''data''',
                       tbl, cols, cols, tbl, case when (o->>'if_new')::boolean then 'on conflict do nothing' else '' end)
          into stored using p_team, fields;
      end if;

    elsif o->>'op' = 'update' then
      fields := fields - 'id';
      select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(fields) k;
      execute format('update public.%I as t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1))
                      where t.team_id = $2 and t.id = $3 and ($4::timestamptz is null or t.changed_at = $4)
                      returning to_jsonb(t.*) - ''data''', tbl, cols, cols, tbl)
        into stored using fields, p_team, row_id, seen;
      if stored is null then
        perform batch_row_gone(tbl, p_team, row_id, true);
      end if;

    elsif o->>'op' = 'remove' then
      execute format('delete from public.%I as t where t.team_id = $1 and t.id = $2
                      and ($3::timestamptz is null or t.changed_at = $3) returning to_jsonb(t.*) - ''data''', tbl)
        into stored using p_team, row_id, seen;
      if stored is null and seen is not null then
        perform batch_row_gone(tbl, p_team, row_id, false);
      end if;
      stored := null;

    else
      raise exception 'Unknown change %', o->>'op';
    end if;

    results := results || jsonb_build_array(stored);
  end loop;
  return results;
end;
$$;

-- The same as in 005, with task_photos among the tables and among the rows that come with a changed task.
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
                           'block_placements', 'period_segments', 'period_placements', 'calendars', 'app_settings',
                           'task_photos'] loop
    if t in ('task_members', 'block_placements', 'period_placements', 'task_photos') then
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

-- The photos of a team for the backup, as base64, a page at a time (a year of photos is far too much for one
-- answer): the photos after p_after in id order, at most p_count.
create or replace function photos_for_backup(p_team text, p_after text, p_count int)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'data', translate(encode(p.data, 'base64'), E'\n', '')) order by p.id), '[]')
  from (select id, data from public.photo_data
        where team_id = p_team and id > coalesce(p_after, '') order by id limit least(p_count, 100)) p;
$$;

revoke execute on function photos_for_backup(text, text, int) from public, anon;
grant execute on function photos_for_backup(text, text, int) to authenticated;

insert into schema_migrations (version, name) values (6, 'task_photos');

commit;
