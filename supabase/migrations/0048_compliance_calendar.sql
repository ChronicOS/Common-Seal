-- 0048: Compliance calendar.
--
-- One calendar of every compliance date. Most dates already live in their own
-- modules (ASIC filings, the annual review, employee share scheme reporting,
-- insurance renewals, IP renewals, facility reviews, contract notice dates,
-- sanctions re-screens, policy reviews, the modern slavery statement, training,
-- legal audit actions, risk reviews, meetings). The app gathers those.
--
-- This migration adds the obligations that live nowhere else: recurring
-- duties such as BAS, FBT, payroll tax, the taxable payments annual report,
-- Payment Times reporting or NGER. Each has a frequency, a first due date, an
-- owner, the law or regulator it comes from, and a record of each period
-- completed (with evidence files), or marked not applicable with a reason.
--
-- Ladder up: an obligation with a period past due and not completed feeds the
-- Risk Register; obligations due within 14 days appear under For you for
-- their owner.

create table public.compliance_obligations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  entity_id       uuid references public.entities (id) on delete cascade,     -- null: the whole group
  title           text not null check (char_length(btrim(title)) between 3 and 200),
  category        text not null default 'other' check (category in ('corporate', 'tax', 'employment', 'financial_reporting', 'whs', 'privacy',
                                                                   'environment', 'industry', 'governance', 'other')),
  regulator       text,
  law             text,          -- the law or rule it comes from
  frequency       text not null default 'annually' check (frequency in ('once', 'monthly', 'quarterly', 'half_yearly', 'annually')),
  first_due_on    date not null,
  ends_on         date,
  due_rule        text,          -- in words, for example "28 days after the end of each quarter"
  owner_user_id   uuid references auth.users (id) on delete set null,
  template_key    text,
  notes           text,
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_on is null or ends_on >= first_due_on)
);
create index compliance_obligations_org_idx on public.compliance_obligations (organisation_id) where is_active;

create table public.obligation_completions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  obligation_id   uuid not null references public.compliance_obligations (id) on delete cascade,
  due_on          date not null,          -- which occurrence
  done_on         date,
  not_applicable  boolean not null default false,
  notes           text,
  done_by         uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (obligation_id, due_on),
  check (not_applicable or done_on is not null),
  check (not not_applicable or char_length(btrim(coalesce(notes, ''))) >= 5)
);

-- Every due date of an obligation from its start up to a date. Each is counted from the first
-- (31 October, 31 January, 30 April, 31 July), so month-end dates do not drift.
create or replace function app.obligation_dates(p_first date, p_frequency text, p_ends date, p_upto date)
returns setof date language sql immutable as $$
  select d from (
    select (p_first + i * case p_frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                                           when 'half_yearly' then interval '6 months' else interval '1 year' end)::date as d
    from generate_series(0, case when p_frequency = 'once' then 0 else 1200 end) i
  ) x
  where d <= p_upto and (p_ends is null or d <= p_ends);
$$;

create or replace function app.guard_obligation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'compliance_obligations' then
    if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
      raise exception 'That company is not in this organisation';
    end if;
    if new.owner_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
      raise exception 'The owner must be an active member of this organisation';
    end if;
    if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  else
    if not exists (select 1 from public.compliance_obligations o where o.id = new.obligation_id and o.organisation_id = new.organisation_id
                   and new.due_on in (select app.obligation_dates(o.first_due_on, o.frequency, o.ends_on, new.due_on))) then
      raise exception 'That is not one of this obligation''s due dates';
    end if;
    if new.done_on is not null and new.done_on > current_date then
      raise exception 'The date done cannot be in the future';
    end if;
    new.done_by := coalesce(auth.uid(), new.done_by);
  end if;
  return new;
end;
$$;
create trigger compliance_obligations_guard before insert or update on public.compliance_obligations for each row execute function app.guard_obligation();
create trigger obligation_completions_guard before insert or update on public.obligation_completions for each row execute function app.guard_obligation();

