-- 0035: a responsible person reviews each conflict of interest.
--
-- The responsible person (nominated by an owner, administrator, secretary,
-- legal or compliance member) reviews every declared conflict and records
-- whether it is acceptable. If it is not, they record the action taken (for
-- example termination of employment or disposal of the interest); if it is,
-- they record any action or mitigation. Until someone is nominated, the
-- records roles review. Nobody reviews a conflict of their own.

create table public.conflict_settings (
  organisation_id      uuid primary key references public.organisations (id) on delete cascade,
  responsible_user_id  uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);

alter table public.conflict_declarations add column if not exists outcome text check (outcome in ('acceptable', 'not_acceptable'));
alter table public.conflict_declarations add column if not exists outcome_actions text[] not null default '{}';
alter table public.conflict_declarations add column if not exists outcome_details text;
alter table public.conflict_declarations add column if not exists outcome_by uuid references auth.users (id) on delete set null;
alter table public.conflict_declarations add column if not exists outcome_at timestamptz;
alter table public.conflict_declarations add column if not exists action_complete_at timestamptz;

create or replace function app.is_conflict_officer(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_member(p_org) and exists (select 1 from public.conflict_settings s where s.organisation_id = p_org and s.responsible_user_id = auth.uid());
$$;

create or replace function public.ensure_conflict_settings(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_member(p_org) then
    raise exception 'Not a member of this organisation';
  end if;
  insert into public.conflict_settings (organisation_id) values (p_org) on conflict do nothing;
end;
$$;

create or replace function public.set_conflict_officer(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'Only an owner, administrator, secretary, legal or compliance member can nominate the responsible person';
  end if;
  if p_user is not null and not exists (select 1 from public.memberships m where m.organisation_id = p_org and m.user_id = p_user and m.is_active) then
    raise exception 'The responsible person must be an active member of this organisation';
  end if;
  insert into public.conflict_settings (organisation_id, responsible_user_id, updated_at) values (p_org, p_user, now())
  on conflict (organisation_id) do update set responsible_user_id = excluded.responsible_user_id, updated_at = now();
end;
$$;

-- The review: acceptable or not, the action or mitigation, the assessed risk level, and when to look again
create or replace function public.review_conflict(p_conflict uuid, p_outcome text, p_actions text[], p_details text, p_risk_level text, p_review_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.conflict_declarations%rowtype;
  v_officer uuid;
  v_actions text[] := coalesce((select array_agg(distinct btrim(a)) from unnest(coalesce(p_actions, '{}')) a where btrim(a) <> ''), '{}');
begin
  select * into c from public.conflict_declarations where id = p_conflict for update;
  if c.id is null then
    raise exception 'Not found';
  end if;
  select responsible_user_id into v_officer from public.conflict_settings where organisation_id = c.organisation_id;
  if not (app.is_conflict_officer(c.organisation_id)
          or (app.has_role(c.organisation_id, app.records_roles())
              and (v_officer is null or v_officer = c.person_user_id))) then
    raise exception 'Only the responsible person for conflicts of interest can review this';
  end if;
  if auth.uid() = c.person_user_id then
    raise exception 'You cannot review a conflict of your own. Someone else must review it.';
  end if;
  if c.status = 'closed' then
    raise exception 'This conflict is closed';
  end if;
  if p_outcome not in ('acceptable', 'not_acceptable') then
    raise exception 'Record whether the conflict is acceptable';
  end if;
  if p_risk_level not in ('actual', 'potential', 'perceived') then
    raise exception 'Choose the risk level';
  end if;
  if p_outcome = 'not_acceptable' and cardinality(v_actions) = 0 then
    raise exception 'Record the action taken, such as disposal of the interest or termination of employment';
  end if;
  if p_outcome = 'acceptable' and cardinality(v_actions) = 0 then
    raise exception 'Record the action or mitigation, or choose "No further action needed"';
  end if;
  if 'Other' = any (v_actions) and char_length(btrim(coalesce(p_details, ''))) < 5 then
    raise exception 'Describe the other action in the details';
  end if;
  update public.conflict_declarations
     set outcome = p_outcome, outcome_actions = v_actions, outcome_details = nullif(btrim(coalesce(p_details, '')), ''),
         outcome_by = auth.uid(), outcome_at = now(), risk_level = p_risk_level, review_on = p_review_on,
         -- Kept in step with the earlier fields, so older screens and reports still read correctly
         status = 'managed',
         management_plan = left(concat_ws('. ', case p_outcome when 'acceptable' then 'Acceptable' else 'Not acceptable' end,
                                          array_to_string(v_actions, '; '), nullif(btrim(coalesce(p_details, '')), '')), 1000),
         action_complete_at = case when p_outcome = 'not_acceptable' then null else action_complete_at end
   where id = p_conflict;
end;
$$;

-- Closes a conflict: for one not acceptable, once the action has been completed
create or replace function public.close_conflict(p_conflict uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.conflict_declarations%rowtype;
  v_officer uuid;
begin
  select * into c from public.conflict_declarations where id = p_conflict for update;
  if c.id is null then
    raise exception 'Not found';
  end if;
  select responsible_user_id into v_officer from public.conflict_settings where organisation_id = c.organisation_id;
  if not (app.is_conflict_officer(c.organisation_id)
          or (app.has_role(c.organisation_id, app.records_roles()) and (v_officer is null or v_officer = c.person_user_id)))
     or auth.uid() = c.person_user_id then
    raise exception 'Only the responsible person for conflicts of interest can close this';
  end if;
  if c.outcome is null then
    raise exception 'Review the conflict before closing it';
  end if;
  update public.conflict_declarations
     set status = 'closed',
         action_complete_at = case when c.outcome = 'not_acceptable' then now() else action_complete_at end,
         outcome_details = case when char_length(btrim(coalesce(p_note, ''))) > 0
                                then concat_ws(E'\n', outcome_details, 'Closed: ' || btrim(p_note)) else outcome_details end
   where id = p_conflict;
end;
$$;

-- The responsible person sees the whole register
drop policy if exists conflict_declarations_select on public.conflict_declarations;
create policy conflict_declarations_select on public.conflict_declarations for select to authenticated
  using (declared_by = auth.uid() or person_user_id = auth.uid() or app.has_role(organisation_id, app.board_read_roles()) or app.is_conflict_officer(organisation_id));

-- Reviews go through review_conflict and close_conflict only
drop policy if exists conflict_declarations_update on public.conflict_declarations;
revoke update on public.conflict_declarations from authenticated;

revoke all on public.conflict_settings from anon, authenticated;
grant select on public.conflict_settings to authenticated;
grant all on public.conflict_settings to service_role;
alter table public.conflict_settings enable row level security;
create policy conflict_settings_select on public.conflict_settings for select to authenticated using (app.is_member(organisation_id));
create trigger conflict_settings_audit after insert or update or delete on public.conflict_settings for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
grant execute on function app.is_conflict_officer(uuid) to authenticated, service_role;
revoke execute on function public.ensure_conflict_settings(uuid), public.set_conflict_officer(uuid, uuid),
  public.review_conflict(uuid, text, text[], text, text, date), public.close_conflict(uuid, text) from public, anon;
grant execute on function public.ensure_conflict_settings(uuid), public.set_conflict_officer(uuid, uuid),
  public.review_conflict(uuid, text, text[], text, text, date), public.close_conflict(uuid, text) to authenticated;
