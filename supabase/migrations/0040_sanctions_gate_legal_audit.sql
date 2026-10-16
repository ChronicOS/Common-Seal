-- 0040: The sanctions decision gates contract approval, and the Legal Audit.
--
-- Contract approval is now blocked when the third party's latest sanctions
-- assessment is not yet decided, was decided "do not proceed", needs a permit
-- that has not been recorded, or is overdue for re-screening. A party with no
-- sanctions assessment (or no due diligence) is flagged in the app, not blocked.
--
-- Legal Audit: a periodic legal compliance review of a company or country,
-- carried out with local management (general manager, finance director). Each
-- question is answered yes / no / not applicable, with comments and the person
-- responsible; agreed actions have an owner and a date. It is signed off by name
-- and title once every question is answered and every adverse answer has a
-- comment or an action. Signed off, it is locked; its open actions feed the Risk
-- Register under Legal and Compliance.

-- ---------------------------------------------------------------------
-- Contract gate: sanctions
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.decide_contract_approval(uuid, boolean, text)'::regprocedure);
  if v_def not like '%sanctions assessment%' then
    v_def := replace(v_def, $x$      raise exception 'Blocked: % has mitigations to complete before the engagement', v_party.name using errcode = 'P0001';
    end if;$x$, $x$      raise exception 'Blocked: % has mitigations to complete before the engagement', v_party.name using errcode = 'P0001';
    end if;
    declare
      s public.sanctions_assessments%rowtype;
    begin
      select * into s from public.sanctions_assessments x
      where x.counterparty_id = v_party.id and x.status <> 'withdrawn'
      order by x.created_at desc limit 1;
      if s.id is not null then
        if s.status in ('draft', 'submitted') then
          raise exception 'Blocked: the sanctions assessment of % is not decided', v_party.name using errcode = 'P0001';
        elsif s.outcome = 'do_not_proceed' then
          raise exception 'Blocked: the sanctions decision for % is do not proceed', v_party.name using errcode = 'P0001';
        elsif s.outcome = 'licence_required' and s.licence_reference is null then
          raise exception 'Blocked: % needs a sanctions permit or licence first', v_party.name using errcode = 'P0001';
        elsif s.next_screen_on is not null and s.next_screen_on < current_date then
          raise exception 'Blocked: the sanctions re-screen of % is overdue', v_party.name using errcode = 'P0001';
        end if;
      end if;
    end;$x$);
    if v_def not like '%sanctions assessment%' then
      raise exception 'Could not extend public.decide_contract_approval (run 0039 first)';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Legal Audit
-- ---------------------------------------------------------------------
-- Question keys and the answer that needs a comment or an action. The wording lives in the app.
create or replace function app.legal_audit_questions()
returns table (key text, adverse text, optional boolean) language sql immutable as $$
  values
    ('a1_competition', 'no', false), ('a1_product_regulation', 'no', false), ('a1_claims_advertising', 'no', false), ('a1_ip', 'no', false),
    ('a1_tax', 'no', false), ('a1_environment', 'no', false), ('a1_company_law', 'no', false), ('a1_whs', 'no', false),
    ('a1_employment', 'no', false), ('a1_privacy', 'no', false), ('a1_sanctions_export', 'no', false), ('a1_anti_bribery', 'no', false),
    ('a1_other', 'no', true),
    ('a2_management_review', 'no', false), ('a3_training_needs', 'yes', false),
    ('b4_group_notification', 'no', false),
    ('c5_retention', 'no', false), ('c6_delegations', 'no', false), ('c7_code', 'no', false),
    ('d8_dawn_raid', 'no', false), ('d9_competition_programme', 'no', false), ('d10_trade_associations', 'yes', false), ('d11_category_management', 'yes', false),
    ('e12_originals', 'no', false),
    ('e13_acquisitions', 'no', false), ('e13_property', 'no', false), ('e13_supply', 'no', false), ('e13_international', 'no', false), ('e13_it', 'no', false),
    ('e14_terms', 'no', false), ('e15_ip_ownership', 'no', false), ('e16_onerous', 'yes', false), ('e17_terminations', 'no', false),
    ('e18_employment_contracts', 'no', false), ('e18_employee_disputes', 'yes', false),
    ('f19_major_litigation', 'yes', false), ('f20_investigations', 'yes', false);
$$;

