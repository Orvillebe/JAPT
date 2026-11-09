-- JAPT migration 002: a way to prove that every table is protected.
--
-- tests/teams.test.js asks this list and fails when it isn't empty, so a table added later without Row
-- Level Security can't go unnoticed. It only returns table names of this app's own schema.

begin;

create or replace function tables_without_rls()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select c.relname::text from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
$$;
revoke execute on function tables_without_rls() from public, anon;
grant execute on function tables_without_rls() to authenticated;

insert into schema_migrations (version, name) values (2, 'rls_check');

commit;
