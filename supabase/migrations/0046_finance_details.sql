-- 0046: Finance details for each company.
--
-- Bank accounts: bank, account name, BSB, account number, SWIFT/BIC and IBAN
-- for overseas accounts, currency, what the account is for, whether it is a
-- main account, who can authorise payments and how, the online banking
-- platform, and when it was opened or closed.
--
-- Payment fraud often works by changing bank details. So any change to the
-- BSB, account number, SWIFT/BIC or IBAN is stamped with who changed it and
-- when, and the account shows as unverified until someone records that the
-- details were confirmed independently (for example by calling the bank on a
-- known number). Every change is also in the audit log.
--
-- Credit facilities: lender, type (overdraft, revolving, term loan, trade
-- finance, card, bank guarantee, lease), limit, amount drawn and when,
-- interest rate and fees, start, maturity and review dates, security and
-- guarantors, covenants and the next covenant test date.
--
-- Ladder up: a facility maturing within 180 days, or with a review or
-- covenant test due within 30 days (or past), feeds the Risk Register.
--
-- Who can see it: owners, administrators, the secretary, legal, compliance,
-- directors and auditors. Who can change it: owners, administrators, the
-- secretary, legal and compliance.

create or replace function app.can_read_finance(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_org, app.board_read_roles()) or app.has_role(p_org, array['auditor']::public.member_role[]);
$$;

create table public.bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  entity_id           uuid not null references public.entities (id) on delete cascade,
  bank                text not null check (char_length(btrim(bank)) between 2 and 200),
  account_name        text not null check (char_length(btrim(account_name)) between 2 and 300),
  bsb                 text check (bsb is null or bsb ~ '^[0-9]{3}-?[0-9]{3}$'),
  account_number      text check (account_number is null or account_number ~ '^[0-9 -]{4,20}$'),
  swift_bic           text check (swift_bic is null or swift_bic ~ '^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$'),
  iban                text check (iban is null or char_length(replace(iban, ' ', '')) between 15 and 34),
  currency            text not null default 'AUD',
  country             text not null default 'Australia',
  purpose             text not null default 'operating' check (purpose in ('operating', 'payroll', 'receipts', 'savings', 'term_deposit', 'trust', 'tax', 'loan', 'card', 'other')),
  is_main             boolean not null default false,
  signatories         text,          -- who can authorise payments
  authorisation_rule  text,          -- for example "any two of the above"
  online_banking      text,          -- platform and who administers it
  opened_on           date,
  closed_on           date,
  status              text not null default 'open' check (status in ('open', 'closed')),
  notes               text,
  details_changed_at  timestamptz,
  details_changed_by  uuid references auth.users (id) on delete set null,
  verified_at         timestamptz,
  verified_by         uuid references auth.users (id) on delete set null,
  verified_how        text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (closed_on is null or opened_on is null or closed_on >= opened_on),
  check (status = 'open' or closed_on is not null)
);
create index bank_accounts_entity_idx on public.bank_accounts (entity_id);

create table public.credit_facilities (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete cascade,
  entity_id             uuid not null references public.entities (id) on delete cascade,
  lender                text not null check (char_length(btrim(lender)) between 2 and 200),
  kind                  text not null default 'revolving' check (kind in ('overdraft', 'revolving', 'term_loan', 'trade_finance', 'credit_card', 'bank_guarantee', 'lease', 'invoice_finance', 'other')),
  reference             text,
  limit_amount          numeric(18,2) check (limit_amount is null or limit_amount >= 0),
  currency              text not null default 'AUD',
  drawn_amount          numeric(18,2) check (drawn_amount is null or drawn_amount >= 0),
  drawn_as_at           date,
  interest_rate         text,          -- for example "BBSY + 2.10%"
  fees                  text,
  starts_on             date,
  maturity_on           date,
  review_on             date,
  security              text,
  guarantors            text,
  covenants             text,
  next_covenant_test_on date,
  bank_account_id       uuid references public.bank_accounts (id) on delete set null,
  status                text not null default 'active' check (status in ('active', 'repaid', 'cancelled', 'expired')),
  notes                 text,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (maturity_on is null or starts_on is null or maturity_on >= starts_on)
);
create index credit_facilities_entity_idx on public.credit_facilities (entity_id);

