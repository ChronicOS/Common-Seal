-- =====================================================================
-- Common Seal - 0019: hardening
--
-- Postgres lets everyone run a new function unless told otherwise.
-- The internal helpers in the app schema were not reachable by people
-- who are not signed in (that role cannot use the schema, and the
-- schema is not exposed through the API), but the permission itself
-- was still there. This removes it, so the health check can hold the
-- line at "nobody signed out can run anything".
-- =====================================================================

revoke execute on all functions in schema app from public, anon;

-- Signed-in users keep exactly the helpers that access rules and screens rely on
grant execute on function
  app.is_member(uuid),
  app.has_role(uuid, public.member_role[]),
  app.admin_roles(), app.records_roles(), app.contributor_roles(),
  app.board_read_roles(), app.board_write_roles(), app.notes_roles(),
  app.can_read_document(uuid),
  app.is_under_hold(uuid, text, uuid),
  app.dd_rating(jsonb),
  app.can_write_policy(uuid),
  app.can_see_case(uuid),
  app.can_see_claim(uuid),
  app.ms_rating(jsonb),
  app.can_store_object(text),
  app.can_read_object(text)
to authenticated, service_role;

-- These act for the caller without checking who is calling, so nobody calls them directly
revoke execute on function
  app.advance_workflow_run(uuid),
  app.covering_rules(uuid, public.authority_kind, text, numeric),
  app.rule_holder(public.delegation_rules),
  app.rule_basis(public.delegation_rules),
  app.attach_target(text, uuid),
  app.speak_up_hash(text)
from authenticated;
