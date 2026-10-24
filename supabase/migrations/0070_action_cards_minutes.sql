-- 0070: Action cards, and the minutes approval workflow.
--
-- Action cards
--   Every workflow (and later every AI agent) ends in a card for one person, or one role, to decide:
--   what was done, the one decision needed, the evidence, and what happens on approval. Buttons are
--   Approve, Change, Send it back (or, for information cards, Got it). Each card records who decided,
--   when, what they changed and how long it took (from first seeing it), for the audit trail and the
--   "human time per compliance task" measure. Cards are only changed through decide_card.
--
-- Minutes workflow
--   1. The secretary sends the draft minutes for approval (from the meeting page).
--   2. Card for the approver: the person named in Defaults (e.g. the general counsel), otherwise the
--      company secretary role. Approve, change the text, or send it back to the drafter with a note.
--   3. Card for the chair to sign. If the chair has no VeraPhius login, the card goes to the company
--      secretary to record that the chair signed (with the signed copy attached on the meeting page).
--   4. Signing makes the minutes final and locks the meeting (as before). Then:
--        - each action owner gets a card: Got it, or ask for another due date (the company secretary
--          decides that request);
--        - interests declared in the meeting: a card to check the register of interests;
--        - passed resolutions that look like they need an ASIC filing (appointments, resignations,
--          shares, name or constitution changes): a card to check the form and the 28-day deadline.
--   The draft itself is still built from the notes (no AI yet). The AI minutes agent will produce the
--   same first card, with its evidence, once it is built.

-- ---------- Action cards ----------
create table if not exists public.action_cards (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  kind               text not null check (kind in ('minutes_approve', 'minutes_sign', 'minutes_revise', 'action_assigned', 'action_date', 'interest_update', 'follow_up')),
  subject_table      text not null check (subject_table in ('minutes', 'meetings', 'tasks')),
  subject_id         uuid not null,
  title              text not null check (char_length(title) between 3 and 300),
  summary            text check (summary is null or char_length(summary) <= 2000),
  decision           text not null check (char_length(decision) between 3 and 300),
  on_approval        text check (on_approval is null or char_length(on_approval) <= 500),
  evidence           jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  flags              jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array'),
  payload            jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  assignee_user_id   uuid references auth.users (id) on delete set null,
  assignee_roles     public.member_role[],
  prepared_by        text not null default 'VeraPhius' check (char_length(prepared_by) <= 80),
  agent_version      text,
  model              text,
  status             text not null default 'open' check (status in ('open', 'approved', 'changed', 'sent_back', 'done', 'cancelled')),
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  decision_note      text check (decision_note is null or char_length(decision_note) <= 1000),
  first_seen_at      timestamptz,
  seconds_to_decide  integer,
  due_on             date,
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  check (assignee_user_id is not null or assignee_roles is not null)
);
create index if not exists action_cards_open_idx on public.action_cards (organisation_id, status, due_on);
create index if not exists action_cards_subject_idx on public.action_cards (subject_table, subject_id);

create or replace function app.can_decide_card(c public.action_cards)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_member(c.organisation_id)
     and (c.assignee_user_id = auth.uid() or (c.assignee_user_id is null and c.assignee_roles is not null and app.has_role(c.organisation_id, c.assignee_roles)));
$$;

alter table public.action_cards enable row level security;
revoke all on public.action_cards from anon, authenticated;
grant select on public.action_cards to authenticated;
grant all on public.action_cards to service_role;
drop policy if exists action_cards_read on public.action_cards;
-- The person who must decide, anyone in the role it is waiting on, and the records roles (oversight)
create policy action_cards_read on public.action_cards for select to authenticated
  using (app.can_decide_card(action_cards) or app.has_role(organisation_id, app.records_roles()));
drop trigger if exists action_cards_audit on public.action_cards;
create trigger action_cards_audit after insert or update or delete on public.action_cards for each row execute function app.audit_row();

-- When a card is first shown to the person who decides (for the time measure)
create or replace function public.card_seen(p_card uuid)
returns void language sql security definer set search_path = '' as $$
  update public.action_cards c set first_seen_at = now()
   where c.id = p_card and c.first_seen_at is null and c.status = 'open' and app.can_decide_card(c);
$$;

-- ---------- Minutes workflow: settings and columns ----------
alter table public.organisations add column if not exists minutes_approver_user_id uuid references auth.users (id) on delete set null;
grant update (minutes_approver_user_id) on public.organisations to authenticated;

