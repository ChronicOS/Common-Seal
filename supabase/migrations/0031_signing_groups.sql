-- 0031: Signing Delegation as signatory groups, per company.
--
-- Replaces the amount-band layout 0030 gave the Signing Delegation. For each
-- company there are signatory groups. A group is made up of the directors
-- and/or the company secretary (read from the company's officeholders, so
-- appointments flow through) and/or authorised representatives, named by
-- position or as a person. Each group sets out what it can sign (one line
-- each, optionally capped at an amount or at the Financial Approval Matrix
-- limits) and the minimum signatures needed, with any further stipulations.
--
-- The same change control applies: groups belong to a version; once locked,
-- a change is a new draft ratified by board resolution.

create table public.sign_groups (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  version_id            uuid not null references public.auth_versions (id) on delete cascade,
  entity_id             uuid not null references public.entities (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 2 and 120),
  position              integer not null default 0,
  includes_directors    boolean not null default false,
  includes_secretary    boolean not null default false,
  -- Any one of these combinations is enough (see the app for the wording)
  requirements          text[] not null default '{}'
                        check (requirements <@ array['two_directors', 'director_and_secretary', 'sole_director', 'one_member', 'two_members', 'director_and_member']::text[]),
  stipulations          text,
  copied_from           uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index sign_groups_version_idx on public.sign_groups (version_id, entity_id, position);

create table public.sign_group_members (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  version_id       uuid not null references public.auth_versions (id) on delete cascade,
  group_id         uuid not null references public.sign_groups (id) on delete cascade,
  position_id      uuid references public.positions (id) on delete restrict,
  person_id        uuid references public.people (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((position_id is null) <> (person_id is null))
);

create table public.sign_group_scopes (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  version_id          uuid not null references public.auth_versions (id) on delete cascade,
  group_id            uuid not null references public.sign_groups (id) on delete cascade,
  position            integer not null default 0,
  text                text not null check (char_length(btrim(text)) >= 3),
  up_to               numeric(16, 2) check (up_to is null or up_to > 0),
  within_financial    boolean not null default false,   -- capped at the Financial Approval Matrix limits
  copied_from         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Same rule as the matrix: rows change only while their version is a draft, and stay inside it
create or replace function app.guard_sign_row()
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
    if tg_table_name = 'sign_groups' then
      if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
        raise exception 'That company is not in this organisation';
      end if;
      if (select kind from public.auth_versions where id = new.version_id) <> 'signing' then
        raise exception 'Signatory groups belong to the Signing Delegation';
      end if;
    else
      if not exists (select 1 from public.sign_groups g where g.id = new.group_id and g.version_id = new.version_id) then
        raise exception 'The row must belong to a group in the same version';
      end if;
      if tg_table_name = 'sign_group_members' then
        if new.position_id is not null and not exists (select 1 from public.positions p where p.id = new.position_id and p.organisation_id = new.organisation_id) then
          raise exception 'That position is not in this organisation';
        end if;
        if new.person_id is not null and not exists (select 1 from public.people p where p.id = new.person_id and p.organisation_id = new.organisation_id) then
          raise exception 'That person is not in this organisation';
        end if;
      end if;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger sign_groups_guard before insert or update or delete on public.sign_groups for each row execute function app.guard_sign_row();
create trigger sign_group_members_guard before insert or update or delete on public.sign_group_members for each row execute function app.guard_sign_row();
create trigger sign_group_scopes_guard before insert or update or delete on public.sign_group_scopes for each row execute function app.guard_sign_row();

-- Starting a change now copies the signatory groups too
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

  insert into public.sign_groups (organisation_id, version_id, entity_id, name, position, includes_directors, includes_secretary, requirements, stipulations, copied_from)
  select organisation_id, p_to, entity_id, name, position, includes_directors, includes_secretary, requirements, stipulations, id
  from public.sign_groups where version_id = p_from;
  insert into public.sign_group_members (organisation_id, version_id, group_id, position_id, person_id)
  select m.organisation_id, p_to, ng.id, m.position_id, m.person_id
  from public.sign_group_members m join public.sign_groups ng on ng.version_id = p_to and ng.copied_from = m.group_id
  where m.version_id = p_from;
  insert into public.sign_group_scopes (organisation_id, version_id, group_id, position, text, up_to, within_financial, copied_from)
  select s.organisation_id, p_to, ng.id, s.position, s.text, s.up_to, s.within_financial, s.id
  from public.sign_group_scopes s join public.sign_groups ng on ng.version_id = p_to and ng.copied_from = s.group_id
  where s.version_id = p_from;
  perform set_config('app.auth_system', 'off', true);
end;
$$;

-- What is missing: the matrix rules for the Financial Approval Matrix; signatory groups for the Signing Delegation
create or replace function app.auth_gaps(p_version uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text;
  v_org uuid;
  v_gaps text[] := '{}';
  r record;
begin
  select kind, organisation_id into v_kind, v_org from public.auth_versions where id = p_version;
  if v_kind = 'signing' then
    for r in select e.name from public.entities e
             where e.organisation_id = v_org and e.status <> 'deregistered'
               and not exists (select 1 from public.sign_groups g where g.version_id = p_version and g.entity_id = e.id) loop
      v_gaps := v_gaps || format('%s: add at least one signatory group', r.name);
    end loop;
    for r in select g.*, e.name as company from public.sign_groups g join public.entities e on e.id = g.entity_id where g.version_id = p_version loop
      if cardinality(r.requirements) = 0 then
        v_gaps := v_gaps || format('%s, %s: choose the minimum signatures', r.company, r.name);
      end if;
      if not r.includes_directors and not r.includes_secretary
         and not exists (select 1 from public.sign_group_members m where m.group_id = r.id) then
        v_gaps := v_gaps || format('%s, %s: say who is in the group', r.company, r.name);
      end if;
      if not exists (select 1 from public.sign_group_scopes s where s.group_id = r.id) then
        v_gaps := v_gaps || format('%s, %s: say what the group can sign', r.company, r.name);
      end if;
    end loop;
    return v_gaps;
  end if;

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
    if not r.board and exists (select 1 from public.auth_functions f where f.version_id = p_version
                   and not exists (select 1 from public.auth_cells c where c.band_id = r.id and c.function_id = f.id
                                   and c.operational_position_id is not null and c.finance_position_id is not null)) then
      v_gaps := v_gaps || format('%s (%s), band %s: an operational and a finance approver are needed for every function', r.vertical, r.scope, r.n);
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

-- Default group for each company in an open Signing Delegation draft:
-- the directors and company secretary, with the usual wording
create or replace function public.ensure_signing_groups(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_draft uuid;
  e record;
  v_group uuid;
begin
  if not app.is_member(p_org) then
    raise exception 'Not a member of this organisation';
  end if;
  select id into v_draft from public.auth_versions where organisation_id = p_org and kind = 'signing' and status = 'draft';
  if v_draft is null then
    return;
  end if;
  perform set_config('app.auth_system', 'on', true);
  -- The 0030 layout (document types and amount bands) is not used for signing; clear it from a draft that never used it
  delete from public.auth_verticals x where x.version_id = v_draft
    and not exists (select 1 from public.auth_cells c join public.auth_bands b on b.id = c.band_id where b.vertical_id = x.id);
  for e in select * from public.entities en where en.organisation_id = p_org and en.status <> 'deregistered'
             and not exists (select 1 from public.sign_groups g where g.version_id = v_draft and g.entity_id = en.id) loop
    insert into public.sign_groups (organisation_id, version_id, entity_id, name, position, includes_directors, includes_secretary, requirements)
    values (p_org, v_draft, e.id, 'Directors and Company Secretary', 1, true, true, array['two_directors', 'director_and_secretary'])
    returning id into v_group;
    insert into public.sign_group_scopes (organisation_id, version_id, group_id, position, text) values
      (p_org, v_draft, v_group, 1, 'Unlimited, except major actions, which must be approved or ratified by the board'),
      (p_org, v_draft, v_group, 2, 'Subject to the approval thresholds and reserved matters in any shareholders'' deed and the constitution');
  end loop;
  perform set_config('app.auth_system', 'off', true);
end;
$$;

revoke all on public.sign_groups, public.sign_group_members, public.sign_group_scopes from anon, authenticated;
grant select, insert, update, delete on public.sign_groups, public.sign_group_members, public.sign_group_scopes to authenticated;
grant all on public.sign_groups, public.sign_group_members, public.sign_group_scopes to service_role;

do $$
declare t text;
begin
  foreach t in array array['sign_groups', 'sign_group_members', 'sign_group_scopes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.is_member(organisation_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app.has_role(organisation_id, app.records_roles()))', t || '_delete', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.copy_auth_version(uuid, uuid), app.auth_gaps(uuid) from authenticated;
revoke execute on function public.ensure_signing_groups(uuid) from public, anon;
grant execute on function public.ensure_signing_groups(uuid) to authenticated;