create table public.legal_audits (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  entity_id          uuid references public.entities (id) on delete set null,
  country            text,
  title              text not null check (char_length(btrim(title)) between 3 and 200),
  audit_date         date not null default current_date,
  auditor_name       text,
  with_names         text,          -- carried out with: general manager, finance director, legal director
  management_comments text,
  status             text not null default 'open' check (status in ('open', 'signed_off')),
  signed_off_name    text,
  signed_off_title   text,
  signed_off_at      timestamptz,
  signed_off_by      uuid references auth.users (id) on delete set null,
  previous_id        uuid references public.legal_audits (id) on delete set null,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index legal_audits_org_idx on public.legal_audits (organisation_id, audit_date desc);

create table public.legal_audit_answers (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  audit_id         uuid not null references public.legal_audits (id) on delete cascade,
  question_key     text not null,
  answer           text check (answer in ('yes', 'no', 'na')),
  response         text,
  responsible      text,
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (audit_id, question_key)
);

create table public.legal_audit_actions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  audit_id         uuid not null references public.legal_audits (id) on delete cascade,
  question_key     text,
  action           text not null check (char_length(btrim(action)) >= 5),
  owner_name       text,
  due_on           date,
  done_at          timestamptz,
  done_note        text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index legal_audit_actions_audit_idx on public.legal_audit_actions (audit_id);

create or replace function app.guard_legal_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.legal_audit_system', true), 'off') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'open'; new.signed_off_name := null; new.signed_off_title := null; new.signed_off_at := null; new.signed_off_by := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    if new.organisation_id <> old.organisation_id then
      raise exception 'An audit cannot move to another organisation';
    end if;
    if old.status = 'signed_off' then
      raise exception 'This audit is signed off and locked';
    end if;
    if (new.status, new.signed_off_name, new.signed_off_title, new.signed_off_at, new.signed_off_by)
       is distinct from (old.status, old.signed_off_name, old.signed_off_title, old.signed_off_at, old.signed_off_by) then
      raise exception 'Use Sign off to sign off the audit';
    end if;
  end if;
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  return new;
end;
$$;
create trigger legal_audits_guard before insert or update on public.legal_audits for each row execute function app.guard_legal_audit();

-- Answers and actions follow their audit: editable while open; actions can be completed after sign-off
create or replace function app.guard_legal_audit_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_audit public.legal_audits%rowtype;
begin
  select * into v_audit from public.legal_audits a where a.id = coalesce(new.audit_id, old.audit_id);
  if tg_op <> 'DELETE' then
    new.organisation_id := v_audit.organisation_id;
  end if;
  if v_audit.status = 'signed_off' then
    -- After sign-off only an action's completion can change
    if tg_table_name = 'legal_audit_actions' and tg_op = 'UPDATE' then
      if (to_jsonb(new) - 'done_at' - 'done_note') = (to_jsonb(old) - 'done_at' - 'done_note') then
        new.done_at := case when new.done_at is not null and old.done_at is null then now() else new.done_at end;
        return new;
      end if;
    end if;
    raise exception 'This audit is signed off and locked';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_table_name = 'legal_audit_answers' then
    if not exists (select 1 from app.legal_audit_questions() q where q.key = new.question_key) then
      raise exception 'Unknown question';
    end if;
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;
create trigger legal_audit_answers_guard before insert or update or delete on public.legal_audit_answers for each row execute function app.guard_legal_audit_child();
create trigger legal_audit_actions_guard before insert or update or delete on public.legal_audit_actions for each row execute function app.guard_legal_audit_child();

create or replace function public.sign_off_legal_audit(p_audit uuid, p_name text, p_title text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.legal_audits%rowtype;
  v_missing integer;
  v_unexplained integer;
begin
  select * into a from public.legal_audits where id = p_audit for update;
  if a.id is null or not (app.has_role(a.organisation_id, app.records_roles()) or app.has_role(a.organisation_id, array['director']::public.member_role[])) then
    raise exception 'You do not have permission to sign off this audit';
  end if;
  if a.status <> 'open' then
    raise exception 'This audit is already signed off';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 3 or char_length(btrim(coalesce(p_title, ''))) < 2 then
    raise exception 'Give the name and title of the person signing off';
  end if;
  select count(*) into v_missing from app.legal_audit_questions() q
  where not q.optional and not exists (select 1 from public.legal_audit_answers x where x.audit_id = a.id and x.question_key = q.key and x.answer is not null);
  if v_missing > 0 then
    raise exception '% questions are not answered yet', v_missing;
  end if;
  select count(*) into v_unexplained from app.legal_audit_questions() q
  join public.legal_audit_answers x on x.audit_id = a.id and x.question_key = q.key and x.answer = q.adverse
  where char_length(btrim(coalesce(x.response, ''))) < 3
    and not exists (select 1 from public.legal_audit_actions t where t.audit_id = a.id and t.question_key = q.key);
  if v_unexplained > 0 then
    raise exception '% answers need a comment or an agreed action before sign-off', v_unexplained;
  end if;
  perform set_config('app.legal_audit_system', 'on', true);
  update public.legal_audits set status = 'signed_off', signed_off_name = btrim(p_name), signed_off_title = btrim(p_title),
    signed_off_at = now(), signed_off_by = auth.uid() where id = a.id;
  perform set_config('app.legal_audit_system', 'off', true);
end;
$$;

-- Starts the next audit from a signed-off one: same company, answers copied to confirm or change
create or replace function public.start_legal_audit_from(p_previous uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.legal_audits%rowtype;
  v_id uuid;
begin
  select * into p from public.legal_audits where id = p_previous;
  if p.id is null or not app.has_role(p.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  insert into public.legal_audits (organisation_id, entity_id, country, title, auditor_name, with_names, previous_id)
  values (p.organisation_id, p.entity_id, p.country, coalesce(nullif(btrim(coalesce(p_title, '')), ''), p.title || ' (follow-up)'), p.auditor_name, p.with_names, p.id)
  returning id into v_id;
  insert into public.legal_audit_answers (organisation_id, audit_id, question_key, answer, response, responsible)
  select p.organisation_id, v_id, x.question_key, x.answer, x.response, x.responsible from public.legal_audit_answers x where x.audit_id = p.id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up: open actions from signed-off audits
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions'));

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%legal_audit_actions%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Legal audit: agreed actions still open after sign-off
    select 'legal_audit_actions', t.id, 'Legal Audit', v_legal,
           'Legal audit action: ' || t.action || E'\n' || a.title
           || coalesce(' · ' || (select e.name from public.entities e where e.id = a.entity_id), '') || coalesce(' · ' || a.country, ''),
           t.action, t.owner_name, t.due_on
    from public.legal_audit_actions t join public.legal_audits a on a.id = t.audit_id
    where a.organisation_id = v_org and a.status = 'signed_off' and t.done_at is null
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%legal_audit_actions%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.legal_audits, public.legal_audit_answers, public.legal_audit_actions from anon, authenticated;
grant select on public.legal_audits, public.legal_audit_answers, public.legal_audit_actions to authenticated;
grant insert (organisation_id, entity_id, country, title, audit_date, auditor_name, with_names, management_comments),
      update (entity_id, country, title, audit_date, auditor_name, with_names, management_comments) on public.legal_audits to authenticated;
grant insert (organisation_id, audit_id, question_key, answer, response, responsible), update (answer, response, responsible) on public.legal_audit_answers to authenticated;
grant insert (organisation_id, audit_id, question_key, action, owner_name, due_on), update (action, owner_name, due_on, done_at, done_note), delete on public.legal_audit_actions to authenticated;
grant all on public.legal_audits, public.legal_audit_answers, public.legal_audit_actions to service_role;

alter table public.legal_audits enable row level security;
alter table public.legal_audit_answers enable row level security;
alter table public.legal_audit_actions enable row level security;

create policy legal_audits_select on public.legal_audits for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]));
create policy legal_audits_insert on public.legal_audits for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy legal_audits_update on public.legal_audits for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy legal_audit_answers_select on public.legal_audit_answers for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]));
create policy legal_audit_answers_insert on public.legal_audit_answers for insert to authenticated
  with check (exists (select 1 from public.legal_audits a where a.id = audit_id and app.has_role(a.organisation_id, app.records_roles())));
create policy legal_audit_answers_update on public.legal_audit_answers for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy legal_audit_actions_select on public.legal_audit_actions for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]));
create policy legal_audit_actions_insert on public.legal_audit_actions for insert to authenticated
  with check (exists (select 1 from public.legal_audits a where a.id = audit_id and app.has_role(a.organisation_id, app.records_roles())));
create policy legal_audit_actions_update on public.legal_audit_actions for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy legal_audit_actions_delete on public.legal_audit_actions for delete to authenticated using (app.has_role(organisation_id, app.records_roles()));

create trigger legal_audits_touch before update on public.legal_audits for each row execute function app.touch_updated_at();
create trigger legal_audits_audit after insert or update or delete on public.legal_audits for each row execute function app.audit_row();
create trigger legal_audit_answers_audit after insert or update or delete on public.legal_audit_answers for each row execute function app.audit_row();
create trigger legal_audit_actions_audit after insert or update or delete on public.legal_audit_actions for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function public.sign_off_legal_audit(uuid, text, text), public.start_legal_audit_from(uuid, text) from public, anon;
grant execute on function public.sign_off_legal_audit(uuid, text, text), public.start_legal_audit_from(uuid, text) to authenticated;
