-- 0054: Confidential projects.
--
-- A light protocol for projects that involve confidential information
-- (acquisitions, investments, partnerships, licensing): a code name, a list of
-- who is inside, an acknowledged confidentiality notice, the NDA's basic
-- terms, a closing routine, and a notice when confidentiality ends.
--
-- Who does what:
--   * Any member can start a project and becomes its lead. The lead drives it:
--     adds people (with the reason), issues the notices, keeps the
--     distribution list (DL) up to date, and closes it.
--   * Each project has a legal contact, the escalation point. By default the
--     General Counsel; if there is none, the CEO; if neither (or the default
--     would be the lead themselves), the directors.
--   * Owners and admins (and directors) see the register: code name, status,
--     lead, dates and whether the protocol is being followed. They do not see
--     the purpose, counterparty, terms or list unless they are on it.
--
-- The platform sends no email. Notices are opened as ready-to-send emails to
-- the project DL, and each person on the list has a personal link the lead can
-- paste into an email or invitation to acknowledge the notice (and, at close,
-- to confirm they have deleted the material).
--
-- Ladder up (code name only): acknowledgements outstanding after 5 days, a
-- project past its expected close date, closure confirmations outstanding 14
-- days after close, and a DL not updated 3 days after the list changed.

create table public.conf_projects (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  entity_id             uuid references public.entities (id) on delete set null,
  code_name             text not null check (char_length(btrim(code_name)) between 2 and 60),
  kind                  text not null default 'other' check (kind in ('acquisition', 'investment', 'partnership', 'licensing', 'other')),
  status                text not null default 'open' check (status in ('open', 'paused', 'closed')),
  started_on            date not null default current_date,
  expected_close_on     date,
  closed_on             date,
  outcome               text check (outcome is null or outcome in ('completed', 'not_proceeding', 'other')),
  outcome_note          text,
  lead_user_id          uuid not null references auth.users (id),
  legal_user_id         uuid references auth.users (id) on delete set null,      -- null: the directors
  -- Details, seen only by the people on the project
  purpose               text,
  counterparty          text,
  counterparty_listed   boolean not null default false,
  counterparty_competitor boolean not null default false,
  related_project       text,
  -- NDA basic terms
  nda_status            text not null default 'pending' check (nda_status in ('pending', 'signed', 'not_needed')),
  nda_signed_on         date,
  conf_term_months      integer check (conf_term_months is null or conf_term_months between 1 and 600),
  conf_ends_on          date,
  trade_secret_split    boolean not null default false,
  trade_secret_ends_on  date,          -- null with the split: for as long as they remain trade secrets
  non_solicit_ends_on   date,
  standstill_ends_on    date,
  return_destroy        text check (return_destroy is null or return_destroy in ('on_request', 'on_close', 'none')),
  certify_within_days   integer check (certify_within_days is null or certify_within_days between 1 and 365),
  nda_notes             text,
  nda_request           jsonb not null default '{}'::jsonb check (jsonb_typeof(nda_request) = 'object'),  -- the external NDA form, kept until sending is switched on
  -- Distribution list and notices
  dl_address            text,
  dl_synced_at          timestamptz,
  kickoff_text          text,
  kickoff_issued_at     timestamptz,
  closure_text          text,
  closure_needs_deletion boolean not null default true,
  closure_issued_at     timestamptz,
  ended_notice_at       timestamptz,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (status <> 'closed' or (closed_on is not null and outcome is not null)),
  check (not trade_secret_split or conf_ends_on is not null or conf_term_months is not null)
);
-- Code names are never reused in an organisation, even after a project closes
create unique index conf_projects_code_name on public.conf_projects (organisation_id, lower(btrim(code_name)));

create table public.conf_members (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  project_id           uuid not null references public.conf_projects (id) on delete cascade,
  user_id              uuid references auth.users (id) on delete set null,      -- set when the person has a VeraPhius account
  full_name            text not null check (char_length(btrim(full_name)) between 2 and 120),
  email                text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  title                text,
  function             text,
  organisation_name    text,            -- for advisers: their firm
  reason               text not null check (char_length(btrim(reason)) >= 3),
  added_by             uuid references auth.users (id) on delete set null,
  added_at             timestamptz not null default now(),         -- obtained access
  removed_at           timestamptz,                                -- ceased to have access
  token                text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  acknowledged_at      timestamptz,
  ack_name             text,
  ack_method           text check (ack_method is null or ack_method in ('in_app', 'link', 'recorded')),
  closure_confirmed_at timestamptz,
  closure_name         text,
  closure_method       text check (closure_method is null or closure_method in ('in_app', 'link', 'recorded'))
);
create index conf_members_project_idx on public.conf_members (project_id);
create unique index conf_members_one_user on public.conf_members (project_id, user_id) where user_id is not null and removed_at is null;

