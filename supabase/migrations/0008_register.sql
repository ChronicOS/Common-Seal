-- =====================================================================
-- Common Seal - 0008: risk and compliance register
--
-- One register at three levels (local, regional, global). Each entry is
-- a risk or an obligation with a rating, controls, a review date and
-- named owners: responsible, accountable, consulted, informed, with
-- backups. Entries suggested by a sector template stay "proposed" until
-- a named owner confirms them.
-- =====================================================================

create type public.register_level as enum ('local', 'regional', 'global');
create type public.entry_kind as enum ('risk', 'obligation');
create type public.entry_status as enum ('proposed', 'active', 'closed');
create type public.raci_role as enum ('responsible', 'accountable', 'consulted', 'informed');

-- Which region an entity reports into (free text, so groups can name their own)
alter table public.entities add column region text;

-- ---------------------------------------------------------------------
-- Sector templates (platform content, the same for every organisation)
-- ---------------------------------------------------------------------
create table public.register_templates (
  id                 uuid primary key default gen_random_uuid(),
  sector             text not null,
  position           integer not null,
  kind               public.entry_kind not null,
  category           text not null,
  title              text not null,
  description        text not null,
  suggested_control  text not null,
  unique (sector, title)
);

create table public.register_entries (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  level                public.register_level not null,
  entity_id            uuid references public.entities (id) on delete cascade,
  region               text,
  kind                 public.entry_kind not null,
  category             text not null check (char_length(btrim(category)) >= 2),
  title                text not null check (char_length(btrim(title)) between 2 and 300),
  description          text,
  controls             text,
  likelihood           smallint check (likelihood between 1 and 5),
  impact               smallint check (impact between 1 and 5),
  review_on            date,
  review_every_months  integer not null default 12 check (review_every_months between 1 and 60),
  last_reviewed_on     date,
  status               public.entry_status not null default 'proposed',
  source               text not null default 'manual' check (source in ('manual', 'template')),
  template_id          uuid references public.register_templates (id) on delete set null,
  confirmed_by         uuid references auth.users (id) on delete set null,
  confirmed_at         timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (
    (level = 'local' and entity_id is not null and region is null)
    or (level = 'regional' and entity_id is null and region is not null)
    or (level = 'global' and entity_id is null and region is null)
  )
);
create index register_entries_org_idx on public.register_entries (organisation_id, level, status);

create table public.register_assignments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entry_id         uuid not null references public.register_entries (id) on delete cascade,
  raci             public.raci_role not null,
  person_id        uuid not null references public.people (id) on delete cascade,
  is_backup        boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (entry_id, raci, person_id)
);
create index register_assignments_entry_idx on public.register_assignments (entry_id);
-- Exactly one person is accountable; they may have backups.
create unique index register_assignments_one_accountable_idx
  on public.register_assignments (entry_id) where raci = 'accountable' and not is_backup;

