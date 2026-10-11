-- =====================================================================
-- Common Seal - 0024: risk entry, one risk at a time
--
-- Each risk is saved on its own (Risk; Actions, Controls, Mitigations;
-- Due date; optional actioner) and can be edited again while the review
-- is open. A category counts as answered when the responsible user
-- presses Finished. The report owner comments on an individual risk,
-- and the risk owner ticks the comment off once they have amended it.
-- =====================================================================

alter table public.risk_items
  add column owner_comment       text,
  add column owner_comment_at    timestamptz,
  add column comment_resolved    boolean not null default false,
  add column comment_resolved_at timestamptz;

-- The whole-form submit and the category-level send-back are replaced by the functions below
drop function if exists public.risk_submit(text, text, boolean, jsonb);
drop function if exists public.reopen_risk_request(uuid, text);

-- What a responsible user sees from their link. They can return to it for as long as the review is open.
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
    'open', v_r.status = 'collecting', 'submitted_at', v_q.submitted_at, 'submitted_by', v_q.submitted_by,
    'nothing_to_report', v_q.nothing_to_report,
    'category', v_c.name, 'covers', v_c.covers, 'examples', v_c.examples,
    'people', coalesce((select jsonb_agg(k.name order by k.role desc, k.name) from public.risk_contacts k where k.category_id = v_c.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'title', i.title, 'action', i.action, 'actioner', i.actioner, 'actioner_email', i.actioner_email,
                 'due_on', i.due_on, 'is_closed', i.is_closed, 'carried', i.carried_from_id is not null,
                 'owner_comment', i.owner_comment, 'comment_resolved', i.comment_resolved) order by i.position, i.created_at)
               from public.risk_items i where i.review_id = v_q.review_id and i.category_id = v_q.category_id), '[]'::jsonb));
end;
$$;

