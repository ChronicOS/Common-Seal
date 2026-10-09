-- =====================================================================
-- Common Seal - 0004: board meetings
--
-- Covers: boards and committees, meetings, agenda, attendance, draft
-- notes, resolutions, minutes that lock when final, actions, the
-- two-person wipe of draft notes with a deletion certificate, and
-- adding members to an organisation.
--
-- Permanent records: minutes, resolutions, agenda, attendance.
-- Wipeable: meeting_captures (draft notes) only.
-- =====================================================================

create type public.body_kind as enum ('board', 'committee');
create type public.meeting_status as enum ('scheduled', 'in_progress', 'minutes_draft', 'minutes_final');
create type public.attendance_status as enum ('expected', 'present', 'apology', 'absent');
create type public.item_kind as enum ('noting', 'discussion', 'decision');
create type public.resolution_outcome as enum ('passed', 'not_passed', 'deferred');
create type public.minutes_status as enum ('draft', 'final');

-- Role groups for board records
create or replace function app.board_read_roles() returns public.member_role[]
language sql immutable as $$ select array['owner','admin','secretary','legal','compliance','director']::public.member_role[] $$;

create or replace function app.board_write_roles() returns public.member_role[]
language sql immutable as $$ select array['owner','admin','secretary']::public.member_role[] $$;

create or replace function app.notes_roles() returns public.member_role[]
language sql immutable as $$ select array['owner','admin','secretary','legal']::public.member_role[] $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.bodies (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_id        uuid not null references public.entities (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 200),
  kind             public.body_kind not null default 'board',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (entity_id, name)
);
create index bodies_org_idx on public.bodies (organisation_id);

create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  body_id          uuid not null references public.bodies (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 2 and 200),
  scheduled_at     timestamptz not null,
  location         text,
  status           public.meeting_status not null default 'scheduled',
  started_at       timestamptz,
  ended_at         timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index meetings_org_idx on public.meetings (organisation_id, scheduled_at desc);

create table public.agenda_items (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  meeting_id       uuid not null references public.meetings (id) on delete cascade,
  position         integer not null default 0,
  title            text not null check (char_length(btrim(title)) between 2 and 300),
  kind             public.item_kind not null default 'discussion',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index agenda_items_meeting_idx on public.agenda_items (meeting_id, position);

create table public.attendance (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  meeting_id       uuid not null references public.meetings (id) on delete cascade,
  person_id        uuid not null references public.people (id) on delete cascade,
  capacity         text,                      -- e.g. Director, Secretary, Invitee
  status           public.attendance_status not null default 'expected',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (meeting_id, person_id)
);

-- Draft notes: the only wipeable board table
create table public.meeting_captures (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  meeting_id       uuid not null references public.meetings (id) on delete cascade,
  agenda_item_id   uuid not null references public.agenda_items (id) on delete cascade,
  notes            text not null default '',
  conflicts        text not null default '',
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (agenda_item_id)
);
create index meeting_captures_meeting_idx on public.meeting_captures (meeting_id);

create table public.resolutions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  meeting_id       uuid not null references public.meetings (id) on delete cascade,
  agenda_item_id   uuid references public.agenda_items (id) on delete restrict,
  text             text not null check (char_length(btrim(text)) >= 5),
  outcome          public.resolution_outcome not null default 'passed',
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index resolutions_meeting_idx on public.resolutions (meeting_id);
create index resolutions_org_idx on public.resolutions (organisation_id);

create table public.minutes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  meeting_id       uuid not null unique references public.meetings (id) on delete cascade,
  content          text not null default '',
  status           public.minutes_status not null default 'draft',
  finalised_at     timestamptz,
  finalised_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'final') = (finalised_at is not null))
);

-- Actions are tasks; link them to the agenda item they came from
alter table public.tasks
  add column agenda_item_id uuid references public.agenda_items (id) on delete set null;

-- A deletion request can cover part of a record, e.g. a meeting's draft notes
alter table public.deletion_requests
  add column scope text not null default 'record';