-- ---------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------
create or replace function app.guard_register_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null and not exists
     (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'The entity does not belong to this organisation';
  end if;
  new.region := nullif(btrim(coalesce(new.region, '')), '');

  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;

  -- An entry only counts once someone is accountable for it and someone is responsible for doing it.
  if new.status = 'active' and old.status <> 'active' then
    if not exists (select 1 from public.register_assignments a
                   where a.entry_id = new.id and a.raci = 'accountable' and not a.is_backup)
       or not exists (select 1 from public.register_assignments a
                      where a.entry_id = new.id and a.raci = 'responsible' and not a.is_backup) then
      raise exception 'Name who is accountable and who is responsible before confirming this entry';
    end if;
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
  elsif new.status = old.status then
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
  end if;
  return new;
end;
$$;
create trigger register_entries_guard before insert or update on public.register_entries
  for each row execute function app.guard_register_entry();

create or replace function app.guard_register_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- A confirmed entry must keep its accountable and responsible owners.
    if not old.is_backup and old.raci in ('accountable', 'responsible')
       and exists (select 1 from public.register_entries e where e.id = old.entry_id and e.status = 'active')
       and not exists (select 1 from public.register_assignments a
                       where a.entry_id = old.entry_id and a.raci = old.raci and not a.is_backup and a.id <> old.id) then
      raise exception 'A confirmed entry must keep someone % for it. Add the replacement first.', old.raci;
    end if;
    return old;
  end if;
  if not exists (select 1 from public.register_entries e where e.id = new.entry_id and e.organisation_id = new.organisation_id)
     or not exists (select 1 from public.people p where p.id = new.person_id and p.organisation_id = new.organisation_id) then
    raise exception 'The entry and the person must belong to this organisation';
  end if;
  return new;
end;
$$;
create trigger register_assignments_guard before insert or update or delete on public.register_assignments
  for each row execute function app.guard_register_assignment();

create trigger register_entries_touch before update on public.register_entries
  for each row execute function app.touch_updated_at();
create trigger register_entries_audit after insert or update or delete on public.register_entries
  for each row execute function app.audit_row();
create trigger register_assignments_audit after insert or update or delete on public.register_assignments
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------
-- Applying a sector template to one register
-- ---------------------------------------------------------------------
create or replace function public.apply_register_template(
  p_org uuid, p_sector text, p_level public.register_level, p_entity uuid default null, p_region text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'You do not have permission to change the register';
  end if;
  insert into public.register_entries
    (organisation_id, level, entity_id, region, kind, category, title, description, controls, source, template_id,
     review_on, created_by)
  select p_org, p_level, p_entity, nullif(btrim(coalesce(p_region, '')), ''), t.kind, t.category, t.title, t.description,
         t.suggested_control, 'template', t.id, current_date + interval '12 months', auth.uid()
  from public.register_templates t
  where t.sector = p_sector
    and not exists (
      select 1 from public.register_entries e
      where e.organisation_id = p_org and e.template_id = t.id and e.level = p_level
        and e.entity_id is not distinct from p_entity
        and e.region is not distinct from nullif(btrim(coalesce(p_region, '')), ''))
  order by t.position;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.apply_register_template(uuid, text, public.register_level, uuid, text) from public, anon;
grant execute on function public.apply_register_template(uuid, text, public.register_level, uuid, text) to authenticated;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.register_templates, public.register_entries, public.register_assignments from anon, authenticated;
grant select on public.register_templates to authenticated;
grant select, insert, update on public.register_entries to authenticated;
grant select, insert, update, delete on public.register_assignments to authenticated;
grant all on public.register_templates, public.register_entries, public.register_assignments to service_role;

alter table public.register_templates   enable row level security;
alter table public.register_entries     enable row level security;
alter table public.register_assignments enable row level security;

create policy register_templates_select on public.register_templates for select to authenticated using (true);

create policy register_entries_select on public.register_entries for select to authenticated
  using (app.is_member(organisation_id));
create policy register_entries_insert on public.register_entries for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy register_entries_update on public.register_entries for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));

create policy register_assignments_select on public.register_assignments for select to authenticated
  using (app.is_member(organisation_id));
create policy register_assignments_insert on public.register_assignments for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy register_assignments_update on public.register_assignments for update to authenticated
  using (app.has_role(organisation_id, app.records_roles()))
  with check (app.has_role(organisation_id, app.records_roles()));
create policy register_assignments_delete on public.register_assignments for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()));

-- ---------------------------------------------------------------------
-- Template content: a starting point for review, not legal advice.
-- Each entry is a headline; applicability must be confirmed per business.
-- ---------------------------------------------------------------------
insert into public.register_templates (sector, position, kind, category, title, description, suggested_control) values
-- Financial services
('Financial services', 1, 'risk', 'Commercial', 'Concentration in key clients or distribution partners',
 'Loss of a major client or distributor materially reduces revenue.',
 'Quarterly concentration review; diversification targets set by the board.'),
('Financial services', 2, 'risk', 'Commercial', 'Failure of a material service provider',
 'A material outsourced provider fails or underperforms, interrupting critical operations.',
 'Due diligence before appointment; service levels and exit plans in contracts; annual review of material providers.'),