-- ---------------------------------------------------------------------
-- Who is who
-- ---------------------------------------------------------------------
-- The default legal contact: the General Counsel, then the CEO; null means the directors
create or replace function app.conf_default_legal(p_org uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select x.user_id from (
    select pe.user_id, case when po.title ~* '(general counsel|chief legal|head of legal|legal director)' then 1 else 2 end as rank
    from public.positions po
    join public.position_assignments pa on pa.position_id = po.id and pa.starts_on <= current_date and (pa.ends_on is null or pa.ends_on >= current_date)
    join public.people pe on pe.id = pa.person_id and pe.user_id is not null
    join public.memberships m on m.organisation_id = p_org and m.user_id = pe.user_id and m.is_active
    where po.organisation_id = p_org and po.is_active
      and po.title ~* '(general counsel|chief legal|head of legal|legal director|chief executive|\mceo\M|managing director)'
  ) x order by x.rank limit 1;
$$;

-- Lead, legal contact, or (where there is no legal contact) a director: can manage the project
create or replace function app.conf_can_manage(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conf_projects p
    where p.id = p_project and app.is_member(p.organisation_id)
      and (p.lead_user_id = auth.uid() or p.legal_user_id = auth.uid()
           or (p.legal_user_id is null and app.has_role(p.organisation_id, array['director']::public.member_role[])))
  );
$$;
-- On the list (and not removed), or able to manage: can see the detail
create or replace function app.conf_can_read(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.conf_can_manage(p_project)
      or exists (select 1 from public.conf_members m join public.conf_projects p on p.id = m.project_id
                 where m.project_id = p_project and m.user_id = auth.uid() and m.removed_at is null and app.is_member(p.organisation_id));
$$;

-- ---------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------
create or replace function app.guard_conf_project()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.lead_user_id and m.is_active) then
    raise exception 'The lead must be an active member of this organisation';
  end if;
  if new.legal_user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.legal_user_id and m.is_active) then
    raise exception 'The legal contact must be an active member of this organisation';
  end if;
  if tg_op = 'UPDATE' then
    if lower(btrim(new.code_name)) <> lower(btrim(old.code_name)) then
      raise exception 'A code name cannot be changed once the project has started';
    end if;
    if old.status = 'closed' and new.status <> 'closed' and new.closure_issued_at is not null then
      raise exception 'A closed project whose closure notice has gone out cannot be reopened. Start a new project instead.';
    end if;
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    new.closed_on := coalesce(new.closed_on, current_date);
    if new.outcome is null then
      raise exception 'Record the outcome to close the project';
    end if;
  end if;
  if new.closed_on > current_date or new.nda_signed_on > current_date then
    raise exception 'That date cannot be in the future';
  end if;
  -- The confidentiality end date follows the term when one is given
  if new.conf_term_months is not null and new.nda_signed_on is not null
     and (tg_op = 'INSERT' or new.conf_term_months is distinct from old.conf_term_months or new.nda_signed_on is distinct from old.nda_signed_on or new.conf_ends_on is null) then
    new.conf_ends_on := (new.nda_signed_on + make_interval(months => new.conf_term_months))::date;
  end if;
  if not new.trade_secret_split then
    new.trade_secret_ends_on := null;
  end if;
  return new;
end;
$$;
create trigger conf_projects_guard before insert or update on public.conf_projects for each row execute function app.guard_conf_project();

