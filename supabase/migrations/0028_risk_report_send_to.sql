-- 0028: who the risk report is sent to.
-- Empty (null) means the default: the person responsible for the report.
-- The list can be changed before and after the report is finalised.

alter table public.risk_reviews add column if not exists send_to text[];

create or replace function public.set_risk_report_recipients(p_review uuid, p_emails text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_list text[];
begin
  select r.organisation_id into v_org from public.risk_reviews r where r.id = p_review;
  if v_org is null or not (app.has_role(v_org, app.records_roles()) or app.is_risk_owner(v_org)) then
    raise exception 'Only the report owner, a backup or someone who manages the register can change who the report goes to';
  end if;
  select coalesce(array_agg(e order by n), '{}') into v_list
  from (select lower(btrim(e)) as e, min(n) as n from unnest(coalesce(p_emails, '{}')) with ordinality as t(e, n)
        where btrim(coalesce(e, '')) <> '' group by 1) x;
  if exists (select 1 from unnest(v_list) e where e not like '%_@_%._%') then
    raise exception 'One of those is not a valid email address';
  end if;
  if cardinality(v_list) > 50 then
    raise exception 'That is too many recipients';
  end if;
  -- Allowed on a finalised report too, so the guard is stepped past for this one column
  perform set_config('app.risk_system', 'on', true);
  update public.risk_reviews set send_to = v_list where id = p_review;
  perform set_config('app.risk_system', 'off', true);
end;
$$;

revoke execute on function public.set_risk_report_recipients(uuid, text[]) from public, anon;
grant execute on function public.set_risk_report_recipients(uuid, text[]) to authenticated;
