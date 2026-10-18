import { supabase } from "./supabase";

function db() {
  if (!supabase) throw new Error("Not connected");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** The organisation's settings (migration 0060). Missing until it has been run. */
export type OrgSettings = {
  id: string;
  name: string;
  tier: string;
  data_region: string;
  legal_name: string | null;
  abn: string | null;
  address: string | null;
  logo_data_url: string | null;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  dpa_version: string | null;
  dpa_accepted_at: string | null;
  close_requested_at: string | null;
  close_reason: string | null;
  mfa_required_roles: string[];
  idle_timeout_minutes: number | null;
  invite_domains: string[];
  link_days: number;
  policy_review_months: number;
  default_conf_months: number | null;
  default_reminder_emails: "when_needed" | "weekly" | "off";
  email_from_address: string | null;
  email_footer: string | null;
  gift_approval_threshold?: number | null;
  expense_receipt_threshold?: number | null;
};
export type EditableSettings = Partial<
  Pick<
    OrgSettings,
    | "name" | "legal_name" | "abn" | "address" | "logo_data_url" | "billing_contact_name" | "billing_contact_email" | "mfa_required_roles" | "idle_timeout_minutes"
    | "invite_domains" | "link_days" | "policy_review_months" | "default_conf_months" | "default_reminder_emails" | "email_from_address" | "email_footer"
    | "gift_approval_threshold" | "expense_receipt_threshold"
  >
>;

/** The current terms and data processing agreement versions. Drafts until the documents are final. */
export const TERMS_VERSION = "Draft October 2026";
export const DPA_VERSION = "Draft October 2026";
/** Placeholder until a support mailbox is set up */
export const SUPPORT_EMAIL = "support@veraphius.com";

export async function loadOrgSettings(organisationId: string): Promise<OrgSettings | null> {
  const { data, error } = await db().from("organisations").select("*").eq("id", organisationId).maybeSingle();
  if (error || !data || !("link_days" in data)) return null;
  return data as OrgSettings;
}
export async function saveOrgSettings(organisationId: string, patch: EditableSettings) {
  check((await db().from("organisations").update(patch).eq("id", organisationId)).error);
}

export type Usage = { companies: number; people: number; files: number; storage_bytes: number; owners: string[]; legal_contact: string | null };
export async function loadUsage(organisationId: string): Promise<Usage | null> {
  const { data, error } = await db().rpc("account_usage", { p_org: organisationId });
  return error ? null : (data as Usage | null);
}
export const bytes = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

export async function acceptTerms(organisationId: string, what: "terms" | "dpa") {
  check((await db().rpc("accept_terms", { p_org: organisationId, p_what: what, p_version: what === "terms" ? TERMS_VERSION : DPA_VERSION })).error);
}
export async function requestClose(organisationId: string, reason: string | null) {
  check((await db().rpc("request_close", { p_org: organisationId, p_reason: reason })).error);
}
export async function setAccessEnd(organisationId: string, userId: string, endsOn: string | null) {
  check((await db().rpc("set_member_access_end", { p_org: organisationId, p_user: userId, p_ends_on: endsOn || null })).error);
}
export async function loadAccessEnds(organisationId: string): Promise<Record<string, string | null>> {
  const { data, error } = await db().from("memberships").select("user_id, access_ends_on").eq("organisation_id", organisationId);
  if (error) return {};
  return Object.fromEntries(((data ?? []) as { user_id: string; access_ends_on: string | null }[]).map((m) => [m.user_id, m.access_ends_on]));
}

// ---- Your own settings ----
export async function loadMine(organisationId: string, userId: string): Promise<{ reminder_muted: string[] } | null> {
  const { data, error } = await db().from("memberships").select("reminder_muted").eq("organisation_id", organisationId).eq("user_id", userId).maybeSingle();
  return error || !data ? null : (data as { reminder_muted: string[] });
}
export async function setMuted(organisationId: string, areas: string[]) {
  check((await db().rpc("set_reminder_muted", { p_org: organisationId, p_areas: areas })).error);
}
/** The areas reminder emails come from (they match the server's list) */
export const REMINDER_AREAS = [
  "Compliance calendar", "Training", "Policies", "Confidential projects", "Work health and safety", "Privacy and cyber", "Company register", "Compliance checks",
  "Consumer law", "Anti-bribery", "Insurance", "Gifts and hospitality", "Conflicts of interest", "Speak up", "Risk Register",
];

export type MySecurity = { mfa_required: boolean; idle_timeout_minutes: number | null; access_ends_on: string | null };
export async function loadMySecurity(organisationId: string): Promise<MySecurity | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_security", { p_org: organisationId });
  return error ? null : (data as MySecurity | null);
}