alter table public.minutes
  add column if not exists review_status text not null default 'drafting' check (review_status in ('drafting', 'with_approver', 'sent_back', 'with_chair', 'signed')),
  add column if not exists submitted_by uuid references auth.users (id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists sent_back_note text check (sent_back_note is null or char_length(sent_back_note) <= 1000),
  add column if not exists chair_person_id uuid references public.people (id) on delete set null,
  add column if not exists chair_signed_at timestamptz,
  add column if not exists signed_on_behalf boolean not null default false;
-- Minutes already final count as signed (final minutes are otherwise locked, so the guard is paused for this one-off)
alter table public.minutes disable trigger minutes_guard;
update public.minutes set review_status = 'signed' where status = 'final' and review_status = 'drafting';
alter table public.minutes enable trigger minutes_guard;

-- Who approves draft minutes: the person named in Defaults (if still a member), else the company secretary role
create or replace function app.minutes_approver(p_org uuid, out user_id uuid, out roles public.member_role[])
language plpgsql stable security definer set search_path = '' as $$
begin
  select o.minutes_approver_user_id into user_id from public.organisations o
   where o.id = p_org and exists (select 1 from public.memberships m where m.organisation_id = p_org and m.user_id = o.minutes_approver_user_id and m.is_active);
  if user_id is null then
    roles := case when exists (select 1 from public.memberships m where m.organisation_id = p_org and m.is_active and (m.role = 'secretary' or 'secretary' = any (coalesce(m.extra_roles, '{}'))))
                  then array['secretary']::public.member_role[] else array['owner', 'admin']::public.member_role[] end;
  end if;
end;
$$;

-- The meeting's chair: who attended as chair, else the company's chair
create or replace function app.meeting_chair(p_meeting uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select a.person_id from public.attendance a where a.meeting_id = p_meeting and lower(coalesce(a.capacity, '')) = 'chair' and a.status <> 'absent' order by a.status = 'present' desc limit 1),
    (select o.person_id from public.meetings m join public.bodies b on b.id = m.body_id
       join public.officeholdings o on o.entity_id = b.entity_id and o.role = 'chair' and o.ceased_on is null
      where m.id = p_meeting limit 1));
$$;

-- ---------- Step 1: send the draft for approval ----------
create or replace function public.submit_minutes(p_meeting uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings%rowtype;
  v_min uuid;
  v_card uuid;
  v_appr record;
  v_items integer;
  v_res integer;
  v_acts integer;
  v_conf integer;
  v_flags jsonb := '[]'::jsonb;
  v_evidence jsonb;
  v_chair text;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not app.has_role(m.organisation_id, app.board_write_roles()) then
    raise exception 'Only the owner, an administrator or the secretary can send minutes for approval';
  end if;
  if m.status <> 'minutes_draft' then
    raise exception 'End the meeting first; minutes are sent for approval once the meeting has ended';
  end if;
  if char_length(btrim(coalesce(p_content, ''))) < 20 then
    raise exception 'The minutes are empty';
  end if;

  insert into public.minutes (organisation_id, meeting_id, content) values (m.organisation_id, m.id, p_content)
  on conflict (meeting_id) do update set content = excluded.content
  returning id into v_min;
  update public.minutes set review_status = 'with_approver', submitted_by = auth.uid(), submitted_at = now(), sent_back_note = null,
         approved_by = null, approved_at = null, chair_person_id = app.meeting_chair(m.id)
   where id = v_min;
  -- Anything still open from an earlier round is closed
  update public.action_cards set status = 'cancelled', decided_at = now(), decision_note = 'Replaced when the minutes were sent again'
   where subject_table = 'minutes' and subject_id = v_min and status = 'open';

  select count(*) into v_items from public.agenda_items where meeting_id = m.id;
  select count(*) into v_res from public.resolutions where meeting_id = m.id;
  select count(*) into v_acts from public.tasks where subject_table = 'meetings' and subject_id = m.id;
  select count(*) into v_conf from public.meeting_captures where meeting_id = m.id and btrim(coalesce(conflicts, '')) <> '';

  -- What the approver should look at
  select coalesce(jsonb_agg(jsonb_build_object('label', a.title, 'quote', left(btrim(c.notes), 300)) order by a.position), '[]'::jsonb) into v_evidence
  from public.agenda_items a join public.meeting_captures c on c.agenda_item_id = a.id
  where a.meeting_id = m.id and btrim(coalesce(c.notes, '')) <> '';
  select coalesce(jsonb_agg(format('No notes were taken for "%s"', a.title) order by a.position), '[]'::jsonb) into v_flags
  from public.agenda_items a where a.meeting_id = m.id
    and not exists (select 1 from public.meeting_captures c where c.agenda_item_id = a.id and btrim(coalesce(c.notes, '')) <> '');
  if not exists (select 1 from public.attendance where meeting_id = m.id and status = 'present') then
    v_flags := v_flags || to_jsonb('No one is recorded as present: check attendance and quorum'::text);
  end if;
  if exists (select 1 from public.tasks t where t.subject_table = 'meetings' and t.subject_id = m.id and t.assignee_person_id is null) then
    v_flags := v_flags || to_jsonb('Some actions have no owner'::text);
  end if;
  if app.meeting_chair(m.id) is null then
    v_flags := v_flags || to_jsonb('No chair is recorded for this meeting'::text);
  end if;
  select p.full_name into v_chair from public.people p where p.id = app.meeting_chair(m.id);

  v_appr := app.minutes_approver(m.organisation_id);
  insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, evidence, flags,
                                   assignee_user_id, assignee_roles, prepared_by, due_on, payload)
  values (m.organisation_id, 'minutes_approve', 'minutes', v_min,
          format('Minutes to approve: %s', m.title),
          format('Drafted the minutes from the notes taken in the meeting: %s, %s, %s, %s.',
                 v_items || case when v_items = 1 then ' agenda item' else ' agenda items' end,
                 v_res || case when v_res = 1 then ' resolution' else ' resolutions' end,
                 v_acts || case when v_acts = 1 then ' action' else ' actions' end,
                 v_conf || case when v_conf = 1 then ' declared interest' else ' declared interests' end),
          'Approve the draft for the chair to sign, change it, or send it back',
          format('Sent to %s to sign', coalesce(v_chair, 'the chair')),
          v_evidence, v_flags, v_appr.user_id, v_appr.roles, 'VeraPhius (from the meeting notes)', current_date + 7,
          jsonb_build_object('meeting_id', m.id))
  returning id into v_card;
  return v_card;