create or replace function app.guard_finance_row()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.entities e where e.id = new.entity_id and e.organisation_id = new.organisation_id) then
    raise exception 'That company is not in this organisation';
  end if;
  if tg_op = 'UPDATE' and (new.entity_id <> old.entity_id or new.organisation_id <> old.organisation_id) then
    raise exception 'A record cannot move to another company';
  end if;
  if tg_table_name = 'bank_accounts' then
    new.bsb := nullif(regexp_replace(coalesce(new.bsb, ''), '[^0-9]', '', 'g'), '');
    if new.bsb is not null then new.bsb := substr(new.bsb, 1, 3) || '-' || substr(new.bsb, 4, 3); end if;
    new.account_number := nullif(regexp_replace(coalesce(new.account_number, ''), '[^0-9]', '', 'g'), '');
    new.swift_bic := nullif(upper(btrim(coalesce(new.swift_bic, ''))), '');
    new.iban := nullif(upper(replace(coalesce(new.iban, ''), ' ', '')), '');
    if new.account_number is null and new.iban is null then
      raise exception 'Give the account number (or the IBAN for an overseas account)';
    end if;
    if upper(new.country) in ('AUSTRALIA', 'AU') and new.bsb is null and new.purpose <> 'card' then
      raise exception 'Give the BSB for an Australian account';
    end if;
    -- Stamp any change to where money goes; verification starts again
    if tg_op = 'INSERT' or (new.bsb, new.account_number, new.swift_bic, new.iban) is distinct from (old.bsb, old.account_number, old.swift_bic, old.iban) then
      new.details_changed_at := now();
      new.details_changed_by := auth.uid();
      if tg_op = 'UPDATE' then
        new.verified_at := null; new.verified_by := null; new.verified_how := null;
      end if;
    elsif current_setting('app.finance_system', true) is distinct from 'on' then
      new.details_changed_at := old.details_changed_at; new.details_changed_by := old.details_changed_by;
      new.verified_at := old.verified_at; new.verified_by := old.verified_by; new.verified_how := old.verified_how;
    end if;
    if tg_op = 'INSERT' then
      new.verified_at := null; new.verified_by := null; new.verified_how := null;
    end if;
    if new.status = 'closed' then new.is_main := false; end if;
  else
    if new.bank_account_id is not null and not exists (select 1 from public.bank_accounts b where b.id = new.bank_account_id and b.entity_id = new.entity_id) then
      raise exception 'That bank account is not this company''s';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;
create trigger bank_accounts_guard before insert or update on public.bank_accounts for each row execute function app.guard_finance_row();
create trigger credit_facilities_guard before insert or update on public.credit_facilities for each row execute function app.guard_finance_row();

