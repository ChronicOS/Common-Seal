// Screens a third party (an organisation or an individual) against sanctions, politically exposed
// persons and other watch lists through Dilisense (migration 0061).
//
// Called from the Due Diligence page by a signed-in person (Verify JWT stays ON for this function).
// Their own token is used to check they may screen this party; the result is then recorded with the
// service role, so a result can only ever come from a real search.
//
// Secrets (Supabase → Edge Functions → Secrets). Never in chat:
//   DILISENSE_API_KEY   the key from the Dilisense dashboard
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
// Actions (POST, JSON body):
//   { "action": "status" }                              is screening set up; this month's usage (free call)
//   { "action": "screen", "party_id": "…", "fuzzy": true } run a search and record it
//   { "action": "report", "screening_id": "…" }         the provider's PDF report for an earlier search (one paid call)

import { createClient } from "npm:@supabase/supabase-js@2";

const API = Deno.env.get("DILISENSE_BASE_URL") ?? "https://api.dilisense.com/v1";
const MAX_HITS = 50;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Target = { organisation_id: string; counterparty_id: string; name: string; subject_type: "entity" | "individual"; date_of_birth: string | null; gender: string | null; citizenship: string | null };

/** Dilisense wants dd/mm/yyyy */
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const first = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : v);

/** Keeps what a reviewer needs to decide, and no more */
function trim(r: Record<string, unknown>) {
  const keep: Record<string, unknown> = {};
  for (const k of ["id", "source_id", "source_type", "pep_type", "pep_level", "entity_type", "name", "gender", "list_date", "jurisdiction", "company_number"]) if (r[k] != null) keep[k] = r[k];
  for (const [k, n] of [["alias_names", 10], ["date_of_birth", 5], ["place_of_birth", 3], ["citizenship", 5], ["positions", 5], ["sanction_details", 5], ["description", 3], ["address", 3], ["links", 3], ["political_parties", 3]] as const)
    if (r[k] != null) keep[k] = first(r[k], n);
  keep.id = String(r.id ?? r.source_id ?? crypto.randomUUID());
  return keep;
}

function query(t: Target, fuzzy: boolean) {
  const q: Record<string, string> = { names: t.name.trim() };
  if (fuzzy) q.fuzzy_search = "1";
  if (t.subject_type === "individual") {
    // Records without a date of birth or gender are still returned, so these narrow the list without hiding anyone.
    // Citizenship is deliberately not sent: it could hide a listed person recorded under another citizenship.
    if (t.date_of_birth) q.dob = dmy(t.date_of_birth);
    if (t.gender) q.gender = t.gender;
  }
  return q;
}

async function dilisense(path: string, params: Record<string, string>, key: string) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { "x-api-key": key } });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 200);
    try {
      message = (JSON.parse(text) as { error_message?: string }).error_message ?? message;
    } catch {
      // not JSON
    }
    const plain =
      res.status === 401 || res.status === 403 ? "The screening service did not accept the API key. Check DILISENSE_API_KEY in Supabase."
      : res.status === 429 ? "The screening service's limit has been reached. Try again later, or check the plan's monthly quota."
      : res.status >= 500 ? "The screening service is not available right now. Try again in a few minutes."
      : `The screening service could not run this search: ${message}`;
    throw new Error(plain);
  }
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const asServer = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return reply({ error: "Sign in again." }, 401);
  const key = Deno.env.get("DILISENSE_API_KEY");
  let body: { action?: string; party_id?: string; screening_id?: string; fuzzy?: boolean };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Bad request" }, 400);
  }

  try {
    if (body.action === "status") {
      if (!key) return reply({ configured: false });
      const usage = JSON.parse(await dilisense("usage", {}, key)) as { summary?: Record<string, unknown> };
      return reply({ configured: true, provider: "Dilisense", usage: usage.summary ?? null });
    }
    if (!key) return reply({ error: "Screening is not set up yet. Add DILISENSE_API_KEY in Supabase (see the README)." }, 503);

    if (body.action === "screen") {
      const target = await asUser.rpc("dd_screening_target", { p_party: body.party_id });
      if (target.error || !target.data) return reply({ error: "You cannot screen this party." }, 403);
      const t = target.data as Target;
      const q = query(t, body.fuzzy !== false);
      const raw = JSON.parse(await dilisense(t.subject_type === "individual" ? "checkIndividual" : "checkEntity", q, key)) as { total_hits?: number; found_records?: Record<string, unknown>[] };
      const records = (raw.found_records ?? []).slice(0, MAX_HITS).map(trim);
      const total = Number(raw.total_hits ?? records.length);
      const saved = await asServer.rpc("record_dd_screening", { p_party: t.counterparty_id, p_user: who.user.id, p_query: { ...q, endpoint: t.subject_type === "individual" ? "checkIndividual" : "checkEntity", shown: records.length }, p_total: total, p_hits: records });
      if (saved.error) throw new Error(`Searched, but the result could not be saved: ${saved.error.message}`);
      return reply({ screening_id: saved.data, total_hits: total, shown: records.length });
    }

    if (body.action === "report") {
      const target = await asUser.rpc("dd_screening_report_target", { p_screening: body.screening_id });
      if (target.error || !target.data) return reply({ error: "You cannot get this report." }, 403);
      const r = target.data as { subject_type: string; query: Record<string, string> };
      const params: Record<string, string> = {};
      for (const k of ["names", "fuzzy_search", "dob", "gender"]) if (r.query[k]) params[k] = r.query[k];
      const pdf = await dilisense(r.subject_type === "individual" ? "generateIndividualReport" : "generateEntityReport", params, key);
      return reply({ pdf_base64: pdf.replace(/^"|"$/g, "") });
    }
    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : "Screening failed" }, 502);
  }
});