create or replace function app.is_obligation_owner(p_obligation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.compliance_obligations o where o.id = p_obligation and o.owner_user_id = auth.uid() and app.is_member(o.organisation_id));
$$;

-- ---------------------------------------------------------------------
-- Ladder up: obligations with a period past due and not completed
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities', 'compliance_obligations'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%compliance_obligations%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Compliance calendar: the earliest missed period of each obligation (last two years)
    select 'compliance_obligations', ob.id, 'Compliance calendar', v_legal,
           'Compliance obligation overdue: ' || ob.title || coalesce(' (' || en.name || ')', '')
           || E'\n' || 'Due ' || to_char(miss.first_missed, 'FMDD Mon YYYY') || case when miss.n > 1 then ' and ' || (miss.n - 1) || ' later period(s) also not recorded as done' else '' end
           || coalesce(' · ' || ob.regulator, ''),
           'Complete it, or record why it does not apply',
           (select coalesce(nullif(btrim(p.full_name), ''), u.email)::text from auth.users u left join public.people p on p.user_id = u.id and p.organisation_id = v_org where u.id = ob.owner_user_id limit 1),
           miss.first_missed
    from public.compliance_obligations ob
    left join public.entities en on en.id = ob.entity_id
    cross join lateral (
      select min(d) as first_missed, count(*) as n
      from app.obligation_dates(ob.first_due_on, ob.frequency, ob.ends_on, current_date - 1) d
      where d >= current_date - 730
        and not exists (select 1 from public.obligation_completions oc where oc.obligation_id = ob.id and oc.due_on = d)
    ) miss
    where ob.organisation_id = v_org and ob.is_active and miss.first_missed is not null
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%compliance_obligations%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: evidence for a completed period
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%obligation_completions%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''obligation_completions''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%obligation_completions%' then
    v_def := replace(v_def, $x$  elsif p_table in ('corporate_documents',$x$, $x$  elsif p_table = 'obligation_completions' then
    select c.organisation_id, (app.has_role(c.organisation_id, app.records_roles()) or app.is_obligation_owner(c.obligation_id)) into v_org, v_ok
    from public.obligation_completions c where c.id = p_id;
  elsif p_table in ('corporate_documents',$x$);
    if v_def not like '%obligation_completions%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%obligation_completions%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.compliance_obligations, public.obligation_completions from anon, authenticated;
grant select on public.compliance_obligations, public.obligation_completions to authenticated;
grant insert (organisation_id, entity_id, title, category, regulator, law, frequency, first_due_on, ends_on, due_rule, owner_user_id, template_key, notes, is_active),
      update (entity_id, title, category, regulator, law, frequency, first_due_on, ends_on, due_rule, owner_user_id, notes, is_active)
  on public.compliance_obligations to authenticated;
grant insert (organisation_id, obligation_id, due_on, done_on, not_applicable, notes),
      update (done_on, not_applicable, notes)
  on public.obligation_completions to authenticated;
grant all on public.compliance_obligations, public.obligation_completions to service_role;

alter table public.compliance_obligations enable row level security;
alter table public.obligation_completions enable row level security;
create policy compliance_obligations_select on public.compliance_obligations for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or owner_user_id = auth.uid());
create policy compliance_obligations_insert on public.compliance_obligations for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy compliance_obligations_update on public.compliance_obligations for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy obligation_completions_select on public.obligation_completions for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or app.is_obligation_owner(obligation_id));
create policy obligation_completions_insert on public.obligation_completions for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_obligation_owner(obligation_id));
create policy obligation_completions_update on public.obligation_completions for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));

create trigger compliance_obligations_touch before update on public.compliance_obligations for each row execute function app.touch_updated_at();
create trigger compliance_obligations_audit after insert or update or delete on public.compliance_obligations for each row execute function app.audit_row();
create trigger obligation_completions_audit after insert or update or delete on public.obligation_completions for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
grant execute on function app.can_read_ownership(uuid) to authenticated;
grant execute on function app.can_read_finance(uuid) to authenticated;
grant execute on function app.can_read_register(uuid) to authenticated;
grant execute on function app.is_obligation_owner(uuid) to authenticated;
