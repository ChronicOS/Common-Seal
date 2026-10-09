-- =====================================================================
-- Common Seal - 0012: workflow builder
--
-- An organisation defines a compliance process as an ordered list of
-- steps, publishes it, then runs it as often as needed. A published
-- workflow is fixed, and each run takes its own copy of the steps, so
-- the record of a run always shows the process as it was followed.
-- =====================================================================

create type public.workflow_step_kind as enum ('confirm', 'answer', 'approve');
create type public.workflow_run_status as enum ('open', 'completed', 'stopped');
create type public.workflow_step_status as enum ('waiting', 'open', 'done', 'refused', 'cancelled');

create table public.workflows (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) >= 3),
  purpose          text,
  status           public.training_status not null default 'draft',
  published_at     timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index workflows_org_idx on public.workflows (organisation_id, status);

create table public.workflow_steps (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  workflow_id      uuid not null references public.workflows (id) on delete cascade,
  position         integer not null check (position >= 1),
  title            text not null check (char_length(btrim(title)) >= 3),
  instructions     text,
  kind             public.workflow_step_kind not null default 'confirm',
  -- Who does the step. Null means any records role.
  assignee_role    public.member_role,
  due_days         integer not null default 7 check (due_days between 0 and 365),
  unique (workflow_id, position)
);

create table public.workflow_runs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  workflow_id      uuid not null references public.workflows (id) on delete restrict,
  subject          text not null check (char_length(btrim(subject)) >= 3),
  entity_id        uuid references public.entities (id) on delete set null,
  status           public.workflow_run_status not null default 'open',
  stop_reason      text,
  started_by       uuid references auth.users (id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index workflow_runs_org_idx on public.workflow_runs (organisation_id, status);

create table public.workflow_run_steps (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  run_id           uuid not null references public.workflow_runs (id) on delete restrict,
  position         integer not null,
  title            text not null,
  instructions     text,
  kind             public.workflow_step_kind not null,
  assignee_role    public.member_role,
  due_days         integer not null,
  due_on           date,
  status           public.workflow_step_status not null default 'waiting',
  response         text,
  completed_by     uuid references auth.users (id) on delete set null,
  completed_at     timestamptz,
  unique (run_id, position)
);
create index workflow_run_steps_run_idx on public.workflow_run_steps (run_id);

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function app.guard_workflow()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.published_at := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if new.organisation_id <> old.organisation_id then
    raise exception 'A workflow cannot move between organisations';
  end if;
  if old.status <> 'draft' and (new.name <> old.name or new.purpose is distinct from old.purpose) then
    raise exception 'A published workflow is fixed. Retire it and publish a new one to change it.';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'published') or (old.status = 'published' and new.status = 'retired')) then
      raise exception 'A workflow goes from draft to published, then to retired';
    end if;
    if new.status = 'published' then
      if not exists (select 1 from public.workflow_steps s where s.workflow_id = new.id) then
        raise exception 'Add at least one step before publishing';
      end if;
      new.published_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger workflows_guard before insert or update on public.workflows
  for each row execute function app.guard_workflow();

create or replace function app.guard_workflow_step()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_w public.workflows%rowtype;
  v_id uuid := case when tg_op = 'DELETE' then old.workflow_id else new.workflow_id end;
begin
  select * into v_w from public.workflows w where w.id = v_id;
  if v_w.id is null then
    return coalesce(new, old);
  end if;
  if v_w.status <> 'draft' then
    raise exception 'Steps are fixed once a workflow is published';
  end if;
  if tg_op <> 'DELETE' and new.organisation_id <> v_w.organisation_id then
    raise exception 'The step must belong to the workflow''s organisation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger workflow_steps_guard before insert or update or delete on public.workflow_steps
  for each row execute function app.guard_workflow_step();

-- ---------------------------------------------------------------------
-- Running a workflow
-- ---------------------------------------------------------------------

