-- =====================================================================
-- Common Seal - 0014: speak-up reports and investigations
--
-- Confidentiality comes first here, so this module does not follow the
-- usual pattern:
--   * A report is visible only to the people given access to that case.
--     Owners and administrators do not see reports by virtue of role.
--   * The reporter chooses which report recipients are left out, so a
--     report about a recipient never reaches that person.
--   * An anonymous report stores nothing that identifies the reporter.
--     They follow it up with a code shown once; only its hash is kept.
--   * None of these tables write to the general audit log, which other
--     roles can read. Each case keeps its own log instead, and that log
--     never records who the reporter is.
--   * Cases never create tasks, which the whole organisation can see.
-- =====================================================================

create type public.speak_up_status as enum ('new', 'assessing', 'investigating', 'closed');

-- The people appointed to receive reports. Everyone can see who they are.
create table public.speak_up_handlers (
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  added_by         uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table public.speak_up_cases (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  reference             text not null,
  category              text not null,
  description           text not null check (char_length(btrim(description)) >= 20),
  is_anonymous          boolean not null default true,
  -- Null for an anonymous report
  reporter_user_id      uuid references auth.users (id) on delete set null,
  code_hash             text not null unique,
  status                public.speak_up_status not null default 'new',
  -- Whether the report appears to qualify for whistleblower protection
  protection            text not null default 'unassessed' check (protection in ('unassessed', 'yes', 'no')),
  investigator_user_id  uuid references auth.users (id) on delete set null,
  findings              text,
  outcome               text check (outcome in ('substantiated', 'partly_substantiated', 'not_substantiated', 'not_investigated')),
  received_at           timestamptz not null default now(),
  closed_at             timestamptz,
  unique (organisation_id, reference)
);
create index speak_up_cases_org_idx on public.speak_up_cases (organisation_id, status);

create table public.speak_up_case_access (
  case_id     uuid not null references public.speak_up_cases (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  granted_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (case_id, user_id)
);

-- Messages between the case team and the reporter. The reporter's side never carries a user id.
create table public.speak_up_messages (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  case_id          uuid not null references public.speak_up_cases (id) on delete cascade,
  from_reporter    boolean not null default false,
  author_user_id   uuid references auth.users (id) on delete set null,
  body             text not null check (char_length(btrim(body)) >= 1),
  created_at       timestamptz not null default now(),
  check (not from_reporter or author_user_id is null)
);
create index speak_up_messages_case_idx on public.speak_up_messages (case_id, created_at);

-- Working notes of the case team. The reporter never sees these.
create table public.speak_up_notes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  case_id          uuid not null references public.speak_up_cases (id) on delete cascade,
  author_user_id   uuid references auth.users (id) on delete set null,
  body             text not null check (char_length(btrim(body)) >= 1),
  created_at       timestamptz not null default now()
);
create index speak_up_notes_case_idx on public.speak_up_notes (case_id, created_at);

-- The case's own log. actor_user_id is null for anything the reporter did.
create table public.speak_up_events (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null,
  case_id          uuid not null references public.speak_up_cases (id) on delete cascade,
  actor_user_id    uuid,
  event            text not null,
  created_at       timestamptz not null default now()
);
create index speak_up_events_case_idx on public.speak_up_events (case_id, created_at);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function app.can_see_case(p_case uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.speak_up_case_access a
    join public.speak_up_cases c on c.id = a.case_id
    where a.case_id = p_case and a.user_id = auth.uid() and app.is_member(c.organisation_id));
$$;

create or replace function app.speak_up_hash(p_code text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex');
$$;

create or replace function app.guard_speak_up_handler()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m
                 where m.organisation_id = new.organisation_id and m.user_id = new.user_id and m.is_active) then
    raise exception 'A report recipient must be an active member of this organisation';
  end if;
  new.added_by := auth.uid();
  return new;
end;
$$;
create trigger speak_up_handlers_guard before insert on public.speak_up_handlers
  for each row execute function app.guard_speak_up_handler();

create or replace function app.stamp_speak_up_author()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.author_user_id := auth.uid();
  new.organisation_id := (select c.organisation_id from public.speak_up_cases c where c.id = new.case_id);
  if tg_table_name = 'speak_up_messages' then
    new.from_reporter := false;
  end if;
  return new;
end;
$$;
create trigger speak_up_messages_stamp before insert on public.speak_up_messages
  for each row when (not new.from_reporter) execute function app.stamp_speak_up_author();
create trigger speak_up_notes_stamp before insert on public.speak_up_notes
  for each row execute function app.stamp_speak_up_author();

create or replace function app.speak_up_fixed()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Speak-up records cannot be changed or removed';
end;
$$;
create trigger speak_up_messages_fixed before update or delete on public.speak_up_messages
  for each row execute function app.speak_up_fixed();
create trigger speak_up_notes_fixed before update or delete on public.speak_up_notes
  for each row execute function app.speak_up_fixed();
create trigger speak_up_events_fixed before update or delete on public.speak_up_events
  for each row execute function app.speak_up_fixed();

-- ---------------------------------------------------------------------
-- The reporter's side
-- ---------------------------------------------------------------------

-- Makes a report. Returns the reference and the follow-up code; the code is shown once and never stored.
create or replace function public.submit_speak_up(
  p_org uuid, p_category text, p_description text, p_anonymous boolean default true, p_exclude uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_raw text := upper(replace(gen_random_uuid()::text, '-', ''));
  v_code text;
  v_case uuid;
  v_ref text;
  v_recipients integer;
begin
  if not app.is_member(p_org) then
    raise exception 'You are not a member of this organisation';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) < 20 then
    raise exception 'Describe what happened in a little more detail';
  end if;
  if not exists (select 1 from public.speak_up_handlers h where h.organisation_id = p_org) then
    raise exception 'Nobody has been appointed to receive reports yet';
  end if;
  select count(*) into v_recipients
  from public.speak_up_handlers h
  join public.memberships m on m.organisation_id = h.organisation_id and m.user_id = h.user_id and m.is_active
  where h.organisation_id = p_org and not (h.user_id = any (coalesce(p_exclude, '{}')));
  if v_recipients = 0 then
    raise exception 'That would leave nobody to receive the report. Keep at least one recipient, or raise it outside the company.';
  end if;

  v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4) || '-' || substr(v_raw, 13, 4);
  perform pg_advisory_xact_lock(hashtext('speak_up:' || p_org::text));
  v_ref := 'SU-' || to_char(now() at time zone 'Australia/Sydney', 'YYYY') || '-' ||
           lpad(((select count(*) from public.speak_up_cases c where c.organisation_id = p_org) + 1)::text, 4, '0');

  insert into public.speak_up_cases (organisation_id, reference, category, description, is_anonymous, reporter_user_id, code_hash)
  values (p_org, v_ref, coalesce(nullif(btrim(p_category), ''), 'Other'), btrim(p_description),
          coalesce(p_anonymous, true), case when coalesce(p_anonymous, true) then null else auth.uid() end,
          app.speak_up_hash(v_code))
  returning id into v_case;

  insert into public.speak_up_case_access (case_id, user_id)
  select v_case, h.user_id
  from public.speak_up_handlers h
  join public.memberships m on m.organisation_id = h.organisation_id and m.user_id = h.user_id and m.is_active
  where h.organisation_id = p_org and not (h.user_id = any (coalesce(p_exclude, '{}')));

  insert into public.speak_up_events (organisation_id, case_id, actor_user_id, event)
  values (p_org, v_case, null, format('Report received. Sent to %s recipient(s).', v_recipients));
  return jsonb_build_object('reference', v_ref, 'code', v_code);
