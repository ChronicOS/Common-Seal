-- 0050: Privacy and cyber incidents.
--
-- Data breach register. A suspected breach starts the Notifiable Data Breaches
-- clock: the assessment must be finished within 30 days of suspecting it
-- (Privacy Act s 26WH). If it is an eligible data breach (likely to result in
-- serious harm, and remedial action has not prevented that), the OAIC and the
-- individuals must be told as soon as practicable (ss 26WK, 26WL).
--
-- Ransomware: a business with turnover over $3 million that makes, or knows
-- of, a ransomware payment must report it to the Australian Signals
-- Directorate within 72 hours (Cyber Security Act 2024, Part 3). Other
-- notices (APRA CPS 234 in 72 hours, SOCI cyber incidents in 12 or 72 hours,
-- insurers, the ASX) are tracked as a checklist on each breach.
--
-- Personal information holdings: what personal information is held, where,
-- why, for how long, and who looks after it.
--
-- Automated decisions: from 10 December 2026 a privacy policy must say what
-- kinds of personal information are used by computer programs that make, or
-- substantially and directly help make, decisions that could reasonably be
-- expected to significantly affect someone's rights or interests, and what
-- kinds of decisions those are (APP 1.7 to 1.9). The inventory produces that
-- wording.
--
-- Ladder up: assessments due within 7 days or late, eligible breaches not
-- notified to the OAIC, and ransomware payments not reported feed the Risk
-- Register (with no personal details).

create or replace function app.privacy_managers()
returns public.member_role[] language sql immutable as $$ select array['owner','admin','secretary','legal','compliance']::public.member_role[] $$;

create or replace function app.valid_info_kinds(p text[])
returns boolean language sql immutable as $$
  select p <@ array['contact', 'identity', 'government_id', 'tfn', 'financial', 'credit', 'health', 'sensitive', 'biometric', 'children',
                    'employee', 'location', 'online', 'other']::text[];
$$;

create table public.privacy_breaches (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete cascade,
  entity_id               uuid references public.entities (id) on delete set null,
  title                   text not null check (char_length(btrim(title)) between 3 and 200),
  suspected_on            date not null,                                      -- the day there were reasonable grounds to suspect it
  assessment_due_on       date generated always as (suspected_on + 30) stored,
  occurred_on             date,
  description             text not null check (char_length(btrim(description)) >= 10),
  cause                   text check (cause is null or cause in ('malicious_cyber', 'malicious_other', 'system_fault', 'human_error')),
  info_kinds              text[] not null default '{}' check (app.valid_info_kinds(info_kinds)),
  individuals_affected    integer check (individuals_affected is null or individuals_affected >= 0),
  contained_at            timestamptz,
  remedial_action         text,
  -- Assessment
  eligible                boolean,           -- null: not yet assessed
  assessment_basis        text,
  assessed_by             uuid references auth.users (id) on delete set null,
  assessed_at             timestamptz,
  -- Notification
  oaic_notified_at        timestamptz,
  oaic_reference          text,
  individuals_notified_at timestamptz,
  notify_option           text check (notify_option is null or notify_option in ('all', 'at_risk', 'publish')),
  notify_exception        text,              -- for example another entity notified (s 26WJ), or the enforcement body exception (s 26WN)
  -- Ransomware
  ransom_demanded         boolean not null default false,
  ransom_paid             boolean not null default false,
  ransom_paid_at          timestamptz,
  ransom_reported_at      timestamptz,
  ransom_reference        text,
  other_notifications     jsonb not null default '[]'::jsonb,               -- [{body, due_at, done_at, reference}]
  lessons                 text,
  status                  text not null default 'open' check (status in ('open', 'closed')),
  closed_at               timestamptz,
  reported_by             uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (not ransom_paid or ransom_demanded),
  check (not ransom_paid or ransom_paid_at is not null),
  check (jsonb_typeof(other_notifications) = 'array')
);
create index privacy_breaches_org_idx on public.privacy_breaches (organisation_id, status);