create or replace function app.guard_conf_member()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  select p.status into v_status from public.conf_projects p where p.id = new.project_id and p.organisation_id = new.organisation_id;
  if v_status is null then
    raise exception 'That project is not in this organisation';
  end if;
  if new.user_id is not null and not exists (select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.user_id and m.is_active) then
    raise exception 'That person is not an active member of this organisation';
  end if;
  if tg_op = 'INSERT' then
    if v_status = 'closed' then
      raise exception 'The project is closed';
    end if;
    new.added_by := coalesce(auth.uid(), new.added_by);
    new.added_at := now();
  else
    if new.removed_at is not null and old.removed_at is null then
      new.removed_at := now();
    end if;
    if old.removed_at is not null and new.removed_at is null then
      raise exception 'Add the person again instead of restoring them, so the list shows each period of access';
    end if;
  end if;
  -- Acknowledgements and closure confirmations are recorded only through the functions below,
  -- or by the lead as "recorded" (for example an email reply)
  if current_setting('app.conf_system', true) is distinct from 'on' then
    if (tg_op = 'INSERT' and (new.acknowledged_at is not null or new.closure_confirmed_at is not null))
       or (tg_op = 'UPDATE' and (new.acknowledged_at is distinct from old.acknowledged_at or new.closure_confirmed_at is distinct from old.closure_confirmed_at)) then
      raise exception 'Use the acknowledgement buttons';
    end if;
  end if;
  return new;