('Financial services', 3, 'obligation', 'Financial', 'Financial reporting and audit',
 'Prepare, have audited where required, and lodge annual financial reports under the Corporations Act.',
 'Reporting calendar; audit committee review; directors'' declaration sign-off.'),
('Financial services', 4, 'risk', 'Financial', 'Liquidity and capital adequacy',
 'Insufficient liquid funds or capital to meet obligations or licence conditions.',
 'Cash-flow forecasting; capital buffer policy; monthly reporting to the board.'),
('Financial services', 5, 'obligation', 'Legal', 'Financial services licence general obligations',
 'Provide financial services efficiently, honestly and fairly, and meet the other general obligations of a licensee.',
 'Compliance plan mapped to each obligation; breach register; reportable situations process.'),
('Financial services', 6, 'obligation', 'Legal', 'Design and distribution obligations',
 'Maintain target market determinations and take reasonable steps so distribution is consistent with them.',
 'Determinations reviewed on schedule; distributor reporting; review triggers monitored.'),
('Financial services', 7, 'obligation', 'Regulatory', 'Anti-money laundering and counter-terrorism financing program',
 'Maintain and comply with an AML/CTF program, including customer identification, monitoring and reporting to AUSTRAC.',
 'Board-approved program; customer due diligence procedures; independent review; staff training.'),
('Financial services', 8, 'obligation', 'Regulatory', 'Privacy and notifiable data breaches',
 'Handle personal information in line with the Australian Privacy Principles and notify eligible data breaches.',
 'Privacy policy and collection notices; data breach response plan; privacy impact assessments.'),
('Financial services', 9, 'risk', 'Cyber and IT', 'Cyber attack or data breach',
 'Unauthorised access to systems or customer data causes loss, disruption and regulatory exposure.',
 'Multi-factor authentication; patching; penetration testing; incident response exercises.'),
('Financial services', 10, 'risk', 'Cyber and IT', 'Technology outage affecting critical operations',
 'Failure of core systems prevents services to customers beyond tolerance.',
 'Business continuity and disaster recovery plans, tested annually; tolerance levels set by the board.'),
('Financial services', 11, 'risk', 'AI', 'Use of AI in decisions affecting customers',
 'AI tools produce inaccurate, biased or unexplainable outcomes for customers.',
 'AI use register; human review of consequential decisions; testing before deployment.'),
('Financial services', 12, 'obligation', 'Training', 'Competence and training of representatives',
 'Ensure representatives are adequately trained and competent to provide the services they provide.',
 'Training plan by role; completion tracking; annual refreshers.'),
('Financial services', 13, 'obligation', 'People', 'Work health and safety',
 'Officers exercise due diligence so the business meets its work health and safety duties.',
 'Safety reporting to the board; incident register; consultation arrangements.'),
('Financial services', 14, 'obligation', 'People', 'Whistleblower protections',
 'Maintain a whistleblower policy where required and protect people who make protected disclosures.',
 'Policy available to staff; eligible recipients trained; confidential reporting channel.'),
('Financial services', 15, 'risk', 'People', 'Loss of key people',
 'Departure of people in critical or licence-nominated roles disrupts operations.',
 'Succession plans; documented procedures; notice periods.'),
('Financial services', 16, 'obligation', 'Disputes', 'Complaints handling and external dispute resolution',
 'Handle complaints within required timeframes and maintain membership of the external dispute resolution scheme.',
 'Complaints register; response-time tracking; root cause reporting.'),
-- Consumer goods, including pharma
('Consumer goods', 1, 'risk', 'Commercial', 'Reliance on key retail customers or distributors',
 'Loss of, or adverse terms from, a major customer materially reduces revenue or margin.',
 'Joint business plans; customer concentration reporting; contract renewal calendar.'),
('Consumer goods', 2, 'risk', 'Commercial', 'Supply chain disruption',
 'A key supplier or contract manufacturer cannot supply, causing stock-outs.',
 'Dual sourcing for critical inputs; safety stock; supplier audits.'),