create table public.personal_info_holdings (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  entity_id          uuid references public.entities (id) on delete set null,
  name               text not null check (char_length(btrim(name)) between 2 and 200),    -- "Customer accounts", "Payroll"
  system             text,                  -- where it lives
  info_kinds         text[] not null default '{}' check (app.valid_info_kinds(info_kinds)),
  individuals        text check (individuals is null or individuals in ('under_1k', '1k_10k', '10k_100k', '100k_1m', 'over_1m')),
  whose              text,                  -- customers, employees, suppliers' staff
  purpose            text,
  collected_from     text,
  disclosed_to       text,
  overseas           text,                  -- countries where it is stored or accessed, if any
  retention          text,
  deletion           text,
  security_controls  text,
  owner_user_id      uuid references auth.users (id) on delete set null,
  review_on          date,
  status             text not null default 'active' check (status in ('active', 'retired')),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.automated_decisions (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  name               text not null check (char_length(btrim(name)) between 2 and 200),    -- "Credit limit engine"
  decision           text not null check (char_length(btrim(decision)) >= 5),            -- the kind of decision, in plain words
  role               text not null default 'solely' check (role in ('solely', 'substantially')),
  significant        boolean not null default true,     -- could reasonably be expected to significantly affect rights or interests
  info_kinds         text[] not null default '{}' check (app.valid_info_kinds(info_kinds)),
  info_detail        text,                  -- the kinds of personal information, in words for the policy
  holding_id         uuid references public.personal_info_holdings (id) on delete set null,
  human_review       text,                  -- how someone can ask a person to review it
  owner_user_id      uuid references auth.users (id) on delete set null,
  review_on          date,
  status             text not null default 'active' check (status in ('active', 'retired')),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create or replace function app.guard_privacy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_n jsonb;
begin
  -- (nested ifs: PL/pgSQL resolves every field in a condition, so a column only some tables have needs its own branch)
  if tg_table_name <> 'automated_decisions' then
    if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
      raise exception 'That company is not in this organisation';
    end if;
  end if;
  if tg_table_name <> 'privacy_breaches' then
    if new.owner_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
      raise exception 'The owner must be an active member of this organisation';
    end if;
    if tg_table_name = 'automated_decisions' then
      if new.holding_id is not null and not exists (select 1 from public.personal_info_holdings h where h.id = new.holding_id and h.organisation_id = new.organisation_id) then
        raise exception 'That holding is not in this organisation';
      end if;
    end if;
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
    return new;
  end if;

  -- Data breaches
  if new.suspected_on > current_date or new.occurred_on > current_date then
    raise exception 'A breach date cannot be in the future';
  end if;
  if new.occurred_on > new.suspected_on then
    raise exception 'It cannot have happened after it was suspected';
  end if;
  if greatest(new.oaic_notified_at, new.individuals_notified_at, new.ransom_paid_at, new.ransom_reported_at, new.contained_at) > now() + interval '1 hour' then
    raise exception 'A notification or payment time cannot be in the future';
  end if;
  for v_n in select * from jsonb_array_elements(new.other_notifications) loop
    if jsonb_typeof(v_n) <> 'object' or char_length(btrim(coalesce(v_n ->> 'body', ''))) < 2 then
      raise exception 'Each other notification needs the body it goes to';
    end if;
  end loop;
  if tg_op = 'INSERT' then
    new.reported_by := coalesce(auth.uid(), new.reported_by);
  end if;
  -- The reporter can describe it; only the privacy managers assess, notify and close
  if tg_op = 'UPDATE' and not app.has_role(new.organisation_id, app.privacy_managers())
     and (new.eligible, new.assessment_basis, new.oaic_notified_at, new.individuals_notified_at, new.notify_exception, new.ransom_paid, new.ransom_reported_at, new.status)
         is distinct from (old.eligible, old.assessment_basis, old.oaic_notified_at, old.individuals_notified_at, old.notify_exception, old.ransom_paid, old.ransom_reported_at, old.status) then
    raise exception 'Only the people who manage privacy can assess, notify or close a breach';
  end if;
  if tg_op = 'INSERT' and not app.has_role(new.organisation_id, app.privacy_managers())
     and (new.eligible is not null or new.oaic_notified_at is not null or new.status <> 'open') then
    raise exception 'Only the people who manage privacy can assess, notify or close a breach';
  end if;
  if new.eligible is not null and (tg_op = 'INSERT' or new.eligible is distinct from old.eligible) then
    if char_length(btrim(coalesce(new.assessment_basis, ''))) < 10 then
      raise exception 'Record the reasons for the assessment';
    end if;
    new.assessed_by := auth.uid();
    new.assessed_at := now();
  end if;
  if new.eligible is null and (new.oaic_notified_at is not null or new.individuals_notified_at is not null) then
    raise exception 'Assess it before recording a notification';
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    if new.eligible is null then
      raise exception 'Finish the assessment before closing it';
    end if;
    if new.eligible and new.oaic_notified_at is null then
      raise exception 'It is an eligible data breach: record when the OAIC was notified before closing it';
    end if;
    if new.eligible and new.individuals_notified_at is null and char_length(btrim(coalesce(new.notify_exception, ''))) < 5 then
      raise exception 'Record when the individuals were told, or the exception relied on, before closing it';
    end if;
    if new.ransom_paid and new.ransom_reported_at is null then
      raise exception 'A ransomware payment was made: record the report to the Australian Signals Directorate before closing it';
    end if;
    if exists (select 1 from jsonb_array_elements(new.other_notifications) n where nullif(n ->> 'done_at', '') is null) then
      raise exception 'Record every other notification as done (or remove it) before closing it';
    end if;
    new.closed_at := now();
  elsif new.status = 'open' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;
create trigger privacy_breaches_guard before insert or update on public.privacy_breaches for each row execute function app.guard_privacy();
create trigger personal_info_holdings_guard before insert or update on public.personal_info_holdings for each row execute function app.guard_privacy();
create trigger automated_decisions_guard before insert or update on public.automated_decisions for each row execute function app.guard_privacy();

-- ---------------------------------------------------------------------
-- Ladder up (no personal details)
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities', 'compliance_obligations', 'whs_incidents', 'whs_hazards', 'privacy_breaches'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%privacy_breaches%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    select 'privacy_breaches', pb.id, 'Privacy', app.risk_feed_category(p_review, array['privacy', 'data', 'cyber', 'technology', 'legal and compliance', 'legal', 'compliance']),
           case when pb.ransom_paid and pb.ransom_reported_at is null then 'Ransomware payment not yet reported to the Australian Signals Directorate'
                when pb.eligible and pb.oaic_notified_at is null then 'Eligible data breach not yet notified to the OAIC'
                else 'Possible data breach: assessment due ' || to_char(pb.assessment_due_on, 'FMDD Mon YYYY') end
           || ' (' || pb.title || ')',
           case when pb.ransom_paid and pb.ransom_reported_at is null then 'Report it within 72 hours of the payment'
                when pb.eligible and pb.oaic_notified_at is null then 'Notify the OAIC and the individuals as soon as practicable'
                else 'Finish the assessment within 30 days of suspecting it' end,
           null::text,
           case when pb.ransom_paid and pb.ransom_reported_at is null then (pb.ransom_paid_at + interval '72 hours')::date
                when pb.eligible and pb.oaic_notified_at is null then pb.assessed_at::date
                else pb.assessment_due_on end
    from public.privacy_breaches pb
    where pb.organisation_id = v_org and pb.status = 'open'
      and ((pb.ransom_paid and pb.ransom_reported_at is null)
           or (pb.eligible and pb.oaic_notified_at is null)
           or (pb.eligible is null and pb.assessment_due_on <= current_date + 7))
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%privacy_breaches%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: breach evidence, OAIC forms, holding and decision assessments (PIAs)
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%privacy_breaches%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''privacy_breaches'', ''personal_info_holdings'', ''automated_decisions''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%privacy_breaches%' then
    v_def := replace(v_def, $x$  elsif p_table = 'whs_incidents' then$x$, $x$  elsif p_table = 'privacy_breaches' then
    select b.organisation_id, (app.has_role(b.organisation_id, app.privacy_managers()) or b.reported_by = auth.uid()) into v_org, v_ok
    from public.privacy_breaches b where b.id = p_id;
  elsif p_table in ('personal_info_holdings', 'automated_decisions') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    v_ok := v_org is not null and app.has_role(v_org, app.privacy_managers());
  elsif p_table = 'whs_incidents' then$x$);
    if v_def not like '%privacy_breaches%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%privacy_breaches%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- Files on these records are restricted to the people who can see the record
create or replace function app.sensitive_subject(p_table text)
returns boolean language sql immutable as $$
  select p_table in ('expense_claims', 'dd_cases', 'share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles', 'investor_consents',
                     'bank_accounts', 'credit_facilities', 'corporate_documents', 'asic_filings', 'annual_reviews', 'obligation_completions',
                     'whs_incidents', 'whs_hazards', 'whs_due_diligence', 'privacy_breaches', 'personal_info_holdings', 'automated_decisions');
$$;
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.can_read_subject(text, uuid)'::regprocedure);
  if v_def not like '%privacy_breaches%' then
    v_def := replace(v_def, $x$  elsif p_table = 'whs_incidents' then$x$, $x$  elsif p_table = 'privacy_breaches' then
    return exists (select 1 from public.privacy_breaches b where b.id = p_id
                   and (app.has_role(b.organisation_id, app.privacy_managers()) or (b.reported_by = auth.uid() and app.is_member(b.organisation_id))));
  elsif p_table in ('personal_info_holdings', 'automated_decisions') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    return v_org is not null and (app.has_role(v_org, app.board_read_roles()) or app.has_role(v_org, array['auditor']::public.member_role[]));
  elsif p_table = 'whs_incidents' then$x$);
    if v_def not like '%privacy_breaches%' then
      raise exception 'Could not extend app.can_read_subject';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Fix to 0049: someone who can see a sensitive record (a director on the
-- share register, or the person who reported an incident or breach) could open
-- its files but not see them listed, because the documents policy did not
-- follow the record. The policy now uses the same test as opening the file.
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated using (app.can_read_document(id));

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.privacy_breaches, public.personal_info_holdings, public.automated_decisions from anon, authenticated;
grant select on public.privacy_breaches, public.personal_info_holdings, public.automated_decisions to authenticated;
grant insert (organisation_id, entity_id, title, suspected_on, occurred_on, description, cause, info_kinds, individuals_affected, contained_at, remedial_action,
              ransom_demanded),
      update (entity_id, title, suspected_on, occurred_on, description, cause, info_kinds, individuals_affected, contained_at, remedial_action,
              eligible, assessment_basis, oaic_notified_at, oaic_reference, individuals_notified_at, notify_option, notify_exception,
              ransom_demanded, ransom_paid, ransom_paid_at, ransom_reported_at, ransom_reference, other_notifications, lessons, status)
  on public.privacy_breaches to authenticated;
grant insert (organisation_id, entity_id, name, system, info_kinds, individuals, whose, purpose, collected_from, disclosed_to, overseas, retention, deletion,
              security_controls, owner_user_id, review_on, status),
      update (entity_id, name, system, info_kinds, individuals, whose, purpose, collected_from, disclosed_to, overseas, retention, deletion,
              security_controls, owner_user_id, review_on, status)
  on public.personal_info_holdings to authenticated;
grant insert (organisation_id, name, decision, role, significant, info_kinds, info_detail, holding_id, human_review, owner_user_id, review_on, status),
      update (name, decision, role, significant, info_kinds, info_detail, holding_id, human_review, owner_user_id, review_on, status)
  on public.automated_decisions to authenticated;
grant all on public.privacy_breaches, public.personal_info_holdings, public.automated_decisions to service_role;

alter table public.privacy_breaches enable row level security;
alter table public.personal_info_holdings enable row level security;
alter table public.automated_decisions enable row level security;
-- Anyone can report a possible breach; only the privacy managers and the reporter see it
create policy privacy_breaches_select on public.privacy_breaches for select to authenticated
  using (app.has_role(organisation_id, app.privacy_managers()) or (reported_by = auth.uid() and app.is_member(organisation_id)));
create policy privacy_breaches_insert on public.privacy_breaches for insert to authenticated with check (app.is_member(organisation_id));
create policy privacy_breaches_update on public.privacy_breaches for update to authenticated
  using (app.has_role(organisation_id, app.privacy_managers()) or (reported_by = auth.uid() and status = 'open' and app.is_member(organisation_id)))
  with check (app.has_role(organisation_id, app.privacy_managers()) or (reported_by = auth.uid() and app.is_member(organisation_id)));
-- Holdings and automated decisions describe systems and their security: the board, auditors and owners see them
create policy personal_info_holdings_select on public.personal_info_holdings for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or owner_user_id = auth.uid());
create policy personal_info_holdings_insert on public.personal_info_holdings for insert to authenticated with check (app.has_role(organisation_id, app.privacy_managers()));
create policy personal_info_holdings_update on public.personal_info_holdings for update to authenticated
  using (app.has_role(organisation_id, app.privacy_managers()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.privacy_managers()) or owner_user_id = auth.uid());
create policy automated_decisions_select on public.automated_decisions for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or owner_user_id = auth.uid());
create policy automated_decisions_insert on public.automated_decisions for insert to authenticated with check (app.has_role(organisation_id, app.privacy_managers()));
create policy automated_decisions_update on public.automated_decisions for update to authenticated
  using (app.has_role(organisation_id, app.privacy_managers()) or owner_user_id = auth.uid())
  with check (app.has_role(organisation_id, app.privacy_managers()) or owner_user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array['privacy_breaches', 'personal_info_holdings', 'automated_decisions'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
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