end;
$$;

-- What the reporter sees with their code: the status and the messages, nothing else.
create or replace function public.speak_up_follow_up(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.speak_up_cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to follow up a report';
  end if;
  select * into v_c from public.speak_up_cases c where c.code_hash = app.speak_up_hash(p_code);
  if v_c.id is null or not app.is_member(v_c.organisation_id) then
    raise exception 'That code does not match a report';
  end if;
  return jsonb_build_object(
    'reference', v_c.reference, 'status', v_c.status, 'received_at', v_c.received_at, 'closed_at', v_c.closed_at,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('from_reporter', m.from_reporter, 'body', m.body, 'created_at', m.created_at)
                                           order by m.created_at)
                          from public.speak_up_messages m where m.case_id = v_c.id), '[]'::jsonb));
end;
$$;

create or replace function public.speak_up_reply(p_code text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.speak_up_cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to follow up a report';
  end if;
  select * into v_c from public.speak_up_cases c where c.code_hash = app.speak_up_hash(p_code);
  if v_c.id is null or not app.is_member(v_c.organisation_id) then
    raise exception 'That code does not match a report';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 1 then
    raise exception 'Write a message';
  end if;
  insert into public.speak_up_messages (organisation_id, case_id, from_reporter, author_user_id, body)
  values (v_c.organisation_id, v_c.id, true, null, btrim(p_body));
  insert into public.speak_up_events (organisation_id, case_id, actor_user_id, event)
  values (v_c.organisation_id, v_c.id, null, 'The reporter sent a message.');
end;
$$;

-- ---------------------------------------------------------------------
-- The case team's side
-- ---------------------------------------------------------------------
create or replace function public.update_speak_up_case(
  p_case uuid, p_status public.speak_up_status, p_protection text, p_investigator uuid, p_findings text, p_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_c public.speak_up_cases%rowtype;
  v_findings text := nullif(btrim(coalesce(p_findings, '')), '');
  v_outcome text := nullif(p_outcome, '');
begin
  select * into v_c from public.speak_up_cases c where c.id = p_case for update;
  if v_c.id is null or not app.can_see_case(p_case) then
    raise exception 'You do not have access to this case';
  end if;
  if v_c.status = 'closed' then
    raise exception 'This case is closed';
  end if;
  if p_investigator is not null and not exists
     (select 1 from public.speak_up_case_access a where a.case_id = p_case and a.user_id = p_investigator) then
    raise exception 'Give the investigator access to the case first';
  end if;
  if p_status = 'closed' and v_outcome is null then
    raise exception 'Record the outcome before closing';
  end if;
  if p_status = 'closed' and v_outcome <> 'not_investigated' and v_findings is null then
    raise exception 'Record the findings before closing';
  end if;

  update public.speak_up_cases
     set status = p_status, protection = coalesce(p_protection, protection), investigator_user_id = p_investigator,
         findings = v_findings, outcome = v_outcome,
         closed_at = case when p_status = 'closed' then now() else null end
   where id = p_case;

  insert into public.speak_up_events (organisation_id, case_id, actor_user_id, event)
  values (v_c.organisation_id, p_case, auth.uid(),
          case when p_status is distinct from v_c.status then format('Status changed to %s.', replace(p_status::text, '_', ' '))
               else 'Case details updated.' end);
end;
$$;

create or replace function public.grant_speak_up_access(p_case uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select c.organisation_id into v_org from public.speak_up_cases c where c.id = p_case;
  if v_org is null or not app.can_see_case(p_case) then
    raise exception 'You do not have access to this case';
  end if;
  if not exists (select 1 from public.memberships m where m.organisation_id = v_org and m.user_id = p_user and m.is_active) then
    raise exception 'That person is not an active member of this organisation';
  end if;
  insert into public.speak_up_case_access (case_id, user_id, granted_by) values (p_case, p_user, auth.uid())
  on conflict do nothing;
  insert into public.speak_up_events (organisation_id, case_id, actor_user_id, event)
  values (v_org, p_case, auth.uid(), 'Access to the case was given to another person.');
end;
$$;

-- Numbers only, for the board. No case details.
create or replace function public.speak_up_summary(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_role(p_org, app.board_read_roles()) or app.has_role(p_org, array['auditor']::public.member_role[])) then
    raise exception 'You do not have permission to see these numbers';
  end if;
  return (
    select jsonb_build_object(
      'recipients', (select count(*) from public.speak_up_handlers h where h.organisation_id = p_org),
      'open', count(*) filter (where c.status <> 'closed'),
      'open_over_90_days', count(*) filter (where c.status <> 'closed' and c.received_at < now() - interval '90 days'),
      'received_12_months', count(*) filter (where c.received_at > now() - interval '12 months'),
      'closed_12_months', count(*) filter (where c.closed_at > now() - interval '12 months'),
      'substantiated_12_months', count(*) filter (where c.closed_at > now() - interval '12 months'
                                                    and c.outcome in ('substantiated', 'partly_substantiated')))
    from public.speak_up_cases c where c.organisation_id = p_org);
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
create trigger speak_up_handlers_audit after insert or update or delete on public.speak_up_handlers
  for each row execute function app.audit_row();

revoke execute on function app.can_see_case(uuid), app.speak_up_hash(text) from public, anon;
grant execute on function app.can_see_case(uuid) to authenticated, service_role;
revoke execute on function public.submit_speak_up(uuid, text, text, boolean, uuid[]) from public, anon;
revoke execute on function public.speak_up_follow_up(text) from public, anon;
revoke execute on function public.speak_up_reply(text, text) from public, anon;
revoke execute on function public.update_speak_up_case(uuid, public.speak_up_status, text, uuid, text, text) from public, anon;
revoke execute on function public.grant_speak_up_access(uuid, uuid) from public, anon;
revoke execute on function public.speak_up_summary(uuid) from public, anon;
grant execute on function public.submit_speak_up(uuid, text, text, boolean, uuid[]) to authenticated;
grant execute on function public.speak_up_follow_up(text) to authenticated;
grant execute on function public.speak_up_reply(text, text) to authenticated;
grant execute on function public.update_speak_up_case(uuid, public.speak_up_status, text, uuid, text, text) to authenticated;
grant execute on function public.grant_speak_up_access(uuid, uuid) to authenticated;
grant execute on function public.speak_up_summary(uuid) to authenticated;

revoke all on public.speak_up_handlers, public.speak_up_cases, public.speak_up_case_access, public.speak_up_messages,
  public.speak_up_notes, public.speak_up_events from anon, authenticated;
grant select, insert, delete on public.speak_up_handlers to authenticated;
-- The follow-up code hash is never readable, even by the case team
grant select (id, organisation_id, reference, category, description, is_anonymous, reporter_user_id, status, protection,
              investigator_user_id, findings, outcome, received_at, closed_at) on public.speak_up_cases to authenticated;
grant select on public.speak_up_case_access, public.speak_up_events to authenticated;
grant select, insert on public.speak_up_messages, public.speak_up_notes to authenticated;
grant all on public.speak_up_handlers, public.speak_up_cases, public.speak_up_case_access, public.speak_up_messages,
  public.speak_up_notes, public.speak_up_events to service_role;

alter table public.speak_up_handlers    enable row level security;
alter table public.speak_up_cases       enable row level security;
alter table public.speak_up_case_access enable row level security;
alter table public.speak_up_messages    enable row level security;
alter table public.speak_up_notes       enable row level security;
alter table public.speak_up_events      enable row level security;

create policy speak_up_handlers_select on public.speak_up_handlers for select to authenticated
  using (app.is_member(organisation_id));
create policy speak_up_handlers_insert on public.speak_up_handlers for insert to authenticated
  with check (app.has_role(organisation_id, app.admin_roles()));
create policy speak_up_handlers_delete on public.speak_up_handlers for delete to authenticated
  using (app.has_role(organisation_id, app.admin_roles()));

create policy speak_up_cases_select on public.speak_up_cases for select to authenticated
  using (app.can_see_case(id));
create policy speak_up_case_access_select on public.speak_up_case_access for select to authenticated
  using (app.can_see_case(case_id));
create policy speak_up_events_select on public.speak_up_events for select to authenticated
  using (app.can_see_case(case_id));
create policy speak_up_messages_select on public.speak_up_messages for select to authenticated
  using (app.can_see_case(case_id));
create policy speak_up_messages_insert on public.speak_up_messages for insert to authenticated
  with check (app.can_see_case(case_id) and not from_reporter);
create policy speak_up_notes_select on public.speak_up_notes for select to authenticated
  using (app.can_see_case(case_id));
create policy speak_up_notes_insert on public.speak_up_notes for insert to authenticated
  with check (app.can_see_case(case_id));
