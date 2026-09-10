-- Run this after migration to compare the expected canonical object counts.
select 'enums' as kind, count(*) as count
from pg_type t join pg_namespace n on n.oid=t.typnamespace
where n.nspname='public' and t.typtype='e'
union all
select 'tables', count(*)
from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all
select 'indexes', count(*)
from pg_indexes where schemaname='public'
union all
select 'policies', count(*)
from pg_policies where schemaname='public'
union all
select 'triggers', count(*)
from information_schema.triggers where trigger_schema='public'
union all
select 'realtime_tables', count(*)
from pg_publication_tables where pubname='supabase_realtime' and schemaname='public';
