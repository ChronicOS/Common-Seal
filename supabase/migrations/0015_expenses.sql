-- =====================================================================
-- Common Seal - 0015: expenses
--
-- Staff claim expenses line by line. Nobody approves their own claim.
-- Hospitality and gift lines become gift declarations automatically on
-- submission, so the anti-bribery record never depends on someone
-- remembering to declare twice, and a claim cannot be approved while
-- one of its declarations is still waiting for a decision.
-- =====================================================================

create type public.expense_status as enum ('draft', 'submitted', 'approved', 'rejected', 'paid');

-- Lines at or above this amount are flagged when there is no receipt
alter table public.organisations
  add column expense_receipt_threshold numeric(12,2) not null default 82.50 check (expense_receipt_threshold >= 0);

create table public.expense_claims (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  claimant_user_id   uuid not null references auth.users (id) on delete restrict,
  claimant_name      text not null check (char_length(btrim(claimant_name)) >= 2),
  purpose            text not null check (char_length(btrim(purpose)) >= 3),
  entity_id          uuid references public.entities (id) on delete set null,
  status             public.expense_status not null default 'draft',
  submitted_at       timestamptz,
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  decision_note      text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index expense_claims_org_idx on public.expense_claims (organisation_id, status);
create index expense_claims_claimant_idx on public.expense_claims (claimant_user_id);

create table public.expense_lines (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  claim_id         uuid not null references public.expense_claims (id) on delete cascade,
  incurred_on      date not null check (incurred_on <= current_date + 1),
  category         text not null check (category in ('Travel', 'Accommodation', 'Meals', 'Entertainment and hospitality',
                                                    'Gifts', 'Training and conferences', 'Equipment and software', 'Other')),
  description      text not null check (char_length(btrim(description)) >= 2),
  amount           numeric(12,2) not null check (amount > 0),
  has_receipt      boolean not null default false,
  -- Who was entertained or given the gift
  other_party      text,
  public_official  boolean not null default false,
  gift_entry_id    uuid references public.gift_entries (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index expense_lines_claim_idx on public.expense_lines (claim_id);

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function app.can_see_claim(p_claim uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.expense_claims c
    where c.id = p_claim
      and (app.has_role(c.organisation_id, app.records_roles())
           or (c.claimant_user_id = auth.uid() and app.is_member(c.organisation_id))));
$$;

create or replace function app.guard_expense_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := coalesce(current_setting('app.expense_system', true), 'off') = 'on';
begin
  if tg_op = 'INSERT' then
    new.claimant_user_id := coalesce(auth.uid(), new.claimant_user_id);
    new.status := 'draft';
    new.submitted_at := null;
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := null;
    new.paid_at := null;
    if new.entity_id is not null and not exists
       (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
      raise exception 'The entity must belong to this organisation';
    end if;
    return new;
  end if;
  if v_system then
    return new;
  end if;
  if old.claimant_user_id <> auth.uid() or old.status not in ('draft', 'rejected') then
    raise exception 'A claim can be changed only by the person claiming, before it is submitted';
  end if;
  if new.status <> old.status or new.claimant_user_id <> old.claimant_user_id or new.organisation_id <> old.organisation_id then
    raise exception 'A claim''s status changes only by submitting, deciding and paying it';
  end if;
  return new;
end;
$$;
create trigger expense_claims_guard before insert or update on public.expense_claims
  for each row execute function app.guard_expense_claim();

create or replace function app.guard_expense_line()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_c public.expense_claims%rowtype;
  v_id uuid := case when tg_op = 'DELETE' then old.claim_id else new.claim_id end;
begin
  if coalesce(current_setting('app.expense_system', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  select * into v_c from public.expense_claims c where c.id = v_id;
  if v_c.id is null then
    return coalesce(new, old);
  end if;
  if v_c.claimant_user_id <> auth.uid() or v_c.status not in ('draft', 'rejected') then
    raise exception 'Lines can be changed only by the person claiming, before the claim is submitted';
  end if;
  if tg_op <> 'DELETE' then
    new.organisation_id := v_c.organisation_id;
    new.gift_entry_id := case when tg_op = 'UPDATE' then old.gift_entry_id else null end;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger expense_lines_guard before insert or update or delete on public.expense_lines
  for each row execute function app.guard_expense_line();

-- ---------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------
create or replace function public.submit_expense_claim(p_claim uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_c public.expense_claims%rowtype;
  v_line public.expense_lines%rowtype;
  v_gift uuid;
  v_declared integer := 0;
begin
  select * into v_c from public.expense_claims c where c.id = p_claim for update;
  if v_c.id is null or v_c.claimant_user_id <> auth.uid() or not app.is_member(v_c.organisation_id) then
    raise exception 'This is not your claim';
  end if;
  if v_c.status not in ('draft', 'rejected') then
    raise exception 'This claim has already been submitted';
  end if;
  if not exists (select 1 from public.expense_lines l where l.claim_id = p_claim) then
    raise exception 'Add at least one expense before submitting';
  end if;
  if exists (select 1 from public.expense_lines l
             where l.claim_id = p_claim and (l.category in ('Entertainment and hospitality', 'Gifts') or l.public_official)
               and nullif(btrim(coalesce(l.other_party, '')), '') is null) then
    raise exception 'For hospitality, gifts and anything involving a public official, say who it was for';
  end if;

  perform set_config('app.expense_system', 'on', true);
  -- Hospitality and gifts are declared automatically, once
  for v_line in
    select * from public.expense_lines l
    where l.claim_id = p_claim and l.gift_entry_id is null
      and (l.category in ('Entertainment and hospitality', 'Gifts') or l.public_official)
  loop
    insert into public.gift_entries (organisation_id, staff_name, direction, other_party, description, value_amount, occurred_on, public_official)
    values (v_c.organisation_id, v_c.claimant_name, 'given', btrim(v_line.other_party),
            format('%s (expense claim)', v_line.description), v_line.amount, least(v_line.incurred_on, current_date), v_line.public_official)
    returning id into v_gift;
    update public.expense_lines set gift_entry_id = v_gift where id = v_line.id;
    v_declared := v_declared + 1;
  end loop;

  update public.expense_claims
     set status = 'submitted', submitted_at = now(), decided_by = null, decided_at = null, decision_note = null
   where id = p_claim;
  perform set_config('app.expense_system', 'off', true);
  return v_declared;
end;
$$;

create or replace function public.decide_expense_claim(p_claim uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.expense_claims%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_c from public.expense_claims c where c.id = p_claim for update;
  if v_c.id is null or not app.has_role(v_c.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to decide this claim';
  end if;
  if v_c.claimant_user_id = auth.uid() then
    raise exception 'You cannot decide your own claim';
  end if;
  if v_c.status <> 'submitted' then
    raise exception 'This claim is not waiting for a decision';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Give the reason for rejecting';
  end if;
  if p_approve and exists (
       select 1 from public.expense_lines l join public.gift_entries g on g.id = l.gift_entry_id
       where l.claim_id = p_claim and g.status = 'pending') then
    raise exception 'Blocked: a gift or hospitality declaration on this claim is still waiting for a decision';
  end if;

  perform set_config('app.expense_system', 'on', true);
  update public.expense_claims
     set status = case when p_approve then 'approved' else 'rejected' end::public.expense_status,
         decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = p_claim;
  perform set_config('app.expense_system', 'off', true);
end;
$$;

create or replace function public.mark_expense_paid(p_claim uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.expense_claims%rowtype;
begin
  select * into v_c from public.expense_claims c where c.id = p_claim for update;
  if v_c.id is null or not app.has_role(v_c.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to mark this claim as paid';
  end if;
  if v_c.claimant_user_id = auth.uid() then
    raise exception 'You cannot mark your own claim as paid';
  end if;
  if v_c.status <> 'approved' then
    raise exception 'Only an approved claim can be marked as paid';
  end if;
  perform set_config('app.expense_system', 'on', true);
  update public.expense_claims set status = 'paid', paid_at = now() where id = p_claim;
  perform set_config('app.expense_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers, privileges and row-level security
-- ---------------------------------------------------------------------
create trigger expense_claims_touch before update on public.expense_claims
  for each row execute function app.touch_updated_at();
create trigger expense_claims_audit after insert or update or delete on public.expense_claims
  for each row execute function app.audit_row();
create trigger expense_lines_audit after insert or update or delete on public.expense_lines
  for each row execute function app.audit_row();

revoke execute on function app.can_see_claim(uuid) from public, anon;
grant execute on function app.can_see_claim(uuid) to authenticated, service_role;
revoke execute on function public.submit_expense_claim(uuid) from public, anon;
revoke execute on function public.decide_expense_claim(uuid, boolean, text) from public, anon;
revoke execute on function public.mark_expense_paid(uuid) from public, anon;
grant execute on function public.submit_expense_claim(uuid) to authenticated;
grant execute on function public.decide_expense_claim(uuid, boolean, text) to authenticated;
grant execute on function public.mark_expense_paid(uuid) to authenticated;

revoke all on public.expense_claims, public.expense_lines from anon, authenticated;
grant select, insert on public.expense_claims to authenticated;
grant update (purpose, entity_id) on public.expense_claims to authenticated;
grant select, insert, update, delete on public.expense_lines to authenticated;
grant all on public.expense_claims, public.expense_lines to service_role;

alter table public.expense_claims enable row level security;
alter table public.expense_lines  enable row level security;

-- Written out in full (not through can_see_claim) so a newly inserted claim can be read back at once
create policy expense_claims_select on public.expense_claims for select to authenticated
  using ((claimant_user_id = auth.uid() and app.is_member(organisation_id))
         or app.has_role(organisation_id, app.records_roles()));
create policy expense_claims_insert on public.expense_claims for insert to authenticated
  with check (claimant_user_id = auth.uid() and app.has_role(organisation_id, app.contributor_roles()));
create policy expense_claims_update on public.expense_claims for update to authenticated
  using (claimant_user_id = auth.uid() and app.is_member(organisation_id))
  with check (claimant_user_id = auth.uid() and app.is_member(organisation_id));

create policy expense_lines_select on public.expense_lines for select to authenticated
  using (app.can_see_claim(claim_id));
create policy expense_lines_insert on public.expense_lines for insert to authenticated
  with check (app.can_see_claim(claim_id));
create policy expense_lines_update on public.expense_lines for update to authenticated
  using (app.can_see_claim(claim_id)) with check (app.can_see_claim(claim_id));
create policy expense_lines_delete on public.expense_lines for delete to authenticated
  using (app.can_see_claim(claim_id));
