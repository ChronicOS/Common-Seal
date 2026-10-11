-- =====================================================================
-- Common Seal - health check. Read-only: it changes nothing.
-- Run it in the Supabase SQL editor after running migrations.
-- Every row should say "pass". A "FAIL" row names what to look at.
-- =====================================================================
with expected (migration, marker) as (
  values ('0001', 'organisations'), ('0003', 'entities'), ('0004', 'meetings'), ('0005', 'invitations'),
         ('0006', 'delegation_rules'), ('0007', 'contracts'), ('0008', 'register_entries'), ('0009', 'dd_cases'),
         ('0011', 'training_modules'), ('0012', 'workflows'), ('0013', 'policies'), ('0014', 'speak_up_cases'),
         ('0015', 'expense_claims'), ('0016', 'document_links'), ('0017', 'ms_statements'), ('0018', 'attestation_rounds'), ('0020', 'ms_campaigns')
),
tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
checks (check_name, ok, detail) as (
  select 'Migration ' || e.migration || ' has been run', to_regclass('public.' || e.marker) is not null,
         case when to_regclass('public.' || e.marker) is null then 'Table ' || e.marker || ' is missing' else '' end
  from expected e
  union all
  select 'Migration 0021 has been run',
         exists (select 1 from pg_constraint c where c.conname = 'ms_sections_criterion_check' and pg_get_constraintdef(c.oid) like '%0%9%'), ''
  union all
  select 'Migration 0010 has been run',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'counterparty_entity_id'), ''
  union all
  select 'Every table has row-level security switched on', not exists (select 1 from tables where not relrowsecurity),
         coalesce((select string_agg(relname, ', ') from tables where not relrowsecurity), '')
  union all
  -- training_library_questions has no policy on purpose: only a database function reads it
  select 'Every table has an access rule',
         not exists (select 1 from tables t where t.relname <> 'training_library_questions'
                       and not exists (select 1 from pg_policy p where p.polrelid = t.oid)),
         coalesce((select string_agg(t.relname, ', ') from tables t where t.relname <> 'training_library_questions'
                     and not exists (select 1 from pg_policy p where p.polrelid = t.oid)), '')
  union all
  select 'Visitors who are not signed in can read or change no table',
         not exists (select 1 from information_schema.role_table_grants g where g.grantee = 'anon' and g.table_schema = 'public'),
         coalesce((select string_agg(distinct g.table_name, ', ') from information_schema.role_table_grants g
                   where g.grantee = 'anon' and g.table_schema = 'public'), '')
  union all
  select 'Signed-in users cannot delete or empty tables they should not',
         not exists (select 1 from information_schema.role_table_grants g
                     where g.grantee = 'authenticated' and g.table_schema = 'public' and g.privilege_type = 'TRUNCATE'),
         coalesce((select string_agg(distinct g.table_name, ', ') from information_schema.role_table_grants g
                   where g.grantee = 'authenticated' and g.table_schema = 'public' and g.privilege_type = 'TRUNCATE'), '')
  union all
  -- The supplier questionnaire is the one deliberate exception: two functions that need the code from a supplier's link
  select 'Visitors who are not signed in can run nothing except the supplier questionnaire',
         not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
                       and p.proname not in ('ms_questionnaire', 'ms_submit_questionnaire')
                       and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                   where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
                     and p.proname not in ('ms_questionnaire', 'ms_submit_questionnaire')
                     and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')), '')
  union all
  select 'Every privileged function has a fixed search path',
         not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prosecdef
                       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                   where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prosecdef
                     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), '')
  union all
  select 'Internal helpers cannot be called directly',
         not exists (select 1 from pg_proc p where p.pronamespace = 'app'::regnamespace
                       and p.proname in ('advance_workflow_run', 'covering_rules', 'rule_holder', 'rule_basis', 'attach_target', 'ms_rate_recipient')
                       and has_function_privilege('authenticated', p.oid, 'execute')),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'app'::regnamespace
                     and p.proname in ('advance_workflow_run', 'covering_rules', 'rule_holder', 'rule_basis', 'attach_target', 'ms_rate_recipient')
                     and has_function_privilege('authenticated', p.oid, 'execute')), '')
  union all
  select 'The file store is private', exists (select 1 from storage.buckets b where b.id = 'documents' and not b.public), ''
  union all
  select 'Speak-up cases are kept out of the general audit log',
         not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                     where c.relnamespace = 'public'::regnamespace and c.relname like 'speak\_up\_%' and c.relname <> 'speak_up_handlers'
                       and t.tgname like '%\_audit'), ''
)
select check_name, case when ok then 'pass' else 'FAIL' end as result, detail
from checks
order by ok, check_name;
