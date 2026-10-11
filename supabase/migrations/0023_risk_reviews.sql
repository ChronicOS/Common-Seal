-- =====================================================================
-- Common Seal - 0023: risk register as a review cycle
--
-- A risk review asks the people responsible for each risk category for
-- their incidents and updates, each with an action, an actioner and a
-- due date. Late responses are reminded twice and then escalated to a
-- manager. The report owner reviews and edits the inputs, sends back
-- questions, and finalises the report for the forum.
--
-- Timeline, counted back from the forum date:
--   day 0   requests go out            (forum - 31 days)
--   day 14  responses due, reminder 1
--   day 19  reminder 2
--   day 24  escalation to the manager; the report owner's week begins
--   day 31  the forum
--
-- Responsible users answer through a personal link with no account,
-- like the supplier questionnaire: two public functions that do nothing
-- without the long random code in the link.
--
-- The earlier standing register and attestation rounds are no longer
-- shown. Their tables are left in place so nothing recorded is lost.
-- =====================================================================

create table public.risk_categories (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  position         integer not null,
  name             text not null check (char_length(btrim(name)) >= 2),
  covers           text,
  -- Prompts only: examples of what would be material in this category
  examples         text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index risk_categories_name_idx on public.risk_categories (organisation_id, lower(btrim(name)));

-- Who answers for a category, and who it escalates to. People here need no Common Seal account.
create table public.risk_contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  category_id      uuid not null references public.risk_categories (id) on delete cascade,
  role             text not null check (role in ('responsible', 'manager')),
  name             text not null check (char_length(btrim(name)) >= 2),
  title            text,
  email            text not null check (email like '%_@_%._%'),
  created_at       timestamptz not null default now()
);
create index risk_contacts_category_idx on public.risk_contacts (category_id);

-- Who owns the report. They sign in, so they are members. Backups have the same rights.
create table public.risk_owners (
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  is_backup        boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create unique index risk_owners_one_owner_idx on public.risk_owners (organisation_id) where not is_backup;

create table public.risk_reviews (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) >= 3),
  forum            text,
  frequency        text not null default 'once' check (frequency in ('once', 'monthly', 'quarterly', 'half_yearly', 'annually')),
  forum_on         date not null,
  start_on         date not null,
  respond_by       date not null,
  reminder2_on     date not null,
  escalate_on      date not null,
  status           text not null default 'scheduled' check (status in ('scheduled', 'collecting', 'final', 'cancelled')),
  started_at       timestamptz,
  finalised_at     timestamptz,
  finalised_by     uuid references auth.users (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (start_on <= respond_by and respond_by <= reminder2_on and reminder2_on <= escalate_on and escalate_on <= forum_on)
);
create index risk_reviews_org_idx on public.risk_reviews (organisation_id, status, forum_on);

-- One request per category in a review. Its link is shared by that category's responsible users and, on escalation, their manager.
create table public.risk_requests (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  review_id          uuid not null references public.risk_reviews (id) on delete cascade,
  category_id        uuid not null references public.risk_categories (id) on delete restrict,
  token              text not null unique,
  sent_at            timestamptz,
  reminder1_sent_at  timestamptz,
  reminder2_sent_at  timestamptz,
  escalated_at       timestamptz,
  opened_at          timestamptz,
  submitted_at       timestamptz,
  submitted_by       text,
  nothing_to_report  boolean not null default false,
  -- The report owner's latest question, shown to the responsible user when the request is reopened
  query              text,
  queried_at         timestamptz,
  unique (review_id, category_id)
);
create index risk_requests_review_idx on public.risk_requests (review_id);

