-- =====================================================================
-- Common Seal - 0011: training
--
-- A standard library of starter modules (platform content), modules an
-- organisation adopts or writes itself, assignments with due dates, and
-- an append-only record of every attempt. A published module is fixed,
-- so a completion always points at the wording the person actually saw.
-- =====================================================================

create type public.training_status as enum ('draft', 'published', 'retired');

-- ---------------------------------------------------------------------
-- Standard library (the same for every organisation)
-- ---------------------------------------------------------------------
create table public.training_library (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  position        integer not null,
  title           text not null,
  summary         text not null,
  audience        text not null default 'everyone' check (audience in ('everyone', 'directors')),
  minutes         integer not null default 10,
  content         text not null default '',
  is_placeholder  boolean not null default false
);

create table public.training_library_questions (
  id             uuid primary key default gen_random_uuid(),
  library_id     uuid not null references public.training_library (id) on delete cascade,
  position       integer not null,
  prompt         text not null,
  options        text[] not null check (cardinality(options) between 2 and 6),
  correct_index  integer not null check (correct_index >= 0),
  unique (library_id, position)
);

-- ---------------------------------------------------------------------
-- An organisation's modules
-- ---------------------------------------------------------------------
create table public.training_modules (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  title                 text not null check (char_length(btrim(title)) >= 3),
  summary               text,
  content               text not null check (char_length(btrim(content)) >= 20),
  audience              text not null default 'everyone' check (audience in ('everyone', 'directors')),
  pass_mark             integer not null default 80 check (pass_mark between 0 and 100),
  refresh_every_months  integer check (refresh_every_months is null or refresh_every_months between 1 and 60),
  status                public.training_status not null default 'draft',
  source                text not null default 'custom' check (source in ('custom', 'library')),
  library_id            uuid references public.training_library (id) on delete set null,
  published_at          timestamptz,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index training_modules_org_idx on public.training_modules (organisation_id, status);

create table public.training_questions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  module_id        uuid not null references public.training_modules (id) on delete cascade,
  position         integer not null,
  prompt           text not null check (char_length(btrim(prompt)) >= 5),
  options          text[] not null check (cardinality(options) between 2 and 6),
  correct_index    integer not null check (correct_index >= 0),
  unique (module_id, position),
  check (correct_index < cardinality(options))
);

create table public.training_assignments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  module_id        uuid not null references public.training_modules (id) on delete restrict,
  user_id          uuid not null references auth.users (id) on delete restrict,
  due_on           date not null,
  assigned_by      uuid references auth.users (id) on delete set null,
  assigned_at      timestamptz not null default now(),
  completed_at     timestamptz,
  score            integer,
  expires_on       date
);
create index training_assignments_org_idx on public.training_assignments (organisation_id, module_id);
create index training_assignments_user_idx on public.training_assignments (user_id);
-- One open assignment per person per module
create unique index training_assignments_open_idx on public.training_assignments (module_id, user_id) where completed_at is null;

create table public.training_attempts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  assignment_id    uuid not null references public.training_assignments (id) on delete restrict,
  user_id          uuid not null references auth.users (id) on delete restrict,
  answers          integer[] not null,
  score            integer not null,
  passed           boolean not null,
  created_at       timestamptz not null default now()
);
create index training_attempts_assignment_idx on public.training_attempts (assignment_id);

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function app.guard_training_module()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.published_at := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if new.organisation_id <> old.organisation_id then
    raise exception 'A module cannot move between organisations';
  end if;
  if old.status <> 'draft' and (
       new.title <> old.title or new.content <> old.content or new.summary is distinct from old.summary
       or new.pass_mark <> old.pass_mark or new.audience <> old.audience) then
    raise exception 'A published module is fixed. Retire it and publish a new one to change the wording.';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'published') or (old.status = 'published' and new.status = 'retired')) then
      raise exception 'A module goes from draft to published, then to retired';
    end if;
    if new.status = 'published' then
      new.published_at := now();
    end if;
  end if;
  return new;
end;
$$;
create trigger training_modules_guard before insert or update on public.training_modules
  for each row execute function app.guard_training_module();

create or replace function app.guard_training_question()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_module public.training_modules%rowtype;
  v_id uuid := case when tg_op = 'DELETE' then old.module_id else new.module_id end;
begin
  select * into v_module from public.training_modules m where m.id = v_id;
  -- Nothing to guard when the module itself is being removed
  if v_module.id is null then
    return coalesce(new, old);
  end if;
  if v_module.status <> 'draft' then
    raise exception 'Questions are fixed once a module is published';
  end if;
  if tg_op <> 'DELETE' and new.organisation_id <> v_module.organisation_id then
    raise exception 'The question must belong to the module''s organisation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger training_questions_guard before insert or update or delete on public.training_questions
  for each row execute function app.guard_training_question();

