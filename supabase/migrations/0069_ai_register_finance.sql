-- 0069: AI register (Risk and compliance) and financial results for the board (Company).
--
-- AI register
--   AI tools: added by dropping in links. Each has a status (approved, approved with limits, under
--   review, prohibited, retired), the most sensitive information that may be put into it, whether it is
--   used through a company account, an owner and a review date.
--   Use rules: approved and prohibited uses, for one tool or for every AI tool.
--   AI projects (Medium and Large): AI being built for the business: purpose, owner, status, risk level,
--   personal information, decisions about people, models used, where data is processed, human oversight,
--   testing, approval and review.
--   Everyone in the organisation can read the register (so staff know what they may use); the records
--   roles keep it.
--
-- Financial results
--   A report (for the group or one company) with a frequency (weekly, monthly, quarterly, half-yearly,
--   annually), the person who prepares it, how many days after the period it is due, and its measures
--   (revenue, expenses, net profit, margin, cash, customers, or others), each with an actual and optionally
--   a budget. Each period is filled in by the preparer, with commentary and supporting files (P&L, balance
--   sheet, slides), then submitted; directors mark it as reviewed. Readable by the board roles and auditors
--   (as for bank and finance details) and by the preparer.

-- ---------- AI register ----------
create table if not exists public.ai_tools (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  url              text check (url is null or (url ~* '^https?://' and char_length(url) <= 500)),
  vendor           text check (vendor is null or char_length(vendor) <= 120),
  category         text not null default 'other' check (category in ('chat', 'writing', 'coding', 'meeting', 'image', 'search', 'analytics', 'built_in', 'other')),
  status           text not null default 'approved' check (status in ('approved', 'limited', 'review', 'prohibited', 'retired')),
  data_allowed     text check (data_allowed is null or data_allowed in ('public', 'internal', 'confidential', 'personal')),
  company_account  boolean not null default false,
  owner_name       text check (owner_name is null or char_length(owner_name) <= 120),
  approved_by      text check (approved_by is null or char_length(approved_by) <= 120),
  approved_on      date,
  review_on        date,
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists ai_tools_name_idx on public.ai_tools (organisation_id, lower(name));

create table if not exists public.ai_use_rules (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  tool_id          uuid references public.ai_tools (id) on delete cascade,   -- null: every AI tool
  kind             text not null check (kind in ('approved', 'prohibited')),
  text             text not null check (char_length(btrim(text)) between 3 and 300),
  position         integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists ai_use_rules_idx on public.ai_use_rules (organisation_id, tool_id, kind, position);

create table if not exists public.ai_projects (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete cascade,
  entity_id               uuid references public.entities (id) on delete set null,
  name                    text not null check (char_length(btrim(name)) between 2 and 150),
  purpose                 text check (purpose is null or char_length(purpose) <= 2000),
  owner_name              text check (owner_name is null or char_length(owner_name) <= 120),
  status                  text not null default 'idea' check (status in ('idea', 'assessing', 'building', 'pilot', 'live', 'paused', 'retired')),
  risk_level              text check (risk_level is null or risk_level in ('minimal', 'limited', 'high', 'unacceptable')),
  personal_info           boolean not null default false,
  decisions_about_people  boolean not null default false,
  customer_facing         boolean not null default false,
  models                  text check (models is null or char_length(models) <= 300),
  tool_id                 uuid references public.ai_tools (id) on delete set null,
  data_location           text check (data_location is null or char_length(data_location) <= 200),
  human_oversight         text check (human_oversight is null or char_length(human_oversight) <= 1000),
  testing                 text check (testing is null or char_length(testing) <= 1000),
  approved_by             text check (approved_by is null or char_length(approved_by) <= 120),
  approved_on             date,
  go_live_on              date,
  review_on               date,
  created_by              uuid references auth.users (id) on delete set null default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.ai_tools enable row level security;
alter table public.ai_use_rules enable row level security;
alter table public.ai_projects enable row level security;
revoke all on public.ai_tools, public.ai_use_rules, public.ai_projects from anon, authenticated;
grant select, insert, update, delete on public.ai_tools, public.ai_use_rules, public.ai_projects to authenticated;
grant all on public.ai_tools, public.ai_use_rules, public.ai_projects to service_role;

do $$
declare t text;
begin
  foreach t in array array['ai_tools', 'ai_use_rules', 'ai_projects'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (app.is_member(organisation_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()))', t);
  end loop;
end;
$$;

-- A rule for one tool must belong to a tool of the same organisation; a project's tool and company likewise
create or replace function app.guard_ai_rows()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'ai_use_rules' and new.tool_id is not null
     and not exists (select 1 from public.ai_tools t where t.id = new.tool_id and t.organisation_id = new.organisation_id) then
    raise exception 'That AI tool is not in this organisation';
  end if;
  if tg_table_name = 'ai_projects' then
    if new.tool_id is not null and not exists (select 1 from public.ai_tools t where t.id = new.tool_id and t.organisation_id = new.organisation_id) then
      raise exception 'That AI tool is not in this organisation';
    end if;
    if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
      raise exception 'That company is not in this organisation';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.organisation_id <> old.organisation_id then
    raise exception 'A record cannot move to another organisation';
  end if;
  return new;
end;
$$;
drop trigger if exists ai_use_rules_guard on public.ai_use_rules;
create trigger ai_use_rules_guard before insert or update on public.ai_use_rules for each row execute function app.guard_ai_rows();
drop trigger if exists ai_projects_guard on public.ai_projects;
create trigger ai_projects_guard before insert or update on public.ai_projects for each row execute function app.guard_ai_rows();
drop trigger if exists ai_tools_touch on public.ai_tools;
create trigger ai_tools_touch before update on public.ai_tools for each row execute function app.touch_updated_at();
drop trigger if exists ai_projects_touch on public.ai_projects;
create trigger ai_projects_touch before update on public.ai_projects for each row execute function app.touch_updated_at();
drop trigger if exists ai_tools_audit on public.ai_tools;
create trigger ai_tools_audit after insert or update or delete on public.ai_tools for each row execute function app.audit_row();
drop trigger if exists ai_use_rules_audit on public.ai_use_rules;
create trigger ai_use_rules_audit after insert or update or delete on public.ai_use_rules for each row execute function app.audit_row();
drop trigger if exists ai_projects_audit on public.ai_projects;
create trigger ai_projects_audit after insert or update or delete on public.ai_projects for each row execute function app.audit_row();

-- ---------- Financial results ----------
create table if not exists public.fin_reports (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  entity_id           uuid references public.entities (id) on delete cascade,   -- null: the whole group
  name                text not null default 'Financial results' check (char_length(btrim(name)) between 2 and 120),
  frequency           text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'half_yearly', 'annually')),
  first_period_start  date not null,
  due_days            integer not null default 15 check (due_days between 0 and 120),
  preparer_person_id  uuid references public.people (id) on delete set null,
  currency            text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  metrics             jsonb not null default '[
    {"key": "revenue", "label": "Revenue", "unit": "money", "budget": true},
    {"key": "expenses", "label": "Expenses", "unit": "money", "budget": true},
    {"key": "net_profit", "label": "Net profit", "unit": "money", "budget": true},
    {"key": "margin", "label": "Margin", "unit": "percent", "budget": true},
    {"key": "cash", "label": "Cash at bank", "unit": "money", "budget": false},
    {"key": "customers", "label": "Customers", "unit": "number", "budget": true}
  ]'::jsonb check (jsonb_typeof(metrics) = 'array' and jsonb_array_length(metrics) between 1 and 30),
  is_active           boolean not null default true,
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.fin_periods (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  report_id        uuid not null references public.fin_reports (id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  due_on           date not null,
  status           text not null default 'open' check (status in ('open', 'submitted', 'reviewed')),
  figures          jsonb not null default '{}'::jsonb check (jsonb_typeof(figures) = 'object'),
  commentary       text check (commentary is null or char_length(commentary) <= 4000),
  submitted_by     uuid references auth.users (id) on delete set null,
  submitted_at     timestamptz,
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  review_note      text check (review_note is null or char_length(review_note) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (report_id, period_start)
);
create index if not exists fin_periods_report_idx on public.fin_periods (report_id, period_start desc);

create or replace function app.is_fin_preparer(p_report uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fin_reports r join public.people p on p.id = r.preparer_person_id
                 where r.id = p_report and p.user_id = auth.uid() and app.is_member(r.organisation_id));
$$;

alter table public.fin_reports enable row level security;
alter table public.fin_periods enable row level security;
revoke all on public.fin_reports, public.fin_periods from anon, authenticated;
grant select, insert, update, delete on public.fin_reports to authenticated;
grant select on public.fin_periods to authenticated;
grant all on public.fin_reports, public.fin_periods to service_role;
drop policy if exists fin_reports_read on public.fin_reports;
create policy fin_reports_read on public.fin_reports for select to authenticated using (app.can_read_finance(organisation_id) or app.is_fin_preparer(id));
drop policy if exists fin_reports_write on public.fin_reports;
create policy fin_reports_write on public.fin_reports for all to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
drop policy if exists fin_periods_read on public.fin_periods;
create policy fin_periods_read on public.fin_periods for select to authenticated using (app.can_read_finance(organisation_id) or app.is_fin_preparer(report_id));

create or replace function app.guard_fin_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m jsonb;
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.preparer_person_id is not null and not exists (select 1 from public.people p where p.id = new.preparer_person_id and p.organisation_id = new.organisation_id) then
    raise exception 'That person is not in this organisation';
  end if;
  for m in select * from jsonb_array_elements(new.metrics) loop
    if coalesce(m ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,39}$' or char_length(btrim(coalesce(m ->> 'label', ''))) not between 1 and 60
       or coalesce(m ->> 'unit', '') not in ('money', 'percent', 'number') then
      raise exception 'Each measure needs a name and a kind (money, percent or number)';
    end if;
  end loop;
  if (select count(distinct x ->> 'key') from jsonb_array_elements(new.metrics) x) <> jsonb_array_length(new.metrics) then
    raise exception 'Two measures have the same name';
  end if;
  if tg_op = 'UPDATE' and new.organisation_id <> old.organisation_id then
    raise exception 'A report cannot move to another organisation';
  end if;
  return new;
end;
$$;
drop trigger if exists fin_reports_guard on public.fin_reports;
create trigger fin_reports_guard before insert or update on public.fin_reports for each row execute function app.guard_fin_report();
drop trigger if exists fin_reports_touch on public.fin_reports;
create trigger fin_reports_touch before update on public.fin_reports for each row execute function app.touch_updated_at();
drop trigger if exists fin_periods_touch on public.fin_periods;
create trigger fin_periods_touch before update on public.fin_periods for each row execute function app.touch_updated_at();
drop trigger if exists fin_reports_audit on public.fin_reports;
create trigger fin_reports_audit after insert or update or delete on public.fin_reports for each row execute function app.audit_row();
drop trigger if exists fin_periods_audit on public.fin_periods;
create trigger fin_periods_audit after insert or update or delete on public.fin_periods for each row execute function app.audit_row();

-- Changing the frequency or start clears periods not yet started on (no figures, no files), so they are rebuilt to match
create or replace function app.fin_report_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.frequency is distinct from old.frequency or new.first_period_start is distinct from old.first_period_start then
    delete from public.fin_periods f
     where f.report_id = new.id and f.status = 'open' and f.figures = '{}'::jsonb and f.commentary is null
       and not exists (select 1 from public.document_links l where l.subject_table = 'fin_periods' and l.subject_id = f.id);
  end if;
  return new;
end;
$$;
drop trigger if exists fin_reports_changed on public.fin_reports;
create trigger fin_reports_changed after update on public.fin_reports for each row execute function app.fin_report_changed();

create or replace function app.fin_next(p_start date, p_freq text)
returns date language sql immutable set search_path = '' as $$
  select case p_freq
    when 'weekly' then p_start + 7
    when 'monthly' then (p_start + interval '1 month')::date
    when 'quarterly' then (p_start + interval '3 months')::date
    when 'half_yearly' then (p_start + interval '6 months')::date
    else (p_start + interval '1 year')::date end;
$$;

-- Adds the periods up to the current one (at most 60 back), so the table is always ready to fill in
create or replace function public.ensure_fin_periods(p_report uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r public.fin_reports%rowtype;
  v_start date;
  v_starts date[] := '{}';
  d date;
  v_n integer := 0;
begin
  select * into r from public.fin_reports where id = p_report;
  if r.id is null or not (app.can_read_finance(r.organisation_id) or app.is_fin_preparer(r.id)) then
    raise exception 'Not allowed';
  end if;
  if not r.is_active then
    return 0;
  end if;
  v_start := r.first_period_start;
  -- Every period start up to today; only the most recent 60 are added
  while v_start <= current_date and cardinality(v_starts) < 10000 loop
    v_starts := v_starts || v_start;
    v_start := app.fin_next(v_start, r.frequency);
  end loop;
  foreach d in array coalesce(v_starts[greatest(1, cardinality(v_starts) - 59):], '{}'::date[]) loop
    insert into public.fin_periods (organisation_id, report_id, period_start, period_end, due_on)
    values (r.organisation_id, r.id, d, app.fin_next(d, r.frequency) - 1, app.fin_next(d, r.frequency) - 1 + r.due_days)
    on conflict (report_id, period_start) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;

-- The preparer (or a records role) fills in a period; it can be saved as it goes, then submitted
create or replace function public.save_fin_period(p_period uuid, p_figures jsonb, p_commentary text, p_submit boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  p public.fin_periods%rowtype;
  r public.fin_reports%rowtype;
  k text;
  v jsonb;
  clean jsonb := '{}'::jsonb;
  part text;
begin
  select * into p from public.fin_periods where id = p_period for update;
  select * into r from public.fin_reports where id = p.report_id;
  if p.id is null or not (app.is_fin_preparer(r.id) or app.has_role(r.organisation_id, app.records_roles())) then
    raise exception 'Only the person preparing these results, or a records role, can fill them in';
  end if;
  if p.status = 'reviewed' and not app.has_role(r.organisation_id, app.records_roles()) then
    raise exception 'These results have been reviewed by the board, so they are locked';
  end if;
  -- Only the report's measures, and only numbers
  for k, v in select * from jsonb_each(coalesce(p_figures, '{}'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(r.metrics) m where m ->> 'key' = k) then
      continue;
    end if;
    foreach part in array array['actual', 'budget'] loop
      if v ? part and jsonb_typeof(v -> part) not in ('number', 'null') then
        raise exception 'Figures must be numbers';
      end if;
    end loop;
    clean := clean || jsonb_build_object(k, jsonb_strip_nulls(jsonb_build_object('actual', v -> 'actual', 'budget', v -> 'budget')));
  end loop;
  update public.fin_periods set figures = clean, commentary = nullif(btrim(p_commentary), ''),
         status = case when p_submit then 'submitted' when status = 'reviewed' then 'reviewed' else status end,
         submitted_by = case when p_submit then auth.uid() else submitted_by end,
         submitted_at = case when p_submit then now() else submitted_at end,
         reviewed_by = case when p_submit then null else reviewed_by end,
         reviewed_at = case when p_submit then null else reviewed_at end
   where id = p_period
   returning status into part;
  return part;
end;
$$;

-- A director (or other board role) records that the board has seen the results
create or replace function public.review_fin_period(p_period uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.fin_periods%rowtype;
begin
  select * into p from public.fin_periods where id = p_period for update;
  if p.id is null or not app.has_role(p.organisation_id, app.board_read_roles()) then
    raise exception 'Only directors and the board roles can mark results as reviewed';
  end if;
  if p.status <> 'submitted' then
    raise exception 'These results have not been submitted yet';
  end if;
  update public.fin_periods set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_note), '') where id = p_period;
end;
$$;

-- ---------- Files on a period and on an AI project ----------
alter table public.document_links drop constraint if exists document_links_subject_table_check;
alter table public.document_links add constraint document_links_subject_table_check check (subject_table = any (array[
  'expense_claims', 'contracts', 'policies', 'workflow_run_steps', 'register_entries', 'dd_cases', 'ms_statements', 'insurance_policies', 'ip_assets',
  'conf_projects', 'acquisitions', 'compliance_checks', 'standard_form_contracts', 'abc_assessments', 'abc_programme', 'privacy_breaches',
  'personal_info_holdings', 'automated_decisions', 'whs_incidents', 'whs_hazards', 'whs_due_diligence', 'obligation_completions', 'corporate_documents',
  'asic_filings', 'annual_reviews', 'bank_accounts', 'credit_facilities', 'share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles',
  'investor_consents', 'sanctions_assessments', 'training_modules', 'fin_periods', 'ai_projects']::text[]));

do $$
declare v text;
begin
  v := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if position('''fin_periods''' in v) = 0 then
    v := replace(v, '  else
    raise exception ''Files cannot be attached to that kind of record'';',
      '  elsif p_table = ''fin_periods'' then
    select f.organisation_id, (app.has_role(f.organisation_id, app.records_roles()) or app.is_fin_preparer(f.report_id)) into v_org, v_ok
    from public.fin_periods f where f.id = p_id;
  elsif p_table = ''ai_projects'' then
    select a.organisation_id, app.has_role(a.organisation_id, app.records_roles()) into v_org, v_ok from public.ai_projects a where a.id = p_id;
  else
    raise exception ''Files cannot be attached to that kind of record'';');
    if position('''fin_periods''' in v) = 0 then raise exception 'attach_target: marker not found'; end if;
    execute v;
  end if;

  v := pg_get_functiondef('app.sensitive_subject(text)'::regprocedure);
  if position('''fin_periods''' in v) = 0 then
    v := replace(v, '''acquisitions'', ''conf_projects'')', '''acquisitions'', ''conf_projects'', ''fin_periods'')');
    if position('''fin_periods''' in v) = 0 then raise exception 'sensitive_subject: marker not found'; end if;
    execute v;
  end if;

  v := pg_get_functiondef('app.can_read_subject(text, uuid)'::regprocedure);
  if position('''fin_periods''' in v) = 0 then
    v := replace(v, '  end if;
  return false;', '  elsif p_table = ''fin_periods'' then
    return exists (select 1 from public.fin_periods f where f.id = p_id and (app.can_read_finance(f.organisation_id) or app.is_fin_preparer(f.report_id)));
  end if;
  return false;');
    if position('''fin_periods''' in v) = 0 then raise exception 'can_read_subject: marker not found'; end if;
    execute v;
  end if;
end;
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
grant execute on function app.can_read_ownership(uuid) to authenticated;
grant execute on function app.can_read_finance(uuid) to authenticated;
grant execute on function app.can_read_register(uuid) to authenticated;
grant execute on function app.is_obligation_owner(uuid) to authenticated;
grant execute on function app.whs_managers() to authenticated;
grant execute on function app.privacy_managers() to authenticated;
grant execute on function app.valid_info_kinds(text[]) to authenticated;
grant execute on function app.can_read_document(uuid) to authenticated;
grant execute on function app.can_read_abc(uuid) to authenticated;
grant execute on function app.can_read_regulatory(uuid) to authenticated;
grant execute on function app.conf_can_read(uuid), app.conf_can_manage(uuid) to authenticated;
grant execute on function app.is_fin_preparer(uuid) to authenticated;
revoke execute on function public.ensure_fin_periods(uuid), public.save_fin_period(uuid, jsonb, text, boolean), public.review_fin_period(uuid, text) from public, anon;
grant execute on function public.ensure_fin_periods(uuid), public.save_fin_period(uuid, jsonb, text, boolean), public.review_fin_period(uuid, text) to authenticated;
