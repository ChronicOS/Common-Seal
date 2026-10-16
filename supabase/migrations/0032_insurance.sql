-- 0032: Insurance register.
--
-- One row per policy term: type, insurer, broker, policy number, insured
-- company (or the whole group), limit and excess, currency period, and
-- details. Certificates of currency attach to the row as evidence (through
-- document_links, like other files). Renewing creates the next term and
-- marks the old one renewed, so the history stays.
--
-- Each policy has a responsible person: the directors collectively (the
-- default) or a named member. Reminders fall due 3, 2 and 1 months before
-- the period ends. The app shows them to send and records when each was
-- sent; nothing is emailed by the database.

create table public.insurance_policies (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  entity_id             uuid references public.entities (id) on delete set null,   -- null = the whole group
  policy_type           text not null check (char_length(btrim(policy_type)) between 2 and 120),
  insurer               text,
  broker                text,
  policy_number         text,
  insured_name          text,
  limit_amount          numeric(16, 2) check (limit_amount is null or limit_amount >= 0),
  limit_basis           text,           -- e.g. any one claim, in the aggregate
  excess_amount         numeric(16, 2) check (excess_amount is null or excess_amount >= 0),
  currency              text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  premium_amount        numeric(16, 2) check (premium_amount is null or premium_amount >= 0),
  period_from           date,
  period_to             date not null,
  details               text,
  responsible_user_id   uuid references auth.users (id) on delete set null,  -- null = the directors collectively
  status                text not null default 'current' check (status in ('current', 'renewed', 'lapsed', 'cancelled')),
  previous_id           uuid references public.insurance_policies (id) on delete set null,
  reminder3_sent_at     timestamptz,
  reminder2_sent_at     timestamptz,
  reminder1_sent_at     timestamptz,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (period_from is null or period_to > period_from)
);
create index insurance_policies_org_idx on public.insurance_policies (organisation_id, period_to);

create or replace function app.guard_insurance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if new.responsible_user_id is not null and not exists (
       select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.responsible_user_id and m.is_active) then
    raise exception 'The responsible person must be an active member of this organisation';
  end if;
  if tg_op = 'UPDATE' then
    if new.organisation_id <> old.organisation_id then
      raise exception 'A policy cannot move to another organisation';
    end if;
    -- A new end date starts the reminders again
    if new.period_to is distinct from old.period_to then
      new.reminder3_sent_at := null; new.reminder2_sent_at := null; new.reminder1_sent_at := null;
    end if;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;
create trigger insurance_policies_guard before insert or update on public.insurance_policies
  for each row execute function app.guard_insurance();

-- Renew: the next term, copying the details; the old term is marked renewed
create or replace function public.renew_insurance(p_policy uuid, p_from date, p_to date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.insurance_policies%rowtype;
  v_id uuid;
begin
  select * into p from public.insurance_policies where id = p_policy for update;
  if p.id is null or not app.has_role(p.organisation_id, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can renew a policy';
  end if;
  if p.status <> 'current' then
    raise exception 'Only a current policy can be renewed';
  end if;
  if p_to is null or (p_from is not null and p_to <= p_from) or p_to <= p.period_to then
    raise exception 'The new period must end after the current one';
  end if;
  insert into public.insurance_policies (organisation_id, entity_id, policy_type, insurer, broker, policy_number, insured_name, limit_amount, limit_basis,
                                         excess_amount, currency, premium_amount, period_from, period_to, details, responsible_user_id, previous_id)
  values (p.organisation_id, p.entity_id, p.policy_type, p.insurer, p.broker, p.policy_number, p.insured_name, p.limit_amount, p.limit_basis,
          p.excess_amount, p.currency, null, coalesce(p_from, p.period_to), p_to, p.details, p.responsible_user_id, p.id)
  returning id into v_id;
  update public.insurance_policies set status = 'renewed' where id = p.id;
  return v_id;
end;
$$;

-- Records that a reminder (3, 2 or 1 months before expiry) has been sent
create or replace function public.mark_insurance_reminder_sent(p_policy uuid, p_months integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.insurance_policies where id = p_policy;
  if v_org is null or not (app.has_role(v_org, app.records_roles())
                           or exists (select 1 from public.insurance_policies x where x.id = p_policy and x.responsible_user_id = auth.uid())) then
    raise exception 'You do not have permission to do this';
  end if;
  if p_months not in (1, 2, 3) then
    raise exception 'Reminders are 3, 2 or 1 months before expiry';
  end if;
  -- Sending a later reminder covers the earlier ones too
  update public.insurance_policies set
    reminder3_sent_at = coalesce(reminder3_sent_at, now()),
    reminder2_sent_at = case when p_months <= 2 then coalesce(reminder2_sent_at, now()) else reminder2_sent_at end,
    reminder1_sent_at = case when p_months = 1 then coalesce(reminder1_sent_at, now()) else reminder1_sent_at end
  where id = p_policy;
end;
$$;

-- Certificates of currency attach to policies
alter table public.document_links drop constraint document_links_subject_table_check;
alter table public.document_links add constraint document_links_subject_table_check check (subject_table in
  ('expense_claims', 'contracts', 'policies', 'workflow_run_steps', 'register_entries', 'dd_cases', 'ms_statements', 'insurance_policies'));

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%insurance_policies%' then
    v_def := replace(v_def, $x$  else
    raise exception 'Files cannot be attached to that kind of record';$x$, $x$  elsif p_table = 'insurance_policies' then
    select i.organisation_id, app.has_role(i.organisation_id, app.records_roles()) into v_org, v_ok
    from public.insurance_policies i where i.id = p_id;
  else
    raise exception 'Files cannot be attached to that kind of record';$x$);
    if v_def not like '%insurance_policies%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;

revoke all on public.insurance_policies from anon, authenticated;
grant select on public.insurance_policies to authenticated;
grant insert (organisation_id, entity_id, policy_type, insurer, broker, policy_number, insured_name, limit_amount, limit_basis, excess_amount,
              currency, premium_amount, period_from, period_to, details, responsible_user_id),
      update (entity_id, policy_type, insurer, broker, policy_number, insured_name, limit_amount, limit_basis, excess_amount,
              currency, premium_amount, period_from, period_to, details, responsible_user_id, status)
  on public.insurance_policies to authenticated;
grant all on public.insurance_policies to service_role;

alter table public.insurance_policies enable row level security;
create policy insurance_policies_select on public.insurance_policies for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[])
         or responsible_user_id = auth.uid());
create policy insurance_policies_insert on public.insurance_policies for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy insurance_policies_update on public.insurance_policies for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()) and status in ('current', 'lapsed', 'cancelled', 'renewed'));

create trigger insurance_policies_touch before update on public.insurance_policies for each row execute function app.touch_updated_at();
create trigger insurance_policies_audit after insert or update or delete on public.insurance_policies for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
revoke execute on function public.renew_insurance(uuid, date, date), public.mark_insurance_reminder_sent(uuid, integer) from public, anon;
grant execute on function public.renew_insurance(uuid, date, date), public.mark_insurance_reminder_sent(uuid, integer) to authenticated;
