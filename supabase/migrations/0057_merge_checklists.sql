-- 0057: One checklist engine.
--
-- The anti-bribery adequate procedures map (0051) and the regulatory checks
-- (0052) recorded the same thing: an item, its status, notes, evidence, owner
-- and review date. The anti-bribery map now lives in compliance_checks as the
-- programme 'anti_bribery', so every checklist shares one table, one set of
-- rules, one way of combining what was recorded with what the records show,
-- and one way of laddering gaps up to the Risk Register. Existing answers,
-- their files and their Risk Register entries move across with the same ids.

alter table public.compliance_checks drop constraint if exists compliance_checks_programme_check;
alter table public.compliance_checks add constraint compliance_checks_programme_check
  check (programme in ('employment', 'consumer', 'climate', 'anti_bribery'));

-- Move the answers (same ids, so files and Risk Register entries follow), keeping who reviewed them and when
alter table public.compliance_checks disable trigger compliance_checks_guard;
insert into public.compliance_checks (id, organisation_id, entity_id, programme, item_key, status, notes, evidence, owner_user_id, review_on, reviewed_by, reviewed_at, created_at, updated_at)
select ap.id, ap.organisation_id, null, 'anti_bribery', ap.element_key, ap.status, ap.notes, ap.evidence, ap.owner_user_id, null, ap.reviewed_by, ap.reviewed_at, ap.created_at, ap.updated_at
from public.abc_programme ap
on conflict do nothing;
alter table public.compliance_checks enable trigger compliance_checks_guard;
update public.document_links set subject_table = 'compliance_checks' where subject_table = 'abc_programme';
update public.risk_items set source_table = 'compliance_checks' where source_table = 'abc_programme';

-- The Risk Register: gaps now come from the one checklist feed
do $$
declare
  v_def text;
  a integer;
  b integer;
begin
  v_def := pg_get_functiondef('public.risk_feed(uuid)'::regprocedure);
  a := strpos(v_def, E'    union all\n    -- Gaps in the adequate procedures map');
  b := strpos(v_def, E'    union all\n    -- The latest approved risk assessment');
  if a > 0 and b > a then
    v_def := substr(v_def, 1, a - 1) || substr(v_def, b);
  end if;
  if v_def not like '%when ''anti_bribery'' then ''Anti-bribery''%' then
    v_def := replace(v_def, $x$case cc.programme when 'employment' then 'Employment law'$x$, $x$case cc.programme when 'anti_bribery' then 'Anti-bribery' when 'employment' then 'Employment law'$x$);
    v_def := replace(v_def, $x$app.risk_feed_category(p_review, case cc.programme when 'employment' then$x$,
                            $x$app.risk_feed_category(p_review, case cc.programme when 'anti_bribery' then array['bribery and corruption', 'anti-bribery', 'legal and compliance', 'legal', 'compliance'] when 'employment' then$x$);
  end if;
  if v_def like '%public.abc_programme%' or v_def not like '%when ''anti_bribery'' then ''Anti-bribery''%' then
    raise exception 'Could not update public.risk_feed';
  end if;
  execute v_def;
end;
$$;

drop table public.abc_programme;