-- Opens the next waiting step of a run, or completes the run if none is left.
create or replace function app.advance_workflow_run(p_run uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_run public.workflow_runs%rowtype;
  v_step public.workflow_run_steps%rowtype;
  v_due date;
begin
  select * into v_run from public.workflow_runs r where r.id = p_run;
  select * into v_step from public.workflow_run_steps s
   where s.run_id = p_run and s.status = 'waiting' order by s.position limit 1;

  if v_step.id is null then
    update public.workflow_runs set status = 'completed', finished_at = now() where id = p_run;
    return;
  end if;

  v_due := current_date + v_step.due_days;
  update public.workflow_run_steps set status = 'open', due_on = v_due where id = v_step.id;
  insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
  values (v_run.organisation_id, format('%s: %s', v_run.subject, v_step.title), 'workflow_run_steps', v_step.id,
          (v_due::timestamp at time zone 'Australia/Sydney'), 'workflow', auth.uid());
end;
$$;

create or replace function public.start_workflow(p_workflow uuid, p_subject text, p_entity uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_w public.workflows%rowtype;
  v_run uuid;
begin
  select * into v_w from public.workflows w where w.id = p_workflow;
  if v_w.id is null or not app.has_role(v_w.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to start this workflow';
  end if;
  if v_w.status <> 'published' then
    raise exception 'Publish the workflow before starting it';
  end if;
  if char_length(btrim(coalesce(p_subject, ''))) < 3 then
    raise exception 'Say what this run is about';
  end if;
  if p_entity is not null and not exists
     (select 1 from public.entities e where e.id = p_entity and e.organisation_id = v_w.organisation_id) then
    raise exception 'The entity must belong to this organisation';
  end if;

  insert into public.workflow_runs (organisation_id, workflow_id, subject, entity_id, started_by)
  values (v_w.organisation_id, v_w.id, btrim(p_subject), p_entity, auth.uid())
  returning id into v_run;

  insert into public.workflow_run_steps (organisation_id, run_id, position, title, instructions, kind, assignee_role, due_days)
  select s.organisation_id, v_run, s.position, s.title, s.instructions, s.kind, s.assignee_role, s.due_days
  from public.workflow_steps s where s.workflow_id = v_w.id order by s.position;

  perform app.advance_workflow_run(v_run);
  return v_run;
end;
$$;

-- Completes the open step. For an approval step, p_approve false refuses it and stops the run.
create or replace function public.complete_workflow_step(p_step uuid, p_response text default null, p_approve boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.workflow_run_steps%rowtype;
  v_response text := nullif(btrim(coalesce(p_response, '')), '');
  v_refused boolean;
begin
  select * into v_s from public.workflow_run_steps s where s.id = p_step for update;
  if v_s.id is null or not app.is_member(v_s.organisation_id) then
    raise exception 'You do not have permission to complete this step';
  end if;
  if v_s.status <> 'open' then
    raise exception 'This step is not open';
  end if;
  if not (app.has_role(v_s.organisation_id, app.records_roles())
          or (v_s.assignee_role is not null and app.has_role(v_s.organisation_id, array[v_s.assignee_role]))) then
    raise exception 'This step belongs to someone else';
  end if;
  v_refused := v_s.kind = 'approve' and not coalesce(p_approve, true);
  if v_s.kind = 'answer' and v_response is null then
    raise exception 'This step needs a written answer';
  end if;
  if v_refused and v_response is null then
    raise exception 'Give the reason for refusing';
  end if;

  update public.workflow_run_steps
     set status = case when v_refused then 'refused' else 'done' end::public.workflow_step_status,
         response = v_response, completed_by = auth.uid(), completed_at = now()
   where id = v_s.id;
  update public.tasks set status = 'done', completed_at = now()
   where subject_table = 'workflow_run_steps' and subject_id = v_s.id and status in ('open', 'in_progress');

  if v_refused then
    update public.workflow_run_steps set status = 'cancelled' where run_id = v_s.run_id and status = 'waiting';
    update public.workflow_runs
       set status = 'stopped', finished_at = now(), stop_reason = format('Refused at "%s": %s', v_s.title, v_response)
     where id = v_s.run_id;
  else
    perform app.advance_workflow_run(v_s.run_id);
  end if;
end;
$$;

create or replace function public.stop_workflow_run(p_run uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_r public.workflow_runs%rowtype;
begin
  select * into v_r from public.workflow_runs r where r.id = p_run for update;
  if v_r.id is null or not app.has_role(v_r.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to stop this run';
  end if;
  if v_r.status <> 'open' then
    raise exception 'This run has already finished';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give the reason for stopping';
  end if;
  update public.tasks t set status = 'cancelled'
   from public.workflow_run_steps s
   where s.run_id = v_r.id and t.subject_table = 'workflow_run_steps' and t.subject_id = s.id and t.status in ('open', 'in_progress');
  update public.workflow_run_steps set status = 'cancelled' where run_id = v_r.id and status in ('waiting', 'open');
  update public.workflow_runs set status = 'stopped', finished_at = now(), stop_reason = btrim(p_reason) where id = v_r.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers, privileges and row-level security
-- ---------------------------------------------------------------------
create trigger workflows_touch before update on public.workflows
  for each row execute function app.touch_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['workflows', 'workflow_steps', 'workflow_runs', 'workflow_run_steps'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on function public.start_workflow(uuid, text, uuid) from public, anon;
revoke execute on function public.complete_workflow_step(uuid, text, boolean) from public, anon;
revoke execute on function public.stop_workflow_run(uuid, text) from public, anon;
grant execute on function public.start_workflow(uuid, text, uuid) to authenticated;
grant execute on function public.complete_workflow_step(uuid, text, boolean) to authenticated;
grant execute on function public.stop_workflow_run(uuid, text) to authenticated;
grant execute on all functions in schema app to authenticated, service_role;
-- Internal helpers that act for the caller without checking who is calling. They are used only
-- inside the workflow functions, so nobody may call them directly. (The app schema is not
-- reachable through the API in any case; this closes it at the database as well.)
revoke execute on function app.advance_workflow_run(uuid) from public, anon, authenticated;
revoke execute on function app.covering_rules(uuid, public.authority_kind, text, numeric) from public, anon, authenticated;
revoke execute on function app.rule_holder(public.delegation_rules) from public, anon, authenticated;
revoke execute on function app.rule_basis(public.delegation_rules) from public, anon, authenticated;

revoke all on public.workflows, public.workflow_steps, public.workflow_runs, public.workflow_run_steps from anon, authenticated;
grant select, insert, update on public.workflows to authenticated;
grant select, insert, delete on public.workflow_steps to authenticated;
-- Runs and their steps are written only by the functions
grant select on public.workflow_runs, public.workflow_run_steps to authenticated;
grant all on public.workflows, public.workflow_steps, public.workflow_runs, public.workflow_run_steps to service_role;

alter table public.workflows          enable row level security;
alter table public.workflow_steps     enable row level security;
alter table public.workflow_runs      enable row level security;
alter table public.workflow_run_steps enable row level security;

create policy workflows_select on public.workflows for select to authenticated
  using (app.has_role(organisation_id, app.records_roles())
         or (status <> 'draft' and app.is_member(organisation_id)));
create policy workflows_insert on public.workflows for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy workflows_update on public.workflows for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy workflow_steps_select on public.workflow_steps for select to authenticated
  using (app.is_member(organisation_id));
create policy workflow_steps_insert on public.workflow_steps for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy workflow_steps_delete on public.workflow_steps for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

create policy workflow_runs_select on public.workflow_runs for select to authenticated
  using (app.is_member(organisation_id));
create policy workflow_run_steps_select on public.workflow_run_steps for select to authenticated
  using (app.is_member(organisation_id));
