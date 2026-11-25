-- JAPT migration 008: your own order of the goals.
--
-- A goal gets a position, as tasks have: the goals of a client stand in that order everywhere (Doelen, Verwerken,
-- the goal picker, the filter), and you change it by dragging on Doelen. Until now goals had no order of their
-- own (they followed their random id). The goals already there start alphabetically per client.
-- Run once in the SQL Editor, after 007, before the new app files go online.

begin;

alter table goals add column position double precision;

update goals g set position = o.n * 1024
from (
  select team_id, id, row_number() over (partition by team_id, client_id order by lower(name), id) as n
  from goals
) o
where g.team_id = o.team_id and g.id = o.id;

alter table goals alter column position set default 0;
alter table goals alter column position set not null;

insert into schema_migrations (version, name) values (8, 'goal_order');

commit;