('Consumer goods', 3, 'obligation', 'Commercial', 'Modern slavery reporting',
 'Where consolidated revenue is at least $100 million, submit an annual modern slavery statement approved by the board.',
 'Supplier risk assessment; questionnaires for higher-risk suppliers; statement approval calendar.'),
('Consumer goods', 4, 'obligation', 'Financial', 'Financial reporting and audit',
 'Prepare, have audited where required, and lodge annual financial reports under the Corporations Act.',
 'Reporting calendar; audit committee review; directors'' declaration sign-off.'),
('Consumer goods', 5, 'risk', 'Financial', 'Foreign exchange and input cost volatility',
 'Currency and commodity movements erode margins.',
 'Hedging policy; pricing reviews; treasury reporting.'),
('Consumer goods', 6, 'obligation', 'Legal', 'Consumer law: product safety, guarantees and claims',
 'Products are safe, consumer guarantees are honoured, and marketing claims are not misleading.',
 'Claims substantiation and legal review of advertising; product safety testing; recall procedure.'),
('Consumer goods', 7, 'obligation', 'Legal', 'Competition law',
 'No cartel conduct, resale price maintenance or misuse of market power in dealings with competitors, retailers and suppliers.',
 'Competition law training for sales teams; legal review of trading terms; trade association protocols.'),
('Consumer goods', 8, 'obligation', 'Regulatory', 'Therapeutic goods: registration, manufacturing and advertising',
 'Therapeutic goods are entered on the Australian Register of Therapeutic Goods, made to manufacturing standards, and advertised in line with the advertising code.',
 'Regulatory affairs sign-off before launch; advertising review process; manufacturing licence and clearance tracking.'),
('Consumer goods', 9, 'obligation', 'Regulatory', 'Safety monitoring and product complaints',
 'Record, assess and report adverse events and quality complaints within required timeframes.',
 'Adverse event intake procedure; trained responsible person; reconciliation with complaints data.'),
('Consumer goods', 10, 'obligation', 'Regulatory', 'Anti-bribery and dealings with healthcare professionals',
 'No improper payments or benefits; dealings with healthcare professionals follow the applicable industry code.',
 'Gifts and hospitality register; approval for sponsorships; third-party due diligence.'),
('Consumer goods', 11, 'obligation', 'Regulatory', 'Privacy and notifiable data breaches',
 'Handle personal information in line with the Australian Privacy Principles and notify eligible data breaches.',
 'Privacy policy and collection notices; data breach response plan; privacy impact assessments.'),
('Consumer goods', 12, 'risk', 'Regulatory', 'Product recall',
 'A quality or safety defect requires recall, with cost, regulatory and reputational impact.',
 'Recall plan tested by mock recall; batch traceability; recall insurance.'),
('Consumer goods', 13, 'risk', 'Cyber and IT', 'Cyber attack or data breach',
 'Unauthorised access to systems or data causes loss, disruption and regulatory exposure.',
 'Multi-factor authentication; patching; penetration testing; incident response exercises.'),
('Consumer goods', 14, 'risk', 'AI', 'Use of AI in marketing and operations',
 'AI-generated content or decisions breach advertising rules, infringe rights or disclose confidential information.',
 'AI use policy and register; human review of external content; approved tools list.'),
('Consumer goods', 15, 'obligation', 'Training', 'Compliance training for commercial teams',
 'People dealing with customers, healthcare professionals and suppliers are trained on the rules that apply to them.',
 'Role-based training plan covering competition, anti-bribery and advertising; completion tracking.'),
('Consumer goods', 16, 'obligation', 'People', 'Work health and safety',
 'Officers exercise due diligence so the business meets its work health and safety duties.',
 'Safety reporting to the board; incident register; consultation arrangements.'),
('Consumer goods', 17, 'obligation', 'People', 'Whistleblower protections',
 'Maintain a whistleblower policy where required and protect people who make protected disclosures.',
 'Policy available to staff; eligible recipients trained; confidential reporting channel.'),
('Consumer goods', 18, 'risk', 'Disputes', 'Product liability claims',
 'Claims for injury or loss caused by products.',
 'Product liability insurance; complaint escalation to legal; document retention.');
