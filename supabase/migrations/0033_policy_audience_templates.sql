-- 0033: internal and external policies, codes of conduct, and the organisation's own templates.
--
-- audience: internal (for people who work for the company, e.g. the Employee
--   Code of Conduct) or external (for people outside it, e.g. the Supplier Code
--   of Conduct, or the published privacy policy).
-- kind: a policy, or a code of conduct (the top-level statement of expected
--   behaviour that other policies sit under). Both follow the same drafting,
--   approval and review cycle.
-- applies_to: who an external policy is for (suppliers, distributors, customers).
-- policy_templates: templates an organisation saves from its own policies, so
--   the built-in template library can be added to.

alter table public.policies add column if not exists audience text not null default 'internal' check (audience in ('internal', 'external'));
alter table public.policies add column if not exists kind text not null default 'policy' check (kind in ('policy', 'code'));
alter table public.policies add column if not exists applies_to text;

drop function if exists public.create_policy(uuid, text, text, uuid, integer, text);
create or replace function public.create_policy(
  p_org uuid, p_title text, p_category text, p_owner uuid, p_review_months integer, p_content text,
  p_audience text default 'internal', p_kind text default 'policy', p_applies_to text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_policy uuid;
begin
  if not app.has_role(p_org, app.records_roles()) then
    raise exception 'You do not have permission to add policies';
  end if;
  insert into public.policies (organisation_id, title, category, owner_user_id, review_every_months, audience, kind, applies_to)
  values (p_org, btrim(p_title), coalesce(nullif(btrim(p_category), ''), 'General'), p_owner, coalesce(p_review_months, 12),
          coalesce(p_audience, 'internal'), coalesce(p_kind, 'policy'), nullif(btrim(coalesce(p_applies_to, '')), ''))
  returning id into v_policy;
  insert into public.policy_versions (organisation_id, policy_id, version_no, content, written_by)
  values (p_org, v_policy, 1, coalesce(p_content, ''), auth.uid());
  return v_policy;
end;
$$;

grant update (audience, kind, applies_to) on public.policies to authenticated;

create table public.policy_templates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 3 and 150),
  category         text not null default 'General',
  audience         text not null default 'internal' check (audience in ('internal', 'external')),
  kind             text not null default 'policy' check (kind in ('policy', 'code')),
  summary          text,
  content          text not null check (char_length(content) >= 20),
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, name)
);

revoke all on public.policy_templates from anon, authenticated;
grant select, insert, update, delete on public.policy_templates to authenticated;
grant all on public.policy_templates to service_role;
alter table public.policy_templates enable row level security;
create policy policy_templates_select on public.policy_templates for select to authenticated using (app.is_member(organisation_id));
create policy policy_templates_insert on public.policy_templates for insert to authenticated with check (app.has_role(organisation_id, app.records_roles()));
create policy policy_templates_update on public.policy_templates for update to authenticated
  using (app.has_role(organisation_id, app.records_roles())) with check (app.has_role(organisation_id, app.records_roles()));
create policy policy_templates_delete on public.policy_templates for delete to authenticated using (app.has_role(organisation_id, app.records_roles()));
create trigger policy_templates_touch before update on public.policy_templates for each row execute function app.touch_updated_at();
create trigger policy_templates_audit after insert or update or delete on public.policy_templates for each row execute function app.audit_row();

revoke execute on all functions in schema app from public, anon;
revoke execute on function public.create_policy(uuid, text, text, uuid, integer, text, text, text, text) from public, anon;
grant execute on function public.create_policy(uuid, text, text, uuid, integer, text, text, text, text) to authenticated;