create table public.risk_items (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  review_id        uuid not null references public.risk_reviews (id) on delete cascade,
  category_id      uuid not null references public.risk_categories (id) on delete restrict,
  position         integer not null default 0,
  -- The incident or update
  title            text not null check (char_length(btrim(title)) >= 3),
  detail           text,
  -- The action, control or mitigation. Free text; "Continue to monitor" is a valid answer.
  action           text not null check (char_length(btrim(action)) >= 2),
  actioner         text,
  actioner_email   text check (actioner_email is null or actioner_email like '%_@_%._%'),
  due_on           date,
  is_closed        boolean not null default false,
  resolution       text,
  resolved_at      timestamptz,
  carried_from_id  uuid references public.risk_items (id) on delete set null,
  entered_by       text,
  -- The code in the actioner's own link, used for the prompts a week before and on the due date
  token            text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  prompt_week_sent_at timestamptz,
  prompt_due_sent_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index risk_items_review_idx on public.risk_items (review_id, category_id);

-- What the actioner reported back each time they were prompted
create table public.risk_item_updates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  item_id          uuid not null references public.risk_items (id) on delete cascade,
  by_name          text not null,
  resolved         boolean not null default false,
  note             text not null check (char_length(btrim(note)) >= 3),
  created_at       timestamptz not null default now()
);
create index risk_item_updates_item_idx on public.risk_item_updates (item_id, created_at);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function app.is_risk_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_member(p_org) and (
    exists (select 1 from public.risk_owners o where o.organisation_id = p_org and o.user_id = auth.uid())
    or app.has_role(p_org, app.admin_roles()));
$$;

create or replace function app.guard_risk_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m
                 where m.organisation_id = new.organisation_id and m.user_id = new.user_id and m.is_active) then
    raise exception 'The report owner must be an active member of this organisation';
  end if;
  return new;
end;
$$;
create trigger risk_owners_guard before insert or update on public.risk_owners
  for each row execute function app.guard_risk_owner();

-- The thirteen default categories, added the first time an organisation opens its risk register
create or replace function public.ensure_risk_categories(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, app.records_roles()) then
    return 0;
  end if;
  if exists (select 1 from public.risk_categories c where c.organisation_id = p_org) then
    return 0;
  end if;
  insert into public.risk_categories (organisation_id, position, name, covers, examples) values
    (p_org, 1, 'Commercial', null, 'Significant competitive activity. Significant customer activity. Significant regulatory or other external impacts. Major tender losses (or likely losses), or material detrimental changes to government or customer pricing or reimbursement.'),
    (p_org, 2, 'Corporate', null, 'Changes in ownership, structure or strategy. Acquisitions, disposals or integrations. Board or executive changes. Reputational issues or adverse media.'),
    (p_org, 3, 'Finance', null, 'Material variance to budget or forecast. Liquidity, covenant or funding pressure. Bad debts or customer credit issues. Tax or audit findings. Suspected fraud.'),
    (p_org, 4, 'Technology', 'IT, cyber, security and AI', 'Cyber incidents or near misses. System outages. Data loss or privacy breaches. Delayed or failing technology projects. New or unapproved use of AI.'),
    (p_org, 5, 'People', 'Training, conflicts of interest, HR issues, leavers and roles outstanding', 'Key leavers or roles vacant for an extended period. Overdue mandatory training. Conflicts of interest declared or suspected. Grievances, misconduct or safety incidents. Significant restructuring.'),
    (p_org, 6, 'Disputes', null, 'New or threatened claims by or against the company. Material developments in existing disputes. Regulator or ombudsman complaints. Material provisions or settlements.'),
    (p_org, 7, 'Supplier', null, 'Supply interruption or stock-outs. Supplier financial distress. Quality or audit failures at a supplier. Modern slavery or ethical concerns. Dependence on a single source.'),
    (p_org, 8, 'Intellectual Property', null, 'Infringement by or against the company. Trade mark or patent expiry, opposition or challenge. Loss or leakage of confidential information. Licence disputes.'),
    (p_org, 9, 'Product Quality/Complaints', null, 'Recalls or potential recalls. Serious or clustered complaints. Quality deviations or failed batches. Adverse event trends. Labelling or packaging errors.'),
    (p_org, 10, 'Regulatory', null, 'New or changed law or regulation affecting the business. Regulator inspections, enquiries or notices. Licence or registration renewals at risk. Advertising or promotional compliance issues.'),
    (p_org, 11, 'Legal and Compliance', null, 'Breaches or suspected breaches of law or policy. Bribery, sanctions, competition or privacy concerns. Material contract risks. Overdue policy reviews or compliance training.'),
    (p_org, 12, 'Investigations', null, 'New or ongoing internal investigations. Speak-up reports and their status. Regulator or law enforcement investigations. Outcomes and remediation.'),
    (p_org, 13, 'Any other risk', 'Anything not covered above', 'Use this for a risk that fits no other category, or add a bespoke category such as patient safety, ingredient or medical.');
  return 13;
