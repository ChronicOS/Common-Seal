-- =====================================================================
-- Common Seal - 0021: modern slavery report template
--
-- The statement gains three parts beside the seven mandatory criteria:
--   0  Our commitment (a message from the CEO)
--   8  Looking ahead
--   9  Appendix: questionnaire results
-- Approval still depends only on criteria 1 to 7.
-- =====================================================================

alter table public.ms_sections drop constraint ms_sections_criterion_check;
alter table public.ms_sections add constraint ms_sections_criterion_check check (criterion between 0 and 9);

create or replace function public.approve_ms_statement(
  p_statement uuid, p_body text, p_approved_on date, p_method text, p_ceo text, p_signed_by text default null, p_signed_role text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_s public.ms_statements%rowtype;
  v_missing integer;
begin
  select * into v_s from public.ms_statements s where s.id = p_statement for update;
  if v_s.id is null or not app.has_role(v_s.organisation_id, app.records_roles()) then
    raise exception 'You do not have permission to record approval of this statement';
  end if;
  if v_s.status <> 'draft' then
    raise exception 'This statement has already been approved';
  end if;
  select 7 - count(*) into v_missing from public.ms_sections x
   where x.statement_id = p_statement and x.criterion between 1 and 7 and char_length(btrim(x.content)) >= 20;
  if v_missing > 0 then
    raise exception '% of the seven mandatory criteria are not yet addressed', v_missing;
  end if;
  if not v_s.product_info_checked then
    raise exception 'Confirm that product information and imagery in the report are up to date';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 3 or p_approved_on is null or coalesce(p_method, '') not in ('meeting', 'circular') then
    raise exception 'Record which body approved it, when, and whether by meeting or circular resolution';
  end if;
  if char_length(btrim(coalesce(p_ceo, ''))) < 2 then
    raise exception 'The statement needs the signature of the CEO or Managing Director';
  end if;
  if p_approved_on > current_date then
    raise exception 'The approval date cannot be in the future';
  end if;
  perform set_config('app.ms_system', 'on', true);
  update public.ms_statements
     set status = 'approved', approved_body = btrim(p_body), approved_on = p_approved_on, approval_method = p_method,
         ceo_signed_by = btrim(p_ceo),
         signed_by = coalesce(nullif(btrim(coalesce(p_signed_by, '')), ''), btrim(p_ceo)),
         signed_role = coalesce(nullif(btrim(coalesce(p_signed_role, '')), ''), 'Chief Executive Officer or Managing Director')
   where id = p_statement;
  perform set_config('app.ms_system', 'off', true);
end;
$$;
