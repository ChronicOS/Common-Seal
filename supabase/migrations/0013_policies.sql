-- =====================================================================
-- Common Seal - 0013: policy repository
--
-- Every policy has a named owner and a review date. Wording lives in
-- versions: one draft at a time, which becomes the version in force
-- when approved and replaces the one before it. Approved wording is
-- never edited, so the history shows what applied and when.
-- =====================================================================

create type public.policy_version_status as enum ('draft', 'approved', 'superseded');

create table public.policies (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  title                 text not null check (char_length(btrim(title)) >= 3),
  category              text not null default 'General',
  owner_user_id         uuid not null references auth.users (id) on delete restrict,
  review_every_months   integer not null default 12 check (review_every_months between 1 and 60),
  next_review_on        date,
  last_reviewed_on      date,
  is_retired            boolean not null default false,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index policies_org_idx on public.policies (organisation_id, is_retired);

create table public.policy_versions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  policy_id        uuid not null references public.policies (id) on delete cascade,
  version_no       integer not null,
  content          text not null default '',
  change_note      text,
  status           public.policy_version_status not null default 'draft',
  written_by       uuid references auth.users (id) on delete set null,
  approved_by      uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  effective_on     date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (policy_id, version_no)
);
create unique index policy_versions_one_draft_idx on public.policy_versions (policy_id) where status = 'draft';
create unique index policy_versions_one_in_force_idx on public.policy_versions (policy_id) where status = 'approved';

-- The owner must be an active member; ownership and settings change, the organisation does not.
create or replace function app.guard_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organisation_id <> old.organisation_id then
    raise exception 'A policy cannot move between organisations';
  end if;
  if not exists (select 1 from public.memberships m
                 where m.organisation_id = new.organisation_id and m.user_id = new.owner_user_id and m.is_active) then
    raise exception 'The owner must be an active member of this organisation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;
create trigger policies_guard before insert or update on public.policies
  for each row execute function app.guard_policy();

-- Who may write a policy's draft: a records role, or its owner.
create or replace function app.can_write_policy(p_policy uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.policies p
    where p.id = p_policy
      and (app.has_role(p.organisation_id, app.records_roles())
           or (p.owner_user_id = auth.uid() and app.is_member(p.organisation_id))));
$$;

