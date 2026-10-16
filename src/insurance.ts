import { supabase } from "./supabase";

// Insurance register (migration 0032).

export type Policy = {
  id: string;
  entity_id: string | null;
  policy_type: string;
  insurer: string | null;
  broker: string | null;
  policy_number: string | null;
  insured_name: string | null;
  limit_amount: number | null;
  limit_basis: string | null;
  excess_amount: number | null;
  currency: string;
  premium_amount: number | null;
  period_from: string | null;
  period_to: string;
  details: string | null;
  responsible_user_id: string | null;
  status: "current" | "renewed" | "lapsed" | "cancelled";
  previous_id: string | null;
  reminder3_sent_at: string | null;
  reminder2_sent_at: string | null;
  reminder1_sent_at: string | null;
  created_at: string;
};
export type PolicyValues = Omit<Policy, "id" | "status" | "previous_id" | "reminder3_sent_at" | "reminder2_sent_at" | "reminder1_sent_at" | "created_at">;
export type Contact = { id: string; full_name: string; email: string | null };

function db() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadInsurance(organisationId: string): Promise<{ policies: Policy[]; contacts: Contact[] }> {
  const client = db();
  const [policies, people] = await Promise.all([
    client.from("insurance_policies").select("*").eq("organisation_id", organisationId).order("period_to"),
    client.from("people").select("id, full_name, email").eq("organisation_id", organisationId),
  ]);
  check(policies.error ?? people.error);
  return {
    policies: ((policies.data ?? []) as Policy[]).map((p) => ({ ...p, limit_amount: num(p.limit_amount), excess_amount: num(p.excess_amount), premium_amount: num(p.premium_amount) })),
    contacts: (people.data ?? []) as Contact[],
  };
}

const tidy = (v: PolicyValues) => ({
  ...v,
  policy_type: v.policy_type.trim(),
  insurer: v.insurer?.trim() || null,
  broker: v.broker?.trim() || null,
  policy_number: v.policy_number?.trim() || null,
  insured_name: v.insured_name?.trim() || null,
  limit_basis: v.limit_basis?.trim() || null,
  details: v.details?.trim() || null,
  period_from: v.period_from || null,
});
export async function addPolicy(organisationId: string, v: PolicyValues): Promise<string> {
  const created = await db().from("insurance_policies").insert({ organisation_id: organisationId, ...tidy(v) }).select("id").single();
  check(created.error);
  return created.data!.id as string;
}
export async function updatePolicy(id: string, v: PolicyValues) {
  check((await db().from("insurance_policies").update(tidy(v)).eq("id", id)).error);
}
export async function setPolicyStatus(id: string, status: "lapsed" | "cancelled" | "current") {
  check((await db().from("insurance_policies").update({ status }).eq("id", id)).error);
}
export async function renewPolicy(id: string, from: string | null, to: string): Promise<string> {
  const { data, error } = await db().rpc("renew_insurance", { p_policy: id, p_from: from, p_to: to });
  check(error);
  return data as string;
}
export async function markReminderSent(id: string, months: number) {
  check((await db().rpc("mark_insurance_reminder_sent", { p_policy: id, p_months: months })).error);
}
export async function setPersonEmail(personId: string, email: string) {
  check((await db().from("people").update({ email: email.trim().toLowerCase() }).eq("id", personId)).error);
}

/** Stores a certificate of currency against a policy, with its fingerprint */
export async function attachCertificate(policyId: string, file: File) {
  const client = db();
  if (file.size > 10 * 1024 * 1024) throw new Error("Files can be up to 10 MB.");
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const registered = await client.rpc("attach_document", { p_table: "insurance_policies", p_id: policyId, p_file_name: file.name, p_mime: file.type, p_size: file.size, p_sha256: sha });
  check(registered.error);
  const { path, link_id } = registered.data as { path: string; link_id: string };
  const stored = await client.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) {
    await client.rpc("remove_attachment", { p_link: link_id });
    throw new Error(`The certificate could not be stored: ${stored.error.message}`);
  }
}

// ---- Dates and reminders ----
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function monthsBefore(isoDate: string, months: number) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1 - months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

/** The reminder due now for a current policy, if any: 3, 2 or 1 months before expiry, latest first */
export function reminderDue(p: Policy, today = todayIso()): 1 | 2 | 3 | null {
  if (p.status !== "current" || p.period_to < today) return null;
  if (today >= monthsBefore(p.period_to, 1) && !p.reminder1_sent_at) return 1;
  if (today >= monthsBefore(p.period_to, 2) && !p.reminder2_sent_at) return 2;
  if (today >= monthsBefore(p.period_to, 3) && !p.reminder3_sent_at) return 3;
  return null;
}
export type Standing = "expired" | "due" | "soon" | "ok" | "ended";
export function standing(p: Policy, today = todayIso()): Standing {
  if (p.status !== "current") return "ended";
  if (p.period_to < today) return "expired";
  if (today >= monthsBefore(p.period_to, 1)) return "due";
  if (today >= monthsBefore(p.period_to, 3)) return "soon";
  return "ok";
}

export const money = (n: number, currency = "AUD") =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
export const day = (isoDate: string) => new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
