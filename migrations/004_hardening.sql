-- JAPT migration 004: what a team member could only do by talking to the database directly.
--
--   * Colours, ids and delete groups have a fixed form. They end up in the HTML of a colleague's page, so
--     text with quotes or brackets must not be able to get in.
--   * Who made or changed something, and when, is filled in here. Nothing a client sends counts.
--     Only for logged-in users: a restore from the SQL Editor keeps the original values.
--   * purge_bin empties the Bin in one go, and first rescues tasks that are alive under a deleted goal.
--
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- =====================
-- Fixed forms
-- =====================

alter table members add constraint members_color_form check (color ~ '^#[0-9a-fA-F]{6}$');

do $$
declare
  t text;
begin
  foreach t in array array['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks', 'block_placements',
                           'period_segments', 'period_placements', 'calendars', 'app_settings'] loop
    execute format('alter table public.%I add constraint %I check (id ~ ''^[A-Za-z0-9_-]+$'')', t, t || '_id_form');
  end loop;
  foreach t in array array['clients', 'goals', 'tasks'] loop
    execute format('alter table public.%I add constraint %I check (delete_group is null or delete_group ~ ''^[A-Za-z0-9_-]+$'')',
                   t, t || '_delete_group_form');
  end loop;
end;
$$;

-- =====================
-- Who and when
-- =====================

create or replace function set_created()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
    new.changed_by := auth.uid();
    new.changed_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create or replace function set_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_id <> old.team_id then
    raise exception 'A row can''t move to another team' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.changed_at := clock_timestamp();
  new.changed_by := auth.uid();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['members', 'clients', 'goals', 'tasks', 'task_members', 'work_blocks', 'block_placements',
                           'period_segments', 'period_placements', 'calendars', 'app_settings'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.set_created()',
                   t || '_created', t);
  end loop;
end;
$$;

-- =====================
-- Emptying the Bin
-- =====================

-- A task made in a goal at the moment someone deleted that goal stays alive under a deleted goal. It goes to
-- the Inbox here; otherwise it would be invisible work, and removing the goal for good would fail for ever.
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
end;
$$;

revoke execute on function purge_bin(text, timestamptz), set_created() from public, anon;
grant execute on function purge_bin(text, timestamptz) to authenticated;

insert into schema_migrations (version, name) values (4, 'hardening');

commit;
