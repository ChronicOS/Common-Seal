-- 0063: Adverse media search.
--
-- The adverse media check now has two sources, run from the case page for the third party and
-- everyone its questionnaire names:
--   Dilisense adverse media   news screening across its media index (same key as list screening)
--   Claude news search        Claude (Anthropic API) searches the web for adverse news and reports
--                             what it found, each finding with its source link
-- Both run on the server (edge function screen-party); keys stay in Supabase.
--
-- Every finding is a lead, not a conclusion: Legal or Compliance marks each "relevant" (it is about
-- this subject and is adverse) or "not relevant". The adverse media check follows:
--   - a finding marked relevant: concern at once
--   - every subject searched, every finding reviewed, none relevant: clear (if still pending)
-- "Mark the rest not relevant" clears a long list in one step, with one reason, for lists too.

alter table public.dd_screenings
  add column if not exists kind text not null default 'lists' check (kind in ('lists', 'media'));
drop index if exists public.dd_screenings_case_idx;
create index if not exists dd_screenings_case_kind_idx on public.dd_screenings (case_id, kind, subject_key, screened_at desc);

-- The case's checks follow all of its screenings: list screening drives sanctions, PEP and other lists;
-- media searches drive adverse media.
create or replace function app.dd_apply_case_screening(p_case uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_topic text;
  v_topics text[];
  v_matched text[];
  v_left integer;
  v_party boolean;
  v_people boolean;
  v_subjects integer;
  v_hits integer;
  v_missing integer;
  v_waiting boolean;
  v_when text := to_char(now() at time zone 'Australia/Sydney', 'DD Mon YYYY');
begin
  if p_case is null or not exists (select 1 from public.dd_cases where id = p_case and status = 'open') then
    return;
  end if;
  -- A questionnaire still out means more names may come
  v_waiting := exists (select 1 from public.dd_questionnaires q where q.case_id = p_case and q.status = 'sent' and q.form = 2);
  perform set_config('app.dd_system', 'on', true);
  foreach v_kind in array array['lists', 'media'] loop
    select count(*) into v_missing from app.dd_case_targets(p_case) t
     where not exists (select 1 from public.dd_screenings s where s.case_id = p_case and s.kind = v_kind and s.subject_key = t.key);
    with latest as (
      select distinct on (s.subject_key) s.* from public.dd_screenings s where s.case_id = p_case and s.kind = v_kind order by s.subject_key, s.screened_at desc
    ), hits as (
      select l.reviews, h from latest l, jsonb_array_elements(l.hits) h
    )
    select coalesce((select array_agg(distinct case when v_kind = 'media' then 'adverse_media' else app.dd_screen_topic(h ->> 'source_type') end)
                       from hits where reviews -> (h ->> 'id') ->> 'decision' = 'match'), '{}'),
           (select count(*) from hits where not (reviews ? (h ->> 'id'))),
           exists (select 1 from latest where subject_key = 'party'),
           exists (select 1 from latest where subject_type = 'individual'),
           (select count(*) from latest),
           (select coalesce(sum(jsonb_array_length(hits)), 0) from latest)
      into v_matched, v_left, v_party, v_people, v_subjects, v_hits;
    if v_subjects = 0 then
      continue;
    end if;
    v_topics := case when v_kind = 'media' then array['adverse_media'] else array['sanctions', 'pep', 'official_lists'] end;
    foreach v_topic in array v_topics loop
      if v_topic = any (v_matched) then
        update public.dd_checks set result = 'concern',
               notes = concat_ws(E'\n', nullif(notes, ''), case when v_kind = 'media' then 'Adverse media ' else 'Screening ' end || v_when
                                 || case when v_kind = 'media' then ': a finding was marked relevant. See the adverse media results.' else ': confirmed match. See the screening results.' end)
         where case_id = p_case and topic = v_topic and result <> 'concern';
      elsif v_left = 0 and v_party and v_missing = 0 and not v_waiting and (v_topic <> 'pep' or v_people) then
        update public.dd_checks set result = 'clear',
               notes = concat_ws(E'\n', nullif(notes, ''),
                 case when v_kind = 'media' then 'Adverse media search ' || v_when || ': ' || v_subjects || ' subject(s) searched'
                        || case when v_hits = 0 then '; nothing found.' else '; findings reviewed, none relevant.' end
                      else 'Screening ' || v_when || ' (Dilisense): ' || v_subjects || ' subject(s) screened'
                        || case when v_hits = 0 then '; no possible matches.' else '; possible matches reviewed, none on this list is a match.' end end)
         where case_id = p_case and topic = v_topic and result = 'pending';
      end if;
    end loop;
  end loop;
  perform set_config('app.dd_system', 'off', true);
end;
$$;

drop function if exists public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb, jsonb);
create or replace function public.record_dd_screening(p_party uuid, p_user uuid, p_query jsonb, p_total integer, p_hits jsonb, p_subject jsonb, p_kind text default 'lists')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.counterparties%rowtype;
  v_id uuid;
  v_case uuid;
