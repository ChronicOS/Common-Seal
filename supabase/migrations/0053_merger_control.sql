-- 0053: Merger control.
--
-- From 1 January 2026 an acquisition of shares or assets that meets the
-- notification thresholds must be notified to the ACCC and approved before it
-- completes. One completed without approval is void, and penalties apply.
--
-- The thresholds (Australian revenue, in A$ millions):
--   A. combined revenue of the acquirer group and target of $200m or more, and
--      either the target's revenue is $50m or more or the transaction value is
--      $250m or more; or
--   B. the acquirer group's revenue is $500m or more and the target's revenue
--      is $10m or more.
-- For the target revenue tests, acquisitions in the previous three years of
-- the same or substitutable goods or services are added together, unless the
-- current target's revenue is under $2m. Earlier targets under $2m, and
-- earlier acquisitions that were notified, are left out.
--
-- Each acquisition records the figures, whether control is acquired, any
-- exception relied on, and the related earlier acquisitions. A trigger works
-- out whether notification is required and records why. Completion cannot be
-- recorded for a notifiable acquisition until the ACCC has approved it (or
-- granted a waiver).
--
-- Ladder up: notifiable acquisitions not yet notified, or awaiting a
-- determination, feed the Risk Register.

create table public.acquisitions (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete cascade,
  entity_id                uuid references public.entities (id) on delete set null,     -- the acquirer
  name                     text not null check (char_length(btrim(name)) between 2 and 200),
  target                   text not null check (char_length(btrim(target)) between 2 and 200),
  kind                     text not null default 'shares' check (kind in ('shares', 'assets', 'business', 'units', 'other')),
  market                   text,                       -- the goods or services, for grouping related acquisitions
  -- Australian revenue for the most recent 12 months, and value, in A$ millions
  acquirer_group_revenue   numeric(14, 3) check (acquirer_group_revenue is null or acquirer_group_revenue >= 0),
  target_revenue           numeric(14, 3) check (target_revenue is null or target_revenue >= 0),
  transaction_value        numeric(14, 3) check (transaction_value is null or transaction_value >= 0),
  gives_control            boolean,                    -- acquires control (alone or with associates)
  target_in_australia      boolean,                    -- the target carries on business in Australia
  exception                text,                       -- an exception relied on (for example a rights issue, certain land, administrator)
  related_ids              uuid[] not null default '{}',   -- earlier acquisitions of the same or substitutable goods or services
  -- Worked out by the trigger
  aggregated_target_revenue numeric(14, 3),
  notification             text not null default 'unknown' check (notification in ('required', 'not_required', 'unknown')),
  reasons                  text,
  -- Process
  status                   text not null default 'considering' check (status in ('considering', 'notified', 'determined', 'completed', 'abandoned')),
  planned_completion_on    date,
  accc_notified_on         date,
  accc_reference           text,
  determination            text check (determination is null or determination in ('approved', 'approved_with_conditions', 'waiver', 'not_approved')),
  determined_on            date,
  conditions               text,
  completed_on             date,
  notes                    text,
  created_by               uuid references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index acquisitions_org_idx on public.acquisitions (organisation_id, status);

create or replace function app.guard_acquisition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_prior numeric := 0;
  v_target numeric;
  v_reasons text[] := '{}';
  v_a boolean;
  v_b boolean;
begin
  if new.entity_id is not null and not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if exists (select 1 from unnest(new.related_ids) r where r = new.id or not exists (select 1 from public.acquisitions a where a.id = r and a.organisation_id = new.organisation_id)) then
    raise exception 'A related acquisition must be another acquisition in this organisation';
  end if;
  if greatest(new.accc_notified_on, new.determined_on, new.completed_on) > current_date then
    raise exception 'A date that has happened cannot be in the future';
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;

  -- Serial acquisitions: earlier related targets within three years, each $2m or more and not notified
  if coalesce(new.target_revenue, 0) >= 2 then
    select coalesce(sum(a.target_revenue), 0) into v_prior
    from public.acquisitions a
    where a.id = any (new.related_ids)
      and a.status = 'completed'
      and a.completed_on >= coalesce(new.planned_completion_on, current_date) - interval '3 years'
      and coalesce(a.target_revenue, 0) >= 2
      and a.accc_notified_on is null;
  end if;
  v_target := new.target_revenue + v_prior;
  new.aggregated_target_revenue := v_target;

  if new.gives_control is false then
    new.notification := 'not_required';
    new.reasons := 'It does not give control of the target.';
  elsif new.target_in_australia is false then
    new.notification := 'not_required';
    new.reasons := 'The target does not carry on business in Australia.';
  elsif nullif(btrim(new.exception), '') is not null then
    new.notification := 'not_required';
    new.reasons := 'Exception relied on: ' || btrim(new.exception) || '. Confirm it applies.';
  elsif new.acquirer_group_revenue is null or new.target_revenue is null then
    new.notification := 'unknown';
    new.reasons := 'Enter the acquirer group''s and the target''s Australian revenue.';
  else
    v_a := new.acquirer_group_revenue + new.target_revenue >= 200
           and (v_target >= 50 or coalesce(new.transaction_value, 0) >= 250);
    v_b := new.acquirer_group_revenue >= 500 and v_target >= 10;
    if v_a then
      v_reasons := v_reasons || ('Combined revenue $' || trim(to_char(new.acquirer_group_revenue + new.target_revenue, 'FM999G999G990D0')) || 'm is $200m or more, and '
                   || case when v_target >= 50 then 'the target''s revenue' || case when v_prior > 0 then ' (with related acquisitions in the last three years)' else '' end
                                                    || ' is $' || trim(to_char(v_target, 'FM999G999G990D0')) || 'm, $50m or more'
                           else 'the transaction value $' || trim(to_char(new.transaction_value, 'FM999G999G990D0')) || 'm is $250m or more' end || '.');
    end if;
    if v_b then
      v_reasons := v_reasons || ('The acquirer group''s revenue $' || trim(to_char(new.acquirer_group_revenue, 'FM999G999G990D0')) || 'm is $500m or more, and the target''s revenue'
                   || case when v_prior > 0 then ' (with related acquisitions)' else '' end || ' is $' || trim(to_char(v_target, 'FM999G999G990D0')) || 'm, $10m or more.');
    end if;
    if v_a or v_b then
      new.notification := case when new.gives_control is null or new.target_in_australia is null then 'unknown' else 'required' end;
      new.reasons := array_to_string(v_reasons, ' ')
                     || case when new.gives_control is null or new.target_in_australia is null then ' Confirm whether it gives control and whether the target carries on business in Australia.' else '' end;
    else
      new.notification := case when new.gives_control is null or new.target_in_australia is null then 'unknown' else 'not_required' end;
      new.reasons := 'Below the thresholds: combined revenue $' || trim(to_char(new.acquirer_group_revenue + new.target_revenue, 'FM999G999G990D0')) || 'm, target revenue $'
                     || trim(to_char(v_target, 'FM999G999G990D0')) || 'm' || case when v_prior > 0 then ' with related acquisitions' else '' end
                     || coalesce(', transaction value $' || trim(to_char(new.transaction_value, 'FM999G999G990D0')) || 'm', '') || '.'
                     || case when new.gives_control is null or new.target_in_australia is null then ' Confirm whether it gives control and whether the target carries on business in Australia.' else '' end;
    end if;
  end if;

  -- The process
  if new.accc_notified_on is not null and new.status = 'considering' then
    new.status := 'notified';
  end if;
  if new.determination is not null and new.determined_on is null then
    raise exception 'Record the date of the ACCC''s determination';
  end if;
  if new.determination is not null and new.status in ('considering', 'notified') then
    new.status := 'determined';
  end if;
  if new.status = 'completed' then
    if new.completed_on is null then
      raise exception 'Record the completion date';
    end if;
    if new.notification = 'required' and coalesce(new.determination, '') not in ('approved', 'approved_with_conditions', 'waiver') then
      raise exception 'This acquisition must be approved by the ACCC before it completes. Completing without approval makes it void and attracts penalties.';
    end if;
    if new.notification = 'unknown' then
      raise exception 'Finish the notification test before recording completion';
    end if;
  end if;
  return new;
end;
$$;
create trigger acquisitions_guard before insert or update on public.acquisitions for each row execute function app.guard_acquisition();

-- ---------------------------------------------------------------------
-- Ladder up
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements',
                          'credit_facilities', 'asic_filings', 'entities', 'compliance_obligations', 'whs_incidents', 'whs_hazards', 'privacy_breaches',
                          'abc_risks', 'abc_programme', 'abc_assessments', 'compliance_checks', 'standard_form_contracts', 'acquisitions'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%''acquisitions''%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    select 'acquisitions', aq.id, 'Merger control',
           app.risk_feed_category(p_review, array['competition', 'mergers', 'legal and compliance', 'legal', 'compliance']),
           case when aq.notification = 'unknown' then 'Acquisition not yet tested for ACCC notification: '
                when aq.accc_notified_on is null then 'Acquisition needs ACCC approval and has not been notified: '
                else 'Acquisition waiting for the ACCC''s determination: ' end || aq.name,
           case when aq.notification = 'unknown' then 'Finish the notification test'
                when aq.accc_notified_on is null then 'Notify the ACCC; do not complete until it is approved'
                else 'Do not complete until the ACCC approves it' end,
           null::text,
           aq.planned_completion_on
    from public.acquisitions aq
    where aq.organisation_id = v_org and aq.status in ('considering', 'notified')
      and (aq.notification = 'required' or (aq.notification = 'unknown' and aq.planned_completion_on <= current_date + 90))
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%''acquisitions''%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: deal papers, the notification, the determination
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%''acquisitions''%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''acquisitions''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%''acquisitions''%' then
    v_def := replace(v_def, $x$  elsif p_table in ('compliance_checks', 'standard_form_contracts') then$x$, $x$  elsif p_table = 'acquisitions' then
    select a.organisation_id, app.has_role(a.organisation_id, app.records_roles()) into v_org, v_ok from public.acquisitions a where a.id = p_id;
  elsif p_table in ('compliance_checks', 'standard_form_contracts') then$x$);
    if v_def not like '%''acquisitions''%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
  v_def := pg_get_functiondef('app.can_read_subject(text, uuid)'::regprocedure);
  if v_def not like '%''acquisitions''%' then
    v_def := replace(v_def, $x$  elsif p_table in ('compliance_checks', 'standard_form_contracts') then$x$, $x$  elsif p_table = 'acquisitions' then
    return exists (select 1 from public.acquisitions a where a.id = p_id and app.can_read_regulatory(a.organisation_id));
  elsif p_table in ('compliance_checks', 'standard_form_contracts') then$x$);
    if v_def not like '%''acquisitions''%' then
      raise exception 'Could not extend app.can_read_subject';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%''acquisitions''%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security: deal information is confidential
-- ---------------------------------------------------------------------
revoke all on public.acquisitions from anon, authenticated;
grant select on public.acquisitions to authenticated;
grant insert (organisation_id, entity_id, name, target, kind, market, acquirer_group_revenue, target_revenue, transaction_value, gives_control, target_in_australia,
              exception, related_ids, status, planned_completion_on, accc_notified_on, accc_reference, determination, determined_on, conditions, completed_on, notes),
      update (entity_id, name, target, kind, market, acquirer_group_revenue, target_revenue, transaction_value, gives_control, target_in_australia,
              exception, related_ids, status, planned_completion_on, accc_notified_on, accc_reference, determination, determined_on, conditions, completed_on, notes)
  on public.acquisitions to authenticated;
grant all on public.acquisitions to service_role;
alter table public.acquisitions enable row level security;
create policy acquisitions_select on public.acquisitions for select to authenticated using (app.can_read_regulatory(organisation_id));
create policy acquisitions_insert on public.acquisitions for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy acquisitions_update on public.acquisitions for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create trigger acquisitions_touch before update on public.acquisitions for each row execute function app.touch_updated_at();
create trigger acquisitions_audit after insert or update or delete on public.acquisitions for each row execute function app.audit_row();

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
