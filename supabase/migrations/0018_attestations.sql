-- =====================================================================
-- Common Seal - 0018: attestation rounds
--
-- Each round asks the accountable person for every active register
-- entry, and the owner of every policy in force, to confirm it is
-- still true or to raise an exception. Only that person can answer.
-- An item with nobody able to answer is shown as a gap, never as
-- confirmed. The round's result is what the board signs off against.
-- =====================================================================

create table public.attestation_rounds (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) >= 3),
  due_on           date not null,
  status           text not null default 'open' check (status in ('open', 'closed')),
  closed_by        uuid references auth.users (id) on delete set null,
  closed_at        timestamptz,
  closing_note     text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index attestation_rounds_org_idx on public.attestation_rounds (organisation_id, status);

create table public.attestation_items (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  round_id          uuid not null references public.attestation_rounds (id) on delete cascade,
  subject_table     text not null check (subject_table in ('register_entries', 'policies')),
  subject_id        uuid not null,
  -- The wording as it stood when the round opened
  title             text not null,
  statement         text not null,
  attester_user_id  uuid references auth.users (id) on delete set null,
  attester_name     text,
  response          text check (response in ('confirmed', 'exception')),
  comment           text,
  responded_at      timestamptz,
  unique (round_id, subject_table, subject_id)
);
create index attestation_items_round_idx on public.attestation_items (round_id);
create index attestation_items_attester_idx on public.attestation_items (attester_user_id) where response is null;

create or replace function public.open_attestation_round(p_org uuid, p_name text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_round uuid;
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'You do not have permission to open an attestation round';
  end if;
  if exists (select 1 from public.attestation_rounds r where r.organisation_id = p_org and r.status = 'open') then
    raise exception 'A round is already open. Close it before opening another.';
  end if;
  if p_due is null or p_due < current_date then
    raise exception 'Choose a due date that is today or later';
  end if;
  insert into public.attestation_rounds (organisation_id, name, due_on, created_by)
  values (p_org, btrim(p_name), p_due, auth.uid())
  returning id into v_round;

  -- Active register entries: the accountable person attests
  insert into public.attestation_items (organisation_id, round_id, subject_table, subject_id, title, statement, attester_user_id, attester_name)
  select p_org, v_round, 'register_entries', e.id, e.title,
         case e.kind when 'risk' then 'The controls for this risk are in place and working as described.'
                     else 'We are meeting this obligation and the controls described are in place.' end,
         p.user_id, p.full_name
  from public.register_entries e
  left join public.register_assignments a on a.entry_id = e.id and a.raci = 'accountable' and not a.is_backup
  left join public.people p on p.id = a.person_id
  where e.organisation_id = p_org and e.status = 'active';

  -- Policies in force: the owner attests
  insert into public.attestation_items (organisation_id, round_id, subject_table, subject_id, title, statement, attester_user_id, attester_name)
  select p_org, v_round, 'policies', pol.id, pol.title,
         'This policy is current, has been communicated, and I am not aware of a breach that has not been reported.',
         pol.owner_user_id,
         (select coalesce(pe.full_name, pe.email) from public.people pe where pe.organisation_id = p_org and pe.user_id = pol.owner_user_id limit 1)
  from public.policies pol
  where pol.organisation_id = p_org and not pol.is_retired
    and exists (select 1 from public.policy_versions v where v.policy_id = pol.id and v.status = 'approved');

  if not exists (select 1 from public.attestation_items i where i.round_id = v_round) then
    raise exception 'There is nothing to attest yet. Confirm entries on the register or approve a policy first.';
  end if;
  return v_round;
end;
$$;

-- Only the named person can answer, and only while the round is open. An answer can be corrected until then.
create or replace function public.respond_attestation(p_item uuid, p_confirm boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_i public.attestation_items%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into v_i from public.attestation_items i where i.id = p_item for update;
  if v_i.id is null or v_i.attester_user_id is distinct from auth.uid() or not app.is_member(v_i.organisation_id) then
    raise exception 'This attestation is not yours to give';
  end if;
  if not exists (select 1 from public.attestation_rounds r where r.id = v_i.round_id and r.status = 'open') then
    raise exception 'This round is closed';
  end if;
  if not p_confirm and v_comment is null then
    raise exception 'Describe the exception';
  end if;
  update public.attestation_items
     set response = case when p_confirm then 'confirmed' else 'exception' end, comment = v_comment, responded_at = now()
   where id = p_item;
end;
$$;

create or replace function public.close_attestation_round(p_round uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.attestation_rounds%rowtype;
begin
  select * into v_r from public.attestation_rounds r where r.id = p_round for update;
  if v_r.id is null or not app.has_role(v_r.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to close this round';
  end if;
  if v_r.status <> 'open' then
    raise exception 'This round is already closed';
  end if;
  update public.attestation_rounds
     set status = 'closed', closed_by = auth.uid(), closed_at = now(), closing_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_round;
end;
$$;

create trigger attestation_rounds_audit after insert or update or delete on public.attestation_rounds
  for each row execute function app.audit_row();
create trigger attestation_items_audit after insert or update or delete on public.attestation_items
  for each row execute function app.audit_row();

revoke execute on function public.open_attestation_round(uuid, text, date) from public, anon;
revoke execute on function public.respond_attestation(uuid, boolean, text) from public, anon;
revoke execute on function public.close_attestation_round(uuid, text) from public, anon;
grant execute on function public.open_attestation_round(uuid, text, date) to authenticated;
grant execute on function public.respond_attestation(uuid, boolean, text) to authenticated;
grant execute on function public.close_attestation_round(uuid, text) to authenticated;

revoke all on public.attestation_rounds, public.attestation_items from anon, authenticated;
grant select on public.attestation_rounds, public.attestation_items to authenticated;
grant all on public.attestation_rounds, public.attestation_items to service_role;

alter table public.attestation_rounds enable row level security;
alter table public.attestation_items  enable row level security;

create policy attestation_rounds_select on public.attestation_rounds for select to authenticated
  using (app.is_member(organisation_id));
-- People see their own items; the board and compliance see all of them
create policy attestation_items_select on public.attestation_items for select to authenticated
  using ((attester_user_id = auth.uid() and app.is_member(organisation_id))
         or app.has_role(organisation_id, app.board_read_roles())
         or app.has_role(organisation_id, array['auditor']::public.member_role[]));