end;
$$;

-- ---------- After signing: actions, interests, filings ----------
create or replace function app.minutes_follow_ups(p_meeting uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.meetings%rowtype;
  t record;
  c record;
  r record;
  v_appr record;
begin
  select * into m from public.meetings where id = p_meeting;
  v_appr := app.minutes_approver(m.organisation_id);
  -- Each action owner (with a login) is told, and can ask for another date
  for t in select tk.*, p.user_id as owner_user, p.full_name as owner_name from public.tasks tk join public.people p on p.id = tk.assignee_person_id
           where tk.subject_table = 'meetings' and tk.subject_id = m.id and tk.status in ('open', 'in_progress') loop
    if t.owner_user is not null and exists (select 1 from public.memberships ms where ms.organisation_id = m.organisation_id and ms.user_id = t.owner_user and ms.is_active) then
      insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, assignee_user_id, due_on, payload)
      values (m.organisation_id, 'action_assigned', 'tasks', t.id, format('New action for you: %s', t.title),
              format('From the minutes of %s, now signed.', m.title),
              'Got it, or ask for another due date', 'The action stays in your list until it is done',
              t.owner_user, (t.due_at at time zone 'Australia/Sydney')::date, jsonb_build_object('meeting_id', m.id, 'due_on', (t.due_at at time zone 'Australia/Sydney')::date));
    end if;
  end loop;
  -- Interests declared in the meeting: check the register
  for c in select a.title, cp.conflicts from public.meeting_captures cp join public.agenda_items a on a.id = cp.agenda_item_id
           where cp.meeting_id = m.id and btrim(coalesce(cp.conflicts, '')) <> '' loop
    insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, evidence, assignee_user_id, assignee_roles, due_on, payload)
    values (m.organisation_id, 'interest_update', 'meetings', m.id, format('Check the register of interests: %s', m.title),
            format('An interest was declared on "%s".', c.title), 'Confirm the register of interests is up to date',
            'Marked as checked', jsonb_build_array(jsonb_build_object('label', c.title, 'quote', left(btrim(c.conflicts), 300))),
            v_appr.user_id, v_appr.roles, current_date + 7, jsonb_build_object('meeting_id', m.id));
  end loop;
  -- Resolutions that usually need an ASIC form
  for r in select * from public.resolutions where meeting_id = m.id and outcome = 'passed'
             and text ~* '(appoint|resign|retire|ceas|remov|issue of|allot|transfer of shares|share capital|change of name|constitution|registered office|principal place)' loop
    insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, evidence, assignee_user_id, assignee_roles, due_on, payload)
    values (m.organisation_id, 'follow_up', 'meetings', m.id, 'Check whether an ASIC form is needed',
            'A resolution passed at this meeting usually needs a notice to ASIC (most within 28 days).',
            'Confirm the form is prepared, or that none is needed', 'Marked as done',
            jsonb_build_array(jsonb_build_object('label', 'Resolution', 'quote', left(r.text, 300))),
            v_appr.user_id, v_appr.roles, (m.scheduled_at at time zone 'Australia/Sydney')::date + 28, jsonb_build_object('meeting_id', m.id, 'resolution_id', r.id));
  end loop;
