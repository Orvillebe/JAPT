-- JAPT: the first team of a new installation. Run once, after migrations/001_initial.sql, in the SQL Editor.
-- Change the team name below. Everyone who already has a login joins this team and gets access.
-- Inviting someone later: Authentication > Users > Invite; the invited person joins this team by
-- themselves and gets access when you set allowed to true in Table Editor > members.

begin;

with new_team as (
  insert into public.teams (name) values ('Orville') returning id
)
insert into public.members (team_id, user_id, name, allowed)
select new_team.id, u.id, split_part(u.email, '@', 1), true
from new_team, auth.users u;

commit;
