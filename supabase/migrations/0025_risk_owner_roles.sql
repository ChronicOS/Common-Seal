-- 0025: the people who manage the risk register can name the report owner.
-- Before this, only an owner or administrator of the organisation could.
-- Now: owner, administrator, secretary, legal and compliance.
-- The person named must still be an active member (checked by the existing guard).

drop policy if exists risk_owners_insert on public.risk_owners;
drop policy if exists risk_owners_delete on public.risk_owners;

create policy risk_owners_insert on public.risk_owners for insert to authenticated
  with check (app.has_role(organisation_id, app.records_roles()));
create policy risk_owners_delete on public.risk_owners for delete to authenticated
  using (app.has_role(organisation_id, app.records_roles()));