begin
  select * into c from public.counterparties where id = p_party;
  if c.id is null then
    raise exception 'Unknown third party';
  end if;
  if p_kind not in ('lists', 'media') then
    raise exception 'Unknown kind of screening';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select id into v_case from public.dd_cases where counterparty_id = c.id and status = 'open';
  insert into public.dd_screenings (organisation_id, counterparty_id, case_id, kind, provider, subject_type, query, total_hits, hits, outcome, screened_by,
                                    subject_key, subject_name, subject_role, declared_pep)
  values (c.organisation_id, c.id, v_case, p_kind, coalesce(nullif(p_query ->> 'provider', ''), 'dilisense'),
          case when p_subject ->> 'subject_type' in ('entity', 'individual') then p_subject ->> 'subject_type' else c.subject_type end,
          p_query, p_total, coalesce(p_hits, '[]'::jsonb), case when jsonb_array_length(coalesce(p_hits, '[]'::jsonb)) = 0 then 'no_matches' else 'to_review' end, p_user,
          coalesce(nullif(p_subject ->> 'key', ''), 'party'), coalesce(nullif(p_subject ->> 'name', ''), c.name), nullif(p_subject ->> 'role', ''),
          coalesce((p_subject ->> 'declared_pep')::boolean, false))
  returning id into v_id;
  perform app.dd_apply_case_screening(v_case);
  return v_id;
end;
$$;

-- "Mark the rest not relevant": one reason for every finding not yet reviewed
create or replace function public.review_dd_screening_rest(p_screening uuid, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.dd_screenings%rowtype;
  v_entry jsonb;
  v_outcome text;
begin
  select * into s from public.dd_screenings where id = p_screening for update;
  if s.id is null or not app.has_role(s.organisation_id, array['owner', 'admin', 'legal', 'compliance']::public.member_role[]) then
    raise exception 'Only Legal, Compliance or an administrator can review screening results';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Say why none of them is relevant';
  end if;
  v_entry := jsonb_build_object('decision', 'not_a_match', 'note', btrim(p_note), 'by', auth.uid(),
               'by_name', coalesce((select nullif(btrim(pe.full_name), '') from public.people pe where pe.user_id = auth.uid() and pe.organisation_id = s.organisation_id limit 1),
                                   (select u.email from auth.users u where u.id = auth.uid())), 'at', now(), 'bulk', true);
  update public.dd_screenings set
    reviews = reviews || coalesce((select jsonb_object_agg(h ->> 'id', v_entry) from jsonb_array_elements(hits) h where not (reviews ? (h ->> 'id'))), '{}'::jsonb)
  where id = p_screening
  returning case when exists (select 1 from jsonb_each(reviews) r where r.value ->> 'decision' = 'match') then 'match' else 'cleared' end into v_outcome;
  update public.dd_screenings set outcome = v_outcome, reviewed_at = now() where id = p_screening;
  perform app.dd_apply_case_screening(s.case_id);
  return v_outcome;
end;
$$;

-- The party's country too (helps the news search tell people and companies apart)
create or replace function public.dd_screening_target(p_party uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  select jsonb_build_object('organisation_id', c.organisation_id, 'counterparty_id', c.id, 'name', c.name, 'subject_type', c.subject_type,
                            'date_of_birth', d.date_of_birth, 'gender', d.gender, 'citizenship', d.citizenship, 'country', c.country,
                            'key', 'party', 'role', case when c.subject_type = 'individual' then coalesce(d.role_title, 'The individual') else 'The organisation' end)
    into v
  from public.counterparties c left join public.dd_individual_details d on d.counterparty_id = c.id
  where c.id = p_party and app.has_role(c.organisation_id, app.records_roles());
  if v is null then
    raise exception 'Not allowed';
  end if;
  return v;
end;
$$;

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
revoke execute on function public.reminder_batch(), public.reminder_sent(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.reminder_batch(), public.reminder_sent(uuid, uuid, text[]) to service_role;
revoke execute on function public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_dd_screening(uuid, uuid, jsonb, integer, jsonb, jsonb, text) to service_role;
revoke execute on function public.review_dd_screening_rest(uuid, text) from public, anon;
grant execute on function public.review_dd_screening_rest(uuid, text) to authenticated;
