-- 0030: Authorities: the Financial Approval Matrix and Signing Delegation.
--
-- Each is kept as numbered versions. A draft can be edited freely. The first
-- version is locked by recording the board's approval; after that the version
-- in force cannot be edited. A change is made in a new draft copied from the
-- version in force, submitted for ratification at a board meeting (an agenda
-- item is added), and takes effect only when the board passes a resolution on
-- that item. Not passed means rejected; deferred leaves it waiting.
--
-- Financial Approval Matrix: verticals (Expense Approval, Capital Approval ...),
-- each with amount bands. For every band and every function (Corporate,
-- Finance, Operations, IT ...) there is an operational approver and a finance
-- approver, both positions. The top band can be marked as going to the board.
-- Signing Delegation: document types, each with amount bands and one or two
-- signatory positions. Bands can be set for the whole group, and varied for a
-- single company (entity_id set): a company's own bands replace the group's
-- for that vertical.
--
-- Approvals are tied to positions. People hold positions through the existing
-- position_assignments, so who held an authority on a given day can be shown.

create table public.auth_versions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  kind             text not null check (kind in ('financial', 'signing')),
  number           integer not null,
  status           text not null default 'draft' check (status in ('draft', 'proposed', 'in_force', 'superseded', 'rejected', 'withdrawn')),
  based_on_id      uuid references public.auth_versions (id) on delete set null,
  change_note      text,
  meeting_id       uuid references public.meetings (id) on delete set null,
  agenda_item_id   uuid references public.agenda_items (id) on delete set null,
  resolution_id    uuid references public.resolutions (id) on delete set null,
  approval_note    text,
  proposed_at      timestamptz,
  proposed_by      uuid references auth.users (id) on delete set null,
  in_force_from    timestamptz,
  ended_at         timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, kind, number)
);
create unique index auth_versions_one_in_force on public.auth_versions (organisation_id, kind) where status = 'in_force';
create unique index auth_versions_one_open on public.auth_versions (organisation_id, kind) where status in ('draft', 'proposed');

create table public.auth_functions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  version_id       uuid not null references public.auth_versions (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  position         integer not null default 0,
  copied_from      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (version_id, name)
);

