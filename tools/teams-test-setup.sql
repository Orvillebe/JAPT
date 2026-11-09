-- JAPT: two test teams for tests/teams.test.js. Only for testing; a reset of the database removes them.
-- First make two logins in Authentication > Users (Auto Confirm): the e-mails below, passwords of your choice.
-- Then run this once in the SQL Editor.

begin;

insert into public.teams (id, name) values ('teamtest-a', 'Test A'), ('teamtest-b', 'Test B')
on conflict (id) do nothing;

-- Whatever the logins got automatically is replaced: each in exactly one test team.
delete from public.members where user_id in
  (select id from auth.users where email in ('japt-test-a@example.com', 'japt-test-b@example.com'));

insert into public.members (team_id, id, user_id, name, allowed)
select case u.email when 'japt-test-a@example.com' then 'teamtest-a' else 'teamtest-b' end,
       case u.email when 'japt-test-a@example.com' then 'teamtest-a-me' else 'teamtest-b-me' end,
       u.id, split_part(u.email, '@', 1), true
from auth.users u where u.email in ('japt-test-a@example.com', 'japt-test-b@example.com');

commit;
