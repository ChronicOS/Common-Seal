import { supabase } from "./supabase";

// Compliance calendar (migration 0048): recurring obligations, plus every dated item from the other modules.

export type Frequency = "once" | "monthly" | "quarterly" | "half_yearly" | "annually";
export type Category = "corporate" | "tax" | "employment" | "financial_reporting" | "whs" | "privacy" | "environment" | "industry" | "governance" | "other";
export type Obligation = {
  id: string;
  entity_id: string | null;
  title: string;
  category: Category;
  regulator: string | null;
  law: string | null;
  frequency: Frequency;
  first_due_on: string;
  ends_on: string | null;
  due_rule: string | null;
  owner_user_id: string | null;
  template_key: string | null;
  notes: string | null;
  is_active: boolean;
};
export type ObligationValues = Omit<Obligation, "id">;
export type Completion = { id: string; obligation_id: string; due_on: string; done_on: string | null; not_applicable: boolean; notes: string | null };

export const CATEGORY_LABELS: Record<Category, string> = {
  corporate: "Corporate",
  tax: "Tax",
  employment: "Employment and payroll",
  financial_reporting: "Financial reporting",
  whs: "Work health and safety",
  privacy: "Privacy and cyber",
  environment: "Environment",
  industry: "Industry-specific",
  governance: "Governance",
  other: "Other",
};
export const FREQUENCY_LABELS: Record<Frequency, string> = { once: "Once", monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Every six months", annually: "Every year" };

/** Calendar item from any source */
export type Item = {
  key: string;
  date: string;
  title: string;
  area: string;
  tab: string;
  entityId: string | null;
  ownerId: string | null;
  obligation?: Obligation;
  completion?: Completion;
  done?: boolean;
};

// ---------------------------------------------------------------------
// Library of common Australian obligations. Dates are the usual ones for a
// 30 June financial year; each is editable, and the source is named so it
// can be checked.
// ---------------------------------------------------------------------
type Tpl = { title: string; md?: string; day?: number; frequency: Frequency; category: Category; regulator: string; law?: string; due_rule: string };
export type Template = { key: string; label: string; help: string; rows: Tpl[] };
export const LIBRARY: Template[] = [
  { key: "bas_quarterly", label: "BAS, quarterly", help: "Four lodgements a year if you lodge quarterly yourself. A tax agent may have later dates.", rows: [
    { title: "BAS: July to September quarter", md: "10-28", frequency: "annually", category: "tax", regulator: "ATO", due_rule: "28 October" },
    { title: "BAS: October to December quarter", md: "02-28", frequency: "annually", category: "tax", regulator: "ATO", due_rule: "28 February" },
    { title: "BAS: January to March quarter", md: "04-28", frequency: "annually", category: "tax", regulator: "ATO", due_rule: "28 April" },
    { title: "BAS: April to June quarter", md: "07-28", frequency: "annually", category: "tax", regulator: "ATO", due_rule: "28 July" },
  ] },
  { key: "bas_monthly", label: "BAS, monthly", help: "For monthly GST reporters and large PAYG withholders.", rows: [
    { title: "Monthly BAS", day: 21, frequency: "monthly", category: "tax", regulator: "ATO", due_rule: "21st of the following month" },
  ] },
  { key: "fbt", label: "FBT return", help: "Fringe benefits tax year ends 31 March.", rows: [
    { title: "FBT return and payment", md: "05-21", frequency: "annually", category: "tax", regulator: "ATO", law: "Fringe Benefits Tax Assessment Act 1986", due_rule: "21 May (later if lodged by a tax agent)" },
  ] },
  { key: "stp_final", label: "Payroll year-end (STP finalisation)", help: "Finalise Single Touch Payroll so employees' income statements are tax ready.", rows: [
    { title: "Single Touch Payroll finalisation", md: "07-14", frequency: "annually", category: "employment", regulator: "ATO", due_rule: "14 July" },
  ] },
  { key: "payday_super", label: "Payday super (from 1 July 2026)", help: "Super must be paid with each pay run. A monthly confirmation that every pay run included it.", rows: [
    { title: "Confirm super was paid with every pay run", day: 7, frequency: "monthly", category: "employment", regulator: "ATO", law: "Superannuation Guarantee (payday super)", due_rule: "Each month, for the month before" },
  ] },
  { key: "tpar", label: "Taxable payments annual report", help: "For businesses in industries that pay contractors (building, cleaning, courier, IT, security and others).", rows: [
    { title: "Taxable payments annual report (TPAR)", md: "08-28", frequency: "annually", category: "tax", regulator: "ATO", due_rule: "28 August" },
  ] },
  { key: "payroll_tax_nsw", label: "Payroll tax (NSW)", help: "Other states have similar dates; change the regulator if not NSW.", rows: [
    { title: "Payroll tax monthly return", day: 7, frequency: "monthly", category: "employment", regulator: "Revenue NSW", due_rule: "7th of the following month" },
    { title: "Payroll tax annual reconciliation", md: "07-28", frequency: "annually", category: "employment", regulator: "Revenue NSW", due_rule: "28 July" },
  ] },
  { key: "financial_report", label: "Annual financial report (large proprietary or public company)", help: "Lodged with ASIC within four months of year end (three for disclosing entities).", rows: [
    { title: "Annual financial report lodged with ASIC", md: "10-31", frequency: "annually", category: "financial_reporting", regulator: "ASIC", law: "Corporations Act 2001 Part 2M.3", due_rule: "Within 4 months of year end" },
  ] },
  { key: "agm", label: "AGM (public company)", help: "Within five months of year end.", rows: [
    { title: "Annual general meeting held", md: "11-30", frequency: "annually", category: "corporate", regulator: "ASIC", law: "Corporations Act 2001 s 250N", due_rule: "Within 5 months of year end" },
  ] },
  { key: "payment_times", label: "Payment Times report", help: "For large businesses (over $100 million turnover). Two reports a year.", rows: [
    { title: "Payment Times report: July to December", md: "03-31", frequency: "annually", category: "financial_reporting", regulator: "Payment Times Reporting Regulator", law: "Payment Times Reporting Act 2020", due_rule: "Within 3 months of each 6-month period" },
    { title: "Payment Times report: January to June", md: "09-30", frequency: "annually", category: "financial_reporting", regulator: "Payment Times Reporting Regulator", law: "Payment Times Reporting Act 2020", due_rule: "Within 3 months of each 6-month period" },
  ] },
  { key: "nger", label: "NGER report", help: "For corporations over the greenhouse and energy thresholds.", rows: [
    { title: "National Greenhouse and Energy Reporting report", md: "10-31", frequency: "annually", category: "environment", regulator: "Clean Energy Regulator", law: "National Greenhouse and Energy Reporting Act 2007", due_rule: "31 October" },
  ] },
  { key: "austrac", label: "AUSTRAC compliance report", help: "For AML/CTF reporting entities, including Tranche 2 businesses from 1 July 2026.", rows: [
    { title: "AUSTRAC annual compliance report", md: "03-31", frequency: "annually", category: "industry", regulator: "AUSTRAC", law: "Anti-Money Laundering and Counter-Terrorism Financing Act 2006", due_rule: "31 March" },
  ] },
  { key: "privacy_adm", label: "Privacy policy: automated decisions (10 Dec 2026)", help: "Privacy policies must describe automated decisions that significantly affect people.", rows: [
    { title: "Privacy policy updated for automated decision-making", md: "12-10", frequency: "once", category: "privacy", regulator: "OAIC", law: "Privacy Act 1988 APP 1.7 to 1.9", due_rule: "10 December 2026" },
  ] },
  { key: "privacy_review", label: "Privacy policy review", help: "A yearly check that the privacy policy matches practice.", rows: [
    { title: "Privacy policy reviewed", md: "06-30", frequency: "annually", category: "privacy", regulator: "OAIC", law: "Privacy Act 1988 APP 1", due_rule: "Yearly" },
  ] },
  { key: "whs_board", label: "WHS report to the board", help: "Evidence of officers' due diligence under the WHS Act.", rows: [
    { title: "WHS report to the board", md: "09-30", frequency: "quarterly", category: "whs", regulator: "SafeWork", law: "Work Health and Safety Act s 27", due_rule: "Each quarter" },
  ] },
  { key: "board_eval", label: "Board evaluation", help: "A yearly review of the board's performance.", rows: [
    { title: "Board evaluation", md: "06-30", frequency: "annually", category: "governance", regulator: "Board", due_rule: "Yearly" },
  ] },
];

/** The next date on or after today for a month-day, or a day of the month */
export function nextDate(today: string, tpl: { md?: string; day?: number; frequency: Frequency }): string {
  if (tpl.day) {
    const [y, m] = today.split("-").map(Number);
    const thisMonth = `${y}-${String(m).padStart(2, "0")}-${String(tpl.day).padStart(2, "0")}`;
    if (thisMonth >= today) return thisMonth;
    const nm = m === 12 ? 1 : m + 1;
    return `${m === 12 ? y + 1 : y}-${String(nm).padStart(2, "0")}-${String(tpl.day).padStart(2, "0")}`;
  }
  const y = Number(today.slice(0, 4));
  const d = `${y}-${tpl.md}`;
  if (tpl.frequency === "quarterly") {
    // The next quarter-end-style date on or after today, from the template's month and day
    for (let i = -3; i < 12; i += 3) {
      const dt = new Date(`${d}T12:00:00`);
      dt.setMonth(dt.getMonth() + i);
      const iso = dt.toISOString().slice(0, 10);
      if (iso >= today) return iso;
    }
  }
  return d >= today ? d : `${y + 1}-${tpl.md}`;
}

/** Every due date from the first up to a date */
export function dueDates(o: Pick<Obligation, "first_due_on" | "frequency" | "ends_on">, upto: string): string[] {
  const out: string[] = [];
  const step = { once: 0, monthly: 1, quarterly: 3, half_yearly: 6, annually: 12 }[o.frequency];
  const start = new Date(`${o.first_due_on}T12:00:00`);
  for (let i = 0; i < 400; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i * step);
    // Keep month-end dates at month end (31 Oct then 31 Jan, not 3 Feb)
    if (d.getDate() !== start.getDate()) d.setDate(0);
    const iso = d.toISOString().slice(0, 10);
    if (iso > upto || (o.ends_on && iso > o.ends_on)) break;
    out.push(iso);
    if (step === 0) break;
  }
  return out;
}

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function saveObligation(organisationId: string, id: string | null, v: ObligationValues) {
  const values = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));
  if (id) check((await db().from("compliance_obligations").update(values).eq("id", id)).error);
  else check((await db().from("compliance_obligations").insert({ ...values, organisation_id: organisationId })).error);
}
export async function addFromTemplate(organisationId: string, t: Template, entityId: string | null, ownerId: string | null, today: string) {
  const rows = t.rows.map((r) => ({
    organisation_id: organisationId, entity_id: entityId, title: r.title, category: r.category, regulator: r.regulator, law: r.law ?? null,
    frequency: r.frequency, first_due_on: nextDate(today, r), due_rule: r.due_rule, owner_user_id: ownerId, template_key: t.key,
  }));
  check((await db().from("compliance_obligations").insert(rows)).error);
}
export async function completeObligation(organisationId: string, obligationId: string, dueOn: string, v: { done_on: string | null; not_applicable: boolean; notes: string | null }) {
  const { data, error } = await db().from("obligation_completions").insert({ organisation_id: organisationId, obligation_id: obligationId, due_on: dueOn, ...v }).select("id").single();
  check(error);
  return data!.id as string;
}