create table public.auth_verticals (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  version_id       uuid not null references public.auth_versions (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  description      text,
  position         integer not null default 0,
  copied_from      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (version_id, name)
);

create table public.auth_bands (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  version_id       uuid not null references public.auth_versions (id) on delete cascade,
  vertical_id      uuid not null references public.auth_verticals (id) on delete cascade,
  entity_id        uuid references public.entities (id) on delete cascade,  -- null = the whole group
  position         integer not null default 0,
  up_to            numeric(16, 2) check (up_to is null or up_to > 0),      -- null = no upper limit
  currency         text not null default 'AUD',
  board            boolean not null default false,                         -- this band goes to the board
  copied_from      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index auth_bands_vertical_idx on public.auth_bands (vertical_id, entity_id, position);

create table public.auth_cells (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete cascade,
  version_id               uuid not null references public.auth_versions (id) on delete cascade,
  band_id                  uuid not null references public.auth_bands (id) on delete cascade,
  function_id              uuid references public.auth_functions (id) on delete cascade,  -- null for Signing Delegation
  operational_position_id  uuid references public.positions (id) on delete restrict,  -- signing: first signatory
  finance_position_id      uuid references public.positions (id) on delete restrict,  -- signing: second signatory (optional)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index auth_cells_one_per_function on public.auth_cells (band_id, coalesce(function_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Rows of a version can only be changed while it is a draft, and must stay inside one organisation and version.
create or replace function app.guard_auth_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_status text;
  v_org uuid;
begin
  if coalesce(current_setting('app.auth_system', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  v_row := coalesce(new, old);
  select v.status, v.organisation_id into v_status, v_org from public.auth_versions v where v.id = v_row.version_id;
  if v_status is distinct from 'draft' then
    raise exception 'This version is locked. Start a change to propose new authorities for board approval.';
  end if;
  if tg_op = 'UPDATE' and (new.version_id <> old.version_id or new.organisation_id <> old.organisation_id) then
    raise exception 'A row cannot be moved to another version';
  end if;
  if tg_op <> 'DELETE' then
    if new.organisation_id <> v_org then
      raise exception 'The row and its version must belong to the same organisation';
    end if;
    if tg_table_name = 'auth_bands' then
      if not exists (select 1 from public.auth_verticals x where x.id = new.vertical_id and x.version_id = new.version_id) then
        raise exception 'The band must belong to a vertical in the same version';
      end if;
      if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
        raise exception 'That company is not in this organisation';
      end if;
    elsif tg_table_name = 'auth_cells' then
      if not exists (select 1 from public.auth_bands b where b.id = new.band_id and b.version_id = new.version_id) then
        raise exception 'The cell must belong to a band in the same version';
      end if;
      if new.function_id is not null and not exists (select 1 from public.auth_functions f where f.id = new.function_id and f.version_id = new.version_id) then
        raise exception 'The function must belong to the same version';
      end if;
      if exists (select 1 from unnest(array[new.operational_position_id, new.finance_position_id]) p
                 where p is not null and not exists (select 1 from public.positions x where x.id = p and x.organisation_id = new.organisation_id)) then
        raise exception 'That position is not in this organisation';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger auth_functions_guard before insert or update or delete on public.auth_functions for each row execute function app.guard_auth_row();
create trigger auth_verticals_guard before insert or update or delete on public.auth_verticals for each row execute function app.guard_auth_row();
create trigger auth_bands_guard before insert or update or delete on public.auth_bands for each row execute function app.guard_auth_row();
create trigger auth_cells_guard before insert or update or delete on public.auth_cells for each row execute function app.guard_auth_row();

-- Versions change status only through the functions below
create or replace function app.guard_auth_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.auth_system', true), 'off') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Versions are created with their own buttons';
  end if;
  if new.status <> old.status or new.organisation_id <> old.organisation_id or new.kind <> old.kind or new.number <> old.number
     or new.resolution_id is distinct from old.resolution_id or new.in_force_from is distinct from old.in_force_from
     or new.meeting_id is distinct from old.meeting_id or new.agenda_item_id is distinct from old.agenda_item_id then
    raise exception 'A version is locked, proposed and approved with its own buttons';
  end if;
  if old.status <> 'draft' then
    raise exception 'Only a draft can be changed';
  end if;
  return new;
end;
$$;
create trigger auth_versions_guard before insert or update on public.auth_versions for each row execute function app.guard_auth_version();

-- Copy every row of one version into another (used to start a change)
create or replace function app.copy_auth_version(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.auth_system', 'on', true);
  insert into public.auth_functions (organisation_id, version_id, name, position, copied_from)
  select organisation_id, p_to, name, position, id from public.auth_functions where version_id = p_from;
  insert into public.auth_verticals (organisation_id, version_id, name, description, position, copied_from)
  select organisation_id, p_to, name, description, position, id from public.auth_verticals where version_id = p_from;
  insert into public.auth_bands (organisation_id, version_id, vertical_id, entity_id, position, up_to, currency, board, copied_from)
  select b.organisation_id, p_to, nv.id, b.entity_id, b.position, b.up_to, b.currency, b.board, b.id
  from public.auth_bands b join public.auth_verticals nv on nv.version_id = p_to and nv.copied_from = b.vertical_id
  where b.version_id = p_from;
  insert into public.auth_cells (organisation_id, version_id, band_id, function_id, operational_position_id, finance_position_id)
  select c.organisation_id, p_to, nb.id, nf.id, c.operational_position_id, c.finance_position_id
  from public.auth_cells c
  join public.auth_bands nb on nb.version_id = p_to and nb.copied_from = c.band_id
  left join public.auth_functions nf on nf.version_id = p_to and nf.copied_from = c.function_id
  where c.version_id = p_from and (c.function_id is null or nf.id is not null);
  perform set_config('app.auth_system', 'off', true);
end;
$$;

-- What is missing before a version can be locked or proposed; empty when complete
create or replace function app.auth_gaps(p_version uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text;
  v_gaps text[] := '{}';
  r record;
begin
  select kind into v_kind from public.auth_versions where id = p_version;
  for r in
    select x.name as vertical, coalesce(e.name, 'the group') as scope, b.id, b.up_to, b.board,
           row_number() over (partition by b.vertical_id, b.entity_id order by b.position) as n,
           count(*) over (partition by b.vertical_id, b.entity_id) as total,
           lag(b.up_to) over (partition by b.vertical_id, b.entity_id order by b.position) as prev
    from public.auth_bands b
    join public.auth_verticals x on x.id = b.vertical_id
    left join public.entities e on e.id = b.entity_id
    where b.version_id = p_version
  loop
    if r.up_to is null and r.n < r.total then
      v_gaps := v_gaps || format('%s (%s): only the last band can be unlimited', r.vertical, r.scope);
    end if;
    if r.up_to is not null and r.prev is not null and r.up_to <= r.prev then
      v_gaps := v_gaps || format('%s (%s): amounts must go up from one band to the next', r.vertical, r.scope);
    end if;
    if r.n = r.total and r.up_to is not null and not r.board then
      v_gaps := v_gaps || format('%s (%s): the top band must be unlimited or go to the board', r.vertical, r.scope);
    end if;
    if not r.board then
      if v_kind = 'financial' then
        if exists (select 1 from public.auth_functions f where f.version_id = p_version
                   and not exists (select 1 from public.auth_cells c where c.band_id = r.id and c.function_id = f.id
                                   and c.operational_position_id is not null and c.finance_position_id is not null)) then
          v_gaps := v_gaps || format('%s (%s), band %s: an operational and a finance approver are needed for every function', r.vertical, r.scope, r.n);
        end if;
      elsif not exists (select 1 from public.auth_cells c where c.band_id = r.id and c.operational_position_id is not null) then
        v_gaps := v_gaps || format('%s (%s), band %s: name at least one signatory', r.vertical, r.scope, r.n);
      end if;
    end if;
  end loop;
  if not exists (select 1 from public.auth_verticals where version_id = p_version) then
    v_gaps := v_gaps || 'Add at least one vertical'::text;
  end if;
  if exists (select 1 from public.auth_verticals x where x.version_id = p_version
             and not exists (select 1 from public.auth_bands b where b.vertical_id = x.id and b.entity_id is null)) then
    v_gaps := v_gaps || 'Every vertical needs at least one band for the group'::text;
  end if;
  return v_gaps;
end;
$$;

-- Sets up both frameworks with the default functions and verticals, the first time
create or replace function public.ensure_authorities(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_kind text;
  v_name text;
  n integer;
begin
  if not app.is_member(p_org) then
    raise exception 'Not a member of this organisation';
  end if;
  perform set_config('app.auth_system', 'on', true);
  foreach v_kind in array array['financial', 'signing'] loop
    if exists (select 1 from public.auth_versions where organisation_id = p_org and kind = v_kind) then
      continue;
    end if;
    insert into public.auth_versions (organisation_id, kind, number, status, created_by)
    values (p_org, v_kind, 1, 'draft', auth.uid()) returning id into v_id;
    if v_kind = 'financial' then
      n := 0;
      foreach v_name in array array['Corporate', 'Finance', 'Operations', 'IT'] loop
        n := n + 1;
        insert into public.auth_functions (organisation_id, version_id, name, position) values (p_org, v_id, v_name, n);
      end loop;
      n := 0;
      foreach v_name in array array['Expense Approval', 'Capital Approval (Manufacturing)', 'Capital Approval (Commercial/Functional)',
                                    'Capital Approval (IT)', 'Capital Approval (Procurement)', 'Inventory Purchase Approval'] loop
        n := n + 1;
        insert into public.auth_verticals (organisation_id, version_id, name, position) values (p_org, v_id, v_name, n);
      end loop;
    else
      n := 0;
      foreach v_name in array array['Commercial contracts', 'Leases and property', 'Employment contracts',
                                    'Loans, guarantees and security', 'Deeds and powers of attorney', 'Government and regulatory filings'] loop
        n := n + 1;
        insert into public.auth_verticals (organisation_id, version_id, name, position) values (p_org, v_id, v_name, n);
      end loop;
    end if;
    -- Each vertical starts with one band: anything goes to the board, until limits are set
    insert into public.auth_bands (organisation_id, version_id, vertical_id, position, board)
    select p_org, v_id, x.id, 1, true from public.auth_verticals x where x.version_id = v_id;
  end loop;
  perform set_config('app.auth_system', 'off', true);
end;
$$;

-- First lock: the board has approved version 1. Later versions take effect only through ratification.
create or replace function public.lock_authority(p_version uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.auth_versions%rowtype;
  v_gaps text[];
begin
  select * into v from public.auth_versions where id = p_version for update;
  if v.id is null or not app.has_role(v.organisation_id, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can lock the authorities';
  end if;
  if v.status <> 'draft' then
    raise exception 'Only a draft can be locked';
  end if;
  if exists (select 1 from public.auth_versions x where x.organisation_id = v.organisation_id and x.kind = v.kind and x.status in ('in_force', 'superseded')) then
    raise exception 'These authorities are already locked. Propose the change for ratification at a board meeting instead.';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Record how the board approved them (for example, the meeting and date, or the circular resolution)';
  end if;
  v_gaps := app.auth_gaps(p_version);
  if cardinality(v_gaps) > 0 then
    raise exception 'Not complete yet: %', array_to_string(v_gaps, '; ');
  end if;
  perform set_config('app.auth_system', 'on', true);
  update public.auth_versions set status = 'in_force', in_force_from = now(), approval_note = btrim(p_note) where id = p_version;
  perform set_config('app.auth_system', 'off', true);
end;
$$;

-- Starts a change: a new draft copied from the version in force
create or replace function public.start_authority_change(p_org uuid, p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_current uuid;
  v_id uuid;
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can propose changes';
  end if;
  select id into v_current from public.auth_versions where organisation_id = p_org and kind = p_kind and status = 'in_force';
  if v_current is null then
    raise exception 'Nothing is in force yet: edit the draft and lock it';
  end if;
  if exists (select 1 from public.auth_versions where organisation_id = p_org and kind = p_kind and status in ('draft', 'proposed')) then
    raise exception 'A change is already in progress. Finish or withdraw it first.';
  end if;
  perform set_config('app.auth_system', 'on', true);
  insert into public.auth_versions (organisation_id, kind, number, status, based_on_id, created_by)
  values (p_org, p_kind, (select max(number) + 1 from public.auth_versions where organisation_id = p_org and kind = p_kind), 'draft', v_current, auth.uid())
  returning id into v_id;
  perform set_config('app.auth_system', 'off', true);
  perform app.copy_auth_version(v_current, v_id);
  return v_id;
end;
$$;

-- Submits a change for ratification: adds a decision item to the chosen board meeting
create or replace function public.propose_authority_change(p_version uuid, p_meeting uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.auth_versions%rowtype;
  m public.meetings%rowtype;
  v_gaps text[];
  v_item uuid;
begin
  select * into v from public.auth_versions where id = p_version for update;
  if v.id is null or not app.has_role(v.organisation_id, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can propose changes';
  end if;
  if v.status <> 'draft' or v.based_on_id is null then
    raise exception 'Only a change to authorities already in force is proposed for ratification';
  end if;
  select * into m from public.meetings where id = p_meeting and organisation_id = v.organisation_id;
  if m.id is null then
    raise exception 'Choose the board meeting that will ratify the change';
  end if;
  if m.status in ('minutes_draft', 'minutes_final') then
    raise exception 'That meeting has already been held. Choose an upcoming one.';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say briefly what is changing and why';
  end if;
  v_gaps := app.auth_gaps(p_version);
  if cardinality(v_gaps) > 0 then
    raise exception 'Not complete yet: %', array_to_string(v_gaps, '; ');
  end if;
  insert into public.agenda_items (organisation_id, meeting_id, position, title, kind)
  values (v.organisation_id, m.id, coalesce((select max(position) + 1 from public.agenda_items where meeting_id = m.id), 1),
          format('Ratify change to the %s (version %s): %s',
                 case v.kind when 'financial' then 'Financial Approval Matrix' else 'Signing Delegation' end, v.number, left(btrim(p_note), 200)),
          'decision')
  returning id into v_item;
  perform set_config('app.auth_system', 'on', true);
  update public.auth_versions
     set status = 'proposed', meeting_id = m.id, agenda_item_id = v_item, change_note = btrim(p_note), proposed_at = now(), proposed_by = auth.uid()
   where id = p_version;
  perform set_config('app.auth_system', 'off', true);
end;
$$;

-- Withdraws a draft or proposed change; the agenda item comes off if nothing was decided on it
create or replace function public.withdraw_authority_change(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.auth_versions%rowtype;
begin
  select * into v from public.auth_versions where id = p_version for update;
  if v.id is null or not app.has_role(v.organisation_id, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can withdraw a change';
  end if;
  if v.status not in ('draft', 'proposed') or v.based_on_id is null then
    raise exception 'Only a change that is still open can be withdrawn';
  end if;
  perform set_config('app.auth_system', 'on', true);
  update public.auth_versions set status = 'withdrawn', ended_at = now() where id = p_version;
  perform set_config('app.auth_system', 'off', true);
  if v.agenda_item_id is not null and not exists (select 1 from public.resolutions r where r.agenda_item_id = v.agenda_item_id) then
    delete from public.agenda_items where id = v.agenda_item_id;
  end if;
end;
$$;

-- Back to draft (for example after the board deferred it), so it can be edited and proposed again
create or replace function public.reopen_authority_change(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.auth_versions%rowtype;
begin
  select * into v from public.auth_versions where id = p_version for update;
  if v.id is null or not app.has_role(v.organisation_id, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can do this';
  end if;
  if v.status <> 'proposed' then
    raise exception 'Only a proposed change can be taken back to draft';
  end if;
  perform set_config('app.auth_system', 'on', true);
  update public.auth_versions set status = 'draft', meeting_id = null, agenda_item_id = null, proposed_at = null where id = p_version;
  perform set_config('app.auth_system', 'off', true);
  if v.agenda_item_id is not null and not exists (select 1 from public.resolutions r where r.agenda_item_id = v.agenda_item_id) then
    delete from public.agenda_items where id = v.agenda_item_id;
  end if;
end;
$$;

-- The board's decision on the agenda item decides the change: passed takes effect, not passed is rejected
create or replace function app.apply_authority_resolution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v public.auth_versions%rowtype;
begin
  if new.agenda_item_id is null then
    return new;
  end if;
  select * into v from public.auth_versions where agenda_item_id = new.agenda_item_id and status = 'proposed' for update;
  if v.id is null then
    return new;
  end if;
  perform set_config('app.auth_system', 'on', true);
  if new.outcome = 'passed' then
    update public.auth_versions set status = 'superseded', ended_at = now()
     where organisation_id = v.organisation_id and kind = v.kind and status = 'in_force';
    update public.auth_versions set status = 'in_force', in_force_from = now(), resolution_id = new.id where id = v.id;
  elsif new.outcome = 'not_passed' then
    update public.auth_versions set status = 'rejected', ended_at = now(), resolution_id = new.id where id = v.id;
  end if;
  perform set_config('app.auth_system', 'off', true);
  return new;
end;
$$;
create trigger resolutions_apply_authority after insert or update of outcome, agenda_item_id on public.resolutions
  for each row execute function app.apply_authority_resolution();

-- Privileges and row-level security
revoke all on public.auth_versions, public.auth_functions, public.auth_verticals, public.auth_bands, public.auth_cells from anon, authenticated;
grant select on public.auth_versions to authenticated;
grant update (change_note) on public.auth_versions to authenticated;
grant select, insert, update, delete on public.auth_functions, public.auth_verticals, public.auth_bands, public.auth_cells to authenticated;
grant all on public.auth_versions, public.auth_functions, public.auth_verticals, public.auth_bands, public.auth_cells to service_role;

do $$
declare t text;
begin
  foreach t in array array['auth_versions', 'auth_functions', 'auth_verticals', 'auth_bands', 'auth_cells'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.is_member(organisation_id))', t || '_select', t);
    if t <> 'auth_versions' then
      execute format('create policy %I on public.%I for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()))', t || '_insert', t);
      execute format('create policy %I on public.%I for delete to authenticated using (app.has_role(organisation_id, app.records_roles()))', t || '_delete', t);
    end if;
    execute format('create policy %I on public.%I for update to authenticated using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()))', t || '_update', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.copy_auth_version(uuid, uuid), app.auth_gaps(uuid) from authenticated;

-- What still needs filling in before a version can be locked or proposed
create or replace function public.authority_gaps(p_version uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.auth_versions v where v.id = p_version and app.is_member(v.organisation_id)) then
    raise exception 'Not found';
  end if;
  return app.auth_gaps(p_version);
end;
$$;
revoke execute on function public.authority_gaps(uuid) from public, anon;
grant execute on function public.authority_gaps(uuid) to authenticated;
revoke execute on function public.ensure_authorities(uuid), public.lock_authority(uuid, text), public.start_authority_change(uuid, text),
  public.propose_authority_change(uuid, uuid, text), public.withdraw_authority_change(uuid), public.reopen_authority_change(uuid) from public, anon;
grant execute on function public.ensure_authorities(uuid), public.lock_authority(uuid, text), public.start_authority_change(uuid, text),
  public.propose_authority_change(uuid, uuid, text), public.withdraw_authority_change(uuid), public.reopen_authority_change(uuid) to authenticated;