-- ---------------------------------------------------------------------
-- Integrity: rows must belong to the same organisation as their parent
-- ---------------------------------------------------------------------
create or replace function app.guard_board_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if tg_table_name = 'bodies' then
    select exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) into v_ok;
  elsif tg_table_name = 'meetings' then
    select exists (select 1 from public.bodies b where b.id = new.body_id and b.organisation_id = new.organisation_id) into v_ok;
  elsif tg_table_name = 'attendance' then
    select exists (select 1 from public.meetings m where m.id = new.meeting_id and m.organisation_id = new.organisation_id)
       and exists (select 1 from public.people p where p.id = new.person_id and p.organisation_id = new.organisation_id) into v_ok;
  elsif tg_table_name in ('meeting_captures', 'resolutions') then
    select exists (select 1 from public.meetings m where m.id = new.meeting_id and m.organisation_id = new.organisation_id)
       and (new.agenda_item_id is null or exists (select 1 from public.agenda_items a
                                                  where a.id = new.agenda_item_id and a.meeting_id = new.meeting_id)) into v_ok;
  else
    select exists (select 1 from public.meetings m where m.id = new.meeting_id and m.organisation_id = new.organisation_id) into v_ok;
  end if;
  if not v_ok then
    raise exception 'This record does not belong to the same organisation as its parent';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Locking: once minutes are final the meeting record cannot change
-- ---------------------------------------------------------------------
create or replace function app.block_when_minutes_final()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meeting uuid := case when tg_op = 'DELETE' then old.meeting_id else new.meeting_id end;
begin
  if exists (select 1 from public.meetings m where m.id = v_meeting and m.status = 'minutes_final') then
    raise exception 'The minutes are final, so this record is locked' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app.guard_meeting_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'minutes_final' then
    raise exception 'The minutes are final, so this meeting is locked' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if old.status = 'scheduled' and new.status = 'in_progress' then
      new.started_at := now();
    elsif old.status = 'in_progress' and new.status = 'minutes_draft' then
      new.ended_at := now();
    elsif old.status = 'minutes_draft' and new.status = 'in_progress' then
      null; -- reopened to add notes
    elsif old.status = 'minutes_draft' and new.status = 'minutes_final' then
      if not exists (select 1 from public.minutes mi where mi.meeting_id = new.id and mi.status = 'final') then
        raise exception 'Finalise the minutes to lock the meeting';
      end if;
    else
      raise exception 'A meeting cannot move from % to %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.guard_minutes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.finalised_at := null;
    new.finalised_by := null;
    return new;
  end if;
  if old.status = 'final' then
    raise exception 'Final minutes cannot be changed' using errcode = 'P0001';
  end if;
  if new.status = 'final' then
    if not exists (select 1 from public.meetings m where m.id = new.meeting_id and m.status = 'minutes_draft') then
      raise exception 'Minutes can only be finalised once the meeting has ended';
    end if;
    if char_length(btrim(new.content)) < 20 then
      raise exception 'The minutes are empty';
    end if;
    new.finalised_at := now();
    new.finalised_by := auth.uid();
  else
    new.finalised_at := null;
    new.finalised_by := null;
  end if;
  return new;
end;
$$;

create or replace function app.lock_meeting_after_minutes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'final' and old.status = 'draft' then
    update public.meetings set status = 'minutes_final' where id = new.meeting_id;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Legal hold: a hold on a meeting also covers its draft notes
