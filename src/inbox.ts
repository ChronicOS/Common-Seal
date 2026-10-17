import { loadConflictOfficer, loadConflicts } from "./conflicts";
import { loadInsurance, reminderDue, standing } from "./insurance";
import { has } from "./roles";
import { loadContracts } from "./contracts";
import { loadDeclarations, loadGiftSetup } from "./declarations";
import { loadExpenses } from "./expenses";
import { loadPolicies } from "./policies";
import { loadSpeakUp } from "./speakup";
import { isOverdue, loadTraining, today } from "./training";
import { loadWorkflows } from "./workflows";
import { supabase } from "./supabase";

export type InboxItem = { key: string; tab: string; kind: string; title: string; due: string | null; overdue: boolean };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const soon = (iso: string | null, days: number) => {
  if (!iso) return false;
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  return new Date(iso) <= limit;
};

/**
 * Everything waiting on the signed-in person, gathered from each module.
 * A module whose migration has not been run is skipped without failing the rest.
 */
export async function loadInbox(organisationId: string, role: string, userId: string): Promise<InboxItem[]> {
  const manage = has(role, ...MANAGE_ROLES);
  const t = today();
  const items: InboxItem[] = [];
  const add = (tab: string, kind: string, id: string, title: string, due: string | null) =>
    items.push({ key: `${tab}-${id}`, tab, kind, title, due, overdue: Boolean(due && due.slice(0, 10) < t) });
  const safely = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      // That module is not set up yet
    }
  };

  await Promise.all([
    safely(async () => {
      const off = await loadConflictOfficer(organisationId);
      if (!off.ready) return;
      const mine = off.officer === userId;
      if (!mine && !manage) return;
      for (const c of await loadConflicts(organisationId)) {
        if (c.status === "closed" || c.person_user_id === userId) continue;
        if (!mine && off.officer && off.officer !== c.person_user_id) continue;
        if (!c.outcome) add("conflicts", "Conflict of interest to review", c.id, `${c.person_name}: ${c.description}`, null);
        else if (c.outcome === "not_acceptable" && !c.action_complete_at) add("conflicts", "Conflict: confirm the action is complete", c.id, `${c.person_name}: ${c.outcome_actions.join("; ")}`, c.review_on);
      }
    }),
    safely(async () => {
      const d = await loadInsurance(organisationId);
      for (const p of d.policies.filter((x) => x.status === "current")) {
        if (!manage && p.responsible_user_id !== userId) continue;
        if (standing(p) === "expired") add("insurance", "Insurance expired: record the renewal", p.id, p.policy_type, p.period_to);
        else {
          const m = reminderDue(p);
          if (m) add("insurance", `Insurance renewal reminder (${m} ${m === 1 ? "month" : "months"})`, p.id, p.policy_type, p.period_to);
        }
      }
    }),
    safely(async () => {
      const d = await loadTraining(organisationId);
      for (const a of d.assignments.filter((x) => x.user_id === userId && !x.completed_at)) {
        const m = d.modules.find((x) => x.id === a.module_id);
        if (m) items.push({ key: `training-${a.id}`, tab: "training", kind: "Training to complete", title: m.title, due: a.due_on, overdue: isOverdue(a) });
      }
    }),
    safely(async () => {
      const d = await loadWorkflows(organisationId);
      for (const s of d.runSteps.filter((x) => x.status === "open" && (manage ? x.assignee_role === null || has(role, x.assignee_role) : has(role, x.assignee_role)))) {
        const run = d.runs.find((r) => r.id === s.run_id);
        add("workflows", "Workflow step", s.id, `${run?.subject ?? "Workflow"}: ${s.title}`, s.due_on);
      }
    }),
    safely(async () => {
      const d = await loadExpenses(organisationId);
      for (const c of d.claims) {
        if (manage && c.status === "submitted" && c.claimant_user_id !== userId) add("expenses", "Expense claim to decide", c.id, `${c.claimant_name}: ${c.purpose}`, null);
        if (c.claimant_user_id === userId && c.status === "rejected") add("expenses", "Your claim was rejected", c.id, c.purpose, null);
      }
    }),
    safely(async () => {
      const d = await loadPolicies(organisationId);
      for (const p of d.policies.filter((x) => !x.is_retired)) {
        const draft = d.versions.find((v) => v.policy_id === p.id && v.status === "draft");
        if (p.owner_user_id === userId && soon(p.next_review_on, 30)) add("policies", "Policy review", p.id, p.title, p.next_review_on);
        if (manage && draft && draft.content.trim().length >= 50) add("policies", "Policy draft to approve", `d-${p.id}`, p.title, null);
      }
    }),
    safely(async () => {
      const setup = manage ? null : await loadGiftSetup(organisationId);
      if (!manage && setup?.responsible_user_id !== userId) return;
      const d = await loadDeclarations(organisationId);
      for (const g of d.gifts.filter((x) => x.status === "pending" && x.declared_by !== userId)) add("declarations", "Gift or hospitality to decide", g.id, `${g.staff_name}: ${g.description}`, null);
    }),
    safely(async () => {
      const d = await loadSpeakUp(organisationId);
      for (const c of d.cases.filter((x) => x.status === "new")) add("speakup", "New speak-up report", c.id, c.reference, null);
    }),
    safely(async () => {
      if (!manage) return;
      const d = await loadContracts(organisationId);
      for (const a of d.approvals.filter((x) => x.status === "pending")) {
        const c = d.contracts.find((x) => x.id === a.contract_id);
        if (c && c.status === "pending_approval") add("contracts", "Contract approval to record", a.id, `${c.title} (${a.required_holder})`, null);
      }
    }),
    safely(async () => {
      if (!supabase) return;
      // The report owner and backups are told when a risk review is waiting for them
      const owners = await supabase.from("risk_owners").select("user_id").eq("organisation_id", organisationId).eq("user_id", userId);
      if (owners.error || (owners.data ?? []).length === 0) return;
      const { data, error } = await supabase.from("risk_reviews").select("id, name, forum_on, escalate_on, status").eq("organisation_id", organisationId).eq("status", "collecting");
      if (error) return;
      for (const r of (data ?? []) as { id: string; name: string; forum_on: string; escalate_on: string }[]) {
        if (r.escalate_on <= t) add("register", "Risk report to review and finalise", r.id, r.name, r.forum_on);
      }
    }),    safely(async () => {
      // Compliance calendar: recurring obligations I own (or any, for managers) due within 14 days or overdue
      if (!supabase) return;
      const [obs, comps] = await Promise.all([
        supabase.from("compliance_obligations").select("*").eq("organisation_id", organisationId).eq("is_active", true),
        supabase.from("obligation_completions").select("obligation_id, due_on").eq("organisation_id", organisationId),
      ]);
      if (obs.error) return;
      const { dueDates } = await import("./calendar");
      const limit = new Date();
      limit.setDate(limit.getDate() + 14);
      const upto = limit.toISOString().slice(0, 10);
      const past = new Date();
      past.setFullYear(past.getFullYear() - 2);
      for (const o of (obs.data ?? []) as import("./calendar").Obligation[]) {
        if (o.owner_user_id !== userId && !(manage && !o.owner_user_id)) continue;
        for (const d of dueDates(o, upto)) {
          if (d < past.toISOString().slice(0, 10)) continue;
          if (((comps.data ?? []) as { obligation_id: string; due_on: string }[]).some((x) => x.obligation_id === o.id && x.due_on === d)) continue;
          add("calendar", o.owner_user_id ? "Compliance obligation due" : "Compliance obligation with no owner", `${o.id}-${d}`, o.title, d);
        }
      }
    }),
    safely(async () => {
      // Work health and safety: incidents to assess, notifiable incidents not notified, overdue actions, hazard reviews
      if (!supabase || !manage) return;
      const [inc, haz] = await Promise.all([
        supabase.from("whs_incidents").select("id, occurred_at, kind, location, notifiable, regulator_notified_at, actions_due_on, actions_done_on, status").eq("organisation_id", organisationId).eq("status", "open"),
        supabase.from("whs_hazards").select("id, title, review_on, owner_user_id").eq("organisation_id", organisationId).eq("status", "active"),
      ]);
      if (inc.error) return;
      for (const i of (inc.data ?? []) as { id: string; occurred_at: string; kind: string; location: string | null; notifiable: boolean | null; regulator_notified_at: string | null; actions_due_on: string | null; actions_done_on: string | null }[]) {
        const what = `${i.kind.replace("_", " ")}${i.location ? `, ${i.location}` : ""}`;
        if (i.notifiable === null) add("whs", "WHS incident: decide whether it is notifiable", `a-${i.id}`, what, i.occurred_at.slice(0, 10));
        else if (i.notifiable && !i.regulator_notified_at) add("whs", "Notifiable incident: tell the regulator now", `n-${i.id}`, what, i.occurred_at.slice(0, 10));
        if (!i.actions_done_on && soon(i.actions_due_on, 7)) add("whs", "WHS corrective actions due", `c-${i.id}`, what, i.actions_due_on);
      }
      for (const h of (haz.data ?? []) as { id: string; title: string; review_on: string | null; owner_user_id: string | null }[]) {
        if ((h.owner_user_id === userId || !h.owner_user_id) && soon(h.review_on, 14)) add("whs", "Hazard review due", h.id, h.title, h.review_on);
      }
    }),
    safely(async () => {
      // Company register: changes to check, and ASIC filings due within 14 days or overdue
      if (!supabase || !manage) return;
      const [filings, ents] = await Promise.all([
        supabase.from("asic_filings").select("id, entity_id, form, title, status, due_on").eq("organisation_id", organisationId).in("status", ["to_check", "to_lodge"]),
        supabase.from("entities").select("id, name").eq("organisation_id", organisationId),
      ]);
      if (filings.error) return;
      const name = (id: string) => ((ents.data ?? []) as { id: string; name: string }[]).find((e) => e.id === id)?.name ?? "";
      for (const f of (filings.data ?? []) as { id: string; entity_id: string; form: string; title: string; status: string; due_on: string | null }[]) {
        if (f.status === "to_check") add("companyregister", "Check whether ASIC needs telling", f.id, `${name(f.entity_id)}: ${f.title}`, null);
        else if (soon(f.due_on, 14)) add("companyregister", `ASIC Form ${f.form} to lodge`, f.id, `${name(f.entity_id)}: ${f.title}`, f.due_on);
      }
    }),
    safely(async () => {
      // Finance details: bank details to confirm, facilities maturing, reviews and covenant tests
      if (!supabase || !manage) return;
      const [accts, facs] = await Promise.all([
        supabase.from("bank_accounts").select("id, account_name, bank, details_changed_by, details_changed_at").eq("organisation_id", organisationId).eq("status", "open").is("verified_at", null),
        supabase.from("credit_facilities").select("id, lender, kind, maturity_on, review_on, next_covenant_test_on").eq("organisation_id", organisationId).eq("status", "active"),
      ]);
      if (accts.error) return;
      for (const a of (accts.data ?? []) as { id: string; account_name: string; bank: string; details_changed_by: string | null; details_changed_at: string | null }[]) {
        if (a.details_changed_by !== userId) add("company", "Bank details to confirm with the bank", a.id, `${a.account_name} (${a.bank})`, null);
      }
      for (const f of (facs.data ?? []) as { id: string; lender: string; kind: string; maturity_on: string | null; review_on: string | null; next_covenant_test_on: string | null }[]) {
        const what = `${f.lender} ${f.kind.replace("_", " ")}`;
        if (soon(f.maturity_on, 90)) add("company", "Facility maturing", `m-${f.id}`, what, f.maturity_on);
        if (soon(f.review_on, 14)) add("company", "Facility review due", `r-${f.id}`, what, f.review_on);
        if (soon(f.next_covenant_test_on, 14)) add("company", "Covenant test due", `c-${f.id}`, what, f.next_covenant_test_on);
      }
    }),
    safely(async () => {
      // Ownership: ASIC notices of share changes, and employee share scheme reporting
      if (!supabase || !manage) return;
      const [moves, grants, ess, ents] = await Promise.all([
        supabase.from("share_movements").select("id, kind, effective_on, asic_due_on, entity_id").eq("organisation_id", organisationId).is("voided_at", null).is("asic_lodged_on", null).not("asic_due_on", "is", null),
        supabase.from("esop_grants").select("entity_id, granted_on").eq("organisation_id", organisationId),
        supabase.from("ess_reports").select("entity_id, fy_end, statements_given_on, ato_lodged_on").eq("organisation_id", organisationId),
        supabase.from("entities").select("id, name").eq("organisation_id", organisationId),
      ]);
      if (moves.error) return;
      const name = (id: string) => ((ents.data ?? []) as { id: string; name: string }[]).find((e) => e.id === id)?.name ?? "";
      for (const m of (moves.data ?? []) as { id: string; kind: string; effective_on: string; asic_due_on: string; entity_id: string }[]) {
        if (soon(m.asic_due_on, 14)) add("ownership", "ASIC notice of a share change to lodge", m.id, `${name(m.entity_id)}: ${m.kind.replace("_", "-")} on ${m.effective_on}`, m.asic_due_on);
      }
      const years = new Set(((grants.data ?? []) as { entity_id: string; granted_on: string }[]).map((g) => `${g.entity_id}|${Number(g.granted_on.slice(5, 7)) >= 7 ? Number(g.granted_on.slice(0, 4)) + 1 : Number(g.granted_on.slice(0, 4))}`));
      for (const key of years) {
        const [entity, fy] = key.split("|");
        const r = ((ess.data ?? []) as { entity_id: string; fy_end: number; statements_given_on: string | null; ato_lodged_on: string | null }[]).find((x) => x.entity_id === entity && x.fy_end === Number(fy));
        if (!r?.statements_given_on && soon(`${fy}-07-14`, 30)) add("ownership", "Employee share scheme statements to give", `ess-s-${key}`, `${name(entity)}: year to 30 June ${fy}`, `${fy}-07-14`);
        if (!r?.ato_lodged_on && soon(`${fy}-08-14`, 30)) add("ownership", "Employee share scheme report to the ATO", `ess-a-${key}`, `${name(entity)}: year to 30 June ${fy}`, `${fy}-08-14`);
      }
    }),
  ]);

  return items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}
