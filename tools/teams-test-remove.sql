-- JAPT: removes what tools/teams-test-setup.sql and the two test logins added. Only for a database that is
-- also used for real; a separate test project can keep them. Run it in the SQL Editor.
-- Everything of a team goes with the team. Nothing else is touched.

begin;

delete from public.teams where id in ('teamtest-a', 'teamtest-b');
delete from auth.users where email in ('japt-test-a@example.com', 'japt-test-b@example.com');

commit;