create or replace function app.training_attempts_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Training attempts are a permanent record and cannot be changed';
end;
$$;
create trigger training_attempts_append_only before update or delete on public.training_attempts
  for each row execute function app.training_attempts_append_only();

-- ---------------------------------------------------------------------
-- Workflow functions
-- ---------------------------------------------------------------------

-- Copies a library module into the organisation as a draft to review.
create or replace function public.adopt_training_module(p_org uuid, p_library uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lib public.training_library%rowtype;
  v_module uuid;
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'You do not have permission to add training modules';
  end if;
  select * into v_lib from public.training_library l where l.id = p_library;
  if v_lib.id is null then
    raise exception 'That library module does not exist';
  end if;
  if v_lib.is_placeholder then
    raise exception 'That module is not available yet';
  end if;
  if exists (select 1 from public.training_modules m
             where m.organisation_id = p_org and m.library_id = v_lib.id and m.status <> 'retired') then
    raise exception 'You already have this module. Retire it first to take a fresh copy.';
  end if;

  insert into public.training_modules (organisation_id, title, summary, content, audience, source, library_id, refresh_every_months)
  values (p_org, v_lib.title, v_lib.summary, v_lib.content, v_lib.audience, 'library', v_lib.id, 12)
  returning id into v_module;

  insert into public.training_questions (organisation_id, module_id, position, prompt, options, correct_index)
  select p_org, v_module, q.position, q.prompt, q.options, q.correct_index
  from public.training_library_questions q where q.library_id = v_lib.id order by q.position;
  return v_module;
end;
$$;

-- The answer key, for the people who manage training.
create or replace function public.training_answer_key(p_module uuid)
returns table (question_id uuid, correct_index integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select m.organisation_id into v_org from public.training_modules m where m.id = p_module;
  if v_org is null or not app.has_role(v_org, app.records_roles()) then
    raise exception 'You do not have permission to see the answers';
  end if;
  return query select q.id, q.correct_index from public.training_questions q where q.module_id = p_module order by q.position;
end;
$$;

-- Assigns a published module. p_users null means everyone the module is for.
-- People with an open assignment, or a completion that has not expired, are skipped.
create or replace function public.assign_training(p_module uuid, p_users uuid[], p_due date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_m public.training_modules%rowtype;
  v_count integer;
begin
  select * into v_m from public.training_modules m where m.id = p_module;
  if v_m.id is null or not app.has_role(v_m.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to assign this module';
  end if;
  if v_m.status <> 'published' then
    raise exception 'Publish the module before assigning it';
  end if;
  if p_due is null or p_due < current_date then
    raise exception 'Choose a due date that is today or later';
  end if;
  if p_users is not null and exists (
       select 1 from unnest(p_users) u
       where not exists (select 1 from public.memberships ms
                         where ms.organisation_id = v_m.organisation_id and ms.user_id = u and ms.is_active)) then
    raise exception 'Everyone assigned must be an active member of this organisation';
  end if;

  insert into public.training_assignments (organisation_id, module_id, user_id, due_on, assigned_by)
  select v_m.organisation_id, v_m.id, ms.user_id, p_due, auth.uid()
  from public.memberships ms
  where ms.organisation_id = v_m.organisation_id and ms.is_active
    and case when p_users is not null then ms.user_id = any (p_users)
             when v_m.audience = 'directors' then ms.role = 'director'
             else ms.role <> 'auditor' end
    and not exists (
      select 1 from public.training_assignments a
      where a.module_id = v_m.id and a.user_id = ms.user_id
        and (a.completed_at is null or a.expires_on is null or a.expires_on >= current_date));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Marks the person's answers. Every attempt is kept; a pass completes the assignment.
create or replace function public.submit_training(p_assignment uuid, p_answers integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_a public.training_assignments%rowtype;
  v_m public.training_modules%rowtype;
  v_total integer;
  v_right integer;
  v_score integer;
  v_passed boolean;
  v_marks boolean[];
  v_expires date;
begin
  select * into v_a from public.training_assignments a where a.id = p_assignment for update;
  if v_a.id is null or v_a.user_id <> auth.uid() or not app.is_member(v_a.organisation_id) then
    raise exception 'This training is not assigned to you';
  end if;
  if v_a.completed_at is not null then
    raise exception 'You have already completed this training';
  end if;
  select * into v_m from public.training_modules m where m.id = v_a.module_id;

  select count(*), count(*) filter (where p_answers[q.position] = q.correct_index),
         coalesce(array_agg(coalesce(p_answers[q.position] = q.correct_index, false) order by q.position), '{}')
    into v_total, v_right, v_marks
  from public.training_questions q where q.module_id = v_m.id;

  if v_total > 0 and (p_answers is null or cardinality(p_answers) <> v_total
                      or exists (select 1 from unnest(p_answers) x where x is null)) then
    raise exception 'Answer every question';
  end if;

  -- With no questions, completing is an acknowledgement that the material was read
  v_score := case when v_total = 0 then 100 else round(100.0 * v_right / v_total) end;
  v_passed := v_score >= v_m.pass_mark;

  insert into public.training_attempts (organisation_id, assignment_id, user_id, answers, score, passed)
  values (v_a.organisation_id, v_a.id, v_a.user_id, coalesce(p_answers, '{}'), v_score, v_passed);

  if v_passed then
    v_expires := case when v_m.refresh_every_months is null then null
                      else (current_date + make_interval(months => v_m.refresh_every_months))::date end;
    update public.training_assignments
       set completed_at = now(), score = v_score, expires_on = v_expires
     where id = v_a.id;
    if v_expires is not null then
      insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
      values (v_a.organisation_id, format('%s: refresher training due', v_m.title), 'training_modules', v_m.id,
              (v_expires::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
    end if;
  end if;

  return jsonb_build_object('score', v_score, 'passed', v_passed, 'pass_mark', v_m.pass_mark, 'marks', to_jsonb(v_marks));
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers, privileges and row-level security
-- ---------------------------------------------------------------------
create trigger training_modules_touch before update on public.training_modules
  for each row execute function app.touch_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['training_modules', 'training_questions', 'training_assignments', 'training_attempts'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

revoke execute on function public.adopt_training_module(uuid, uuid) from public, anon;
revoke execute on function public.training_answer_key(uuid) from public, anon;
revoke execute on function public.assign_training(uuid, uuid[], date) from public, anon;
revoke execute on function public.submit_training(uuid, integer[]) from public, anon;
grant execute on function public.adopt_training_module(uuid, uuid) to authenticated;
grant execute on function public.training_answer_key(uuid) to authenticated;
grant execute on function public.assign_training(uuid, uuid[], date) to authenticated;
grant execute on function public.submit_training(uuid, integer[]) to authenticated;
grant execute on all functions in schema app to authenticated, service_role;

revoke all on public.training_library, public.training_library_questions, public.training_modules,
  public.training_questions, public.training_assignments, public.training_attempts from anon, authenticated;
grant select on public.training_library to authenticated;
grant select, insert, update on public.training_modules to authenticated;
-- The correct answer is never readable directly; it comes only through training_answer_key
grant select (id, organisation_id, module_id, position, prompt, options) on public.training_questions to authenticated;
grant insert, delete on public.training_questions to authenticated;
grant select, delete on public.training_assignments to authenticated;
grant select on public.training_attempts to authenticated;
grant all on public.training_library, public.training_library_questions, public.training_modules,
  public.training_questions, public.training_assignments, public.training_attempts to service_role;

alter table public.training_library           enable row level security;
alter table public.training_library_questions enable row level security;
alter table public.training_modules           enable row level security;
alter table public.training_questions         enable row level security;
alter table public.training_assignments       enable row level security;
alter table public.training_attempts          enable row level security;

create policy training_library_select on public.training_library for select to authenticated using (true);
-- No policy on training_library_questions: they are read only by adopt_training_module

create policy training_modules_select on public.training_modules for select to authenticated
  using (app.has_role(organisation_id, app.records_roles())
         or (status <> 'draft' and app.is_member(organisation_id)));
create policy training_modules_insert on public.training_modules for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy training_modules_update on public.training_modules for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy training_questions_select on public.training_questions for select to authenticated
  using (app.is_member(organisation_id));
create policy training_questions_insert on public.training_questions for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy training_questions_delete on public.training_questions for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

-- People see their own; records roles, directors and auditors see everyone's status
create policy training_assignments_select on public.training_assignments for select to authenticated
  using (user_id = auth.uid() and app.is_member(organisation_id)
         or app.has_role(organisation_id, app.board_read_roles())
         or app.has_role(organisation_id, array['auditor']::public.member_role[]));
-- An assignment can be withdrawn only before it is completed
create policy training_assignments_delete on public.training_assignments for delete to authenticated
  using (completed_at is null and app.has_role(organisation_id, app.records_roles()));

create policy training_attempts_select on public.training_attempts for select to authenticated
  using (user_id = auth.uid() and app.is_member(organisation_id)
         or app.has_role(organisation_id, app.records_roles()));

-- ---------------------------------------------------------------------
-- Starter library. Plain-English starting points for each organisation
-- to review against its own policies before publishing.
-- ---------------------------------------------------------------------
insert into public.training_library (slug, position, title, summary, audience, minutes, content, is_placeholder) values
('abc-essentials', 1, 'Anti-bribery and corruption essentials',
 'What a bribe is, where the risk sits and what to do when something feels wrong.', 'everyone', 10,
$t$A bribe is anything of value offered, promised, given or accepted to improperly influence a decision. It does not have to be cash. Gifts, travel, jobs for relatives, donations and inflated commissions can all be bribes.

It does not matter whether the bribe works, or whether it is paid directly. If an agent, distributor or consultant pays a bribe while acting for us, the company and the people involved can still be responsible.

Dealing with public officials carries the highest risk. That includes employees of government departments, regulators, public hospitals and state-owned businesses. Anything of value offered to a public official needs approval first under our policy.

Warning signs include a third party who asks for payment in cash or to an unrelated account, commissions that are out of proportion to the work, a refusal to put terms in writing, and pressure to use a particular intermediary.

If you are asked for a bribe, or you suspect one, do not pay and do not investigate on your own. Tell Legal or Compliance straight away. You will not be penalised for refusing to pay a bribe, even if the company loses business.$t$, false),
('gifts-conflicts', 2, 'Gifts, hospitality and conflicts of interest',
 'When to declare a gift or an interest, and why declaring early protects you.', 'everyone', 8,
$t$Giving and receiving modest gifts and hospitality is a normal part of business. It becomes a problem when it could influence a decision, or could look as if it did.

Declare every gift or hospitality you give or receive in connection with your work. Declarations above the company's threshold, and anything involving a public official, need a decision before you accept or offer.

Timing matters. A gift from a supplier during a tender, a contract renewal or a dispute is far more likely to be improper than the same gift at another time.

A conflict of interest arises when your personal interests, or those of someone close to you, could affect your judgement at work. Examples are a relative who works for a supplier, shares in a competitor, or a second job.

Having a conflict is not wrongdoing. Hiding one is. Declare it as soon as you know about it, so that it can be managed, for example by stepping back from a decision.$t$, false),
('modern-slavery', 3, 'Modern slavery awareness',
 'How to recognise the signs of modern slavery in operations and supply chains, and how to raise them.', 'everyone', 10,
$t$Modern slavery describes situations where a person cannot refuse or leave work because of threats, violence, coercion, deception or abuse of power. It includes forced labour, debt bondage, human trafficking, deceptive recruiting and the worst forms of child labour.

It is different from poor working conditions or underpayment, although those can be warning signs. Modern slavery happens in every country, including Australia.

Risk is higher where work is low skilled, seasonal or done by migrant workers, where labour is supplied through agencies, and in supply chains with many tiers.

Signs to look for include workers whose identity documents are held by someone else, workers who owe large recruitment fees, workers who seem frightened or are not allowed to speak for themselves, and prices that are too low to cover lawful wages.

If you see signs, do not confront the supplier or try to resolve it yourself, because that can put workers at greater risk. Report it to Legal or Compliance. The aim is to protect the people affected, not simply to end the contract.$t$, false),
('speaking-up', 4, 'Speaking up',
 'How to raise a concern, what protection you have and what managers must do when someone comes to them.', 'everyone', 8,
$t$If you see or suspect misconduct, we want to know. That includes fraud, bribery, safety risks, harassment, breaches of the law and attempts to hide any of these.

You do not need proof. You need reasonable grounds to suspect something is wrong. Raise it and let the right people look into it.

You can raise a concern with your manager, with Legal or Compliance, or through the company's confidential reporting channel. You can ask to remain anonymous.

Your identity must be kept confidential, and it is against the law to cause someone detriment because they have raised, or might raise, a concern. Retaliation is treated as serious misconduct.

If someone raises a concern with you, listen, thank them and pass it to Legal or Compliance promptly. Do not investigate it yourself, do not tell the person concerned, and do not share the reporter's identity with anyone who does not need it.$t$, false),
('privacy-basics', 5, 'Privacy and personal information',
 'Handling personal information properly and what to do the moment something goes wrong.', 'everyone', 8,
$t$Personal information is any information about a person who can be identified. Names, contact details, photos, employment records and customer histories all count. Health information and some other categories are sensitive and need extra care.

Collect only what you need, and use it only for the purpose it was collected for or one the person would reasonably expect.

Keep it secure. Share it only with people who need it for their work, use approved systems, and do not send it to personal email or paste it into tools the company has not approved.

Do not keep it longer than it is needed. Follow the company's retention rules when deleting or archiving.

If personal information is lost, sent to the wrong person or accessed without authority, tell Legal or the privacy officer immediately. Some breaches must be notified to the regulator and the people affected, and the time to assess them is short. Reporting quickly is never the wrong call.$t$, false),
('director-duties', 6, 'Director duties refresher',
 'Director training is planned as a separate programme. This is a placeholder.', 'directors', 20, '', true);

insert into public.training_library_questions (library_id, position, prompt, options, correct_index)
select l.id, q.position, q.prompt, q.options, q.correct_index
from (values
  ('abc-essentials', 1, 'Which of these could be a bribe?',
   array['Only cash payments', 'A job offered to an official''s relative to win a licence', 'Only payments above a set amount', 'Only payments made directly by an employee'], 1),
  ('abc-essentials', 2, 'A distributor pays a bribe while selling our products. Who may be responsible?',
   array['Only the distributor', 'Nobody, if we did not know', 'The company and the people involved may be responsible', 'Only the person who received it'], 2),
  ('abc-essentials', 3, 'An agent asks for their commission to be paid in cash to another company. What should you do?',
   array['Pay it if the amount is the same', 'Ask the agent to explain, then decide yourself', 'Do not pay, and tell Legal or Compliance', 'Split the payment into smaller amounts'], 2),
  ('abc-essentials', 4, 'You refuse to pay a bribe and the company loses the deal. What happens to you?',
   array['You may be penalised for the lost business', 'You will not be penalised', 'It depends on the size of the deal'], 1),
  ('gifts-conflicts', 1, 'A supplier bidding in a current tender offers you tickets to a final. What is the main concern?',
   array['The tickets may be hard to resell', 'The timing means it could influence, or appear to influence, the decision', 'There is no concern if you pay tax on them'], 1),
  ('gifts-conflicts', 2, 'Your sister has just started working for one of our suppliers. What should you do?',
   array['Nothing unless you deal with that supplier this year', 'Declare it so it can be managed', 'Ask her to resign'], 1),
  ('gifts-conflicts', 3, 'Which gifts or hospitality need a decision before you accept or offer?',
   array['None, as long as you declare afterwards', 'Those above the company threshold or involving a public official', 'Only gifts of cash'], 1),
  ('modern-slavery', 1, 'Which of these is a sign of possible modern slavery?',
   array['Workers are paid weekly', 'A labour agent holds the workers'' passports', 'The supplier has more than one site', 'Workers wear uniforms'], 1),
  ('modern-slavery', 2, 'You notice warning signs during a supplier visit. What should you do?',
   array['Confront the site manager immediately', 'End the contract on the spot', 'Report it to Legal or Compliance', 'Wait until the next audit'], 2),
  ('modern-slavery', 3, 'Modern slavery only happens overseas.',
   array['True', 'False'], 1),
  ('speaking-up', 1, 'How much evidence do you need before raising a concern?',
   array['Written proof', 'A second witness', 'Reasonable grounds to suspect something is wrong'], 2),
  ('speaking-up', 2, 'A team member tells you they think a colleague is falsifying records. What should you do?',
   array['Investigate quietly yourself', 'Tell the colleague so they can respond', 'Thank them and pass it to Legal or Compliance promptly', 'Wait to see if it happens again'], 2),
  ('speaking-up', 3, 'Treating someone badly because they raised a concern is:',
   array['Acceptable if the concern was mistaken', 'Unlawful and treated as serious misconduct', 'A matter for the manager''s discretion'], 1),
  ('privacy-basics', 1, 'You emailed a customer list to the wrong external address. What should you do first?',
   array['Send a recall and wait to see if it works', 'Tell Legal or the privacy officer immediately', 'Delete the sent email', 'Mention it at the next team meeting'], 1),
  ('privacy-basics', 2, 'Which of these is personal information?',
   array['A named customer''s order history', 'Total sales for the quarter', 'The company''s published price list'], 0),
  ('privacy-basics', 3, 'You want to use a new online tool to analyse customer records. What should you check first?',
   array['Whether it is free', 'Whether the company has approved it for personal information', 'Whether colleagues already use it'], 1)
) as q (slug, position, prompt, options, correct_index)
join public.training_library l on l.slug = q.slug;
