-- =====================================================================
-- Common Seal - health check. Read-only: it changes nothing.
-- Run it in the Supabase SQL editor after running migrations.
-- Every row should say "pass". A "FAIL" row names what to look at.
-- =====================================================================
with expected (migration, marker) as (
  values ('0001', 'organisations'), ('0003', 'entities'), ('0004', 'meetings'), ('0005', 'invitations'),
         ('0006', 'delegation_rules'), ('0007', 'contracts'), ('0008', 'register_entries'), ('0009', 'dd_cases'),
         ('0011', 'training_modules'), ('0012', 'workflows'), ('0013', 'policies'), ('0014', 'speak_up_cases'),
         ('0015', 'expense_claims'), ('0016', 'document_links'), ('0017', 'ms_statements'), ('0018', 'attestation_rounds'), ('0020', 'ms_campaigns'), ('0023', 'risk_reviews')
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
  select 'Migration 0053 has been run',
         to_regclass('public.acquisitions') is not null, ''
  union all
  select 'Migration 0052 has been run',
         to_regclass('public.compliance_checks') is not null, ''
  union all
  select 'Migration 0051 has been run',
         to_regclass('public.abc_programme') is not null, ''
  union all
  select 'Migration 0050 has been run',
         to_regclass('public.privacy_breaches') is not null, ''
  union all
  select 'Migration 0049 has been run',
         to_regclass('public.whs_incidents') is not null, ''
  union all
  select 'Files on sensitive records are restricted',
         not exists (select 1 from public.documents d where not d.is_restricted and exists (select 1 from public.document_links l where l.document_id = d.id
                     and l.subject_table in ('share_movements', 'esop_grants', 'convertibles', 'bank_accounts', 'credit_facilities', 'corporate_documents', 'asic_filings', 'whs_incidents', 'privacy_breaches', 'personal_info_holdings', 'automated_decisions', 'abc_assessments', 'abc_programme', 'compliance_checks', 'standard_form_contracts', 'acquisitions'))), ''
  union all
  select 'Migration 0048 has been run',
         to_regclass('public.compliance_obligations') is not null, ''
  union all
  select 'Migration 0047 has been run',
         to_regclass('public.asic_filings') is not null and to_regclass('public.corporate_documents') is not null, ''
  union all
  select 'Migration 0046 has been run',
         to_regclass('public.bank_accounts') is not null and to_regclass('public.credit_facilities') is not null, ''
  union all
  select 'Migration 0045 has been run',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'esop_plans' and column_name = 'plan_type'), ''
  union all
  select 'Migration 0044 has been run',
         to_regclass('public.share_movements') is not null and to_regclass('public.reserved_matters') is not null, ''
  union all
  select 'Migration 0043 has been run',
         to_regclass('public.dd_questionnaire_files') is not null, ''
  union all
  select 'Migration 0042 has been run',
         to_regclass('public.dd_questionnaires') is not null, ''
  union all
  select 'Migration 0041 has been run',
         to_regclass('public.ip_assets') is not null, ''
  union all
  select 'Migration 0040 has been run',
         to_regclass('public.legal_audits') is not null, ''
  union all
  select 'Migration 0039 has been run',
         to_regclass('public.dd_mitigations') is not null, ''
  union all
  select 'Migration 0038 has been run',
         to_regclass('public.sanctions_assessments') is not null, ''
  union all
  select 'Migration 0037 has been run',
         to_regclass('public.disputes') is not null and to_regclass('public.key_employees') is not null, ''
  union all
  select 'Migration 0036 has been run',
         to_regclass('public.training_people') is not null, ''
  union all
  select 'Migration 0035 has been run',
         to_regclass('public.conflict_settings') is not null, ''
  union all
  select 'Migration 0034 has been run',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conflict_declarations' and column_name = 'risk_level'), ''
  union all
  select 'Migration 0033 has been run',
         to_regclass('public.policy_templates') is not null, ''
  union all
  select 'Migration 0032 has been run',
         to_regclass('public.insurance_policies') is not null, ''
  union all
  select 'Migration 0031 has been run',
         to_regclass('public.sign_groups') is not null, ''
  union all
  select 'Migration 0030 has been run',
         to_regclass('public.auth_versions') is not null, ''
  union all
  select 'Migration 0029 has been run',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'presence_org'), ''
  union all
  select 'Presence is limited to members of the organisation',
         to_regclass('realtime.messages') is null
         or (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'common_seal_presence_%') = 2, ''
  union all
  select 'Migration 0028 has been run',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'risk_reviews' and column_name = 'send_to'), ''
  union all
  select 'Migration 0027 has been run',
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_member_roles' and p.prosrc not like '%Only an owner can%'), ''
  union all
  select 'Migration 0026 has been run',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'memberships' and column_name = 'extra_roles'), ''
  union all
  select 'Migration 0025 has been run',
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'risk_owners' and policyname = 'risk_owners_insert' and with_check like '%records_roles%'), ''
  union all
  select 'Migration 0024 has been run',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'risk_items' and column_name = 'owner_comment'), ''
  union all
  select 'Migration 0022 has been run',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ms_questions' and column_name = 'is_active'), ''
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
  -- The deliberate exceptions: eight functions that each need the long code from a person's own link
  select 'Visitors who are not signed in can run nothing except the personal-link pages',
         not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
                       and p.proname not in ('ms_questionnaire', 'ms_submit_questionnaire', 'risk_request', 'risk_save_item', 'risk_delete_item', 'risk_finish', 'risk_action', 'risk_action_update', 'training_by_link', 'complete_training_by_link', 'can_read_training_object', 'dd_questionnaire', 'submit_dd_questionnaire', 'register_dd_upload', 'remove_dd_upload', 'can_store_dd_upload')
                       and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p
                   where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
                     and p.proname not in ('ms_questionnaire', 'ms_submit_questionnaire', 'risk_request', 'risk_save_item', 'risk_delete_item', 'risk_finish', 'risk_action', 'risk_action_update', 'training_by_link', 'complete_training_by_link', 'can_read_training_object', 'dd_questionnaire', 'submit_dd_questionnaire', 'register_dd_upload', 'remove_dd_upload', 'can_store_dd_upload')
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
                       and p.proname in ('advance_workflow_run', 'covering_rules', 'rule_holder', 'rule_basis', 'attach_target', 'ms_rate_recipient', 'start_risk_review')
                       and has_function_privilege('authenticated', p.oid, 'execute')),
         coalesce((select string_agg(p.proname, ', ') from pg_proc p where p.pronamespace = 'app'::regnamespace
                     and p.proname in ('advance_workflow_run', 'covering_rules', 'rule_holder', 'rule_basis', 'attach_target', 'ms_rate_recipient', 'start_risk_review')
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