// ---- Two-step sign-in (authenticator app) ----
export type Factor = { id: string; friendly_name?: string; status: string; created_at: string };
export async function loadFactors(): Promise<{ factors: Factor[]; level: string | null; next: string | null }> {
  const client = db();
  const [f, a] = await Promise.all([client.auth.mfa.listFactors(), client.auth.mfa.getAuthenticatorAssuranceLevel()]);
  return { factors: ((f.data?.totp ?? []) as Factor[]), level: a.data?.currentLevel ?? null, next: a.data?.nextLevel ?? null };
}
export async function startEnrol(): Promise<{ id: string; qr: string; secret: string }> {
  const client = db();
  // Clear out any half-finished set-up first, so a fresh code can be issued
  const existing = await client.auth.mfa.listFactors();
  for (const f of (existing.data?.all ?? []).filter((x) => x.status === "unverified")) await client.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) throw new Error(error?.message ?? "Could not start set-up");
  return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
export async function verifyCode(factorId: string, code: string) {
  const { error } = await db().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? "That code did not work. Codes change every 30 seconds; try the current one." : error.message);
}
export async function removeFactor(factorId: string) {
  const { error } = await db().auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}

// ---- Sign-in history and the audit log ----
export type SignIn = { full_name: string; email: string; at: string; method: string | null; user_agent: string | null };
export async function loadSignIns(organisationId: string): Promise<SignIn[] | null> {
  const { data, error } = await db().rpc("sign_in_history", { p_org: organisationId });
  return error ? null : (data as SignIn[]);
}
/** Records this sign-in once per browser session. Never blocks anything. */
export async function recordSignIn(accessToken: string, userId: string) {
  if (!supabase) return;
  const key = `veraphius-signin-${userId}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // no session storage: record anyway
  }
  let method = "session";
  try {
    const claims = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { amr?: { method: string }[] };
    const m = claims.amr?.map((x) => x.method) ?? [];
    method = m.includes("totp") ? "mfa" : m.includes("password") ? "password" : m.some((x) => x === "otp" || x === "magiclink") ? "link" : "session";
  } catch {
    // keep "session"
  }
  await supabase.rpc("record_sign_in", { p_method: method, p_user_agent: navigator.userAgent.slice(0, 300) }).then(
    () => undefined,
    () => undefined,
  );
}
export function describeAgent(ua: string | null) {
  if (!ua) return "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iPhone or iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export type AuditRow = { id: string; occurred_at: string; actor_user_id: string | null; action: string; table_name: string | null; record_id: string | null };
export async function loadAudit(organisationId: string, table: string, before: string | null): Promise<AuditRow[] | null> {
  let q = db().from("audit_log").select("id, occurred_at, actor_user_id, action, table_name, record_id").eq("organisation_id", organisationId).order("occurred_at", { ascending: false }).limit(100);
  if (table) q = q.eq("table_name", table);
  if (before) q = q.lt("occurred_at", before);
  const { data, error } = await q;
  return error ? null : (data as AuditRow[]);
}

// ---- Data and privacy ----
export type Hold = { id: string; name: string; matter_reference: string | null; reason: string | null; status: "active" | "released"; placed_at: string; released_at: string | null; scopes: { scope_type: string; subject_table: string | null }[] };
export type DeletionRequest = { id: string; subject_table: string; scope: string | null; reason: string | null; status: string; requested_at: string };
export type Retention = { id: string; name: string; applies_to: string; retain_days: number | null; requires_approval: boolean };
export async function loadRecordsControls(organisationId: string) {
  const client = db();
  const [holds, requests, retention] = await Promise.all([
    client.from("legal_holds").select("id, name, matter_reference, reason, status, placed_at, released_at, scopes:legal_hold_scopes(scope_type, subject_table)").eq("organisation_id", organisationId).order("placed_at", { ascending: false }),
    client.from("deletion_requests").select("id, subject_table, scope, reason, status, requested_at").eq("organisation_id", organisationId).order("requested_at", { ascending: false }).limit(100),
    client.from("retention_policies").select("id, name, applies_to, retain_days, requires_approval").eq("organisation_id", organisationId).order("name"),
  ]);
  return {
    holds: holds.error ? null : ((holds.data ?? []) as unknown as Hold[]),
    requests: requests.error ? null : ((requests.data ?? []) as DeletionRequest[]),
    retention: retention.error ? null : ((retention.data ?? []) as Retention[]),
  };
}
/** A hold over everything in the organisation: nothing can be deleted while it is active */
export async function placeOrgHold(organisationId: string, name: string, matter: string, reason: string) {
  const client = db();
  const hold = await client.from("legal_holds").insert({ organisation_id: organisationId, name: name.trim(), matter_reference: matter.trim() || null, reason: reason.trim() || null }).select("id").single();
  check(hold.error);
  check((await client.from("legal_hold_scopes").insert({ organisation_id: organisationId, legal_hold_id: hold.data!.id, scope_type: "organisation" })).error);
}
export async function releaseHold(id: string) {
  check((await db().from("legal_holds").update({ status: "released", released_at: new Date().toISOString() }).eq("id", id)).error);
}
export async function saveRetention(organisationId: string, r: { id?: string; name: string; applies_to: string; retain_days: number | null; requires_approval: boolean }) {
  const client = db();
  const row = { name: r.name.trim(), applies_to: r.applies_to.trim(), retain_days: r.retain_days, requires_approval: r.requires_approval };
  check((r.id ? await client.from("retention_policies").update(row).eq("id", r.id) : await client.from("retention_policies").insert({ organisation_id: organisationId, ...row })).error);
}

/** Every table that carries the organisation's records; the export reads each one the person is allowed to see */
const EXPORT_TABLES = [
  "entities", "entity_relationships", "people", "positions", "position_assignments", "officeholdings", "officer_details", "share_classes", "shareholders", "share_movements", "convertibles",
  "esop_plans", "esop_grants", "investor_consents", "ownership_terms", "register_entries", "register_assignments", "asic_filings", "annual_reviews", "corporate_documents", "bodies",
  "meetings", "agenda_items", "attendance", "resolutions", "minutes", "tasks", "reserved_matters", "delegation_rules", "powers_of_attorney", "auth_functions", "auth_bands", "auth_cells",
  "auth_versions", "auth_verticals", "authority_exceptions", "sign_groups", "sign_group_members", "sign_group_scopes", "insurance_policies", "key_employees", "ip_assets", "bank_accounts",
  "credit_facilities", "contracts", "contract_approvals", "contract_signatures", "counterparties", "dd_cases", "dd_checks", "dd_exemptions", "dd_mitigations", "disputes",
  "sanctions_assessments", "compliance_obligations", "obligation_completions", "policies", "policy_versions", "training_modules", "training_assignments", "training_people",
  "risk_categories", "risk_owners", "risk_reviews", "risk_items", "risk_item_updates", "ms_campaigns", "ms_statements", "ms_sections", "ms_supplier_reviews", "ms_concerns",
  "gift_types", "gift_entries", "conflict_declarations", "expense_claims", "expense_lines", "whs_hazards", "whs_incidents", "whs_due_diligence", "privacy_breaches",
  "personal_info_holdings", "automated_decisions", "abc_assessments", "abc_risks", "programme_profiles", "compliance_checks", "standard_form_contracts", "acquisitions",
  "legal_audits", "legal_audit_answers", "legal_audit_actions", "workflows", "workflow_steps", "workflow_runs", "documents", "document_versions", "document_links",
  "retention_policies", "legal_holds", "deletion_requests", "memberships", "invitations",
];
/** Reads everything this person may see into one JSON file. Files themselves are listed, not included. */
export async function exportAll(organisationId: string, onProgress: (done: number, total: number) => void): Promise<{ blob: Blob; tables: number; rows: number; skipped: string[] }> {
  const client = db();
  const out: Record<string, unknown[]> = {};
  const skipped: string[] = [];
  let rows = 0;
  let done = 0;
  for (const t of EXPORT_TABLES) {
    const all: unknown[] = [];
    let ok = true;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(t).select("*").eq("organisation_id", organisationId).range(from, from + 999);
      if (error) {
        ok = false;
        break;
      }
      all.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (ok) {
      out[t] = all;
      rows += all.length;
    } else skipped.push(t);
    onProgress(++done, EXPORT_TABLES.length);
  }
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), organisation_id: organisationId, note: "Files are listed in document_versions; download them from VeraPhius.", tables: out }, null, 2)], { type: "application/json" });
  return { blob, tables: Object.keys(out).length, rows, skipped };
}