create or replace function public.create_policy(
  p_org uuid, p_title text, p_category text, p_owner uuid, p_review_months integer, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_policy uuid;
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'You do not have permission to add policies';
  end if;
  insert into public.policies (organisation_id, title, category, owner_user_id, review_every_months)
  values (p_org, btrim(p_title), coalesce(nullif(btrim(p_category), ''), 'General'), p_owner, coalesce(p_review_months, 12))
  returning id into v_policy;
  insert into public.policy_versions (organisation_id, policy_id, version_no, content, written_by)
  values (p_org, v_policy, 1, coalesce(p_content, ''), auth.uid());
  return v_policy;
end;
$$;

-- Saves the working draft, starting a new one from the version in force if there is none.
create or replace function public.save_policy_draft(p_policy uuid, p_content text, p_change_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_p public.policies%rowtype;
  v_draft uuid;
begin
  select * into v_p from public.policies p where p.id = p_policy for update;
  if v_p.id is null or not app.can_write_policy(p_policy) then
    raise exception 'You do not have permission to write this policy';
  end if;
  if v_p.is_retired then
    raise exception 'This policy is retired';
  end if;
  select v.id into v_draft from public.policy_versions v where v.policy_id = p_policy and v.status = 'draft';
  if v_draft is null then
    insert into public.policy_versions (organisation_id, policy_id, version_no, content, change_note, written_by)
    values (v_p.organisation_id, p_policy,
            (select coalesce(max(v.version_no), 0) + 1 from public.policy_versions v where v.policy_id = p_policy),
            coalesce(p_content, ''), nullif(btrim(coalesce(p_change_note, '')), ''), auth.uid())
    returning id into v_draft;
  else
    update public.policy_versions
       set content = coalesce(p_content, ''), change_note = nullif(btrim(coalesce(p_change_note, '')), ''), written_by = auth.uid()
     where id = v_draft;
  end if;
  return v_draft;
end;
$$;

-- Approves the draft. It becomes the version in force and the review clock restarts.
create or replace function public.approve_policy_draft(p_policy uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_p public.policies%rowtype;
  v_draft public.policy_versions%rowtype;
  v_review date;
begin
  select * into v_p from public.policies p where p.id = p_policy for update;
  if v_p.id is null or not app.has_role(v_p.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to approve policies';
  end if;
  select * into v_draft from public.policy_versions v where v.policy_id = p_policy and v.status = 'draft';
  if v_draft.id is null then
    raise exception 'There is no draft to approve';
  end if;
  if char_length(btrim(v_draft.content)) < 50 then
    raise exception 'The draft is too short to approve';
  end if;

  update public.policy_versions set status = 'superseded' where policy_id = p_policy and status = 'approved';
  update public.policy_versions
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), effective_on = current_date
   where id = v_draft.id;

  v_review := (current_date + make_interval(months => v_p.review_every_months))::date;
  update public.policies set last_reviewed_on = current_date, next_review_on = v_review where id = p_policy;
  update public.tasks set status = 'cancelled'
   where subject_table = 'policies' and subject_id = p_policy and origin = 'system' and status in ('open', 'in_progress');
  insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
  values (v_p.organisation_id, format('%s: policy review due', v_p.title), 'policies', p_policy,
          (v_review::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
end;
$$;

-- Records a review that found nothing to change.
create or replace function public.confirm_policy_review(p_policy uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_p public.policies%rowtype;
  v_review date;
begin
  select * into v_p from public.policies p where p.id = p_policy for update;
  if v_p.id is null or not app.can_write_policy(p_policy) then
    raise exception 'You do not have permission to review this policy';
  end if;
  if not exists (select 1 from public.policy_versions v where v.policy_id = p_policy and v.status = 'approved') then
    raise exception 'There is no approved version to review';
  end if;
  v_review := (current_date + make_interval(months => v_p.review_every_months))::date;
  update public.policies set last_reviewed_on = current_date, next_review_on = v_review where id = p_policy;
  update public.tasks set status = 'done', completed_at = now()
   where subject_table = 'policies' and subject_id = p_policy and origin = 'system' and status in ('open', 'in_progress');
  insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
  values (v_p.organisation_id, format('%s: policy review due', v_p.title), 'policies', p_policy,
          (v_review::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers, privileges and row-level security
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['policies', 'policy_versions'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on function app.can_write_policy(uuid) from public, anon;
grant execute on function app.can_write_policy(uuid) to authenticated, service_role;
revoke execute on function public.create_policy(uuid, text, text, uuid, integer, text) from public, anon;
revoke execute on function public.save_policy_draft(uuid, text, text) from public, anon;
revoke execute on function public.approve_policy_draft(uuid) from public, anon;
revoke execute on function public.confirm_policy_review(uuid) from public, anon;
grant execute on function public.create_policy(uuid, text, text, uuid, integer, text) to authenticated;
grant execute on function public.save_policy_draft(uuid, text, text) to authenticated;
grant execute on function public.approve_policy_draft(uuid) to authenticated;
grant execute on function public.confirm_policy_review(uuid) to authenticated;

revoke all on public.policies, public.policy_versions from anon, authenticated;
-- Title, category, owner, review cycle and retirement can be changed directly; wording only through the functions
grant select on public.policies, public.policy_versions to authenticated;
grant update (title, category, owner_user_id, review_every_months, is_retired) on public.policies to authenticated;
grant all on public.policies, public.policy_versions to service_role;

alter table public.policies        enable row level security;
alter table public.policy_versions enable row level security;

create policy policies_select on public.policies for select to authenticated
  using (app.is_member(organisation_id));
create policy policies_update on public.policies for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

-- Everyone reads approved and past wording; drafts are for the people writing them
create policy policy_versions_select on public.policy_versions for select to authenticated
  using (app.is_member(organisation_id) and (status <> 'draft' or app.can_write_policy(policy_id)));
