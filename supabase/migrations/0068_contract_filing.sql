-- 0068: Filing contracts properly, their value, who signed, and due diligence before signing.
--
-- 1. Filing. Every contract has one agreement type (a short code from a fixed list, e.g. NDA, MSA) and
--    one business function (who owns the relationship). Amendments, statements of work, variations,
--    renewals and side letters link to their master agreement, as a family.
-- 2. Names. Every contract gets a filing name: Type - Counterparty - Month Year (start date), e.g.
--    "NDA - Adobe - June 2026". Linked documents add "- Amendment 1"; unsigned ones add "- DRAFT";
--    a clash adds "(2)". The name keeps itself up to date unless someone has typed their own.
-- 3. Value, with what it covers (total, per year ...), read from the contract or typed in.
-- 4. Who signed for us, checked against the Signing Delegation in force on the date signed (and,
--    where a signatory group is capped at the Financial Approval Matrix limits, against those), and
--    against section 127 of the Corporations Act. The result is one of: authorised, outside authority,
--    or needs checking (unknown is never shown as fine).
-- 5. Due diligence before signing:
--    - a contract with a third party cannot be approved until due diligence on that party is finished
--      (or the party is recorded as out of scope); sending it for approval opens a task to start it;
--    - signing in VeraPhius without it is logged in the exceptions register;
--    - a signed contract added from a document with no due diligence on the party gets a task to start
--      it, and, if signed after the organisation started using VeraPhius, an exception.

-- ---------- 1, 2, 3, 4: columns ----------
alter type public.exception_kind add value if not exists 'signed_before_due_diligence';

alter table public.contracts
  add column if not exists agreement_type text check (agreement_type is null or agreement_type in
    ('NDA', 'SUP', 'MSA', 'SOW', 'SVC', 'SAAS', 'DIST', 'AGY', 'CUST', 'LIC', 'IPA', 'RD', 'QA', 'PV', 'DPA', 'LEASE', 'LOAN', 'GTEE', 'SHA', 'SPA', 'JV', 'TERMS', 'OTH')),
  add column if not exists agreement_type_other text check (agreement_type_other is null or char_length(agreement_type_other) <= 80),
  add column if not exists business_function text check (business_function is null or business_function in
    ('commercial', 'marketing', 'procurement', 'operations', 'finance', 'it', 'people', 'rdq', 'legal')),
  add column if not exists parent_contract_id uuid references public.contracts (id) on delete set null,
  add column if not exists family_role text check (family_role is null or family_role in ('amendment', 'sow', 'variation', 'renewal', 'side_letter')),
  add column if not exists family_no integer check (family_no is null or family_no between 1 and 999),
  add column if not exists display_name text check (display_name is null or char_length(display_name) <= 200),
  add column if not exists name_is_custom boolean not null default false,
  add column if not exists value_basis text check (value_basis is null or char_length(value_basis) <= 200),
  add column if not exists signed_on date,
  add column if not exists our_signatories jsonb not null default '[]'::jsonb check (jsonb_typeof(our_signatories) = 'array'),
  add column if not exists signatory_check jsonb;
create index if not exists contracts_parent_idx on public.contracts (parent_contract_id) where parent_contract_id is not null;

-- Existing contracts: left as Other, ready to re-type
update public.contracts set agreement_type = case when is_intragroup then 'OTH' else 'OTH' end where agreement_type is null;

-- ---------- 2: names ----------
create or replace function app.short_party_name(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(btrim(coalesce(p, '')), '[,.]?\s+(pty\.?\s*(ltd|limited)\.?|proprietary\s+limited|limited|ltd\.?|inc\.?|incorporated|llc|l\.l\.c\.|plc|gmbh|ag|s\.?a\.?|b\.?v\.?|n\.?v\.?|pte\.?\s*ltd\.?|sdn\.?\s*bhd\.?|corporation|corp\.?|co\.?|k\.?k\.?|s\.?r\.?l\.?|oy|ab|as)\s*$', '', 'i'),
           '\s+', ' ', 'g'));
$$;

create or replace function app.contract_base_name(p_type text, p_other text, p_party text, p_start date, p_signed date, p_role text, p_no integer, p_parent_name text)
returns text language sql stable set search_path = '' as $$
  select case
    when p_parent_name is not null and p_role is not null then
      regexp_replace(p_parent_name, '( - DRAFT)?( \(\d+\))?$', '') || ' - ' ||
      case p_role when 'amendment' then 'Amendment' when 'sow' then 'SOW' when 'variation' then 'Variation' when 'renewal' then 'Renewal' else 'Side letter' end
      || ' ' || coalesce(p_no, 1)
    else
      coalesce(case when p_type = 'OTH' and nullif(btrim(p_other), '') is not null then btrim(p_other) end, p_type, 'OTH')
      || ' - ' || coalesce(nullif(app.short_party_name(p_party), ''), 'Unknown party')
      || ' - ' || coalesce(btrim(to_char(coalesce(p_start, p_signed), 'FMMonth YYYY')), 'Undated')
  end;
