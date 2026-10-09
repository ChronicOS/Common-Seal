-- =====================================================================
-- Common Seal - 0017: modern slavery statement
--
-- One statement per reporting period, written against the seven
-- mandatory criteria, backed by supplier risk reviews, approved by the
-- board and then lodged. Approved wording is fixed.
-- =====================================================================

create type public.ms_status as enum ('draft', 'approved', 'lodged');

create table public.ms_statements (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  reporting_entity_id  uuid not null references public.entities (id) on delete restrict,
  period_start         date not null,
  period_end           date not null check (period_end > period_start),
  -- A statement is due within six months of the end of the reporting period
  due_on               date not null,
  status               public.ms_status not null default 'draft',
  approved_body        text,
  approved_on          date,
  signed_by            text,
  signed_role          text,
  lodged_on            date,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (reporting_entity_id, period_end)
);
create index ms_statements_org_idx on public.ms_statements (organisation_id, status);

create table public.ms_sections (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  statement_id     uuid not null references public.ms_statements (id) on delete cascade,
  criterion        integer not null check (criterion between 1 and 7),
  content          text not null default '',
  updated_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  unique (statement_id, criterion)
);

create table public.ms_supplier_reviews (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  statement_id     uuid not null references public.ms_statements (id) on delete cascade,
  counterparty_id  uuid not null references public.counterparties (id) on delete restrict,
  answers          jsonb not null default '{}'::jsonb,
  risk             public.risk_level not null,
  actions          text,
  reviewed_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (statement_id, counterparty_id)
);

-- The rating rule, kept in one place:
--   high   - a known incident, or a higher-risk country together with vulnerable labour or a higher-risk sector
--   medium - any one of those three, or no policy of their own
--   low    - none of them
create or replace function app.ms_rating(p_answers jsonb)
returns public.risk_level language sql immutable set search_path = '' as $$
  select case
    when coalesce((p_answers ->> 'known_incident')::boolean, false) then 'high'
    when coalesce((p_answers ->> 'higher_risk_country')::boolean, false)
         and (coalesce((p_answers ->> 'vulnerable_labour')::boolean, false)
              or coalesce((p_answers ->> 'higher_risk_sector')::boolean, false)) then 'high'
    when coalesce((p_answers ->> 'higher_risk_country')::boolean, false)
         or coalesce((p_answers ->> 'vulnerable_labour')::boolean, false)
         or coalesce((p_answers ->> 'higher_risk_sector')::boolean, false)
         or not coalesce((p_answers ->> 'has_policy')::boolean, false) then 'medium'
    else 'low' end::public.risk_level;
$$;

create or replace function app.guard_ms_statement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := coalesce(current_setting('app.ms_system', true), 'off') = 'on';
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.entities e where e.id = new.reporting_entity_id and e.organisation_id = new.organisation_id) then
      raise exception 'The reporting entity must belong to this organisation';
    end if;
    new.status := 'draft';
    new.due_on := (new.period_end + interval '6 months')::date;
    new.approved_body := null; new.approved_on := null; new.signed_by := null; new.signed_role := null; new.lodged_on := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if not v_system then
    raise exception 'A statement changes only through its sections, approval and lodgement';
  end if;
  return new;
end;
$$;
create trigger ms_statements_guard before insert or update on public.ms_statements
  for each row execute function app.guard_ms_statement();

-- Sections and supplier reviews are fixed once the statement is approved
create or replace function app.guard_ms_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_s public.ms_statements%rowtype;
  v_id uuid := case when tg_op = 'DELETE' then old.statement_id else new.statement_id end;
begin
  select * into v_s from public.ms_statements s where s.id = v_id;
  if v_s.id is null then
    return coalesce(new, old);
  end if;
  if v_s.status <> 'draft' then
    raise exception 'The statement has been approved and can no longer be changed';
  end if;
  if tg_op <> 'DELETE' then
    new.organisation_id := v_s.organisation_id;
    if tg_table_name = 'ms_supplier_reviews' then
      if not exists (select 1 from public.counterparties c where c.id = new.counterparty_id and c.organisation_id = v_s.organisation_id) then
        raise exception 'The supplier must belong to this organisation';
      end if;
      new.risk := app.ms_rating(new.answers);
      new.reviewed_by := auth.uid();
    else
      new.updated_by := auth.uid();
      new.updated_at := now();
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger ms_sections_guard before insert or update or delete on public.ms_sections
  for each row execute function app.guard_ms_child();
create trigger ms_supplier_reviews_guard before insert or update or delete on public.ms_supplier_reviews
  for each row execute function app.guard_ms_child();

