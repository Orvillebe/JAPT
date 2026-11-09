-- JAPT migration 001: the initial schema.
--
-- Migrations run once each, in number order, in the SQL Editor of Supabase. Never edit one that has run:
-- a later change is a new file (002_..., 003_...). Each file records itself in schema_migrations, and the
-- app compares that number at startup (version.js). Afterwards, for a new installation: tools/first-team.sql.
--
-- Design: docs/design.md, sections 4 and 5, Teams. In short:
--   * Every row belongs to a team; Row Level Security lets you reach only the rows of your own team.
--   * Keys are (team_id, id) and every reference includes team_id, so a row can't point into another team.
--   * Ids are made in the app (UUIDs as text), so a save and its undo never wait for the server.
--   * References are checked at the end of a save, because one save may add a row and point to it in any order.
--   * apply_batch saves a group of changes all or nothing.
--
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- =====================
-- Teams and people
-- =====================

create table teams (
  id text primary key default gen_random_uuid()::text,
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default clock_timestamp()
);

-- A person in a team. Someone in two teams has two rows: a name and colour per team.
-- user_id is the login; allowed is the access list.
create table members (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  color text not null default '#7a7f8c',
  allowed boolean not null default false,
  removed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  unique (team_id, user_id)
);
create unique index members_unique_name on members (team_id, lower(btrim(name))) where removed_at is null;

-- =====================
-- Clients, goals, tasks
-- =====================

create table clients (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null check (btrim(name) <> ''),
  deleted_at timestamptz,
  delete_group text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id)
);
create unique index clients_unique_name on clients (team_id, lower(btrim(name))) where deleted_at is null;

create table goals (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null check (btrim(name) <> ''),
  note text not null default '',
  client_id text,
  hue integer,
  achieved_on date,
  deleted_at timestamptz,
  delete_group text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  foreign key (team_id, client_id) references clients(team_id, id) on delete set null (client_id)
    deferrable initially deferred
);
create index goals_client on goals (team_id, client_id);

create table tasks (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  title text not null check (btrim(title) <> ''),
  note text not null default '',
  goal_id text,
  stage text not null check (stage in ('inbox', 'open', 'backlog')),
  done_on date,
  deadline date,
  repeat text,
  next_task_id text,
  position double precision not null default 0,
  deleted_at timestamptz,
  delete_group text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  -- Outside the Inbox a task has a goal. A task checked off from the Inbox has none, and one in the Bin
  -- may have outlived its goal.
  check (goal_id is not null or stage = 'inbox' or done_on is not null or deleted_at is not null),
  foreign key (team_id, goal_id) references goals(team_id, id) on delete set null (goal_id)
    deferrable initially deferred,
  foreign key (team_id, next_task_id) references tasks(team_id, id) on delete set null (next_task_id)
    deferrable initially deferred
);
create index tasks_goal on tasks (team_id, goal_id);

create table task_members (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  task_id text not null,
  member_id text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  unique (team_id, task_id, member_id),
  foreign key (team_id, task_id) references tasks(team_id, id) on delete cascade deferrable initially deferred,
  foreign key (team_id, member_id) references members(team_id, id) on delete cascade deferrable initially deferred
);

-- =====================
-- Planning
-- =====================

-- The standard week. A change makes a new row from today, so past weeks stay as they were.
create table work_blocks (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  day smallint not null check (day between 0 and 6),
  start_min integer not null check (start_min between 0 and 1440),
  end_min integer not null check (end_min between 0 and 1440 and end_min > start_min),
  label text not null default '',
  valid_from date,
  valid_to date,
  owner text,                                 -- empty = the team; for individual work blocks later
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  foreign key (team_id, owner) references members(team_id, id) on delete set null (owner) deferrable initially deferred
);

create table block_placements (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  task_id text not null,
  block_id text not null,
  on_date date not null,
  position double precision not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  foreign key (team_id, task_id) references tasks(team_id, id) on delete cascade deferrable initially deferred,
  foreign key (team_id, block_id) references work_blocks(team_id, id) on delete cascade deferrable initially deferred
);
create index block_placements_task on block_placements (team_id, task_id);
create index block_placements_block on block_placements (team_id, block_id);

create table period_segments (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  from_date date not null,
  length integer not null check (length > 0),
  unit text not null check (unit in ('d', 'm')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id)
);

create table period_placements (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  task_id text not null,
  period_start date not null,
  position double precision not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  foreign key (team_id, task_id) references tasks(team_id, id) on delete cascade deferrable initially deferred
);
create index period_placements_task on period_placements (team_id, task_id);

-- =====================
-- Settings
-- =====================

-- The link is a secret: readable only by the team.
create table calendars (
  team_id text not null references teams(id) on delete cascade,
  id text not null default gen_random_uuid()::text,
  name text not null default '',
  url text not null default '',
  owner text,                                 -- empty = the team; for one agenda per person later
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id),
  foreign key (team_id, owner) references members(team_id, id) on delete set null (owner) deferrable initially deferred
);

-- One row per team and setting; id is the name of the setting.
create table app_settings (
  team_id text not null references teams(id) on delete cascade,
  id text not null,
  value jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default clock_timestamp(),
  primary key (team_id, id)
);

create table schema_migrations (
  version integer primary key,
  name text not null,
  applied_at timestamptz not null default clock_timestamp()
);

-- =====================
-- Who and when
-- =====================

-- Every update records who and when, here and not in the app. A row can't move to another team.
create or replace function set_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_id <> old.team_id then
    raise exception 'A row can''t move to another team' using errcode = '42501';
  end if;
  new.changed_at := clock_timestamp();
  new.changed_by := auth.uid();
  return new;
