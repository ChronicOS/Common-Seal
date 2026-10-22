import { supabase } from "./supabase";

/** Financial results for the board (migration 0069) */

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
const check = (e: { message: string } | null) => {
  if (e) throw new Error(/does not exist|schema cache|could not find/i.test(e.message) ? "Financial results need migration 0069 to be run in Supabase." : e.message);
};

export type Metric = { key: string; label: string; unit: "money" | "percent" | "number"; budget: boolean };
export type FinReport = {
  id: string; entity_id: string | null; name: string; frequency: string; first_period_start: string; due_days: number;
  preparer_person_id: string | null; currency: string; metrics: Metric[]; is_active: boolean;
};
export type Figure = { actual?: number | null; budget?: number | null };
export type FinPeriod = {
  id: string; report_id: string; period_start: string; period_end: string; due_on: string; status: "open" | "submitted" | "reviewed";
  figures: Record<string, Figure>; commentary: string | null; submitted_at: string | null; reviewed_at: string | null; review_note: string | null;
};
export type Preparer = { id: string; full_name: string; user_id: string | null };
export type FinData = { reports: FinReport[]; periods: FinPeriod[]; people: Preparer[] };

export const FREQUENCIES: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", annually: "Annually" };

export const DEFAULT_METRICS: Metric[] = [
  { key: "revenue", label: "Revenue", unit: "money", budget: true },
  { key: "expenses", label: "Expenses", unit: "money", budget: true },
  { key: "net_profit", label: "Net profit", unit: "money", budget: true },
  { key: "margin", label: "Margin", unit: "percent", budget: true },
  { key: "cash", label: "Cash at bank", unit: "money", budget: false },
  { key: "customers", label: "Customers", unit: "number", budget: true },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso: string) => new Date(`${iso}T00:00:00`);
/** "Sep 2026", "Q1 FY27 (Jul–Sep 2026)", "Week of 5 Oct 2026" ... */
export function periodLabel(p: { period_start: string; period_end: string }, frequency: string) {
  const s = d(p.period_start);
  const e = d(p.period_end);
  const my = (x: Date) => `${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
  if (frequency === "weekly") return `Week of ${s.getDate()} ${my(s)}`;
  if (frequency === "monthly") return my(s);
  if (frequency === "annually") return s.getMonth() === 0 ? `${s.getFullYear()}` : `FY${String(e.getFullYear()).slice(2)}`;
  return `${MONTHS[s.getMonth()]}–${my(e)}`;
}

export function fmt(v: number | null | undefined, unit: Metric["unit"], currency = "AUD") {
  if (v == null || Number.isNaN(v)) return "–";
  if (unit === "percent") return `${(v * 100).toFixed(1)}%`;
  if (unit === "number") return v.toLocaleString("en-AU", { maximumFractionDigits: 2 });
  const abs = Math.abs(v);
  const sym = currency === "AUD" ? "$" : `${currency} `;
  const short = abs >= 1e6 ? `${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}m` : abs >= 1e4 ? `${Math.round(abs / 1e3)}k` : abs.toLocaleString("en-AU", { maximumFractionDigits: 0 });
  return `${v < 0 ? "-" : ""}${sym}${short}`;
}

/** Above or below budget, where "good" depends on the measure (expenses under budget is good) */
export function variance(m: Metric, f: Figure | undefined): { text: string; good: boolean } | null {
  if (!f || f.actual == null || f.budget == null) return null;
  const diff = f.actual - f.budget;
  const costLike = /expense|cost|spend|churn/i.test(m.key + m.label);
  const good = costLike ? diff <= 0 : diff >= 0;
  if (m.unit === "percent") return { text: `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)} pts`, good };
  if (f.budget === 0) return { text: diff === 0 ? "on budget" : "no budget", good };
  return { text: `${diff >= 0 ? "+" : ""}${((diff / Math.abs(f.budget)) * 100).toFixed(0)}%`, good };
}

export async function loadFinance(organisationId: string): Promise<FinData> {
  const client = db();
  const r = await client.from("fin_reports").select("*").eq("organisation_id", organisationId).order("created_at");
  check(r.error);
  const reports = (r.data ?? []) as FinReport[];
  await Promise.all(reports.filter((x) => x.is_active !== false).map((x) => client.rpc("ensure_fin_periods", { p_report: x.id })));
  const [p, people] = await Promise.all([
    reports.length ? client.from("fin_periods").select("*").in("report_id", reports.map((x) => x.id)).order("period_start", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    client.from("people").select("id, full_name, user_id").eq("organisation_id", organisationId).not("user_id", "is", null).order("full_name"),
  ]);
  check(p.error);
  return { reports, periods: (p.data ?? []) as FinPeriod[], people: (people.data ?? []) as Preparer[] };
}

export async function saveReport(organisationId: string, r: Partial<FinReport> & { id?: string }) {
  const { id, ...rest } = r;
  const client = db();
  check((id ? await client.from("fin_reports").update(rest).eq("id", id) : await client.from("fin_reports").insert({ organisation_id: organisationId, ...rest })).error);
}

export async function savePeriod(id: string, figures: Record<string, Figure>, commentary: string, submit: boolean) {
  check((await db().rpc("save_fin_period", { p_period: id, p_figures: figures, p_commentary: commentary, p_submit: submit })).error);
}

export async function reviewPeriod(id: string, note: string) {
  check((await db().rpc("review_fin_period", { p_period: id, p_note: note })).error);
}

/** The start of the current financial year (1 July), for a sensible default */
export function fyStart() {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-07-01`;
}