end;
$$;

-- ---------- Deciding a card ----------
create or replace function public.decide_card(p_card uuid, p_decision text, p_note text default null, p_payload jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.action_cards%rowtype;
  mi public.minutes%rowtype;
  v_chair_user uuid;
  v_chair_name text;
  v_appr record;
  v_status text;
  v_due date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into c from public.action_cards where id = p_card for update;
  if c.id is null or not app.can_decide_card(c) then
    raise exception 'This card is not waiting on you';
  end if;
  if c.status <> 'open' then
    raise exception 'This card has already been decided';
  end if;
  v_status := case p_decision when 'approve' then 'approved' when 'change' then 'changed' when 'send_back' then 'sent_back' when 'done' then 'done' when 'ask_date' then 'done' end;
  if v_status is null then
    raise exception 'Unknown decision';
  end if;

  if c.kind = 'minutes_approve' then
    select * into mi from public.minutes where id = c.subject_id for update;
    if mi.status = 'final' then raise exception 'These minutes are already final'; end if;
    if p_decision = 'send_back' then
      if v_note is null then raise exception 'Say what needs changing'; end if;
      update public.minutes set review_status = 'sent_back', sent_back_note = v_note where id = mi.id;
      if mi.submitted_by is not null then
        insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, assignee_user_id, due_on, payload)
        values (c.organisation_id, 'minutes_revise', 'minutes', mi.id, replace(c.title, 'Minutes to approve', 'Minutes sent back'),
                v_note, 'Revise the draft and send it again', mi.submitted_by, current_date + 7, c.payload);
      end if;
    elsif p_decision in ('approve', 'change') then
      if p_decision = 'change' then
        if char_length(btrim(coalesce(p_payload ->> 'content', ''))) < 20 then raise exception 'The changed minutes are empty'; end if;
        update public.minutes set content = p_payload ->> 'content' where id = mi.id;
      end if;
      update public.minutes set review_status = 'with_chair', approved_by = auth.uid(), approved_at = now(), chair_person_id = coalesce(chair_person_id, app.meeting_chair(meeting_id))
       where id = mi.id returning * into mi;
      select p.user_id, p.full_name into v_chair_user, v_chair_name from public.people p where p.id = mi.chair_person_id;
      if v_chair_user is not null and exists (select 1 from public.memberships ms where ms.organisation_id = c.organisation_id and ms.user_id = v_chair_user and ms.is_active) then
        insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, assignee_user_id, due_on, payload)
        values (c.organisation_id, 'minutes_sign', 'minutes', mi.id, replace(c.title, 'Minutes to approve', 'Minutes to sign'),
                'Approved as a correct record by the company secretary. Please read and sign.', 'Sign the minutes as a correct record, or send them back',
                'The minutes become final and the meeting is locked; actions go to their owners', v_chair_user, current_date + 14, c.payload);
      else
        v_appr := app.minutes_approver(c.organisation_id);
        insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, assignee_user_id, assignee_roles, due_on, payload)
        values (c.organisation_id, 'minutes_sign', 'minutes', mi.id, replace(c.title, 'Minutes to approve', 'Record the chair''s signature'),
                format('%s does not use VeraPhius. Get the minutes signed, attach the signed copy to the meeting, then record it here.', coalesce(v_chair_name, 'The chair')),
                'Record that the chair has signed the minutes', 'The minutes become final and the meeting is locked; actions go to their owners',
                v_appr.user_id, v_appr.roles, current_date + 14, c.payload || jsonb_build_object('on_behalf', true));
      end if;
    else
      raise exception 'Choose approve, change or send back';
    end if;

  elsif c.kind = 'minutes_sign' then
    select * into mi from public.minutes where id = c.subject_id for update;
    if p_decision = 'send_back' then
      if v_note is null then raise exception 'Say what needs changing'; end if;
      update public.minutes set review_status = 'with_approver', sent_back_note = v_note where id = mi.id;
      v_appr := app.minutes_approver(c.organisation_id);
      insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, assignee_user_id, assignee_roles, due_on, payload)
      values (c.organisation_id, 'minutes_approve', 'minutes', mi.id, replace(replace(c.title, 'Minutes to sign', 'Minutes to approve'), 'Record the chair''s signature', 'Minutes to approve'),
              format('The chair sent the minutes back: %s', v_note), 'Change the draft and approve it again, or send it back to the drafter',
              'Sent to the chair again to sign', v_appr.user_id, v_appr.roles, current_date + 7, c.payload);
    elsif p_decision = 'approve' then
      update public.minutes set status = 'final', review_status = 'signed', chair_signed_at = now(),
             signed_on_behalf = coalesce((c.payload ->> 'on_behalf')::boolean, false)
       where id = mi.id;
      perform app.minutes_follow_ups(mi.meeting_id);
    else
      raise exception 'Choose sign or send back';
    end if;

  elsif c.kind = 'minutes_revise' then
    if p_decision <> 'done' then raise exception 'Revise the minutes on the meeting page and send them again'; end if;

  elsif c.kind = 'action_assigned' then
    if p_decision = 'ask_date' then
      v_due := nullif(p_payload ->> 'due_on', '')::date;
      if v_due is null or v_due < current_date then raise exception 'Choose a new due date (today or later)'; end if;
      v_appr := app.minutes_approver(c.organisation_id);
      insert into public.action_cards (organisation_id, kind, subject_table, subject_id, title, summary, decision, on_approval, assignee_user_id, assignee_roles, due_on, payload)
      values (c.organisation_id, 'action_date', 'tasks', c.subject_id, replace(c.title, 'New action for you', 'New due date asked for'),
              format('Asked for %s instead of %s%s', to_char(v_due, 'DD Mon YYYY'), coalesce(to_char((c.payload ->> 'due_on')::date, 'DD Mon YYYY'), 'no date'), coalesce('. Reason: ' || v_note, '')),
              'Agree the new due date, or keep the original', 'The action''s due date changes', v_appr.user_id, v_appr.roles, current_date + 3,
              c.payload || jsonb_build_object('new_due_on', v_due, 'asked_by', auth.uid()));
    elsif p_decision <> 'done' then
      raise exception 'Choose got it, or ask for another date';
    end if;

  elsif c.kind = 'action_date' then
    if p_decision = 'approve' then
      update public.tasks set due_at = ((c.payload ->> 'new_due_on')::date + time '17:00') at time zone 'Australia/Sydney' where id = c.subject_id;
    elsif p_decision <> 'send_back' then
      raise exception 'Choose agree or keep the original date';
    end if;

  elsif c.kind in ('interest_update', 'follow_up') then
    if p_decision not in ('approve', 'done') then raise exception 'Confirm when it is done'; end if;
    v_status := 'done';
  end if;

  update public.action_cards set status = v_status, decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
         seconds_to_decide = greatest(0, extract(epoch from now() - coalesce(first_seen_at, created_at))::integer)
   where id = c.id;
  return v_status;
end;
$$;

-- Approver named in Defaults must be a member
create or replace function app.guard_minutes_approver()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.minutes_approver_user_id is distinct from old.minutes_approver_user_id and new.minutes_approver_user_id is not null
     and not exists (select 1 from public.memberships m where m.organisation_id = new.id and m.user_id = new.minutes_approver_user_id and m.is_active) then
    raise exception 'The minutes approver must be a member of this organisation';
  end if;
  return new;
end;
$$;
drop trigger if exists organisations_minutes_approver on public.organisations;
create trigger organisations_minutes_approver before update of minutes_approver_user_id on public.organisations for each row execute function app.guard_minutes_approver();

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
grant execute on function app.is_fin_preparer(uuid) to authenticated;
grant execute on function app.can_decide_card(public.action_cards) to authenticated;
revoke execute on function public.card_seen(uuid), public.submit_minutes(uuid, text), public.decide_card(uuid, text, text, jsonb) from public, anon;
grant execute on function public.card_seen(uuid), public.submit_minutes(uuid, text), public.decide_card(uuid, text, text, jsonb) to authenticated;