end;
$$;

-- A member row can't be taken over by another login.
create or replace function keep_member_login()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'A member can''t change login' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger members_keep_login before update on members for each row execute function keep_member_login();

-- A new login becomes a member of the team when there is exactly one, and is not yet on the access list:
-- someone created by mistake can log in but sees nothing. Giving access: Table Editor > members > allowed.
-- With a name that is already taken in the team, no member is made: the login then simply has no access.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  only_team text;
begin
  if (select count(*) from public.teams) = 1 then
    select id into only_team from public.teams;
    insert into public.members (team_id, user_id, name, created_by, changed_by)
    values (only_team, new.id, split_part(new.email, '@', 1), new.id, new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- =====================
-- Access
-- =====================

-- The teams of the person asking. The one function that looks past the rules, because the rule on
-- members can't read members itself. It only ever returns your own teams.
create or replace function my_team_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select team_id from public.members where user_id = (select auth.uid()) and allowed and removed_at is null;
$$;

do $$
declare
  t text;
begin
  -- Every table of a team: reading and writing only within your own teams. The check also holds for the
  -- new value, so a row can't be written into another team.
  foreach t in array array['clients', 'goals', 'tasks', 'task_members', 'work_blocks', 'block_placements',
                           'period_segments', 'period_placements', 'calendars', 'app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "team only" on public.%I for all to authenticated
                    using (team_id in (select public.my_team_ids()))
                    with check (team_id in (select public.my_team_ids()))', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_changed()',
                   t || '_changed', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

alter table teams enable row level security;
create policy "own teams" on teams for select to authenticated using (id in (select my_team_ids()));
grant select on teams to authenticated;

-- People are added through an invitation (handle_new_user), so there is no rule for inserting or deleting.
alter table members enable row level security;
create policy "team or self" on members for select to authenticated
  using (team_id in (select my_team_ids()) or user_id = (select auth.uid()));
create policy "team only" on members for update to authenticated
  using (team_id in (select my_team_ids())) with check (team_id in (select my_team_ids()));
create trigger members_changed before update on members for each row execute function set_changed();
grant select, update on members to authenticated;

alter table schema_migrations enable row level security;
create policy "read" on schema_migrations for select to authenticated using (true);
grant select on schema_migrations to authenticated;

revoke all on all tables in schema public from anon;

-- =====================
-- Saving a group of changes
-- =====================

-- All or nothing: anything that fails undoes the whole call. Runs with the rights of the user (security
-- invoker), so the rules above apply to every change. p_ops, one object per change:
--   {op:'insert', table, row, if_new?}     if_new: a row that already exists is left alone
--   {op:'update', table, id, fields, if_changed_at?}
--   {op:'upsert', table, id, fields}
--   {op:'remove', table, id, if_changed_at?}
-- if_changed_at: refuse with JP001 when someone else changed the row since. Returns the stored rows, in
-- the same order (null for a removal).
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
        'block_placements', 'period_segments', 'period_placements', 'calendars', 'app_settings']) then
      raise exception 'Unknown table %', tbl;
    end if;
    row_id := o->>'id';
    seen := (o->>'if_changed_at')::timestamptz;
    fields := coalesce(o->'fields', o->'row') - 'team_id';
    stored := null;

    if o->>'op' = 'insert' or o->>'op' = 'upsert' then
      if o->>'op' = 'upsert' then
        fields := fields || jsonb_build_object('id', row_id);
        select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(fields - 'id') k;
        execute format('update public.%I as t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1))
                        where t.team_id = $2 and t.id = $3 returning to_jsonb(t.*)', tbl, cols, cols, tbl)
          into stored using fields, p_team, row_id;
      end if;
      if stored is null then
        select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(fields) k;
        execute format('insert into public.%I as t (team_id, %s)
                        select $1, %s from jsonb_populate_record(null::public.%I, $2) %s returning to_jsonb(t.*)',
                       tbl, cols, cols, tbl, case when (o->>'if_new')::boolean then 'on conflict do nothing' else '' end)
          into stored using p_team, fields;
      end if;

    elsif o->>'op' = 'update' then
      fields := fields - 'id';
      select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(fields) k;
      execute format('update public.%I as t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1))
                      where t.team_id = $2 and t.id = $3 and ($4::timestamptz is null or t.changed_at = $4)
                      returning to_jsonb(t.*)', tbl, cols, cols, tbl)
        into stored using fields, p_team, row_id, seen;
      if stored is null then
        perform batch_row_gone(tbl, p_team, row_id, true);
      end if;

    elsif o->>'op' = 'remove' then
      execute format('delete from public.%I as t where t.team_id = $1 and t.id = $2
                      and ($3::timestamptz is null or t.changed_at = $3) returning to_jsonb(t.*)', tbl)
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

-- Nothing was changed: because someone else got there first (JP001), or because the row isn't there.
create or replace function batch_row_gone(tbl text, p_team text, row_id text, must_exist boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  found_row boolean;
begin
  execute format('select exists (select 1 from public.%I where team_id = $1 and id = $2)', tbl)
    into found_row using p_team, row_id;
  if found_row then
    raise exception 'Changed meanwhile: % %', tbl, row_id using errcode = 'JP001';
  elsif must_exist then
    raise exception 'Not found: % %', tbl, row_id using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function my_team_ids(), apply_batch(text, jsonb), batch_row_gone(text, text, text, boolean),
  handle_new_user(), set_changed(), keep_member_login() from public, anon;
grant execute on function my_team_ids(), apply_batch(text, jsonb), batch_row_gone(text, text, text, boolean)
  to authenticated;

insert into schema_migrations (version, name) values (1, 'initial');

commit;