end;
$$;
create trigger conf_members_guard before insert or update on public.conf_members for each row execute function app.guard_conf_member();

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------
-- Is a code name free? (Code names of closed projects stay taken.)
create or replace function public.conf_name_available(p_org uuid, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_member(p_org) and char_length(btrim(coalesce(p_name, ''))) >= 2
     and not exists (select 1 from public.conf_projects p where p.organisation_id = p_org and lower(btrim(p.code_name)) = lower(btrim(p_name)));
$$;

-- Start a project: the caller becomes the lead and the first person on the list
create or replace function public.start_conf_project(p_org uuid, p_code_name text, p_kind text, p_expected_close date, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_name text;
  v_email text;
begin
  if not app.is_member(p_org) then
    raise exception 'Not allowed';
  end if;
  if not public.conf_name_available(p_org, p_code_name) then
    raise exception 'That code name has already been used. Choose another.';
  end if;
  insert into public.conf_projects (organisation_id, code_name, kind, expected_close_on, lead_user_id, legal_user_id, created_by)
  values (p_org, btrim(p_code_name), coalesce(p_kind, 'other'), p_expected_close, auth.uid(), nullif(app.conf_default_legal(p_org), auth.uid()), auth.uid())
  returning id into v_id;
  select coalesce(nullif(btrim(pe.full_name), ''), u.email), u.email into v_name, v_email
  from auth.users u left join public.people pe on pe.user_id = u.id and pe.organisation_id = p_org where u.id = auth.uid() limit 1;
  insert into public.conf_members (organisation_id, project_id, user_id, full_name, email, reason)
  values (p_org, v_id, auth.uid(), coalesce(v_name, 'Project lead'), v_email, coalesce(nullif(btrim(p_reason), ''), 'Project lead'));
  return v_id;
end;
$$;

-- The register: what owners, admins, directors and the records roles see, plus every project the caller is on
create or replace function public.conf_register(p_org uuid)
returns table (id uuid, code_name text, status text, started_on date, expected_close_on date, closed_on date, conf_ends_on date,
               lead_name text, legal_name text, on_list integer, not_acknowledged integer, closure_outstanding integer,
               dl_out_of_date boolean, overdue boolean, can_read boolean, can_manage boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.code_name, p.status, p.started_on, p.expected_close_on, p.closed_on, p.conf_ends_on,
         (select coalesce(nullif(btrim(pe.full_name), ''), u.email)::text from auth.users u left join public.people pe on pe.user_id = u.id and pe.organisation_id = p.organisation_id where u.id = p.lead_user_id limit 1),
         coalesce((select coalesce(nullif(btrim(pe.full_name), ''), u.email)::text from auth.users u left join public.people pe on pe.user_id = u.id and pe.organisation_id = p.organisation_id where u.id = p.legal_user_id limit 1), 'The directors'),
         (select count(*)::int from public.conf_members m where m.project_id = p.id and m.removed_at is null),
         (select count(*)::int from public.conf_members m where m.project_id = p.id and m.removed_at is null and m.acknowledged_at is null),
         case when p.closure_issued_at is not null and p.closure_needs_deletion
              then (select count(*)::int from public.conf_members m where m.project_id = p.id and m.closure_confirmed_at is null and m.acknowledged_at is not null) else 0 end,
         p.status <> 'closed' and p.dl_address is not null and (p.dl_synced_at is null or exists (
           select 1 from public.conf_members m where m.project_id = p.id and (m.added_at > p.dl_synced_at or m.removed_at > p.dl_synced_at))),
         p.status = 'open' and p.expected_close_on < current_date,
         app.conf_can_read(p.id), app.conf_can_manage(p.id)
  from public.conf_projects p
  where p.organisation_id = p_org and app.is_member(p_org)
    and (app.has_role(p_org, app.board_read_roles()) or app.conf_can_read(p.id))
  order by (p.status = 'closed'), p.started_on desc;
$$;

-- Acknowledge in VeraPhius
create or replace function public.conf_acknowledge(p_member uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Type your name';
  end if;
  perform set_config('app.conf_system', 'on', true);
  update public.conf_members m set acknowledged_at = coalesce(m.acknowledged_at, now()), ack_name = coalesce(m.ack_name, btrim(p_name)), ack_method = coalesce(m.ack_method, 'in_app')
   where m.id = p_member and m.user_id = auth.uid() and m.removed_at is null;
  if not found then
    raise exception 'Not allowed';
  end if;
  perform set_config('app.conf_system', 'off', true);
end;
$$;
create or replace function public.conf_confirm_closure(p_member uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Type your name';
  end if;
  perform set_config('app.conf_system', 'on', true);
  update public.conf_members m set closure_confirmed_at = coalesce(m.closure_confirmed_at, now()), closure_name = coalesce(m.closure_name, btrim(p_name)), closure_method = coalesce(m.closure_method, 'in_app')
   where m.id = p_member and m.user_id = auth.uid()
     and exists (select 1 from public.conf_projects p where p.id = m.project_id and p.closure_issued_at is not null);
  if not found then
    raise exception 'Not allowed';
  end if;
  perform set_config('app.conf_system', 'off', true);
end;
$$;
-- The lead records an acknowledgement or confirmation received another way (for example an email reply)
create or replace function public.conf_record(p_member uuid, p_what text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.conf_members%rowtype;
begin
  select * into m from public.conf_members x where x.id = p_member;
  if m.id is null or not app.conf_can_manage(m.project_id) then
    raise exception 'Not allowed';
  end if;
  perform set_config('app.conf_system', 'on', true);
  if p_what = 'ack' then
    update public.conf_members set acknowledged_at = coalesce(acknowledged_at, now()), ack_name = coalesce(ack_name, full_name), ack_method = coalesce(ack_method, 'recorded') where id = p_member;
  elsif p_what = 'closure' then
    update public.conf_members set closure_confirmed_at = coalesce(closure_confirmed_at, now()), closure_name = coalesce(closure_name, full_name), closure_method = coalesce(closure_method, 'recorded') where id = p_member;
  else
    raise exception 'Unknown';
  end if;
  perform set_config('app.conf_system', 'off', true);
end;
$$;

-- The personal link: shows only the code name and the notice, never the list or the terms
create or replace function public.conf_link(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code_name', p.code_name, 'organisation', o.name, 'full_name', m.full_name, 'removed', m.removed_at is not null,
    'stage', case when p.closure_issued_at is not null then 'closure' else 'kickoff' end,
    'notice', case when p.closure_issued_at is not null then p.closure_text else p.kickoff_text end,
    'needs_deletion', p.closure_needs_deletion,
    'acknowledged_at', m.acknowledged_at, 'closure_confirmed_at', m.closure_confirmed_at)
  from public.conf_members m
  join public.conf_projects p on p.id = m.project_id
  join public.organisations o on o.id = p.organisation_id
  where m.token = p_token and char_length(p_token) = 64 and (p.kickoff_text is not null or p.closure_text is not null);
$$;
create or replace function public.conf_link_confirm(p_token text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.conf_members%rowtype;
  p public.conf_projects%rowtype;
begin
  select * into m from public.conf_members x where x.token = p_token and char_length(p_token) = 64;
  if m.id is null then
    raise exception 'This link is not valid. Ask the project lead for a new one.';
  end if;
  select * into p from public.conf_projects x where x.id = m.project_id;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Type your name';
  end if;
  perform set_config('app.conf_system', 'on', true);
  if p.closure_issued_at is not null then
    update public.conf_members set closure_confirmed_at = coalesce(closure_confirmed_at, now()), closure_name = coalesce(closure_name, btrim(p_name)), closure_method = coalesce(closure_method, 'link') where id = m.id;
  elsif m.removed_at is null and p.kickoff_text is not null then
    update public.conf_members set acknowledged_at = coalesce(acknowledged_at, now()), ack_name = coalesce(ack_name, btrim(p_name)), ack_method = coalesce(ack_method, 'link') where id = m.id;
  else
    raise exception 'There is nothing to acknowledge on this link';
  end if;
  perform set_config('app.conf_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up: code name only
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities', 'compliance_obligations', 'whs_incidents', 'whs_hazards', 'privacy_breaches',
                          'abc_risks', 'abc_programme', 'abc_assessments', 'compliance_checks', 'standard_form_contracts', 'acquisitions', 'conf_projects'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%conf_projects%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    select 'conf_projects', cp.id, 'Confidential projects', app.risk_feed_category(p_review, array['legal and compliance', 'legal', 'compliance']),
           'Project ' || cp.code_name || ': ' || case
             when cp.status = 'open' and cp.expected_close_on < current_date then 'past its expected close date'
             when exists (select 1 from public.conf_members m where m.project_id = cp.id and m.removed_at is null and m.acknowledged_at is null and m.added_at < now() - interval '5 days' and cp.kickoff_text is not null)
               then 'confidentiality notice not acknowledged by everyone on the list'
             when cp.closure_issued_at < now() - interval '14 days' then 'deletion not confirmed by everyone after close'
             else 'distribution list not updated after the list changed' end,
           'The project lead to follow up; escalate to the legal contact',
           (select coalesce(nullif(btrim(pe.full_name), ''), u.email)::text from auth.users u left join public.people pe on pe.user_id = u.id and pe.organisation_id = v_org where u.id = cp.lead_user_id limit 1),
           coalesce(cp.expected_close_on, cp.started_on)
    from public.conf_projects cp
    where cp.organisation_id = v_org and cp.status <> 'paused'
      and ((cp.status = 'open' and cp.expected_close_on < current_date)
           or (cp.status <> 'closed' and cp.kickoff_text is not null and exists (select 1 from public.conf_members m where m.project_id = cp.id and m.removed_at is null and m.acknowledged_at is null and m.added_at < now() - interval '5 days'))
           or (cp.closure_issued_at < now() - interval '14 days' and cp.closure_needs_deletion
               and exists (select 1 from public.conf_members m where m.project_id = cp.id and m.acknowledged_at is not null and m.closure_confirmed_at is null))
           or (cp.status <> 'closed' and cp.dl_address is not null and exists (select 1 from public.conf_members m where m.project_id = cp.id
                and (m.added_at > coalesce(cp.dl_synced_at, '-infinity') or m.removed_at > coalesce(cp.dl_synced_at, '-infinity'))
                and greatest(m.added_at, coalesce(m.removed_at, m.added_at)) < now() - interval '3 days')))
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%conf_projects%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: the fully signed NDA (and only that, for now)
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%conf_projects%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''conf_projects''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%conf_projects%' then
    v_def := replace(v_def, $x$  elsif p_table = 'acquisitions' then$x$, $x$  elsif p_table = 'conf_projects' then
    select p.organisation_id, app.conf_can_manage(p.id) into v_org, v_ok from public.conf_projects p where p.id = p_id;
  elsif p_table = 'acquisitions' then$x$);
    if v_def not like '%conf_projects%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
  v_def := pg_get_functiondef('app.can_read_subject(text, uuid)'::regprocedure);
  if v_def not like '%conf_projects%' then
    v_def := replace(v_def, $x$  elsif p_table = 'acquisitions' then$x$, $x$  elsif p_table = 'conf_projects' then
    return app.conf_can_read(p_id);
  elsif p_table = 'acquisitions' then$x$);
    if v_def not like '%conf_projects%' then
      raise exception 'Could not extend app.can_read_subject';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%conf_projects%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;
create or replace function app.sensitive_subject(p_table text)
returns boolean language sql immutable as $$
  select p_table in ('expense_claims', 'dd_cases', 'share_movements', 'share_classes', 'esop_plans', 'esop_grants', 'convertibles', 'investor_consents',
                     'bank_accounts', 'credit_facilities', 'corporate_documents', 'asic_filings', 'annual_reviews', 'obligation_completions',
                     'whs_incidents', 'whs_hazards', 'whs_due_diligence', 'privacy_breaches', 'personal_info_holdings', 'automated_decisions',
                     'abc_assessments', 'abc_programme', 'compliance_checks', 'standard_form_contracts', 'acquisitions', 'conf_projects');
$$;

-- Files on a confidential project are not open to the records roles either: only to the project's own people
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.can_read_document(uuid)'::regprocedure);
  if v_def not like '%conf_projects%' then
    v_def := replace(v_def, $x$        not d.is_restricted
        or app.has_role(d.organisation_id, app.records_roles())$x$, $x$        (not d.is_restricted
         or app.has_role(d.organisation_id, app.records_roles()))
        and not exists (select 1 from public.document_links l where l.document_id = d.id and l.subject_table = 'conf_projects' and not app.conf_can_read(l.subject_id))$x$);
    if v_def not like '%conf_projects%' then
      raise exception 'Could not update app.can_read_document';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.conf_projects, public.conf_members from anon, authenticated;
grant select on public.conf_projects, public.conf_members to authenticated;
grant update (entity_id, kind, status, expected_close_on, closed_on, outcome, outcome_note, legal_user_id, lead_user_id, purpose, counterparty, counterparty_listed,
              counterparty_competitor, related_project, nda_status, nda_signed_on, conf_term_months, conf_ends_on, trade_secret_split, trade_secret_ends_on,
              non_solicit_ends_on, standstill_ends_on, return_destroy, certify_within_days, nda_notes, nda_request, dl_address, dl_synced_at,
              kickoff_text, kickoff_issued_at, closure_text, closure_needs_deletion, closure_issued_at, ended_notice_at)
  on public.conf_projects to authenticated;
grant insert (organisation_id, project_id, user_id, full_name, email, title, function, organisation_name, reason),
      update (full_name, email, title, function, organisation_name, reason, removed_at)
  on public.conf_members to authenticated;
grant all on public.conf_projects, public.conf_members to service_role;

alter table public.conf_projects enable row level security;
alter table public.conf_members enable row level security;
-- Projects are started through start_conf_project; there is no direct insert, and nothing is ever deleted
create policy conf_projects_select on public.conf_projects for select to authenticated using (app.conf_can_read(id));
create policy conf_projects_update on public.conf_projects for update to authenticated using (app.conf_can_manage(id)) with check (app.conf_can_manage(id));
create policy conf_members_select on public.conf_members for select to authenticated using (app.conf_can_read(project_id));
create policy conf_members_insert on public.conf_members for insert to authenticated with check (app.conf_can_manage(project_id));
create policy conf_members_update on public.conf_members for update to authenticated using (app.conf_can_manage(project_id)) with check (app.conf_can_manage(project_id));

create trigger conf_projects_touch before update on public.conf_projects for each row execute function app.touch_updated_at();
create trigger conf_projects_audit after insert or update or delete on public.conf_projects for each row execute function app.audit_row();
create trigger conf_members_audit after insert or update or delete on public.conf_members for each row execute function app.audit_row();

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
grant execute on function app.can_read_abc(uuid) to authenticated;
grant execute on function app.can_read_regulatory(uuid) to authenticated;
grant execute on function app.conf_can_read(uuid), app.conf_can_manage(uuid) to authenticated;
revoke execute on function public.conf_name_available(uuid, text), public.start_conf_project(uuid, text, text, date, text), public.conf_register(uuid),
                           public.conf_acknowledge(uuid, text), public.conf_confirm_closure(uuid, text), public.conf_record(uuid, text),
                           public.conf_link(text), public.conf_link_confirm(text, text) from public, anon;
grant execute on function public.conf_name_available(uuid, text), public.start_conf_project(uuid, text, text, date, text), public.conf_register(uuid),
                          public.conf_acknowledge(uuid, text), public.conf_confirm_closure(uuid, text), public.conf_record(uuid, text) to authenticated;
grant execute on function public.conf_link(text), public.conf_link_confirm(text, text) to anon, authenticated;
