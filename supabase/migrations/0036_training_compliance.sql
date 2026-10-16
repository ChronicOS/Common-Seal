-- 0036: compliance training: roster, targets, declarations, personal links,
-- re-assignment and reminders.
--
-- Roster: everyone who can be assigned training (name, email, function,
--   manager, start date), whether or not they have a Common Seal account.
--   Members are added automatically.
-- Modules: can be linked to a policy (the policy's version in force is what
--   people read and acknowledge), carry uploaded material (document_links),
--   a declaration wording, and a default number of days to complete.
-- Targets: a module is assigned to everyone, to chosen functions, or to named
--   people. Anyone who later joins the roster and matches a target (a new
--   starter) is assigned automatically.
-- Completion: read the material, answer the questions if any (pass mark,
--   default 80%), then the declaration: agree to comply and type your name in
--   lieu of a signature. Signed in, or by personal link without an account.
-- Re-assignment: when a completed assignment expires (the module's frequency)
--   and when a linked policy gets a new version in force.
-- Reminders: 7 days before and on the due date, then weekly while overdue,
--   copied to the manager. The app shows them to send; nothing is emailed here.

-- ---------------------------------------------------------------------
-- Roster
-- ---------------------------------------------------------------------
create table public.training_people (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  full_name        text not null check (char_length(btrim(full_name)) between 2 and 150),
  email            text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  function_name    text,
  manager_name     text,
  manager_email    text check (manager_email is null or manager_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  start_date       date,
  user_id          uuid references auth.users (id) on delete set null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index training_people_email_idx on public.training_people (organisation_id, lower(email)) where email is not null;
create unique index training_people_user_idx on public.training_people (organisation_id, user_id) where user_id is not null;

-- ---------------------------------------------------------------------
-- Modules and targets
-- ---------------------------------------------------------------------
alter table public.training_modules add column if not exists policy_id uuid references public.policies (id) on delete set null;
alter table public.training_modules add column if not exists reassign_on_new_version boolean not null default true;
alter table public.training_modules add column if not exists due_days integer not null default 30 check (due_days between 1 and 365);
alter table public.training_modules add column if not exists declaration_text text not null
  default 'I have read and understood this material and I agree to comply with its terms.';

create table public.training_targets (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  module_id        uuid not null references public.training_modules (id) on delete cascade,
  kind             text not null check (kind in ('all', 'function', 'person')),
  function_name    text,
  person_id        uuid references public.training_people (id) on delete cascade,
  created_at       timestamptz not null default now(),
  check ((kind = 'function') = (function_name is not null) and (kind = 'person') = (person_id is not null))
);
create index training_targets_module_idx on public.training_targets (module_id);

-- ---------------------------------------------------------------------
-- Assignments: to a roster person; a signed-in member completes their own
-- ---------------------------------------------------------------------
alter table public.training_assignments alter column user_id drop not null;
alter table public.training_assignments add column if not exists person_id uuid references public.training_people (id) on delete restrict;
alter table public.training_assignments add column if not exists token text;
alter table public.training_assignments add column if not exists policy_version_no integer;
alter table public.training_assignments add column if not exists signed_name text;
alter table public.training_assignments add column if not exists agreed_at timestamptz;
alter table public.training_assignments add column if not exists completed_by_link boolean not null default false;
alter table public.training_assignments add column if not exists reminder_before_sent_at timestamptz;
alter table public.training_assignments add column if not exists reminder_due_sent_at timestamptz;
alter table public.training_assignments add column if not exists overdue_sent_at timestamptz;
alter table public.training_assignments add column if not exists overdue_count integer not null default 0;
alter table public.training_assignments add column if not exists reason text;   -- e.g. 'Assigned', 'New starter', 'Refresher', 'New policy version'
create unique index if not exists training_assignments_token_idx on public.training_assignments (token) where token is not null;
create unique index if not exists training_assignments_open_person_idx on public.training_assignments (module_id, person_id) where completed_at is null and person_id is not null;

alter table public.training_attempts alter column user_id drop not null;
alter table public.training_attempts add column if not exists person_id uuid references public.training_people (id) on delete restrict;

-- Members join the roster automatically; existing assignments are matched to them
create or replace function app.sync_training_roster(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.training_people (organisation_id, full_name, email, user_id)
  select m.organisation_id, coalesce(nullif(btrim(p.full_name), ''), u.email, 'Member'),
         case when u.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then lower(u.email) end, m.user_id
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.people p on p.organisation_id = m.organisation_id and p.user_id = m.user_id
  where m.organisation_id = p_org and m.is_active
    and not exists (select 1 from public.training_people t where t.organisation_id = p_org and (t.user_id = m.user_id or lower(t.email) = lower(u.email)))
  on conflict do nothing;
  -- A roster entry with the same email as a member is that member
  update public.training_people t set user_id = u.id
    from auth.users u join public.memberships m on m.user_id = u.id and m.organisation_id = p_org and m.is_active
   where t.organisation_id = p_org and t.user_id is null and lower(t.email) = lower(u.email)
     and not exists (select 1 from public.training_people x where x.organisation_id = p_org and x.user_id = u.id);
  perform set_config('app.training_system', 'on', true);
  update public.training_assignments a set person_id = t.id
    from public.training_people t
   where a.organisation_id = p_org and a.person_id is null and t.organisation_id = p_org and t.user_id = a.user_id;
  perform set_config('app.training_system', 'off', true);
end;
$$;

create or replace function app.new_training_token()
returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- Does this roster person fall within the module's targets?
create or replace function app.training_target_matches(p_module uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.training_targets g join public.training_people t on t.id = p_person
    where g.module_id = p_module and t.is_active
      and (g.kind = 'all'
           or (g.kind = 'function' and lower(btrim(coalesce(t.function_name, ''))) = lower(btrim(g.function_name)))
           or (g.kind = 'person' and g.person_id = t.id)));
$$;

-- Creates an open assignment unless the person already has an open or still-valid one
create or replace function app.assign_training_person(p_module uuid, p_person uuid, p_due date, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  m public.training_modules%rowtype;
  t public.training_people%rowtype;
  v_version integer;
begin
  select * into m from public.training_modules where id = p_module;
  select * into t from public.training_people where id = p_person;
  if m.status <> 'published' or not t.is_active then
    return false;
  end if;
  if exists (select 1 from public.training_assignments a where a.module_id = p_module and a.person_id = p_person
             and (a.completed_at is null or a.expires_on is null or a.expires_on > current_date)
             and (m.policy_id is null or a.completed_at is null
                  or a.policy_version_no is not distinct from (select max(v.version_no) from public.policy_versions v where v.policy_id = m.policy_id and v.status = 'approved'))) then
    return false;
  end if;
  if m.policy_id is not null then
    select max(v.version_no) into v_version from public.policy_versions v where v.policy_id = m.policy_id and v.status = 'approved';
  end if;
  perform set_config('app.training_system', 'on', true);
  insert into public.training_assignments (organisation_id, module_id, user_id, person_id, due_on, assigned_by, token, policy_version_no, reason)
  values (m.organisation_id, m.id, t.user_id, t.id, greatest(coalesce(p_due, current_date + m.due_days), current_date), auth.uid(),
          app.new_training_token(), v_version, p_reason)
  on conflict do nothing;
  perform set_config('app.training_system', 'off', true);
  return found;
end;
$$;

-- Sets who a module is for, and assigns everyone it now covers
create or replace function public.set_training_targets(p_module uuid, p_all boolean, p_functions text[], p_people uuid[], p_due date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  m public.training_modules%rowtype;
  v_count integer := 0;
  r record;
begin
  select * into m from public.training_modules where id = p_module;
  if m.id is null or not app.has_role(m.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to assign this training';
  end if;
  if m.status <> 'published' then
    raise exception 'Publish the training before assigning it';
  end if;
  if p_due is not null and p_due < current_date then
    raise exception 'The due date cannot be in the past';
  end if;
  if not coalesce(p_all, false) and coalesce(cardinality(p_functions), 0) = 0 and coalesce(cardinality(p_people), 0) = 0 then
    raise exception 'Choose who the training is for: everyone, one or more functions, or named people';
  end if;
  perform app.sync_training_roster(m.organisation_id);
  delete from public.training_targets where module_id = m.id;
  if p_all then
    insert into public.training_targets (organisation_id, module_id, kind) values (m.organisation_id, m.id, 'all');
  end if;
  insert into public.training_targets (organisation_id, module_id, kind, function_name)
  select m.organisation_id, m.id, 'function', btrim(f) from unnest(coalesce(p_functions, '{}')) f where btrim(f) <> '' group by btrim(f);
  insert into public.training_targets (organisation_id, module_id, kind, person_id)
  select m.organisation_id, m.id, 'person', t.id from public.training_people t where t.organisation_id = m.organisation_id and t.id = any (coalesce(p_people, '{}'));
  for r in select t.id from public.training_people t where t.organisation_id = m.organisation_id and t.is_active and app.training_target_matches(m.id, t.id) loop
    if app.assign_training_person(m.id, r.id, coalesce(p_due, current_date + m.due_days), 'Assigned') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- New starters and other new roster entries pick up the training they match
create or replace function app.on_training_person()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if not new.is_active then
    return new;
  end if;
  for r in select m.id, m.due_days from public.training_modules m
           where m.organisation_id = new.organisation_id and m.status = 'published' and app.training_target_matches(m.id, new.id) loop
    perform app.assign_training_person(r.id, new.id, greatest(coalesce(new.start_date, current_date), current_date) + r.due_days,
                                       case when tg_op = 'INSERT' then 'New starter' else 'Assigned' end);
  end loop;
  return new;
end;
$$;
create trigger training_people_assign after insert or update of function_name, is_active on public.training_people
  for each row execute function app.on_training_person();

-- Refreshers that have fallen due; run when the Training page opens
create or replace function public.refresh_due_training(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_count integer := 0;
begin
  if not app.is_member(p_org) then
    return 0;
  end if;
  perform app.sync_training_roster(p_org);
  for r in
    select distinct on (a.module_id, a.person_id) a.module_id, a.person_id, a.expires_on
    from public.training_assignments a join public.training_modules m on m.id = a.module_id
    where a.organisation_id = p_org and m.status = 'published' and a.person_id is not null and a.completed_at is not null
      and a.expires_on is not null and a.expires_on <= current_date + 30
    order by a.module_id, a.person_id, a.completed_at desc
  loop
    if app.training_target_matches(r.module_id, r.person_id)
       and app.assign_training_person(r.module_id, r.person_id, greatest(r.expires_on, current_date), 'Refresher') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- A new version of a linked policy comes into force: everyone covered acknowledges it again
create or replace function app.on_policy_version_in_force()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m record;
  t record;
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
    return new;
  end if;
  for m in select * from public.training_modules x where x.policy_id = new.policy_id and x.status = 'published' and x.reassign_on_new_version loop
    -- Open assignments now ask for the new version
    perform set_config('app.training_system', 'on', true);
    update public.training_assignments set policy_version_no = new.version_no
     where module_id = m.id and completed_at is null;
    perform set_config('app.training_system', 'off', true);
    for t in select p.id from public.training_people p where p.organisation_id = m.organisation_id and p.is_active and app.training_target_matches(m.id, p.id) loop
      perform app.assign_training_person(m.id, t.id, current_date + m.due_days, format('New policy version %s', new.version_no));
    end loop;
  end loop;
  return new;
end;
$$;
create trigger policy_versions_training after insert or update of status on public.policy_versions
  for each row execute function app.on_policy_version_in_force();

-- ---------------------------------------------------------------------
-- Completing: marks the answers, then records the declaration
-- ---------------------------------------------------------------------
create or replace function app.complete_training(p_assignment uuid, p_answers integer[], p_signed_name text, p_agreed boolean, p_by_link boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.training_assignments%rowtype;
  m public.training_modules%rowtype;
  t public.training_people%rowtype;
  v_total integer;
  v_right integer;
  v_score integer;
  v_passed boolean;
  v_marks boolean[];
  v_expires date;
  v_name text := regexp_replace(btrim(coalesce(p_signed_name, '')), '\s+', ' ', 'g');
begin
  select * into a from public.training_assignments where id = p_assignment for update;
  select * into m from public.training_modules where id = a.module_id;
  select * into t from public.training_people where id = a.person_id;
  if a.completed_at is not null then
    raise exception 'This training has already been completed';
  end if;
  if m.status <> 'published' then
    raise exception 'This training is no longer available';
  end if;

  select count(*), count(*) filter (where p_answers[q.position] = q.correct_index),
         coalesce(array_agg(coalesce(p_answers[q.position] = q.correct_index, false) order by q.position), '{}')
    into v_total, v_right, v_marks
  from public.training_questions q where q.module_id = m.id;
  if v_total > 0 and (p_answers is null or cardinality(p_answers) < v_total
                      or exists (select 1 from public.training_questions q where q.module_id = m.id and p_answers[q.position] is null)) then
    raise exception 'Answer every question';
  end if;
  v_score := case when v_total = 0 then 100 else round(100.0 * v_right / v_total) end;
  v_passed := v_score >= m.pass_mark;

  insert into public.training_attempts (organisation_id, assignment_id, user_id, person_id, answers, score, passed)
  values (a.organisation_id, a.id, a.user_id, a.person_id, coalesce(p_answers, '{}'), v_score, v_passed);

  if not v_passed then
    return jsonb_build_object('score', v_score, 'passed', false, 'pass_mark', m.pass_mark, 'marks', to_jsonb(v_marks), 'completed', false);
  end if;
  if not coalesce(p_agreed, false) then
    raise exception 'Confirm that you agree to comply';
  end if;
  if t.id is not null and lower(v_name) <> lower(regexp_replace(btrim(t.full_name), '\s+', ' ', 'g')) then
    raise exception 'Type your name as it appears here: %', t.full_name;
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Type your name in lieu of a signature';
  end if;

  v_expires := case when m.refresh_every_months is null then null else (current_date + make_interval(months => m.refresh_every_months))::date end;
  perform set_config('app.training_system', 'on', true);
  update public.training_assignments
     set completed_at = now(), score = v_score, expires_on = v_expires, signed_name = v_name, agreed_at = now(), completed_by_link = p_by_link
   where id = a.id;
  perform set_config('app.training_system', 'off', true);
  return jsonb_build_object('score', v_score, 'passed', true, 'pass_mark', m.pass_mark, 'marks', to_jsonb(v_marks), 'completed', true, 'expires_on', v_expires);
end;
$$;

-- Signed in
create or replace function public.complete_training(p_assignment uuid, p_answers integer[], p_signed_name text, p_agreed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.training_assignments%rowtype;
begin
  select * into a from public.training_assignments where id = p_assignment;
  if a.id is null or a.user_id is distinct from auth.uid() or not app.is_member(a.organisation_id) then
    raise exception 'This training is not assigned to you';
  end if;
  return app.complete_training(p_assignment, p_answers, p_signed_name, p_agreed, false);
end;
$$;

-- By personal link: what the person needs to see (questions without the answers)
create or replace function public.training_by_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a public.training_assignments%rowtype;
  m public.training_modules%rowtype;
  t public.training_people%rowtype;
  v_content text;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'This link is not valid';
  end if;
  select * into a from public.training_assignments where token = p_token;
  if a.id is null then
    raise exception 'This link is not valid';
  end if;
  select * into m from public.training_modules where id = a.module_id;
  select * into t from public.training_people where id = a.person_id;
  v_content := m.content;
  if m.policy_id is not null then
    select v.content into v_content from public.policy_versions v where v.policy_id = m.policy_id and v.status = 'approved';
  end if;
  return jsonb_build_object(
    'organisation', (select o.name from public.organisations o where o.id = a.organisation_id),
    'title', m.title, 'summary', m.summary, 'content', coalesce(v_content, m.content), 'pass_mark', m.pass_mark,
    'declaration', m.declaration_text, 'name', t.full_name, 'due_on', a.due_on,
    'policy_version', a.policy_version_no, 'available', m.status = 'published',
    'completed_at', a.completed_at, 'signed_name', a.signed_name, 'score', a.score,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('position', q.position, 'prompt', q.prompt, 'options', to_jsonb(q.options)) order by q.position)
                           from public.training_questions q where q.module_id = m.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('file_name', v.file_name, 'path', v.storage_path))
                       from public.document_links l join public.document_versions v on v.document_id = l.document_id
                       where (l.subject_table = 'training_modules' and l.subject_id = m.id)
                          or (m.policy_id is not null and v.document_id = (select pv.document_id from public.policy_versions pv where pv.policy_id = m.policy_id and pv.status = 'approved'))), '[]'::jsonb));
end;
$$;

create or replace function public.complete_training_by_link(p_token text, p_answers integer[], p_signed_name text, p_agreed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'This link is not valid';
  end if;
  select id into v_id from public.training_assignments where token = p_token;
  if v_id is null then
    raise exception 'This link is not valid';
  end if;
  return app.complete_training(v_id, p_answers, p_signed_name, p_agreed, true);
end;
$$;

-- Material for people using a personal link: readable only for published training with an open link
create or replace function app.can_read_training_object(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_versions v
    join public.document_links l on l.document_id = v.document_id
    join public.training_modules m on (l.subject_table = 'training_modules' and l.subject_id = m.id)
                                   or (l.subject_table = 'policies' and l.subject_id = m.policy_id)
    where v.storage_path = p_name and m.status = 'published'
      and exists (select 1 from public.training_assignments a where a.module_id = m.id and a.completed_at is null and a.token is not null));
$$;
create policy documents_bucket_training_read on storage.objects for select to anon
  using (bucket_id = 'documents' and app.can_read_training_object(name));

-- Material files attach to training modules
alter table public.document_links drop constraint document_links_subject_table_check;
alter table public.document_links add constraint document_links_subject_table_check check (subject_table in
  ('expense_claims', 'contracts', 'policies', 'workflow_run_steps', 'register_entries', 'dd_cases', 'ms_statements', 'insurance_policies', 'training_modules'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%training_modules%' then
    v_def := replace(v_def, $x$  else
    raise exception 'Files cannot be attached to that kind of record';$x$, $x$  elsif p_table = 'training_modules' then
    select m.organisation_id, (app.has_role(m.organisation_id, app.records_roles()) and m.status = 'draft') into v_org, v_ok
    from public.training_modules m where m.id = p_id;
  else
    raise exception 'Files cannot be attached to that kind of record';$x$);
    if v_def not like '%training_modules%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Reminders: 7 days before, on the due date, weekly while overdue (copied to the manager)
-- ---------------------------------------------------------------------
create or replace function public.mark_training_reminder_sent(p_assignment uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.training_assignments%rowtype;
begin
  select * into a from public.training_assignments where id = p_assignment for update;
  if a.id is null or not app.has_role(a.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to do this';
  end if;
  perform set_config('app.training_system', 'on', true);
  update public.training_assignments set
    reminder_before_sent_at = case when p_kind in ('before', 'due', 'overdue') then coalesce(reminder_before_sent_at, now()) else reminder_before_sent_at end,
    reminder_due_sent_at = case when p_kind in ('due', 'overdue') then coalesce(reminder_due_sent_at, now()) else reminder_due_sent_at end,
    overdue_sent_at = case when p_kind = 'overdue' then now() else overdue_sent_at end,
    overdue_count = case when p_kind = 'overdue' then overdue_count + 1 else overdue_count end
  where id = p_assignment;
  perform set_config('app.training_system', 'off', true);
end;
$$;

-- Personal links for the reminders: only the records roles can read them
create or replace function public.training_links(p_org uuid)
returns table (assignment_id uuid, token text) language sql stable security definer set search_path = '' as $$
  select a.id, a.token from public.training_assignments a
  where a.organisation_id = p_org and a.completed_at is null and a.token is not null and app.has_role(p_org, app.records_roles());
$$;

-- Assignments are changed only by these functions
create or replace function app.guard_training_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.training_system', true), 'off') = 'on' then
    return new;
  end if;
  raise exception 'Training assignments are changed through the training screens';
end;
$$;
create trigger training_assignments_guard before update on public.training_assignments
  for each row execute function app.guard_training_assignment();

-- A question you write offers at least four answers (adopted library modules keep theirs)
create or replace function app.guard_training_question_options()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.options) < 4 and coalesce((select m.source from public.training_modules m where m.id = new.module_id), 'custom') = 'custom' then
    raise exception 'Each question needs at least four answers to choose from';
  end if;
  return new;
end;
$$;
create trigger training_questions_four_options before insert on public.training_questions
  for each row execute function app.guard_training_question_options();

-- The old submit_training is replaced by complete_training (it has no declaration)
revoke execute on function public.submit_training(uuid, integer[]) from authenticated;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.training_people, public.training_targets from anon, authenticated;
grant select, insert, update on public.training_people to authenticated;
grant select on public.training_targets to authenticated;
grant all on public.training_people, public.training_targets to service_role;
-- The link code is never read directly
revoke select on public.training_assignments from authenticated;
grant select (id, organisation_id, module_id, user_id, person_id, due_on, assigned_by, assigned_at, completed_at, score, expires_on,
              policy_version_no, signed_name, agreed_at, completed_by_link, reminder_before_sent_at, reminder_due_sent_at,
              overdue_sent_at, overdue_count, reason)
  on public.training_assignments to authenticated;
grant update (policy_id, reassign_on_new_version, due_days, declaration_text) on public.training_modules to authenticated;

alter table public.training_people enable row level security;
alter table public.training_targets enable row level security;
create policy training_people_select on public.training_people for select to authenticated
  using (app.has_role(organisation_id, app.board_read_roles()) or user_id = auth.uid());
create policy training_people_insert on public.training_people for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy training_people_update on public.training_people for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy training_targets_select on public.training_targets for select to authenticated using (app.has_role(organisation_id, app.board_read_roles()));

-- Assignments are visible to the person they are for, and to the board and records roles
drop policy if exists training_assignments_select on public.training_assignments;
create policy training_assignments_select on public.training_assignments for select to authenticated
  using (user_id = auth.uid() and app.is_member(organisation_id)
         or app.has_role(organisation_id, app.board_read_roles())
         or app.has_role(organisation_id, array['auditor']::public.member_role[]));

do $$
declare t text;
begin
  foreach t in array array['training_people', 'training_targets'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;
create trigger training_people_touch before update on public.training_people for each row execute function app.touch_updated_at();

revoke execute on all functions in schema app from public, anon;
grant execute on function app.training_target_matches(uuid, uuid) to authenticated, service_role;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
revoke execute on function public.set_training_targets(uuid, boolean, text[], uuid[], date), public.refresh_due_training(uuid),
  public.complete_training(uuid, integer[], text, boolean), public.training_by_link(text),
  public.complete_training_by_link(text, integer[], text, boolean), public.mark_training_reminder_sent(uuid, text),
  public.training_links(uuid) from public, anon;
grant execute on function public.set_training_targets(uuid, boolean, text[], uuid[], date), public.refresh_due_training(uuid),
  public.complete_training(uuid, integer[], text, boolean), public.mark_training_reminder_sent(uuid, text),
  public.training_links(uuid) to authenticated;
grant execute on function public.training_by_link(text), public.complete_training_by_link(text, integer[], text, boolean) to anon, authenticated;