$$;

-- Keeps the filing name up to date (unless someone typed their own), and the family numbering
create or replace function app.contract_filing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_party text;
  v_parent public.contracts%rowtype;
  v_base text;
  v_n integer := 1;
begin
  if new.parent_contract_id is not null then
    if new.parent_contract_id = new.id then
      raise exception 'A contract cannot be part of itself';
    end if;
    select * into v_parent from public.contracts where id = new.parent_contract_id;
    if v_parent.id is null or v_parent.organisation_id <> new.organisation_id then
      raise exception 'The master agreement must be one of your contracts';
    end if;
    if v_parent.parent_contract_id is not null then
      -- keep families one level deep: link to the master
      new.parent_contract_id := v_parent.parent_contract_id;
      select * into v_parent from public.contracts where id = new.parent_contract_id;
    end if;
    new.family_role := coalesce(new.family_role, 'amendment');
    if new.family_no is null or tg_op = 'INSERT' or new.parent_contract_id is distinct from old.parent_contract_id or new.family_role is distinct from old.family_role then
      select coalesce(max(c.family_no), 0) + 1 into new.family_no
      from public.contracts c where c.parent_contract_id = new.parent_contract_id and c.family_role = new.family_role and c.id <> new.id;
    end if;
  else
    new.family_role := null;
    new.family_no := null;
  end if;

  if new.name_is_custom and nullif(btrim(new.display_name), '') is not null then
    new.display_name := btrim(new.display_name);
    return new;
  end if;
  new.name_is_custom := false;
  select name into v_party from public.counterparties where id = new.counterparty_id;
  if v_party is null and new.counterparty_entity_id is not null then
    select name into v_party from public.entities where id = new.counterparty_entity_id;
  end if;
  v_base := app.contract_base_name(new.agreement_type, new.agreement_type_other, v_party, new.starts_on, coalesce(new.signed_on, new.terms_added_on),
                                   new.family_role, new.family_no, v_parent.display_name);
  -- A clash with another contract adds (2), (3) ...
  while exists (select 1 from public.contracts c where c.organisation_id = new.organisation_id and c.id <> new.id
                and regexp_replace(c.display_name, ' - DRAFT$', '') = v_base || case when v_n > 1 then ' (' || v_n || ')' else '' end) loop
    v_n := v_n + 1;
  end loop;
  new.display_name := v_base || case when v_n > 1 then ' (' || v_n || ')' else '' end
                      || case when new.status in ('draft', 'pending_approval', 'approved', 'rejected') then ' - DRAFT' else '' end;
  return new;
end;
$$;
drop trigger if exists contracts_filing on public.contracts;
create trigger contracts_filing before insert or update of agreement_type, agreement_type_other, counterparty_id, counterparty_entity_id, starts_on, signed_on,
  parent_contract_id, family_role, display_name, name_is_custom, status on public.contracts
  for each row execute function app.contract_filing();

-- Names for the contracts already on file
update public.contracts set name_is_custom = false where display_name is null;

-- The stored document takes the filing name
create or replace function app.contract_doc_names()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.display_name is distinct from old.display_name then
    update public.documents d set title = left(new.display_name, 300)
     where d.id in (select l.document_id from public.document_links l where l.subject_table = 'contracts' and l.subject_id = new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists contracts_doc_names on public.contracts;
create trigger contracts_doc_names after update of display_name on public.contracts for each row execute function app.contract_doc_names();

-- ---------- 4: who signed for us ----------
create or replace function app.norm_name(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '^(mr|mrs|ms|miss|dr|prof)\.?\s+', ''), '[^a-z ]+', ' ', 'g'));
$$;

-- "Jane Smith (Director); John Lee (Company Secretary)" -> [{name, title}]
create or replace function app.parse_signatories(p text)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', btrim(regexp_replace(s, '\s*\(.*\)\s*$', '')),
                                               'title', nullif(btrim(substring(s from '\(([^)]*)\)\s*$')), '')) order by n), '[]'::jsonb)
  from unnest(string_to_array(coalesce(p, ''), ';')) with ordinality as t(s, n)
  where char_length(btrim(regexp_replace(s, '\s*\(.*\)\s*$', ''))) >= 2;
$$;

-- Finds who in the organisation a signatory name refers to: full name first, then first and last name
create or replace function app.match_person(p_org uuid, p_name text)
returns uuid language sql stable security definer set search_path = '' as $$
  with n as (select app.norm_name(p_name) as full, split_part(app.norm_name(p_name), ' ', 1) as first,
                    regexp_replace(app.norm_name(p_name), '^.* ', '') as last)
  select coalesce(
    (select p.id from public.people p, n where p.organisation_id = p_org and app.norm_name(p.full_name) = n.full limit 1),
    (select p.id from public.people p, n where p.organisation_id = p_org and n.first <> n.last
       and split_part(app.norm_name(p.full_name), ' ', 1) = n.first and regexp_replace(app.norm_name(p.full_name), '^.* ', '') = n.last
       and (select count(*) from public.people q where q.organisation_id = p_org and split_part(app.norm_name(q.full_name), ' ', 1) = n.first
              and regexp_replace(app.norm_name(q.full_name), '^.* ', '') = n.last) = 1
     limit 1));
