-- 0059: Account settings.
--
-- Tightens what an owner or administrator can change on the organisation
-- record from the app: its name, its tier (until billing replaces the test
-- switch) and the gift and expense thresholds. The data region, the id and
-- the dates can no longer be changed from the app at all: the data region in
-- particular is fixed at Sydney.

revoke update on public.organisations from authenticated;
grant update (name, tier, gift_approval_threshold, expense_receipt_threshold) on public.organisations to authenticated;

create or replace function app.guard_organisation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(new.name)) < 2 or char_length(new.name) > 200 then
    raise exception 'The organisation name must be between 2 and 200 characters';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;
drop trigger if exists organisations_guard on public.organisations;
create trigger organisations_guard before update on public.organisations for each row execute function app.guard_organisation();

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