// ---------------------------------------------------------------------
// Gather every dated item across the modules. A module that is not set up,
// or not visible to this person, is simply left out.
// ---------------------------------------------------------------------
export type CalendarData = { ready: boolean; items: Item[]; obligations: Obligation[]; completions: Completion[]; people: { user_id: string | null; full_name: string }[]; missing: string[] };

const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

export async function loadCalendar(organisationId: string, today: string): Promise<CalendarData> {
  const c = db();
  const horizon = addMonths(today, 12);
  const from = addMonths(today, -24);
  const items: Item[] = [];
  const missing: string[] = [];
  const add = (i: Item) => {
    if (i.date && i.date <= horizon) items.push(i);
  };
  const safely = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      missing.push(label);
    }
  };
  const q = async <T,>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const r = await p;
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? []) as T[];
  };

  let obligations: Obligation[] = [];
  let completions: Completion[] = [];
  let ready = true;
  const [obl, comp, people] = await Promise.all([
    c.from("compliance_obligations").select("*").eq("organisation_id", organisationId).order("title"),
    c.from("obligation_completions").select("*").eq("organisation_id", organisationId),
    c.from("people").select("user_id, full_name").eq("organisation_id", organisationId),
  ]);
  if (obl.error) ready = false;
  else {
    obligations = (obl.data ?? []) as Obligation[];
    completions = (comp.data ?? []) as Completion[];
    for (const o of obligations.filter((x) => x.is_active)) {
      for (const d of dueDates(o, horizon)) {
        if (d < from) continue;
        const done = completions.find((x) => x.obligation_id === o.id && x.due_on === d);
        add({ key: `ob-${o.id}-${d}`, date: d, title: o.title, area: CATEGORY_LABELS[o.category], tab: "calendar", entityId: o.entity_id, ownerId: o.owner_user_id, obligation: o, completion: done, done: Boolean(done) });
      }
    }
  }

  await Promise.all([
    safely("ASIC filings", async () => {
      for (const f of await q<{ id: string; entity_id: string; title: string; form: string; due_on: string }>(c.from("asic_filings").select("id, entity_id, title, form, due_on").eq("organisation_id", organisationId).eq("status", "to_lodge")))
        add({ key: `af-${f.id}`, date: f.due_on, title: `ASIC Form ${f.form}: ${f.title}`, area: "Company register", tab: "companyregister", entityId: f.entity_id, ownerId: null });
      for (const m of await q<{ id: string; entity_id: string; kind: string; asic_due_on: string }>(c.from("share_movements").select("id, entity_id, kind, asic_due_on").eq("organisation_id", organisationId).is("voided_at", null).is("asic_lodged_on", null).not("asic_due_on", "is", null)))
        add({ key: `sm-${m.id}`, date: m.asic_due_on, title: `ASIC Form 484: ${m.kind.replace("_", "-")} of shares`, area: "Company register", tab: "companyregister", entityId: m.entity_id, ownerId: null });
    }),
    safely("Annual reviews", async () => {
      const ents = await q<{ id: string; name: string; incorporated_on: string | null; legal_form: string | null; jurisdiction: string | null; status: string }>(c.from("entities").select("id, name, incorporated_on, legal_form, jurisdiction, status").eq("organisation_id", organisationId));
      const reviews = await q<{ entity_id: string; review_date: string; fee_paid_on: string | null; solvency_resolution_on: string | null; financial_report_lodged: boolean }>(c.from("annual_reviews").select("entity_id, review_date, fee_paid_on, solvency_resolution_on, financial_report_lodged").eq("organisation_id", organisationId));
      for (const e of ents.filter((x) => x.incorporated_on && x.status !== "deregistered" && (x.jurisdiction ?? "AU").toUpperCase().startsWith("AU") && (!x.legal_form || ["proprietary_company", "public_company"].includes(x.legal_form)))) {
        const [, m, d] = e.incorporated_on!.split("-");
        for (const y of [Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
          const rd = `${y}-${m}-${d === "29" && m === "02" ? "28" : d}`;
          if (rd <= e.incorporated_on!) continue;
          const r = reviews.find((x) => x.entity_id === e.id && x.review_date === rd);
          const due = addMonths(rd, 2);
          if (rd >= from) add({ key: `ar-${e.id}-${rd}`, date: rd, title: `Annual review date: ${e.name}`, area: "Company register", tab: "companyregister", entityId: e.id, ownerId: null, done: rd <= today });
          add({ key: `arf-${e.id}-${rd}`, date: due, title: `ASIC annual review fee and solvency resolution: ${e.name}`, area: "Company register", tab: "companyregister", entityId: e.id, ownerId: null, done: Boolean(r?.fee_paid_on && (r.solvency_resolution_on || r.financial_report_lodged)) });
        }
      }
    }),
    safely("Employee share schemes", async () => {
      const grants = await q<{ entity_id: string; granted_on: string; instrument: string }>(c.from("esop_grants").select("entity_id, granted_on, instrument").eq("organisation_id", organisationId));
      const ess = await q<{ entity_id: string; fy_end: number; statements_given_on: string | null; ato_lodged_on: string | null }>(c.from("ess_reports").select("entity_id, fy_end, statements_given_on, ato_lodged_on").eq("organisation_id", organisationId));
      const years = new Set(grants.filter((g) => g.instrument !== "unit").map((g) => `${g.entity_id}|${Number(g.granted_on.slice(5, 7)) >= 7 ? Number(g.granted_on.slice(0, 4)) + 1 : Number(g.granted_on.slice(0, 4))}`));
      for (const k of years) {
        const [eid, fy] = k.split("|");
        const r = ess.find((x) => x.entity_id === eid && x.fy_end === Number(fy));
        add({ key: `esss-${k}`, date: `${fy}-07-14`, title: `Employee share scheme statements (year to June ${fy})`, area: "Ownership", tab: "ownership", entityId: eid, ownerId: null, done: Boolean(r?.statements_given_on) });
        add({ key: `essa-${k}`, date: `${fy}-08-14`, title: `Employee share scheme report to the ATO (year to June ${fy})`, area: "Ownership", tab: "ownership", entityId: eid, ownerId: null, done: Boolean(r?.ato_lodged_on) });
      }
    }),
    safely("Insurance", async () => {
      for (const p of await q<{ id: string; entity_id: string | null; policy_type: string; period_to: string; responsible_user_id: string | null }>(c.from("insurance_policies").select("id, entity_id, policy_type, period_to, responsible_user_id").eq("organisation_id", organisationId).eq("status", "current")))
        add({ key: `ins-${p.id}`, date: p.period_to, title: `Insurance renewal: ${p.policy_type}`, area: "Insurance", tab: "insurance", entityId: p.entity_id, ownerId: p.responsible_user_id });
    }),
    safely("IP Register", async () => {
      for (const a of await q<{ id: string; owner_entity_id: string | null; name: string; kind: string; expires_on: string; responsible_user_id: string | null }>(c.from("ip_assets").select("id, owner_entity_id, name, kind, expires_on, responsible_user_id").eq("organisation_id", organisationId).in("status", ["pending", "registered", "active", "opposed"]).not("expires_on", "is", null)))
        add({ key: `ip-${a.id}`, date: a.expires_on, title: `IP renewal: ${a.name}`, area: "IP Register", tab: "ip", entityId: a.owner_entity_id, ownerId: a.responsible_user_id });
    }),
    safely("Finance details", async () => {
      for (const f of await q<{ id: string; entity_id: string; lender: string; kind: string; maturity_on: string | null; review_on: string | null; next_covenant_test_on: string | null }>(c.from("credit_facilities").select("id, entity_id, lender, kind, maturity_on, review_on, next_covenant_test_on").eq("organisation_id", organisationId).eq("status", "active"))) {
        const what = `${f.lender} ${f.kind.replace("_", " ")}`;
        if (f.maturity_on) add({ key: `fm-${f.id}`, date: f.maturity_on, title: `Facility matures: ${what}`, area: "Finance", tab: "company", entityId: f.entity_id, ownerId: null });
        if (f.review_on) add({ key: `fr-${f.id}`, date: f.review_on, title: `Facility review: ${what}`, area: "Finance", tab: "company", entityId: f.entity_id, ownerId: null });
        if (f.next_covenant_test_on) add({ key: `fc-${f.id}`, date: f.next_covenant_test_on, title: `Covenant test: ${what}`, area: "Finance", tab: "company", entityId: f.entity_id, ownerId: null });
      }
    }),
    safely("Contracts", async () => {
      for (const k of await q<{ id: string; entity_id: string; title: string; notice_by: string }>(c.from("contracts").select("id, entity_id, title, notice_by").eq("organisation_id", organisationId).eq("status", "signed").not("notice_by", "is", null)))
        add({ key: `ct-${k.id}`, date: k.notice_by, title: `Last day for notice: ${k.title}`, area: "Contracts", tab: "contracts", entityId: k.entity_id, ownerId: null });
    }),
    safely("Sanctions", async () => {
      for (const s of await q<{ id: string; entity_id: string | null; subject_name: string; next_screen_on: string | null; licence_expires_on: string | null }>(c.from("sanctions_assessments").select("id, entity_id, subject_name, next_screen_on, licence_expires_on").eq("organisation_id", organisationId).eq("status", "decided"))) {
        if (s.next_screen_on) add({ key: `sn-${s.id}`, date: s.next_screen_on, title: `Sanctions re-screen: ${s.subject_name}`, area: "Sanctions", tab: "sanctions", entityId: s.entity_id, ownerId: null });
        if (s.licence_expires_on) add({ key: `sl-${s.id}`, date: s.licence_expires_on, title: `Sanctions permit expires: ${s.subject_name}`, area: "Sanctions", tab: "sanctions", entityId: s.entity_id, ownerId: null });
      }
    }),
    safely("Policies", async () => {
      for (const p of await q<{ id: string; title: string; next_review_on: string; owner_user_id: string | null }>(c.from("policies").select("id, title, next_review_on, owner_user_id").eq("organisation_id", organisationId).eq("is_retired", false).not("next_review_on", "is", null)))
        add({ key: `po-${p.id}`, date: p.next_review_on, title: `Policy review: ${p.title}`, area: "Policies", tab: "policies", entityId: null, ownerId: p.owner_user_id });
    }),
    safely("Modern slavery", async () => {
      for (const s of await q<{ id: string; reporting_entity_id: string | null; due_on: string; lodged_on: string | null; period_end: string }>(c.from("ms_statements").select("id, reporting_entity_id, due_on, lodged_on, period_end").eq("organisation_id", organisationId).not("due_on", "is", null)))
        add({ key: `ms-${s.id}`, date: s.due_on, title: `Modern slavery statement lodged (period to ${s.period_end})`, area: "Modern slavery", tab: "modernslavery", entityId: s.reporting_entity_id, ownerId: null, done: Boolean(s.lodged_on) });
    }),
    safely("Legal Audit", async () => {
      for (const a of await q<{ id: string; action: string; due_on: string }>(c.from("legal_audit_actions").select("id, action, due_on").eq("organisation_id", organisationId).is("done_at", null).not("due_on", "is", null)))
        add({ key: `la-${a.id}`, date: a.due_on, title: `Legal audit action: ${a.action}`, area: "Legal Audit", tab: "legalaudit", entityId: null, ownerId: null });
    }),
    safely("Risk reviews", async () => {
      for (const r of await q<{ id: string; name: string; forum_on: string; status: string }>(c.from("risk_reviews").select("id, name, forum_on, status").eq("organisation_id", organisationId).neq("status", "final")))
        add({ key: `rr-${r.id}`, date: r.forum_on, title: `Risk report to forum: ${r.name}`, area: "Risk Register", tab: "register", entityId: null, ownerId: null });
    }),
    safely("Conflicts", async () => {
      for (const k of await q<{ id: string; person_name: string; review_on: string; entity_id: string | null }>(c.from("conflict_declarations").select("id, person_name, review_on, entity_id").eq("organisation_id", organisationId).neq("status", "closed").not("review_on", "is", null)))
        add({ key: `cf-${k.id}`, date: k.review_on, title: `Conflict review: ${k.person_name}`, area: "Conflicts", tab: "conflicts", entityId: k.entity_id, ownerId: null });
    }),
    safely("Disputes", async () => {
      for (const d of await q<{ id: string; title: string; next_date: string; next_step: string | null; entity_id: string | null; owner_user_id: string | null }>(c.from("disputes").select("id, title, next_date, next_step, entity_id, owner_user_id").eq("organisation_id", organisationId).eq("status", "open").not("next_date", "is", null)))
        add({ key: `ds-${d.id}`, date: d.next_date, title: `Dispute: ${d.title}${d.next_step ? ` (${d.next_step})` : ""}`, area: "Disputes", tab: "disputes", entityId: d.entity_id, ownerId: d.owner_user_id });
    }),
    safely("Powers of attorney", async () => {
      for (const p of await q<{ id: string; attorney_name: string; expires_on: string; entity_id: string }>(c.from("powers_of_attorney").select("id, attorney_name, expires_on, entity_id").eq("organisation_id", organisationId).is("revoked_on", null).not("expires_on", "is", null)))
        add({ key: `poa-${p.id}`, date: p.expires_on, title: `Power of attorney expires: ${p.attorney_name}`, area: "Authorities", tab: "authorities", entityId: p.entity_id, ownerId: null });
    }),
    safely("Meetings", async () => {
      for (const m of await q<{ id: string; title: string; scheduled_at: string; status: string }>(c.from("meetings").select("id, title, scheduled_at, status").eq("organisation_id", organisationId).eq("status", "scheduled")))
        add({ key: `mt-${m.id}`, date: m.scheduled_at.slice(0, 10), title: `Meeting: ${m.title}`, area: "Meetings", tab: "meetings", entityId: null, ownerId: null });
    }),
  ]);

  items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { ready, items, obligations, completions, people: (people.data ?? []) as CalendarData["people"], missing };
}

/** An iCalendar file of the items, so they can be added to Outlook or Google Calendar */
export function toIcs(items: Item[], orgName: string): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VeraPhius//Compliance calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(`${orgName} compliance`)}`];
  for (const i of items) {
    const d = i.date.replace(/-/g, "");
    const next = new Date(`${i.date}T12:00:00`);
    next.setDate(next.getDate() + 1);
    lines.push("BEGIN:VEVENT", `UID:${i.key}@veraphius.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${esc(i.title)}`, `DESCRIPTION:${esc(`${i.area}. From VeraPhius.`)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