end;
$$;

-- ---------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------
create or replace function app.guard_risk_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_system boolean := coalesce(current_setting('app.risk_system', true), 'off') = 'on';
begin
  if tg_op = 'INSERT' then
    new.status := 'scheduled'; new.started_at := null; new.finalised_at := null; new.finalised_by := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if v_system then
    return new;
  end if;
  if old.status in ('final', 'cancelled') then
    raise exception 'This review is finished and can no longer be changed';
  end if;
  if new.status <> old.status or new.organisation_id <> old.organisation_id
     or new.started_at is distinct from old.started_at or new.finalised_at is distinct from old.finalised_at then
    raise exception 'A review is started, finalised and cancelled with its own buttons';
  end if;
  return new;
end;
$$;
create trigger risk_reviews_guard before insert or update on public.risk_reviews
  for each row execute function app.guard_risk_review();

-- Starts a scheduled review: one request per active category, and open items carried forward from the last review.
create or replace function app.start_risk_review(p_review uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.risk_reviews%rowtype;
  v_prior uuid;
begin
  select * into v_r from public.risk_reviews r where r.id = p_review for update;
  if v_r.status <> 'scheduled' then
    return;
  end if;
  insert into public.risk_requests (organisation_id, review_id, category_id, token)
  select v_r.organisation_id, v_r.id, c.id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  from public.risk_categories c
  where c.organisation_id = v_r.organisation_id and c.is_active
    and exists (select 1 from public.risk_contacts k where k.category_id = c.id and k.role = 'responsible');

  select r.id into v_prior from public.risk_reviews r
   where r.organisation_id = v_r.organisation_id and r.status = 'final' and r.id <> v_r.id
   order by r.finalised_at desc limit 1;
  perform set_config('app.risk_system', 'on', true);
  if v_prior is not null then
    insert into public.risk_items (organisation_id, review_id, category_id, position, title, detail, action, actioner, actioner_email, due_on, carried_from_id, entered_by)
    select i.organisation_id, v_r.id, i.category_id, i.position, i.title, i.detail, i.action, i.actioner, i.actioner_email, i.due_on, i.id, 'Carried forward'
    from public.risk_items i
    where i.review_id = v_prior and not i.is_closed
      and exists (select 1 from public.risk_requests q where q.review_id = v_r.id and q.category_id = i.category_id);
  end if;
  update public.risk_reviews set status = 'collecting', started_at = now() where id = v_r.id;
  perform set_config('app.risk_system', 'off', true);
end;
$$;

-- p_forum_on null means run now: requests go out today and the forum is 31 days away.
create or replace function public.create_risk_review(p_org uuid, p_name text, p_forum text, p_forum_on date, p_frequency text default 'once')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_forum date := coalesce(p_forum_on, current_date + 31);
  v_start date;
  v_id uuid;
begin
  if not (app.has_role(p_org, app.records_roles()) or app.is_risk_owner(p_org)) then
    raise exception 'You do not have permission to set up a risk review';
  end if;
  if not exists (select 1 from public.risk_owners o where o.organisation_id = p_org and not o.is_backup) then
    raise exception 'Name the person responsible for the report first';
  end if;
  if not exists (select 1 from public.risk_categories c join public.risk_contacts k on k.category_id = c.id and k.role = 'responsible'
                 where c.organisation_id = p_org and c.is_active) then
    raise exception 'Assign a responsible person to at least one risk category first';
  end if;
  if v_forum < current_date then
    raise exception 'The forum date cannot be in the past';
  end if;
  -- Less than 31 days to the forum: start today and fit the steps into the time there is
  v_start := greatest(current_date, v_forum - 31);
  insert into public.risk_reviews (organisation_id, name, forum, frequency, forum_on, start_on, respond_by, reminder2_on, escalate_on)
  values (p_org, btrim(p_name), nullif(btrim(coalesce(p_forum, '')), ''), coalesce(p_frequency, 'once'), v_forum, v_start,
          least(v_start + 14, v_forum), least(v_start + 19, v_forum), least(v_start + 24, v_forum))
  returning id into v_id;
  if v_start <= current_date then
    perform app.start_risk_review(v_id);
  end if;
  return v_id;
end;
$$;

-- Starts any scheduled review whose start date has arrived. Called when the risk register is opened.
create or replace function public.start_due_risk_reviews(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not (app.has_role(p_org, app.records_roles()) or app.is_risk_owner(p_org)) then
    return 0;
  end if;
  for v_id in select r.id from public.risk_reviews r
              where r.organisation_id = p_org and r.status = 'scheduled' and r.start_on <= current_date loop
    perform app.start_risk_review(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.cancel_risk_review(p_review uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.risk_reviews%rowtype;
begin
  select * into v_r from public.risk_reviews r where r.id = p_review for update;
  if v_r.id is null or not (app.has_role(v_r.organisation_id, app.records_roles()) or app.is_risk_owner(v_r.organisation_id)) then
    raise exception 'You do not have permission to cancel this review';
  end if;
  if v_r.status in ('final', 'cancelled') then
    raise exception 'This review is already finished';
  end if;
  perform set_config('app.risk_system', 'on', true);
  update public.risk_reviews set status = 'cancelled' where id = p_review;
  perform set_config('app.risk_system', 'off', true);
end;
$$;

-- Finalises the report. A repeating review schedules its next occurrence.
create or replace function public.finalise_risk_review(p_review uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_r public.risk_reviews%rowtype;
  v_next date;
  v_next_id uuid;
  v_start date;
begin
  select * into v_r from public.risk_reviews r where r.id = p_review for update;
  if v_r.id is null or not app.is_risk_owner(v_r.organisation_id) then
    raise exception 'Only the person responsible for the report, or their backup, can finalise it';
  end if;
  if v_r.status <> 'collecting' then
    raise exception 'This review is not open';
  end if;
  perform set_config('app.risk_system', 'on', true);
  update public.risk_reviews set status = 'final', finalised_at = now(), finalised_by = auth.uid() where id = p_review;
  perform set_config('app.risk_system', 'off', true);

  if v_r.frequency <> 'once' then
    v_next := (v_r.forum_on + case v_r.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                                                 when 'half_yearly' then interval '6 months' else interval '12 months' end)::date;
    v_start := greatest(current_date + 1, v_next - 31);
    insert into public.risk_reviews (organisation_id, name, forum, frequency, forum_on, start_on, respond_by, reminder2_on, escalate_on)
    values (v_r.organisation_id, v_r.name, v_r.forum, v_r.frequency, greatest(v_next, v_start), v_start,
            least(v_start + 14, greatest(v_next, v_start)), least(v_start + 19, greatest(v_next, v_start)), least(v_start + 24, greatest(v_next, v_start)))
    returning id into v_next_id;
  end if;
  return v_next_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Items: written by the responsible user through their link, then edited by the report owner
-- ---------------------------------------------------------------------
create or replace function app.guard_risk_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if coalesce(current_setting('app.risk_system', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  select r.status into v_status from public.risk_reviews r where r.id = coalesce(new.review_id, old.review_id);
  if v_status is null then
    return coalesce(new, old);
  end if;
  if v_status <> 'collecting' then
    raise exception 'The report is final and its items can no longer be changed';
  end if;
  if tg_op <> 'DELETE' then
    if tg_op = 'UPDATE' and (new.review_id <> old.review_id or new.category_id <> old.category_id or new.organisation_id <> old.organisation_id) then
      raise exception 'An item cannot move to another review or category';
    end if;
    if tg_op = 'UPDATE' and (new.token <> old.token or new.prompt_week_sent_at is distinct from old.prompt_week_sent_at
                             or new.prompt_due_sent_at is distinct from old.prompt_due_sent_at) then
      raise exception 'Links and prompt dates are managed by the system';
    end if;
    if tg_op = 'INSERT' then
      if not exists (select 1 from public.risk_requests q where q.review_id = new.review_id and q.category_id = new.category_id) then
        raise exception 'That category is not part of this review';
      end if;
      new.organisation_id := (select r.organisation_id from public.risk_reviews r where r.id = new.review_id);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger risk_items_guard before insert or update or delete on public.risk_items
  for each row execute function app.guard_risk_item();

-- What a responsible user sees from their link
create or replace function public.risk_request(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_q public.risk_requests%rowtype;
  v_r public.risk_reviews%rowtype;
  v_c public.risk_categories%rowtype;
begin
  select * into v_q from public.risk_requests q where q.token = p_token and char_length(coalesce(p_token, '')) = 64;
  if v_q.id is null then
    raise exception 'This link is not valid';
  end if;
  select * into v_r from public.risk_reviews r where r.id = v_q.review_id;
  select * into v_c from public.risk_categories c where c.id = v_q.category_id;
  if v_q.opened_at is null and v_r.status = 'collecting' then
    update public.risk_requests set opened_at = now() where id = v_q.id;
  end if;
  return jsonb_build_object(
    'organisation', (select o.name from public.organisations o where o.id = v_q.organisation_id),
    'review', v_r.name, 'forum', v_r.forum, 'forum_on', v_r.forum_on, 'respond_by', v_r.respond_by,
    'open', v_r.status = 'collecting', 'submitted_at', v_q.submitted_at, 'nothing_to_report', v_q.nothing_to_report,
    'query', v_q.query,
    'category', v_c.name, 'covers', v_c.covers, 'examples', v_c.examples,
    'people', coalesce((select jsonb_agg(k.name order by k.role desc, k.name) from public.risk_contacts k where k.category_id = v_c.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'title', i.title, 'detail', i.detail, 'action', i.action, 'actioner', i.actioner, 'actioner_email', i.actioner_email, 'due_on', i.due_on,
                 'is_closed', i.is_closed, 'carried', i.carried_from_id is not null) order by i.position, i.created_at)
               from public.risk_items i where i.review_id = v_q.review_id and i.category_id = v_q.category_id), '[]'::jsonb));
end;
$$;

-- p_items: [{ "id": existing item or null, "title", "detail", "action", "actioner", "due_on", "is_closed" }]
-- The submitted list replaces the category's items: an existing item left out is removed, unless it was carried forward.
create or replace function public.risk_submit(p_token text, p_name text, p_nothing boolean, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_q public.risk_requests%rowtype;
  v_r public.risk_reviews%rowtype;
  v_item jsonb;
  v_id uuid;
  v_n integer := 0;
  v_keep uuid[] := '{}';
begin
  select * into v_q from public.risk_requests q where q.token = p_token and char_length(coalesce(p_token, '')) = 64 for update;
  if v_q.id is null then
    raise exception 'This link is not valid';
  end if;
  select * into v_r from public.risk_reviews r where r.id = v_q.review_id;
  if v_r.status <> 'collecting' then
    raise exception 'This review has closed. Please contact the person who sent it to you.';
  end if;
  if v_q.submitted_at is not null then
    raise exception 'This has already been submitted. If you need to change it, ask the person who sent it to reopen it.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(p_name) > 200 then
    raise exception 'Please tell us who is completing this';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 60 or char_length(p_items::text) > 120000 then
    raise exception 'The answers could not be read';
  end if;
  if jsonb_array_length(p_items) = 0 and not coalesce(p_nothing, false) then
    raise exception 'Add at least one incident or update, or confirm there is nothing to report';
  end if;

  perform set_config('app.risk_system', 'on', true);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    if char_length(btrim(coalesce(v_item ->> 'title', ''))) < 3 then
      raise exception 'Item % needs a description of the incident or update', v_n;
    end if;
    if coalesce(v_item ->> 'actioner_email', '') <> '' and (v_item ->> 'actioner_email') not like '%_@_%._%' then
      raise exception 'Item % has an actioner email that does not look right', v_n;
    end if;
    if char_length(btrim(coalesce(v_item ->> 'action', ''))) < 2 then
      raise exception 'Item % needs an action, control or mitigation. "Continue to monitor" is fine.', v_n;
    end if;
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null then
      update public.risk_items
         set title = btrim(v_item ->> 'title'), detail = nullif(btrim(coalesce(v_item ->> 'detail', '')), ''),
             action = btrim(v_item ->> 'action'), actioner = nullif(btrim(coalesce(v_item ->> 'actioner', '')), ''),
             actioner_email = nullif(btrim(coalesce(v_item ->> 'actioner_email', '')), ''),
             due_on = nullif(v_item ->> 'due_on', '')::date, is_closed = coalesce((v_item ->> 'is_closed')::boolean, false),
             position = v_n, entered_by = btrim(p_name)
       where id = v_id and review_id = v_q.review_id and category_id = v_q.category_id;
      if not found then
        raise exception 'Item % does not belong to this request', v_n;
      end if;
    else
      insert into public.risk_items (organisation_id, review_id, category_id, position, title, detail, action, actioner, actioner_email, due_on, is_closed, entered_by)
      values (v_q.organisation_id, v_q.review_id, v_q.category_id, v_n, btrim(v_item ->> 'title'),
              nullif(btrim(coalesce(v_item ->> 'detail', '')), ''), btrim(v_item ->> 'action'),
              nullif(btrim(coalesce(v_item ->> 'actioner', '')), ''), nullif(btrim(coalesce(v_item ->> 'actioner_email', '')), ''),
              nullif(v_item ->> 'due_on', '')::date,
              coalesce((v_item ->> 'is_closed')::boolean, false), btrim(p_name))
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  -- Items the person removed. Carried-forward items cannot be dropped, only closed.
  delete from public.risk_items i
   where i.review_id = v_q.review_id and i.category_id = v_q.category_id and not (i.id = any (v_keep)) and i.carried_from_id is null;
  perform set_config('app.risk_system', 'off', true);

  update public.risk_requests
     set submitted_at = now(), submitted_by = btrim(p_name), nothing_to_report = coalesce(p_nothing, false) and jsonb_array_length(p_items) = 0
   where id = v_q.id;
end;
$$;

-- The report owner sends a question back: the request reopens and shows the question on the link.
create or replace function public.reopen_risk_request(p_request uuid, p_query text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_q public.risk_requests%rowtype;
begin
  select * into v_q from public.risk_requests q where q.id = p_request for update;
  if v_q.id is null or not app.is_risk_owner(v_q.organisation_id) then
    raise exception 'Only the person responsible for the report, or their backup, can send it back';
  end if;
  if not exists (select 1 from public.risk_reviews r where r.id = v_q.review_id and r.status = 'collecting') then
    raise exception 'This review is not open';
  end if;
  if char_length(btrim(coalesce(p_query, ''))) < 3 then
    raise exception 'Write the question or comment';
  end if;
  update public.risk_requests set submitted_at = null, query = btrim(p_query), queried_at = now() where id = p_request;
end;
$$;

-- ---------------------------------------------------------------------
-- Following up actions: the actioner is prompted a week before the due
-- date and on it, and answers through their own link. This works after
-- the report is final, because actions outlive the review that raised them.
-- ---------------------------------------------------------------------
create or replace function public.risk_action(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_i public.risk_items%rowtype;
begin
  select * into v_i from public.risk_items i where i.token = p_token and char_length(coalesce(p_token, '')) = 64;
  if v_i.id is null then
    raise exception 'This link is not valid';
  end if;
  return jsonb_build_object(
    'organisation', (select o.name from public.organisations o where o.id = v_i.organisation_id),
    'category', (select c.name from public.risk_categories c where c.id = v_i.category_id),
    'title', v_i.title, 'detail', v_i.detail, 'action', v_i.action, 'actioner', v_i.actioner, 'due_on', v_i.due_on,
    'is_closed', v_i.is_closed, 'resolution', v_i.resolution,
    -- A newer review has taken this item over, so updates belong on that one
    'superseded', exists (select 1 from public.risk_items n where n.carried_from_id = v_i.id),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('by_name', u.by_name, 'resolved', u.resolved, 'note', u.note, 'created_at', u.created_at)
                                          order by u.created_at)
                         from public.risk_item_updates u where u.item_id = v_i.id), '[]'::jsonb));
end;
$$;

create or replace function public.risk_action_update(p_token text, p_name text, p_resolved boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_i public.risk_items%rowtype;
begin
  select * into v_i from public.risk_items i where i.token = p_token and char_length(coalesce(p_token, '')) = 64 for update;
  if v_i.id is null then
    raise exception 'This link is not valid';
  end if;
  if v_i.is_closed then
    raise exception 'This item is already resolved';
  end if;
  if exists (select 1 from public.risk_items n where n.carried_from_id = v_i.id) then
    raise exception 'This item has moved to a newer review. Please use the link in the most recent message.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(p_name) > 200 then
    raise exception 'Please tell us who is giving this update';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 or char_length(p_note) > 4000 then
    raise exception '%', case when coalesce(p_resolved, false) then 'Please say how it was resolved' else 'Please give an update' end;
  end if;
  insert into public.risk_item_updates (organisation_id, item_id, by_name, resolved, note)
  values (v_i.organisation_id, v_i.id, btrim(p_name), coalesce(p_resolved, false), btrim(p_note));
  if coalesce(p_resolved, false) then
    perform set_config('app.risk_system', 'on', true);
    update public.risk_items set is_closed = true, resolution = btrim(p_note), resolved_at = now() where id = v_i.id;
    perform set_config('app.risk_system', 'off', true);
  end if;
end;
$$;

-- The links for open actions, for the people who send the prompts
create or replace function public.risk_action_links(p_org uuid)
returns table (item_id uuid, token text) language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_role(p_org, app.records_roles()) or app.is_risk_owner(p_org)) then
    raise exception 'You do not have permission to send action prompts';
  end if;
  return query select i.id, i.token from public.risk_items i where i.organisation_id = p_org and not i.is_closed;
end;
$$;

create or replace function public.mark_risk_prompt_sent(p_item uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select i.organisation_id into v_org from public.risk_items i where i.id = p_item;
  if v_org is null or not (app.has_role(v_org, app.records_roles()) or app.is_risk_owner(v_org)) then
    raise exception 'You do not have permission to send action prompts';
  end if;
  perform set_config('app.risk_system', 'on', true);
  if p_kind = 'week' then
    update public.risk_items set prompt_week_sent_at = now() where id = p_item;
  else
    update public.risk_items set prompt_week_sent_at = coalesce(prompt_week_sent_at, now()), prompt_due_sent_at = now() where id = p_item;
  end if;
  perform set_config('app.risk_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers, privileges and row-level security
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['risk_categories', 'risk_reviews', 'risk_items'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['risk_categories', 'risk_contacts', 'risk_owners', 'risk_reviews', 'risk_requests', 'risk_items', 'risk_item_updates'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on all functions in schema app from public, anon;
grant execute on function app.is_risk_owner(uuid) to authenticated, service_role;
revoke execute on function app.start_risk_review(uuid) from authenticated;

revoke execute on function public.ensure_risk_categories(uuid) from public, anon;
revoke execute on function public.create_risk_review(uuid, text, text, date, text) from public, anon;
revoke execute on function public.start_due_risk_reviews(uuid) from public, anon;
revoke execute on function public.cancel_risk_review(uuid) from public, anon;
revoke execute on function public.finalise_risk_review(uuid) from public, anon;
revoke execute on function public.reopen_risk_request(uuid, text) from public, anon;
grant execute on function public.ensure_risk_categories(uuid) to authenticated;
grant execute on function public.create_risk_review(uuid, text, text, date, text) to authenticated;
grant execute on function public.start_due_risk_reviews(uuid) to authenticated;
grant execute on function public.cancel_risk_review(uuid) to authenticated;
grant execute on function public.finalise_risk_review(uuid) to authenticated;
grant execute on function public.reopen_risk_request(uuid, text) to authenticated;

revoke execute on function public.risk_action_links(uuid) from public, anon;
revoke execute on function public.mark_risk_prompt_sent(uuid, text) from public, anon;
grant execute on function public.risk_action_links(uuid) to authenticated;
grant execute on function public.mark_risk_prompt_sent(uuid, text) to authenticated;

-- Public: usable without signing in, but only with the code from a person's own link
revoke execute on function public.risk_request(text) from public;
revoke execute on function public.risk_submit(text, text, boolean, jsonb) from public;
revoke execute on function public.risk_action(text) from public;
revoke execute on function public.risk_action_update(text, text, boolean, text) from public;
grant execute on function public.risk_request(text) to anon, authenticated;
grant execute on function public.risk_submit(text, text, boolean, jsonb) to anon, authenticated;
grant execute on function public.risk_action(text) to anon, authenticated;
grant execute on function public.risk_action_update(text, text, boolean, text) to anon, authenticated;

revoke all on public.risk_categories, public.risk_contacts, public.risk_owners, public.risk_reviews, public.risk_requests, public.risk_items, public.risk_item_updates from anon, authenticated;
grant select, insert, update on public.risk_categories to authenticated;
grant select, insert, update, delete on public.risk_contacts, public.risk_owners to authenticated;
grant select on public.risk_reviews to authenticated;
grant update (name, forum, frequency, forum_on, start_on, respond_by, reminder2_on, escalate_on) on public.risk_reviews to authenticated;
grant select on public.risk_requests to authenticated;
grant update (sent_at, reminder1_sent_at, reminder2_sent_at, escalated_at) on public.risk_requests to authenticated;
-- An item's link code is never readable directly; it comes only through risk_action_links
grant select (id, organisation_id, review_id, category_id, position, title, detail, action, actioner, actioner_email, due_on, is_closed,
              resolution, resolved_at, carried_from_id, entered_by, prompt_week_sent_at, prompt_due_sent_at, created_at, updated_at)
  on public.risk_items to authenticated;
grant insert (organisation_id, review_id, category_id, position, title, detail, action, actioner, actioner_email, due_on, is_closed, entered_by),
      update (position, title, detail, action, actioner, actioner_email, due_on, is_closed, resolution), delete
  on public.risk_items to authenticated;
grant select on public.risk_item_updates to authenticated;
grant all on public.risk_categories, public.risk_contacts, public.risk_owners, public.risk_reviews, public.risk_requests, public.risk_items, public.risk_item_updates to service_role;

alter table public.risk_categories enable row level security;
alter table public.risk_contacts   enable row level security;
alter table public.risk_owners     enable row level security;
alter table public.risk_reviews    enable row level security;
alter table public.risk_requests   enable row level security;
alter table public.risk_items      enable row level security;
alter table public.risk_item_updates enable row level security;

-- The register is for the board, the compliance roles and auditors
create policy risk_categories_select on public.risk_categories for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or app.is_risk_owner(organisation_id));
create policy risk_categories_insert on public.risk_categories for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));
create policy risk_categories_update on public.risk_categories for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id))
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));

create policy risk_contacts_select on public.risk_contacts for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));
create policy risk_contacts_insert on public.risk_contacts for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));
create policy risk_contacts_delete on public.risk_contacts for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));

