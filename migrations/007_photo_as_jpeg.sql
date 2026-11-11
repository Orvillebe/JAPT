-- JAPT migration 007: reading a photo as bytes.
-- Supabase (PostgREST 12 and later) only answers with bytes when the answer has a type of its own. Asking
-- photo_data for application/octet-stream is refused (PGRST107, found when testing 006 on the real
-- database). So a photo is read through task_photo(), whose answer is of the type image/jpeg.
-- Run once in the SQL Editor, after 006.

begin;

-- The name is the media type the app asks for (Accept: image/jpeg); the content is plain bytes.
create domain "image/jpeg" as bytea;

-- One photo of a team, or nothing when it is gone. With the rights of whoever asks, so the same rule as
-- everywhere: only photos of your own team.
create or replace function task_photo(p_team text, p_id text)
returns "image/jpeg"
language sql
stable
security invoker
set search_path = ''
as $$
  select data from public.photo_data where team_id = p_team and id = p_id;
$$;

revoke execute on function task_photo(text, text) from public, anon;
grant execute on function task_photo(text, text) to authenticated;

insert into schema_migrations (version, name) values (7, 'photo_as_jpeg');

commit;
