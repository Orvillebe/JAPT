-- JAPT migration 003: remember in which free part of a block a task was put.
--
-- A meeting can split a work block into free parts. part_start is the minute that part started at when the
-- task was dropped there. Empty: the task fills the parts from the top. It says nothing about when the task
-- happens, and it is no reference to a meeting: the app works out the parts from the agenda when it draws.

begin;

alter table block_placements add column part_start integer check (part_start between 0 and 1440);

insert into schema_migrations (version, name) values (3, 'block_part');

commit;