create policy risk_owners_select on public.risk_owners for select to authenticated using (app.is_member(organisation_id));
create policy risk_owners_insert on public.risk_owners for insert to authenticated with check (app.has_role(organisation_id, app.admin_roles()));
create policy risk_owners_delete on public.risk_owners for delete to authenticated using (app.has_role(organisation_id, app.admin_roles()));

create policy risk_reviews_select on public.risk_reviews for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or app.is_risk_owner(organisation_id));
create policy risk_reviews_update on public.risk_reviews for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id))
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));

-- A request carries the link code, so only the people running the review can read it
create policy risk_requests_select on public.risk_requests for select to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));
create policy risk_requests_update on public.risk_requests for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id))
  with check (app.has_role(organisation_id, app.records_roles()) or app.is_risk_owner(organisation_id));

-- Everyone with access reads the items; only the report owner and backups edit them
create policy risk_items_select on public.risk_items for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or app.is_risk_owner(organisation_id));
create policy risk_items_insert on public.risk_items for insert to authenticated with check (app.is_risk_owner(organisation_id));
create policy risk_items_update on public.risk_items for update to authenticated
  using (app.is_risk_owner(organisation_id)) with check (app.is_risk_owner(organisation_id));
create policy risk_items_delete on public.risk_items for delete to authenticated using (app.is_risk_owner(organisation_id));

create policy risk_item_updates_select on public.risk_item_updates for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or app.has_role(organisation_id, array['auditor']::public.member_role[]) or app.is_risk_owner(organisation_id));