-- Record that the details were confirmed independently. Not by the person who last changed them.
create or replace function public.verify_bank_account(p_account uuid, p_how text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts%rowtype;
begin
  select * into b from public.bank_accounts x where x.id = p_account;
  if b.id is null or not app.has_role(b.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to verify this account';
  end if;
  if char_length(btrim(coalesce(p_how, ''))) < 5 then
    raise exception 'Say how the details were confirmed';
  end if;
  if b.details_changed_by = auth.uid() then
    raise exception 'Someone other than the person who entered or changed the details must confirm them';
  end if;
  perform set_config('app.finance_system', 'on', true);
  update public.bank_accounts set verified_at = now(), verified_by = auth.uid(), verified_how = btrim(p_how) where id = p_account;
  perform set_config('app.finance_system', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Ladder up: facilities maturing, or reviews and covenant tests due
-- ---------------------------------------------------------------------
alter table public.risk_items drop constraint if exists risk_items_source_table_check;
alter table public.risk_items add constraint risk_items_source_table_check
  check (source_table in ('key_employees', 'disputes', 'contracts', 'sanctions_assessments', 'legal_audit_actions', 'ip_assets', 'share_movements', 'credit_facilities'));
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  if v_def not like '%credit_facilities%' then
    v_def := replace(v_def, $x$
  )
  select f.source_table, f.source_id, f.register$x$, $x$
    union all
    -- Finance: a facility maturing within 180 days, or a review or covenant test due within 30 days
    select 'credit_facilities', cf.id, 'Finance details', app.risk_feed_category(p_review, array['financial', 'finance', 'treasury', 'commercial']),
           (case when cf.maturity_on is not null and cf.maturity_on <= current_date + 180 then 'Facility maturing: '
                 when cf.next_covenant_test_on is not null and cf.next_covenant_test_on <= current_date + 30 then 'Covenant test due: '
                 else 'Facility review due: ' end)
           || cf.lender || ' ' || replace(cf.kind, '_', ' ') || ' for ' || en.name
           || coalesce(', limit ' || cf.currency || ' ' || to_char(cf.limit_amount, 'FM999,999,999,990'), '')
           || E'\n' || concat_ws(' · ',
                case when cf.maturity_on is not null then 'Matures ' || to_char(cf.maturity_on, 'FMDD Mon YYYY') end,
                case when cf.review_on is not null then 'Review ' || to_char(cf.review_on, 'FMDD Mon YYYY') end,
                case when cf.next_covenant_test_on is not null then 'Covenant test ' || to_char(cf.next_covenant_test_on, 'FMDD Mon YYYY') end),
           'Refinance, renew or confirm the covenant position',
           null::text,
           least(cf.maturity_on, cf.review_on, cf.next_covenant_test_on)
    from public.credit_facilities cf join public.entities en on en.id = cf.entity_id
    where cf.organisation_id = v_org and cf.status = 'active'
      and ((cf.maturity_on is not null and cf.maturity_on <= current_date + 180)
           or (cf.review_on is not null and cf.review_on <= current_date + 30)
           or (cf.next_covenant_test_on is not null and cf.next_covenant_test_on <= current_date + 30))
  )
  select f.source_table, f.source_id, f.register$x$);
    if v_def not like '%credit_facilities%' then
      raise exception 'Could not extend public.risk_feed';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Files: facility agreements, bank letters, statements
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
  v_check text;
begin
  select pg_get_constraintdef(oid) into v_check from pg_constraint where conname = 'document_links_subject_table_check';
  if v_check not like '%credit_facilities%' then
    execute 'alter table public.document_links drop constraint document_links_subject_table_check';
    execute 'alter table public.document_links add constraint document_links_subject_table_check ' ||
            replace(v_check, '''ip_assets''', '''ip_assets'', ''bank_accounts'', ''credit_facilities''');
  end if;
  v_def := pg_get_functiondef('app.attach_target(text, uuid)'::regprocedure);
  if v_def not like '%credit_facilities%' then
    v_def := replace(v_def, $x$  elsif p_table in ('share_movements',$x$, $x$  elsif p_table in ('bank_accounts', 'credit_facilities') then
    execute format('select organisation_id from public.%I where id = $1', p_table) into v_org using p_id;
    v_ok := v_org is not null and app.has_role(v_org, app.records_roles());
  elsif p_table in ('share_movements',$x$);
    if v_def not like '%credit_facilities%' then
      raise exception 'Could not extend app.attach_target';
    end if;
    execute v_def;
  end if;
end;
$$;
do $$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'document_links_subject_table_check') not like '%credit_facilities%' then
    raise exception 'Could not extend the document_links subject list';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------
revoke all on public.bank_accounts, public.credit_facilities from anon, authenticated;
grant select on public.bank_accounts, public.credit_facilities to authenticated;
grant insert (organisation_id, entity_id, bank, account_name, bsb, account_number, swift_bic, iban, currency, country, purpose, is_main, signatories,
              authorisation_rule, online_banking, opened_on, closed_on, status, notes),
      update (bank, account_name, bsb, account_number, swift_bic, iban, currency, country, purpose, is_main, signatories,
              authorisation_rule, online_banking, opened_on, closed_on, status, notes)
  on public.bank_accounts to authenticated;
grant insert (organisation_id, entity_id, lender, kind, reference, limit_amount, currency, drawn_amount, drawn_as_at, interest_rate, fees, starts_on, maturity_on,
              review_on, security, guarantors, covenants, next_covenant_test_on, bank_account_id, status, notes),
      update (lender, kind, reference, limit_amount, currency, drawn_amount, drawn_as_at, interest_rate, fees, starts_on, maturity_on,
              review_on, security, guarantors, covenants, next_covenant_test_on, bank_account_id, status, notes)
  on public.credit_facilities to authenticated;
grant all on public.bank_accounts, public.credit_facilities to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['bank_accounts', 'credit_facilities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.can_read_finance(organisation_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()))', t || '_update', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.touch_updated_at()', t || '_touch', t);
  end loop;
end;
$$;

revoke execute on all functions in schema app from public, anon;
revoke execute on function app.attach_target(text, uuid) from authenticated;
grant execute on function app.can_read_training_object(text) to anon, authenticated, service_role;
grant execute on function app.can_store_dd_upload(text) to anon, authenticated, service_role;
grant execute on function app.can_read_ownership(uuid) to authenticated;
grant execute on function app.can_read_finance(uuid) to authenticated;
revoke execute on function public.verify_bank_account(uuid, text) from public, anon;
grant execute on function public.verify_bank_account(uuid, text) to authenticated;