-- Saves one risk: a new one, or an edit to one already saved.
-- p_item: { "id": existing or null, "title", "action", "actioner", "actioner_email", "due_on", "is_closed", "comment_resolved" }
create or replace function public.risk_save_item(p_token text, p_name text, p_item jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_q public.risk_requests%rowtype;
  v_id uuid;
  v_old public.risk_items%rowtype;
  v_title text := btrim(coalesce(p_item ->> 'title', ''));
  v_action text := btrim(coalesce(p_item ->> 'action', ''));
  v_email text := nullif(btrim(coalesce(p_item ->> 'actioner_email', '')), '');
  v_ticked boolean := coalesce((p_item ->> 'comment_resolved')::boolean, false);
begin
  select * into v_q from public.risk_requests q where q.token = p_token and char_length(coalesce(p_token, '')) = 64 for update;
  if v_q.id is null then
    raise exception 'This link is not valid';
  end if;
  if not exists (select 1 from public.risk_reviews r where r.id = v_q.review_id and r.status = 'collecting') then
    raise exception 'This review has closed. Please contact the person who sent it to you.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(p_name) > 200 then
    raise exception 'Please tell us who is completing this';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' or char_length(p_item::text) > 20000 then
    raise exception 'The risk could not be read';
  end if;
  if char_length(v_title) < 3 then
    raise exception 'Describe the risk';
  end if;
  if char_length(v_action) < 2 then
    raise exception 'Say what will be done about it. "Continue to monitor" is fine.';
  end if;
  if v_email is not null and v_email not like '%_@_%._%' then
    raise exception 'The actioner''s email does not look right';
  end if;
  if (select count(*) from public.risk_items i where i.review_id = v_q.review_id and i.category_id = v_q.category_id) >= 60
     and nullif(p_item ->> 'id', '') is null then
    raise exception 'This category already has the most risks it can hold';
  end if;

  v_id := nullif(p_item ->> 'id', '')::uuid;
  perform set_config('app.risk_system', 'on', true);
  if v_id is not null then
    select * into v_old from public.risk_items i where i.id = v_id and i.review_id = v_q.review_id and i.category_id = v_q.category_id;
    if v_old.id is null then
      raise exception 'That risk does not belong to this link';
    end if;
    update public.risk_items
       set title = v_title, action = v_action, actioner = nullif(btrim(coalesce(p_item ->> 'actioner', '')), ''), actioner_email = v_email,
           due_on = nullif(p_item ->> 'due_on', '')::date, is_closed = coalesce((p_item ->> 'is_closed')::boolean, false),
           entered_by = btrim(p_name),
           -- The tick only means something when there is a comment to answer
           comment_resolved = case when v_old.owner_comment is null then false else v_ticked end,
           comment_resolved_at = case when v_old.owner_comment is not null and v_ticked and not v_old.comment_resolved then now()
                                      when v_old.owner_comment is not null and v_ticked then v_old.comment_resolved_at else null end
     where id = v_id;
  else
    insert into public.risk_items (organisation_id, review_id, category_id, position, title, action, actioner, actioner_email, due_on, is_closed, entered_by)
    values (v_q.organisation_id, v_q.review_id, v_q.category_id,
            (select coalesce(max(i.position), 0) + 1 from public.risk_items i where i.review_id = v_q.review_id and i.category_id = v_q.category_id),
            v_title, v_action, nullif(btrim(coalesce(p_item ->> 'actioner', '')), ''), v_email,
            nullif(p_item ->> 'due_on', '')::date, coalesce((p_item ->> 'is_closed')::boolean, false), btrim(p_name))
    returning id into v_id;
  end if;
  perform set_config('app.risk_system', 'off', true);
  -- "Nothing to report" no longer holds once a risk is saved
  update public.risk_requests set nothing_to_report = false where id = v_q.id and nothing_to_report;
  return v_id;
end;
$$;

-- Removes a risk the person added in this review. One carried forward from the last review can be closed, not removed.
create or replace function public.risk_delete_item(p_token text, p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_q public.risk_requests%rowtype;
  v_i public.risk_items%rowtype;
begin
  select * into v_q from public.risk_requests q where q.token = p_token and char_length(coalesce(p_token, '')) = 64;
  if v_q.id is null then
    raise exception 'This link is not valid';
  end if;
  if not exists (select 1 from public.risk_reviews r where r.id = v_q.review_id and r.status = 'collecting') then
    raise exception 'This review has closed';
  end if;
  select * into v_i from public.risk_items i where i.id = p_item and i.review_id = v_q.review_id and i.category_id = v_q.category_id;
  if v_i.id is null then
    raise exception 'That risk does not belong to this link';
  end if;
  if v_i.carried_from_id is not null then
    raise exception 'This risk was carried forward from the last review. Mark it resolved instead of removing it.';
  end if;
  perform set_config('app.risk_system', 'on', true);
  delete from public.risk_items where id = p_item;
  perform set_config('app.risk_system', 'off', true);
end;
$$;

-- The responsible user says they have finished. This is what stops the reminders.
create or replace function public.risk_finish(p_token text, p_name text, p_nothing boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_q public.risk_requests%rowtype;
  v_n integer;
begin
  select * into v_q from public.risk_requests q where q.token = p_token and char_length(coalesce(p_token, '')) = 64 for update;
  if v_q.id is null then
    raise exception 'This link is not valid';
  end if;
  if not exists (select 1 from public.risk_reviews r where r.id = v_q.review_id and r.status = 'collecting') then
    raise exception 'This review has closed. Please contact the person who sent it to you.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(p_name) > 200 then
    raise exception 'Please tell us who is completing this';
  end if;
  select count(*) into v_n from public.risk_items i where i.review_id = v_q.review_id and i.category_id = v_q.category_id;
  if v_n = 0 and not coalesce(p_nothing, false) then
    raise exception 'Save at least one risk, or confirm there is nothing to report';
  end if;
  if v_n > 0 and coalesce(p_nothing, false) then
    raise exception 'There are saved risks, so this cannot be recorded as nothing to report';
  end if;
  update public.risk_requests
     set submitted_at = now(), submitted_by = btrim(p_name), nothing_to_report = (v_n = 0)
   where id = v_q.id;
end;
$$;

-- The report owner's comment on one risk. A new comment clears the tick, so the risk owner answers it afresh.
create or replace function public.comment_risk_item(p_item uuid, p_comment text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_i public.risk_items%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into v_i from public.risk_items i where i.id = p_item for update;
  if v_i.id is null or not app.is_risk_owner(v_i.organisation_id) then
    raise exception 'Only the person responsible for the report, or their backup, can comment';
  end if;
  if not exists (select 1 from public.risk_reviews r where r.id = v_i.review_id and r.status = 'collecting') then
    raise exception 'This review is not open';
  end if;
  perform set_config('app.risk_system', 'on', true);
  update public.risk_items
     set owner_comment = v_comment, owner_comment_at = case when v_comment is null then null else now() end,
         comment_resolved = false, comment_resolved_at = null
   where id = p_item;
  perform set_config('app.risk_system', 'off', true);
end;
$$;

-- The report owner, entering on someone's behalf, can also mark a category finished or reopen it
create or replace function public.set_risk_request_finished(p_request uuid, p_finished boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_q public.risk_requests%rowtype;
  v_n integer;
begin
  select * into v_q from public.risk_requests q where q.id = p_request for update;
  if v_q.id is null or not app.is_risk_owner(v_q.organisation_id) then
    raise exception 'Only the person responsible for the report, or their backup, can do this';
  end if;
  if not exists (select 1 from public.risk_reviews r where r.id = v_q.review_id and r.status = 'collecting') then
    raise exception 'This review is not open';
  end if;
  select count(*) into v_n from public.risk_items i where i.review_id = v_q.review_id and i.category_id = v_q.category_id;
  update public.risk_requests
     set submitted_at = case when p_finished then now() else null end,
         submitted_by = case when p_finished then 'The report owner, on their behalf' else null end,
         nothing_to_report = p_finished and v_n = 0
   where id = p_request;
end;
$$;

revoke execute on function public.comment_risk_item(uuid, text) from public, anon;
revoke execute on function public.set_risk_request_finished(uuid, boolean) from public, anon;
grant execute on function public.comment_risk_item(uuid, text) to authenticated;
grant execute on function public.set_risk_request_finished(uuid, boolean) to authenticated;

-- Public: usable without signing in, but only with the code from a person's own link
revoke execute on function public.risk_request(text) from public;
revoke execute on function public.risk_save_item(text, text, jsonb) from public;
revoke execute on function public.risk_delete_item(text, uuid) from public;
revoke execute on function public.risk_finish(text, text, boolean) from public;
grant execute on function public.risk_request(text) to anon, authenticated;
grant execute on function public.risk_save_item(text, text, jsonb) to anon, authenticated;
grant execute on function public.risk_delete_item(text, uuid) to anon, authenticated;
grant execute on function public.risk_finish(text, text, boolean) to anon, authenticated;

-- The new columns are readable; only the comment function and the risk owner's link write them
grant select (owner_comment, owner_comment_at, comment_resolved, comment_resolved_at) on public.risk_items to authenticated;
grant update (comment_resolved) on public.risk_items to authenticated;