$$;

-- The highest amount a person could approve under the Financial Approval Matrix in force on a date
-- (null: no limit below the board; 0: no approval role)
create or replace function app.fam_limit(p_org uuid, p_person uuid, p_on date)
returns numeric language sql stable security definer set search_path = '' as $$
  with v as (
    select x.id from public.auth_versions x
    where x.organisation_id = p_org and x.kind = 'financial' and x.status in ('in_force', 'superseded')
      and x.in_force_from::date <= p_on and (x.ended_at is null or x.ended_at::date > p_on)
    order by x.in_force_from desc limit 1),
  b as (
    select bd.up_to from public.auth_cells c join public.auth_bands bd on bd.id = c.band_id, v
    where c.version_id = v.id and not bd.board
      and exists (select 1 from public.position_assignments pa where pa.person_id = p_person
                  and pa.position_id in (c.operational_position_id, c.finance_position_id)
                  and pa.starts_on <= p_on and (pa.ends_on is null or pa.ends_on >= p_on)))
  select case when not exists (select 1 from v) then -1          -- no matrix in force
              when not exists (select 1 from b) then 0
              when exists (select 1 from b where up_to is null) then null
              else (select max(up_to) from b) end;
$$;

create or replace function app.check_contract_signatories(p_contract uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.contracts%rowtype;
  v_on date;
  v_sigs jsonb;
  s jsonb;
  v_people uuid[] := '{}';
  v_unmatched text[] := '{}';
  v_titles text[] := '{}';
  v_dirs uuid[];
  v_secs uuid[];
  v_signing uuid;
  g record;
  v_members uuid[];
  v_in_group uuid[];
  v_dir_signed uuid[];
  v_sec_signed uuid[];
  v_req text;
  v_req_ok text;
  v_scope record;
  v_cover text;
  v_limit numeric;
  v_lim_each numeric;
  v_unknown_value boolean := false;
  v_fam_missing boolean := false;
  v_s127 text;
  v_notes text[] := '{}';
  p uuid;
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null then
    return null;
  end if;
  v_on := coalesce(c.signed_on, c.starts_on);
  v_sigs := coalesce(c.our_signatories, '[]'::jsonb);
  if jsonb_array_length(v_sigs) = 0 then
    return jsonb_build_object('verdict', 'check', 'summary', 'No one is recorded as signing for us.', 'notes', '[]'::jsonb, 'checked_at', now());
  end if;
  if v_on is null then
    return jsonb_build_object('verdict', 'check', 'summary', 'Add the date it was signed, so the authorities in force on that day can be checked.', 'notes', '[]'::jsonb, 'checked_at', now());
  end if;

  for s in select * from jsonb_array_elements(v_sigs) loop
    p := app.match_person(c.organisation_id, s ->> 'name');
    if p is null then
      v_unmatched := v_unmatched || (s ->> 'name');
    elsif not p = any (v_people) then
      v_people := v_people || p;
    end if;
  end loop;

  select coalesce(array_agg(distinct o.person_id), '{}') into v_dirs from public.officeholdings o
  where o.entity_id = c.entity_id and o.role in ('director', 'alternate_director')
    and (o.appointed_on is null or o.appointed_on <= v_on) and (o.ceased_on is null or o.ceased_on >= v_on);
  select coalesce(array_agg(distinct o.person_id), '{}') into v_secs from public.officeholdings o
  where o.entity_id = c.entity_id and o.role = 'secretary'
    and (o.appointed_on is null or o.appointed_on <= v_on) and (o.ceased_on is null or o.ceased_on >= v_on);
  select coalesce(array_agg(x), '{}') into v_dir_signed from unnest(v_people) x where x = any (v_dirs);
  select coalesce(array_agg(x), '{}') into v_sec_signed from unnest(v_people) x where x = any (v_secs);

  -- Section 127 of the Corporations Act: two directors, a director and the secretary, or a sole director who is also secretary
  v_s127 := case
    when cardinality(v_dir_signed) >= 2 then 'two directors'
    when cardinality(v_dir_signed) >= 1 and exists (select 1 from unnest(v_sec_signed) x where not x = any (v_dir_signed) or cardinality(v_people) >= 2) then 'a director and the company secretary'
    when cardinality(v_dirs) = 1 and cardinality(v_dir_signed) = 1 then 'the sole director'
  end;

  -- The Signing Delegation in force on the date signed
  select x.id into v_signing from public.auth_versions x
  where x.organisation_id = c.organisation_id and x.kind = 'signing' and x.status in ('in_force', 'superseded')
    and x.in_force_from::date <= v_on and (x.ended_at is null or x.ended_at::date > v_on)
  order by x.in_force_from desc limit 1;

  if v_signing is not null then
    for g in select * from public.sign_groups sg where sg.version_id = v_signing and sg.entity_id = c.entity_id order by sg.position loop
      select coalesce(array_agg(distinct m), '{}') into v_members from (
        select m.person_id as m from public.sign_group_members m where m.group_id = g.id and m.person_id is not null
        union select pa.person_id from public.sign_group_members m join public.position_assignments pa on pa.position_id = m.position_id
          where m.group_id = g.id and pa.starts_on <= v_on and (pa.ends_on is null or pa.ends_on >= v_on)
        union select unnest(case when g.includes_directors then v_dirs else '{}'::uuid[] end)
        union select unnest(case when g.includes_secretary then v_secs else '{}'::uuid[] end)) t;
      select coalesce(array_agg(x), '{}') into v_in_group from unnest(v_people) x where x = any (v_members);

      v_req_ok := null;
      foreach v_req in array g.requirements loop
        if (v_req = 'two_directors' and cardinality(v_dir_signed) >= 2)
           or (v_req = 'director_and_secretary' and cardinality(v_dir_signed) >= 1 and cardinality(v_sec_signed) >= 1 and cardinality(v_people) >= 2)
           or (v_req = 'sole_director' and cardinality(v_dirs) = 1 and cardinality(v_dir_signed) = 1)
           or (v_req = 'director_and_member' and cardinality(v_dir_signed) >= 1 and cardinality(v_in_group) >= 2)
           or (v_req = 'two_members' and cardinality(v_in_group) >= 2)
           or (v_req = 'one_member' and cardinality(v_in_group) >= 1) then
          v_req_ok := v_req;
          exit;
        end if;
      end loop;
      continue when v_req_ok is null;

      -- The amount: some line of the group's scope must cover the value
      v_cover := null;
      for v_scope in select * from public.sign_group_scopes sc where sc.group_id = g.id order by sc.position loop
        if c.value_amount is null and (v_scope.up_to is not null or v_scope.within_financial) then
          v_unknown_value := true;
          continue;
        end if;
        continue when v_scope.up_to is not null and c.value_amount > v_scope.up_to;
        if v_scope.within_financial then
          -- capped at the Financial Approval Matrix: the highest limit among those who signed
          v_limit := 0;
          foreach p in array v_in_group || v_dir_signed loop
            v_lim_each := app.fam_limit(c.organisation_id, p, v_on);
            if v_lim_each = -1 then
              v_fam_missing := true;
              v_limit := -1;
              exit;
            end if;
            if v_lim_each is null then v_limit := null; exit; end if;
            v_limit := greatest(v_limit, v_lim_each);
          end loop;
          continue when v_limit = -1 or (v_limit is not null and c.value_amount > v_limit);
        end if;
        v_cover := v_scope.text;
        exit;
      end loop;
      if v_cover is null and not exists (select 1 from public.sign_group_scopes sc where sc.group_id = g.id) then
        v_cover := 'No limits set for this group';
      end if;

      if v_cover is not null then
        return jsonb_build_object('verdict', 'authorised',
          'summary', format('Within the Signing Delegation: %s, signed by %s.', g.name,
                            case v_req_ok when 'two_directors' then 'two directors' when 'director_and_secretary' then 'a director and the company secretary'
                              when 'sole_director' then 'the sole director' when 'director_and_member' then 'a director and an authorised signatory'
                              when 'two_members' then 'two authorised signatories' else 'an authorised signatory' end),
          'group', g.name, 'scope', v_cover,
          'notes', to_jsonb(v_notes || case when cardinality(v_unmatched) > 0 then array[format('Not found in your people list: %s.', array_to_string(v_unmatched, ', '))] else '{}'::text[] end
                            || ('Check the contract is the kind this group may sign: ' || v_cover)::text),
          'checked_at', now());
      end if;
    end loop;
  end if;

  -- Not shown as authorised: say why, plainly
  if cardinality(v_unmatched) > 0 then
    return jsonb_build_object('verdict', 'check',
      'summary', format('%s %s not in your people list, so their authority cannot be checked. Correct the name, or add them under People.',
                        array_to_string(v_unmatched, ', '), case when cardinality(v_unmatched) = 1 then 'is' else 'are' end),
      's127', v_s127, 'notes', to_jsonb(v_notes), 'checked_at', now());
  end if;
  if v_fam_missing then
    return jsonb_build_object('verdict', 'check', 'summary', 'The signing group is capped at the Financial Approval Matrix limits, but no matrix was in force on that date, so the cap cannot be checked.',
      's127', v_s127, 'notes', to_jsonb(v_notes), 'checked_at', now());
  end if;
  if v_unknown_value then
    return jsonb_build_object('verdict', 'check', 'summary', 'No value is recorded, so the signing limits cannot be checked. Add the value.',
      's127', v_s127, 'notes', to_jsonb(v_notes), 'checked_at', now());
  end if;
  if v_signing is null then
    return jsonb_build_object('verdict', case when v_s127 is not null then 'authorised' else 'check' end,
      'summary', case when v_s127 is not null then format('Signed by %s (section 127 of the Corporations Act). No Signing Delegation was in force on that date.', v_s127)
                      else 'No Signing Delegation was in force on that date, and the signatures are not two directors or a director and the secretary. Check who authorised it.' end,
      's127', v_s127, 'notes', to_jsonb(v_notes), 'checked_at', now());
  end if;
  return jsonb_build_object('verdict', 'outside',
    'summary', 'Outside the Signing Delegation: no signatory group for this company covers these signatories at this value.',
    's127', v_s127,
    'notes', to_jsonb(v_notes || (case when v_s127 is not null then format('It is still validly signed by the company under section 127 (%s); the gap is internal authority.', v_s127) else 'It is also not signed in a way section 127 recognises (two directors, or a director and the secretary).' end)::text),
    'checked_at', now());
end;
$$;

-- Runs the check, keeps the result, and logs an exception when a contract signed since the organisation
-- joined VeraPhius is outside authority (older contracts are shown, not reported)
create or replace function app.recheck_signatories(p_contract uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := app.check_contract_signatories(p_contract);
  c public.contracts%rowtype;
begin
  update public.contracts set signatory_check = v where id = p_contract returning * into c;
  if v ->> 'verdict' = 'outside' and coalesce(c.signed_on, c.starts_on) >= (select o.created_at::date from public.organisations o where o.id = c.organisation_id)
     and not exists (select 1 from public.authority_exceptions x where x.contract_id = c.id and x.kind = 'signed_outside_authority') then
    insert into public.authority_exceptions (organisation_id, contract_id, kind, detail, created_by)
    values (c.organisation_id, c.id, 'signed_outside_authority', v ->> 'summary', auth.uid());
  end if;
  return v;
end;
$$;

create or replace function public.set_contract_signatories(p_contract uuid, p_signatories text, p_signed_on date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.contracts%rowtype;
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null or not (app.has_role(c.organisation_id, app.records_roles()) or (c.created_by = auth.uid() and app.has_role(c.organisation_id, app.contributor_roles()))) then
    raise exception 'You do not have permission to change this contract';
  end if;
  if p_signed_on is not null and p_signed_on > current_date + 1 then
    raise exception 'The signing date cannot be in the future';
  end if;
  update public.contracts set our_signatories = app.parse_signatories(p_signatories), signed_on = p_signed_on where id = p_contract;
  return app.recheck_signatories(p_contract);
end;
$$;

-- Filing details can be changed at any time (they are not part of what was approved)
create or replace function public.set_contract_filing(p_contract uuid, p_type text, p_type_other text, p_function text, p_parent uuid, p_role text, p_name text, p_value numeric, p_value_basis text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.contracts%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null or not (app.has_role(c.organisation_id, app.records_roles()) or (c.created_by = auth.uid() and app.has_role(c.organisation_id, app.contributor_roles()))) then
    raise exception 'You do not have permission to change this contract';
  end if;
  if p_value is not null and p_value < 0 then
    raise exception 'The value cannot be negative';
  end if;
  if p_parent is not null and exists (select 1 from public.contracts k where k.parent_contract_id = c.id) then
    raise exception 'This contract has its own amendments or statements of work, so it stays a master agreement';
  end if;
  -- The value can only change while the contract is a draft (it decides who approves); otherwise the system flag allows a correction of a signed record
  if p_value is distinct from c.value_amount and c.status not in ('draft', 'rejected') then
    if c.status <> 'signed' then
      raise exception 'The value is fixed once a contract is sent for approval';
    end if;
    perform set_config('app.contract_system', 'on', true);
  end if;
  update public.contracts set agreement_type = p_type, agreement_type_other = case when p_type = 'OTH' then nullif(btrim(p_type_other), '') end,
         business_function = nullif(p_function, ''), parent_contract_id = p_parent, family_role = case when p_parent is not null then coalesce(nullif(p_role, ''), 'amendment') end,
         display_name = v_name, name_is_custom = v_name is not null and v_name is distinct from c.display_name or (c.name_is_custom and v_name is not null),
         value_amount = p_value, value_basis = nullif(btrim(p_value_basis), '')
   where id = p_contract
   returning * into c;
  perform set_config('app.contract_system', 'off', true);
  if c.status = 'signed' and jsonb_array_length(c.our_signatories) > 0 then
    perform app.recheck_signatories(c.id);
  end if;
  return c.display_name;
end;
$$;

-- ---------- 5: due diligence before signing ----------
create or replace function app.party_needs_dd(p_party uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_party is not null
     and not exists (select 1 from public.counterparties cp where cp.id = p_party and cp.dd_status in ('cleared', 'cleared_with_conditions'))
     and not exists (select 1 from public.dd_exemptions x where x.counterparty_id = p_party);
$$;

-- One task (not a pile) to start due diligence on a party, for the person who added the contract
create or replace function app.dd_task(p_contract uuid, p_signed boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.contracts%rowtype;
  v_party text;
  v_person uuid;
begin
  select * into c from public.contracts where id = p_contract;
  if c.counterparty_id is null or not app.party_needs_dd(c.counterparty_id)
     or exists (select 1 from public.counterparties cp where cp.id = c.counterparty_id and cp.dd_status = 'open') then
    return;
  end if;
  select name into v_party from public.counterparties where id = c.counterparty_id;
  if exists (select 1 from public.tasks t where t.organisation_id = c.organisation_id and t.status = 'open' and t.origin = 'system'
             and t.title like format('Start due diligence on %s%%', v_party)) then
    return;
  end if;
  select id into v_person from public.people where organisation_id = c.organisation_id and user_id = auth.uid() limit 1;
  insert into public.tasks (organisation_id, title, detail, subject_table, subject_id, assignee_person_id, due_at, origin, created_by)
  values (c.organisation_id, format('Start due diligence on %s', v_party),
          case when p_signed then format('"%s" is already signed. Due diligence on %s has not been done.', coalesce(c.display_name, c.title), v_party)
               else format('"%s" cannot be approved until due diligence on %s is finished, or %s is recorded as out of scope.', coalesce(c.display_name, c.title), v_party, v_party) end,
          'contracts', c.id, v_person, now() + interval '7 days', 'system', auth.uid());
end;
$$;

-- Approval: blocked while there is no due diligence on the party (the existing checks cover open,
-- rejected, mitigations and sanctions)
do $$
declare
  v text := pg_get_functiondef('public.decide_contract_approval(uuid, boolean, text)'::regprocedure);
begin
  if position('Blocked: there is no due diligence on' in v) = 0 then
    v := replace(v, '    if v_party.dd_status = ''open'' then',
      '    if v_party.id is not null and app.party_needs_dd(v_party.id) and v_party.dd_status is distinct from ''open'' and v_party.dd_status is distinct from ''rejected'' then
      raise exception ''Blocked: there is no due diligence on %. Start it on the Due Diligence page, or record % as out of scope.'', v_party.name, v_party.name using errcode = ''P0001'';
    end if;
    if v_party.dd_status = ''open'' then');
    if position('Blocked: there is no due diligence on' in v) = 0 then
      raise exception 'decide_contract_approval: marker not found';
    end if;
    execute v;
  end if;
end;
$$;

-- Sending for approval: opens the task to start due diligence, so it is not discovered at the last step
do $$
declare
  v text := pg_get_functiondef('public.submit_contract(uuid)'::regprocedure);
begin
  if position('app.dd_task(' in v) = 0 then
    v := replace(v, '  update public.contracts set status = ''pending_approval'' where id = v_c.id;
  perform set_config(''app.contract_system'', ''off'', true);',
      '  update public.contracts set status = ''pending_approval'' where id = v_c.id;
  perform set_config(''app.contract_system'', ''off'', true);
  perform app.dd_task(v_c.id, false);');
    if position('app.dd_task(' in v) = 0 then
      raise exception 'submit_contract: marker not found';
    end if;
    execute v;
  end if;
end;
$$;

-- Signing in VeraPhius without due diligence: logged as an exception
do $$
declare
  v text := pg_get_functiondef('public.record_contract_signature(uuid, uuid, text, date, uuid)'::regprocedure);
begin
  if position('signed_before_due_diligence' in v) = 0 then
    v := replace(v, '  select * into v_rule
  from app.covering_rules(v_entity, ''execute'', v_c.transaction_type, v_c.value_amount) r',
      '  if v_c.counterparty_id is not null and app.party_needs_dd(v_c.counterparty_id)
     and not exists (select 1 from public.authority_exceptions x where x.contract_id = v_c.id and x.kind = ''signed_before_due_diligence'') then
    insert into public.authority_exceptions (organisation_id, contract_id, kind, detail, created_by)
    values (v_c.organisation_id, v_c.id, ''signed_before_due_diligence'',
            format(''Signed by %s on %s before due diligence on the other party was finished'', btrim(p_signed_by), to_char(p_signed_on, ''DD Mon YYYY'')), auth.uid());
    v_exceptions := v_exceptions + 1;
  end if;

  select * into v_rule
  from app.covering_rules(v_entity, ''execute'', v_c.transaction_type, v_c.value_amount) r');
    if position('signed_before_due_diligence' in v) = 0 then
      raise exception 'record_contract_signature: marker not found';
    end if;
    execute v;
  end if;
end;
$$;

-- ---------- Saving a read contract, now with filing, value, signatories and the due diligence step ----------
create or replace function public.save_read_contract(p_org uuid, p_entity uuid, p_signed boolean, p_values jsonb, p_version uuid, p_extraction uuid, p_terms_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v text;
  v_party uuid;
  v_new_party boolean := false;
  v_contract uuid;
  v_doc uuid;
  v_name text := btrim(coalesce(p_values ->> 'counterparty', ''));
  v_value numeric;
  v_signed_on date := nullif(p_values ->> 'signed_on', '')::date;
  v_parent uuid := nullif(p_values ->> 'parent_contract_id', '')::uuid;
  v_check jsonb;
  v_display text;
  f record;
begin
  if not app.has_role(p_org, app.contributor_roles()) then
    raise exception 'You do not have permission to add contracts';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Give the other party''s name';
  end if;
  if char_length(btrim(coalesce(p_values ->> 'title', ''))) < 2 then
    raise exception 'Give the contract a short title';
  end if;
  if p_terms_url is not null and p_terms_url !~* '^https?://' then
    raise exception 'The link must start with http:// or https://';
  end if;
  v := regexp_replace(coalesce(p_values ->> 'value', ''), '[^0-9.]', '', 'g');
  if v ~ '^\d+(\.\d+)?$' then
    v_value := v::numeric;
  elsif btrim(coalesce(p_values ->> 'value', '')) <> '' then
    raise exception 'Give the value as a number, or leave it blank';
  end if;
  if v_signed_on > current_date + 1 then
    raise exception 'The signing date cannot be in the future';
  end if;
  if v_parent is not null and not exists (select 1 from public.contracts k where k.id = v_parent and k.organisation_id = p_org) then
    raise exception 'The master agreement must be one of your contracts';
  end if;
  select id into v_party from public.counterparties where organisation_id = p_org and lower(name) = lower(v_name);
  if v_party is null then
    insert into public.counterparties (organisation_id, name, kind) values (p_org, v_name, 'third_party') returning id into v_party;
    v_new_party := true;
  end if;

  insert into public.contracts (organisation_id, entity_id, counterparty_id, title, transaction_type, value_amount, currency, value_basis,
                                starts_on, ends_on, notice_by, auto_renews,
                                summary, description, purpose, terms_url, terms_added_on, tfc_available, tfc_by, tfc_notice, tfc_from, renewal_terms,
                                source, ai_extraction_id, agreement_type, agreement_type_other, business_function, parent_contract_id, family_role,
                                signed_on, our_signatories)
  values (p_org, p_entity, v_party, btrim(p_values ->> 'title'), coalesce(nullif(btrim(p_values ->> 'transaction_type'), ''), 'Any'),
          v_value, coalesce(nullif(upper(btrim(p_values ->> 'currency')), ''), 'AUD'), nullif(btrim(p_values ->> 'value_basis'), ''),
          nullif(p_values ->> 'start_date', '')::date, nullif(p_values ->> 'end_date', '')::date, nullif(p_values ->> 'notice_by', '')::date,
          coalesce(p_values ->> 'auto_renews', '') = 'yes',
          nullif(btrim(p_values ->> 'description'), ''), nullif(btrim(p_values ->> 'description'), ''), nullif(btrim(p_values ->> 'purpose'), ''),
          p_terms_url, case when p_terms_url is not null then current_date end,
          nullif(p_values ->> 'tfc_available', ''), nullif(p_values ->> 'tfc_by', ''), nullif(btrim(p_values ->> 'tfc_notice'), ''), nullif(btrim(p_values ->> 'tfc_from'), ''),
          nullif(btrim(p_values ->> 'renewal_terms'), ''),
          case when p_terms_url is not null then 'online_terms' when p_version is not null then 'document' else 'typed' end, p_extraction,
          coalesce(nullif(p_values ->> 'agreement_type', ''), case when p_terms_url is not null then 'TERMS' else 'OTH' end),
          case when coalesce(p_values ->> 'agreement_type', '') = 'OTH' then nullif(btrim(p_values ->> 'agreement_type_other'), '') end,
          nullif(p_values ->> 'business_function', ''), v_parent, case when v_parent is not null then coalesce(nullif(p_values ->> 'family_role', ''), 'amendment') end,
          v_signed_on, case when p_signed then app.parse_signatories(p_values ->> 'our_signatories') else '[]'::jsonb end)
  returning id into v_contract;

  -- Already signed: recorded as signed (it is a record of an agreement already made, not a request to approve one)
  if p_signed then
    perform set_config('app.contract_system', 'on', true);
    update public.contracts set status = 'signed' where id = v_contract;
    perform set_config('app.contract_system', 'off', true);
    if nullif(p_values ->> 'notice_by', '')::date >= current_date then
      insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
      values (p_org, format('%s: decide whether to renew or give notice', btrim(p_values ->> 'title')), 'contracts', v_contract,
              ((p_values ->> 'notice_by')::date::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
    end if;
    if nullif(p_values ->> 'end_date', '')::date >= current_date then
      insert into public.tasks (organisation_id, title, subject_table, subject_id, due_at, origin, created_by)
      values (p_org, format('%s: contract ends', btrim(p_values ->> 'title')), 'contracts', v_contract,
              ((p_values ->> 'end_date')::date::timestamp at time zone 'Australia/Sydney'), 'system', auth.uid());
    end if;
    v_check := app.recheck_signatories(v_contract);
    -- Signed without due diligence: a task to start it; an exception if signed since joining VeraPhius
    if app.party_needs_dd(v_party) then
      perform app.dd_task(v_contract, true);
      if coalesce(v_signed_on, nullif(p_values ->> 'start_date', '')::date) >= (select o.created_at::date from public.organisations o where o.id = p_org)
         and not exists (select 1 from public.counterparties cp where cp.id = v_party and cp.dd_status = 'open') then
        insert into public.authority_exceptions (organisation_id, contract_id, kind, detail, created_by)
        values (p_org, v_contract, 'signed_before_due_diligence', format('Signed with %s before due diligence on them was done', v_name), auth.uid());
      end if;
    end if;
  end if;

  select display_name into v_display from public.contracts where id = v_contract;
  if p_version is not null then
    select document_id into v_doc from public.document_versions where id = p_version and organisation_id = p_org;
    if v_doc is not null then
      insert into public.document_links (organisation_id, document_id, subject_table, subject_id, created_by)
      values (p_org, v_doc, 'contracts', v_contract, auth.uid());
      update public.documents set is_restricted = false, title = left(v_display, 300) where id = v_doc;
    end if;
  end if;

  -- The person's checks: each AI answer confirmed as read, or corrected
  if p_extraction is not null then
    if not exists (select 1 from public.extractions x where x.id = p_extraction and x.organisation_id = p_org and x.document_version_id is not distinct from coalesce(p_version, x.document_version_id)) then
      raise exception 'That reading belongs to another file';
    end if;
    for f in select x.field_key, x.proposed_value #>> '{}' as proposed from public.extraction_fields x where x.extraction_id = p_extraction and x.status = 'proposed' loop
      v := nullif(btrim(coalesce(p_values ->> f.field_key, '')), '');
      if coalesce(v, '') = coalesce(btrim(f.proposed), '') then
        update public.extraction_fields set status = 'confirmed' where extraction_id = p_extraction and field_key = f.field_key;
      else
        update public.extraction_fields set status = 'corrected', final_value = coalesce(to_jsonb(v), 'null'::jsonb)
         where extraction_id = p_extraction and field_key = f.field_key;
      end if;
    end loop;
    update public.extractions set status = 'confirmed' where id = p_extraction;
  end if;

  return jsonb_build_object('contract_id', v_contract, 'counterparty_id', v_party, 'new_counterparty', v_new_party, 'display_name', v_display,
                            'needs_due_diligence', app.party_needs_dd(v_party), 'signatory_check', v_check);
end;
$$;

-- The prompt version now comes from the reader with the model ("contracts-v2 <model>")
create or replace function public.record_contract_reading(p_version uuid, p_model text, p_fields jsonb, p_error text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id uuid;
  f record;
begin
  select organisation_id into v_org from public.document_versions where id = p_version;
  if v_org is null then
    raise exception 'Unknown file';
  end if;
  insert into public.extractions (organisation_id, document_version_id, ai_system_id, prompt_version, status, error, started_at, completed_at)
  values (v_org, p_version, '6f1c2a10-0067-4c0e-9a11-c0a7ac7e0001', left(coalesce(nullif(btrim(p_model), ''), 'contracts'), 200),
          case when p_error is null then 'needs_review' else 'failed' end::public.extraction_status, p_error, now(), now())
  returning id into v_id;
  if p_error is null then
    for f in select key, value from jsonb_each(coalesce(p_fields, '{}'::jsonb)) loop
      insert into public.extraction_fields (organisation_id, extraction_id, field_key, proposed_value, source_text, confidence)
      values (v_org, v_id, f.key, to_jsonb(f.value ->> 'value'), left(f.value ->> 'quote', 1000),
              case when (f.value ->> 'confidence') ~ '^(0(\.\d+)?|1(\.0+)?)$' then (f.value ->> 'confidence')::numeric end);
    end loop;
  end if;
  return v_id;
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
revoke execute on function public.set_contract_signatories(uuid, text, date), public.set_contract_filing(uuid, text, text, text, uuid, text, text, numeric, text) from public, anon;
grant execute on function public.set_contract_signatories(uuid, text, date), public.set_contract_filing(uuid, text, text, text, uuid, text, text, numeric, text) to authenticated;
revoke execute on function public.record_contract_reading(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_contract_reading(uuid, text, jsonb, text) to service_role;