create or replace function public.approve_ms_statement(
  p_statement uuid, p_body text, p_approved_on date, p_signed_by text, p_signed_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.ms_statements%rowtype;
  v_missing integer;
begin
  select * into v_s from public.ms_statements s where s.id = p_statement for update;
  if v_s.id is null or not app.has_role(v_s.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to record approval of this statement';
  end if;
  if v_s.status <> 'draft' then
    raise exception 'This statement has already been approved';
  end if;
  select 7 - count(*) into v_missing from public.ms_sections x
   where x.statement_id = p_statement and char_length(btrim(x.content)) >= 20;
  if v_missing > 0 then
    raise exception '% of the seven mandatory criteria are not yet addressed', v_missing;
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 3 or char_length(btrim(coalesce(p_signed_by, ''))) < 2
     or char_length(btrim(coalesce(p_signed_role, ''))) < 2 or p_approved_on is null then
    raise exception 'Record which body approved it, when, and who signed it and in what role';
  end if;
  if p_approved_on > current_date then
    raise exception 'The approval date cannot be in the future';
  end if;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_statements
     set status = 'approved', approved_body = btrim(p_body), approved_on = p_approved_on,
         signed_by = btrim(p_signed_by), signed_role = btrim(p_signed_role)
   where id = p_statement;
  perform set_config('app.ms_system', 'off', true);
end;
$$;

create or replace function public.lodge_ms_statement(p_statement uuid, p_lodged_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.ms_statements%rowtype;
begin
  select * into v_s from public.ms_statements s where s.id = p_statement for update;
  if v_s.id is null or not app.has_role(v_s.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to record lodgement';
  end if;
  if v_s.status <> 'approved' then
    raise exception 'Only an approved statement can be lodged';
  end if;
  if p_lodged_on is null or p_lodged_on > current_date or p_lodged_on < v_s.approved_on then
    raise exception 'The lodgement date must be on or after approval and not in the future';
  end if;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_statements set status = 'lodged', lodged_on = p_lodged_on where id = p_statement;
  perform set_config('app.ms_system', 'off', true);
  update public.tasks set status = 'done', completed_at = now()
   where subject_table = 'ms_statements' and subject_id = p_statement and status in ('open', 'in_progress');
end;
$$;

-- A reminder action for the lodgement deadline
create or replace function app.ms_statement_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
  values (new.organisation_id, 'Modern slavery statement: approve and lodge', 'ms_statements', new.id,
          (new.due_on::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
  return new;
end;
$$;
create trigger ms_statements_task after insert on public.ms_statements
  for each row execute function app.ms_statement_task();

do $$
declare
  t text;
begin
  foreach t in array array['ms_statements', 'ms_sections', 'ms_supplier_reviews'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;
create trigger ms_statements_touch before update on public.ms_statements for each row execute function app.touch_updated_at();
create trigger ms_supplier_reviews_touch before update on public.ms_supplier_reviews for each row execute function app.touch_updated_at();

revoke execute on function app.ms_rating(jsonb) from public, anon;
grant execute on function app.ms_rating(jsonb) to authenticated, service_role;
revoke execute on function public.approve_ms_statement(uuid, text, date, text, text) from public, anon;
revoke execute on function public.lodge_ms_statement(uuid, date) from public, anon;
grant execute on function public.approve_ms_statement(uuid, text, date, text, text) to authenticated;
grant execute on function public.lodge_ms_statement(uuid, date) to authenticated;

revoke all on public.ms_statements, public.ms_sections, public.ms_supplier_reviews from anon, authenticated;
grant select, insert on public.ms_statements to authenticated;
grant select, insert, update on public.ms_sections to authenticated;
grant select, insert, update, delete on public.ms_supplier_reviews to authenticated;
grant all on public.ms_statements, public.ms_sections, public.ms_supplier_reviews to service_role;

alter table public.ms_statements       enable row level security;
alter table public.ms_sections         enable row level security;
alter table public.ms_supplier_reviews enable row level security;

create policy ms_statements_select on public.ms_statements for select to authenticated using (app.is_member(organisation_id));
create policy ms_statements_insert on public.ms_statements for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_sections_select on public.ms_sections for select to authenticated using (app.is_member(organisation_id));
create policy ms_sections_insert on public.ms_sections for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_sections_update on public.ms_sections for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_supplier_reviews_select on public.ms_supplier_reviews for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()));
create policy ms_supplier_reviews_insert on public.ms_supplier_reviews for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_supplier_reviews_update on public.ms_supplier_reviews for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy ms_supplier_reviews_delete on public.ms_supplier_reviews for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()));