-- ---------------------------------------------------------------------
create or replace function app.is_under_hold(p_org uuid, p_table text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.legal_holds h
    join public.legal_hold_scopes s on s.legal_hold_id = h.id
    where h.organisation_id = p_org
      and h.status = 'active'
      and (
        s.scope_type = 'organisation'
        or (s.subject_table = p_table and s.subject_id = p_id)
        or (p_table = 'document_versions' and s.subject_table = 'documents'
            and s.subject_id = (select v.document_id from public.document_versions v where v.id = p_id))
        or (p_table = 'meeting_captures' and s.subject_table = 'meetings'
            and s.subject_id = (select c.meeting_id from public.meeting_captures c where c.id = p_id))
      )
  );
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['bodies', 'meetings', 'agenda_items', 'attendance', 'meeting_captures', 'resolutions', 'minutes'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.guard_board_row()', t || '_org_guard', t);
  end loop;
end;
$$;

create trigger agenda_items_lock before insert or update or delete on public.agenda_items
  for each row execute function app.block_when_minutes_final();
create trigger attendance_lock before insert or update or delete on public.attendance
  for each row execute function app.block_when_minutes_final();
create trigger resolutions_lock before insert or update or delete on public.resolutions
  for each row execute function app.block_when_minutes_final();
-- Draft notes cannot be added or edited after the minutes are final, but can still be wiped
create trigger meeting_captures_lock before insert or update on public.meeting_captures
  for each row execute function app.block_when_minutes_final();
create trigger meeting_captures_hold_guard before delete on public.meeting_captures
  for each row execute function app.block_delete_under_hold();

create trigger meetings_guard before update on public.meetings
  for each row execute function app.guard_meeting_update();
create trigger meetings_hold_guard before delete on public.meetings
  for each row execute function app.block_delete_under_hold();
create trigger minutes_guard before insert or update on public.minutes
  for each row execute function app.guard_minutes();
create trigger minutes_lock_meeting after update on public.minutes
  for each row execute function app.lock_meeting_after_minutes();
create trigger minutes_no_delete before delete on public.minutes
  for each row execute function app.reject_change();

-- ---------------------------------------------------------------------
-- Wiping draft notes: request, second-person approval, execution
-- ---------------------------------------------------------------------
create or replace function public.request_meeting_wipe(p_meeting uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_status public.meeting_status;
  v_request uuid;
begin
  select m.organisation_id, m.status into v_org, v_status from public.meetings m where m.id = p_meeting;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to request this';
  end if;
  if v_status <> 'minutes_final' then
    raise exception 'Draft notes can only be wiped after the minutes are final';
  end if;
  if not exists (select 1 from public.meeting_captures c where c.meeting_id = p_meeting) then
    raise exception 'There are no draft notes left to wipe';
  end if;
  if exists (select 1 from public.deletion_requests d
             where d.subject_table = 'meetings' and d.subject_id = p_meeting
               and d.scope = 'meeting_captures' and d.status in ('pending', 'approved')) then
    raise exception 'A wipe request is already open for this meeting';
  end if;

  insert into public.deletion_requests (organisation_id, subject_table, subject_id, scope, reason, requested_by)
  values (v_org, 'meetings', p_meeting, 'meeting_captures',
          'Draft notes are no longer needed now that the minutes are final', auth.uid())
  returning id into v_request;
  return v_request;
end;
$$;

create or replace function public.execute_meeting_wipe(p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_req public.deletion_requests%rowtype;
  v_meeting public.meetings%rowtype;
  v_hashes text[];
  v_count integer;
  v_certificate uuid;
begin
  select * into v_req from public.deletion_requests d where d.id = p_request for update;
  if v_req.id is null or not app.has_role(v_req.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  if v_req.scope <> 'meeting_captures' or v_req.subject_table <> 'meetings' then
    raise exception 'This request is not a draft notes wipe';
  end if;
  if v_req.status <> 'approved' then
    raise exception 'The wipe must be approved by a second person first';
  end if;
  if app.is_under_hold(v_req.organisation_id, 'meetings', v_req.subject_id) then
    raise exception 'Deletion blocked: this meeting is under an active legal hold' using errcode = 'P0001';
  end if;

  select * into v_meeting from public.meetings m where m.id = v_req.subject_id;

  select coalesce(array_agg(encode(sha256(convert_to(c.notes || E'\n' || c.conflicts, 'UTF8')), 'hex') order by c.id), '{}'),
         count(*)
    into v_hashes, v_count
  from public.meeting_captures c where c.meeting_id = v_req.subject_id;

  delete from public.meeting_captures c where c.meeting_id = v_req.subject_id;

  insert into public.deletion_certificates
    (organisation_id, deletion_request_id, subject_table, subject_id, subject_description, file_hashes, external_results)
  values
    (v_req.organisation_id, v_req.id, 'meetings', v_req.subject_id,
     format('Draft notes for "%s" held %s: %s note record(s) deleted', v_meeting.title,
            to_char(v_meeting.scheduled_at at time zone 'Australia/Sydney', 'DD Mon YYYY'), v_count),
     v_hashes,
     jsonb_build_object('microsoft_365', 'Not applicable: no recording or transcript was captured for this meeting'))
  returning id into v_certificate;

  update public.deletion_requests set status = 'completed' where id = v_req.id;
  return v_certificate;
end;
$$;

-- ---------------------------------------------------------------------
-- Adding a member (the person must have signed in once already)
-- ---------------------------------------------------------------------
create or replace function public.add_member(p_org uuid, p_email text, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not app.has_role(p_org, app.admin_roles()) then
    raise exception 'Only an owner or admin can add members';
  end if;
  if p_role = 'owner' and not app.has_role(p_org, array['owner']::public.member_role[]) then
    raise exception 'Only an owner can add another owner';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is null then
    raise exception 'No account uses that email yet. Ask them to sign in to Common Seal once, then add them.';
  end if;

  insert into public.memberships (organisation_id, user_id, role)
  values (p_org, v_user, p_role)
  on conflict (organisation_id, user_id) do update set role = excluded.role, is_active = true;

  if not exists (select 1 from public.people p where p.organisation_id = p_org and p.user_id = v_user) then
    insert into public.people (organisation_id, user_id, full_name, email) values (p_org, v_user, v_email, v_email);
  end if;
end;
$$;

revoke execute on function public.request_meeting_wipe(uuid) from public, anon;
revoke execute on function public.execute_meeting_wipe(uuid) from public, anon;
revoke execute on function public.add_member(uuid, text, public.member_role) from public, anon;
grant execute on function public.request_meeting_wipe(uuid) to authenticated;
grant execute on function public.execute_meeting_wipe(uuid) to authenticated;
grant execute on function public.add_member(uuid, text, public.member_role) to authenticated;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.bodies, public.meetings, public.agenda_items, public.attendance,
  public.meeting_captures, public.resolutions, public.minutes from anon, authenticated;
grant select, insert, update on public.bodies, public.meetings, public.agenda_items, public.attendance,
  public.meeting_captures, public.resolutions, public.minutes to authenticated;
grant delete on public.agenda_items to authenticated;   -- agenda can be trimmed before minutes are final
grant all on public.bodies, public.meetings, public.agenda_items, public.attendance,
  public.meeting_captures, public.resolutions, public.minutes to service_role;

alter table public.bodies           enable row level security;
alter table public.meetings         enable row level security;
alter table public.agenda_items     enable row level security;
alter table public.attendance       enable row level security;
alter table public.meeting_captures enable row level security;
alter table public.resolutions      enable row level security;
alter table public.minutes          enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['bodies', 'meetings', 'agenda_items', 'attendance', 'resolutions', 'minutes'] loop
    execute format('create policy %I on public.%I for select to authenticated using (app.has_role(organisation_id, app.board_read_roles()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_role(organisation_id, app.board_write_roles()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_role(organisation_id, app.board_write_roles())) with check (app.has_role(organisation_id, app.board_write_roles()))', t || '_update', t);
  end loop;
end;
$$;

create policy agenda_items_delete on public.agenda_items for delete to authenticated
  using (app.has_role(organisation_id, app.board_write_roles()));

-- Draft notes are visible to a narrower group than the finished record
create policy meeting_captures_select on public.meeting_captures for select to authenticated
  using (app.has_role(organisation_id, app.notes_roles()));
create policy meeting_captures_insert on public.meeting_captures for insert to authenticated
  with check (app.has_role(organisation_id, app.board_write_roles()));
create policy meeting_captures_update on public.meeting_captures for update to authenticated
  using (app.has_role(organisation_id, app.board_write_roles()))
  with check (app.has_role(organisation_id, app.board_write_roles()));
