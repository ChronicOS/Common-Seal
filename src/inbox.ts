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

/** Something that can be done right here, without opening the module */
export type InboxAction = { label: string; needsName?: boolean; run: (name: string) => Promise<void> };
export type InboxItem = { key: string; tab: string; kind: string; title: string; due: string | null; overdue: boolean; action?: InboxAction };
const must = (r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
};
const inMonths = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString("en-CA");
};

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
  const add = (tab: string, kind: string, id: string, title: string, due: string | null, action?: InboxAction) =>
    items.push({ key: `${tab}-${id}`, tab, kind, title, due, overdue: Boolean(due && due.slice(0, 10) < t), action });
  const safely = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      // That module is not set up yet
    }
  };

  await Promise.all([
    safely(async () => {
      // Financial results this person prepares, once the period has ended (migration 0069)
      if (!supabase) return;
      const me = await supabase.from("people").select("id").eq("organisation_id", organisationId).eq("user_id", userId);
      const ids = ((me.data ?? []) as { id: string }[]).map((x) => x.id);
      if (!ids.length) return;
      const reps = await supabase.from("fin_reports").select("id, name, frequency").eq("organisation_id", organisationId).eq("is_active", true).in("preparer_person_id", ids);
      if (reps.error || !reps.data?.length) return;
      const { periodLabel } = await import("./finResults");
      for (const r of reps.data as { id: string; name: string; frequency: string }[]) {
        await supabase.rpc("ensure_fin_periods", { p_report: r.id });
        const ps = await supabase.from("fin_periods").select("id, period_start, period_end, due_on").eq("report_id", r.id).eq("status", "open").lt("period_end", t);
        for (const p of (ps.data ?? []) as { id: string; period_start: string; period_end: string; due_on: string }[])
          add("finance", "Financial results", p.id, `${r.name}: ${periodLabel(p, r.frequency)}`, p.due_on);
      }
    }),
    safely(async () => {
      // AI tools due for review (migration 0069)
      if (!manage || !supabase) return;
      const { data, error } = await supabase.from("ai_tools").select("id, name, review_on").eq("organisation_id", organisationId).in("status", ["approved", "limited", "review"]).not("review_on", "is", null);
      if (error) return;
      for (const x of (data ?? []) as { id: string; name: string; review_on: string }[]) if (soon(x.review_on, 30)) add("aiRegister", "AI register", x.id, `Review ${x.name}`, x.review_on);
    }),
    safely(async () => {
      // Screening matches waiting for Legal or Compliance (migration 0061)
      if (!has(role, "owner", "admin", "legal", "compliance") || !supabase) return;
      const { data, error } = await supabase.from("dd_screenings").select("*, party:counterparties(name)").eq("organisation_id", organisationId).order("screened_at", { ascending: false });
      if (error) return;
      const seen = new Set<string>();
      for (const x of (data ?? []) as unknown as { id: string; counterparty_id: string; outcome: string; kind?: string; subject_key?: string; subject_name?: string | null; party: { name: string } | null }[]) {
        const k = `${x.counterparty_id}:${x.kind ?? "lists"}:${x.subject_key ?? "party"}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const who = x.subject_name && x.subject_key && x.subject_key !== "party" ? `${x.subject_name} (${x.party?.name ?? "a third party"})` : x.party?.name ?? "A third party";
        if (x.outcome === "to_review") add("parties", x.kind === "media" ? "Adverse media: findings to review" : "Screening: possible matches to review", x.id, who, null);
      }
    }),
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
          add("calendar", o.owner_user_id ? "Compliance obligation due" : "Compliance obligation with no owner", `${o.id}-${d}`, o.title, d,
            d <= t || o.owner_user_id === userId ? { label: "Mark done", run: async () => must(await supabase!.from("obligation_completions").insert({ organisation_id: organisationId, obligation_id: o.id, due_on: d, done_on: t })) } : undefined);
        }
      }
    }),
    safely(async () => {
      // Confidential projects (code names only): my notices to acknowledge or deletion to confirm; for the lead and the
      // legal contact (or the directors), anything in the protocol that has not been followed
      if (!supabase) return;
      const [projects, members] = await Promise.all([
        supabase.from("conf_projects").select("id, code_name, status, lead_user_id, legal_user_id, expected_close_on, kickoff_issued_at, closure_issued_at, closure_needs_deletion, conf_ends_on, ended_notice_at, dl_address, dl_synced_at").eq("organisation_id", organisationId),
        supabase.from("conf_members").select("id, project_id, user_id, added_at, removed_at, acknowledged_at, closure_confirmed_at").eq("organisation_id", organisationId),
      ]);
      if (projects.error) return;
      const ms = (members.data ?? []) as { id: string; project_id: string; user_id: string | null; added_at: string; removed_at: string | null; acknowledged_at: string | null; closure_confirmed_at: string | null }[];
      const ago = (iso: string, days: number) => Date.now() - new Date(iso).getTime() > days * 864e5;
      for (const p of (projects.data ?? []) as { id: string; code_name: string; status: string; lead_user_id: string; legal_user_id: string | null; expected_close_on: string | null; kickoff_issued_at: string | null; closure_issued_at: string | null; closure_needs_deletion: boolean; conf_ends_on: string | null; ended_notice_at: string | null; dl_address: string | null; dl_synced_at: string | null }[]) {
        const name = `Project ${p.code_name}`;
        const team = ms.filter((m) => m.project_id === p.id);
        const me = team.find((m) => m.user_id === userId && !m.removed_at);
        if (me && p.kickoff_issued_at && !me.acknowledged_at && p.status !== "closed") add("confidential", "Acknowledge the confidentiality notice", `ca-${me.id}`, name, null, { label: "I have read it and will follow it", needsName: true, run: async (n) => must(await supabase!.rpc("conf_acknowledge", { p_member: me.id, p_name: n })) });
        if (me && p.closure_issued_at && p.closure_needs_deletion && me.acknowledged_at && !me.closure_confirmed_at) add("confidential", "Confirm you have deleted the project material", `cc-${me.id}`, name, null, { label: "I have deleted it", needsName: true, run: async (n) => must(await supabase!.rpc("conf_confirm_closure", { p_member: me.id, p_name: n })) });
        const isLead = p.lead_user_id === userId;
        const isEscalation = !isLead && (p.legal_user_id === userId || (!p.legal_user_id && has(role, "director")));
        if (!isLead && !isEscalation) continue;
        // The lead hears straight away; the legal contact once it has gone unfixed (escalation)
        const pre = isLead ? "" : "Escalated: ";
        const unacked = team.filter((m) => !m.removed_at && !m.acknowledged_at && p.kickoff_issued_at && (isLead || ago(m.added_at, 5)));
        if (p.status !== "closed" && unacked.length) add("confidential", `${pre}${unacked.length} not acknowledged the confidentiality notice`, `cu-${p.id}`, name, null);
        if (isLead && p.status === "open" && !p.kickoff_issued_at && ago(team[0]?.added_at ?? new Date().toISOString(), 2)) add("confidential", "Issue the confidentiality notice", `ck-${p.id}`, name, null);
        if (p.status === "open" && p.expected_close_on && (isLead ? soon(p.expected_close_on, 7) : p.expected_close_on < t)) add("confidential", `${pre}Close, extend or pause the project`, `ce-${p.id}`, name, p.expected_close_on);
        const dlChanges = p.dl_address && p.status !== "closed" && team.some((m) => (m.added_at > (p.dl_synced_at ?? "") || (m.removed_at ?? "") > (p.dl_synced_at ?? "")) && (isLead || ago(m.removed_at ?? m.added_at, 3)));
        if (dlChanges) add("confidential", `${pre}Update the distribution list`, `cd-${p.id}`, name, null, isLead ? { label: "The DL is up to date", run: async () => must(await supabase!.from("conf_projects").update({ dl_synced_at: new Date().toISOString() }).eq("id", p.id)) } : undefined);
        const outstanding = p.closure_issued_at && p.closure_needs_deletion && (isLead || ago(p.closure_issued_at, 14)) ? team.filter((m) => m.acknowledged_at && !m.closure_confirmed_at).length : 0;
        if (outstanding) add("confidential", `${pre}${outstanding} deletion confirmation${outstanding === 1 ? "" : "s"} outstanding`, `co-${p.id}`, name, null);
        if (p.status === "closed" && p.conf_ends_on && p.conf_ends_on <= t && !p.ended_notice_at) add("confidential", "Confidentiality has ended: tell the team", `cx-${p.id}`, name, p.conf_ends_on);
      }
    }),
    safely(async () => {
      // Regulatory checks I own due for review; standard form contracts to review; acquisitions needing ACCC approval
      if (!supabase) return;
      const [checks, sfc, deals] = await Promise.all([
        supabase.from("compliance_checks").select("id, programme, item_key, review_on, owner_user_id").eq("organisation_id", organisationId).eq("owner_user_id", userId),
        supabase.from("standard_form_contracts").select("id, name, next_review_on, owner_user_id, status").eq("organisation_id", organisationId).eq("status", "current"),
        manage ? supabase.from("acquisitions").select("id, name, notification, accc_notified_on, determination, planned_completion_on, status").eq("organisation_id", organisationId).in("status", ["considering", "notified"]) : Promise.resolve({ data: [], error: null }),
      ]);
      if (checks.error) return;
      const tabOf: Record<string, string> = { employment: "employment", consumer: "consumer", climate: "climate" };
      for (const c of (checks.data ?? []) as { id: string; programme: string; item_key: string; review_on: string | null }[]) {
        if (soon(c.review_on, 14)) add(tabOf[c.programme] ?? "employment", "Compliance check due for review", c.id, c.item_key.replace(/_/g, " "), c.review_on);
      }
      for (const c of (sfc.data ?? []) as { id: string; name: string; next_review_on: string | null; owner_user_id: string | null }[]) {
        if ((c.owner_user_id === userId || (!c.owner_user_id && manage)) && soon(c.next_review_on, 14)) add("consumer", "Standard form contract review due", c.id, c.name, c.next_review_on);
      }
      for (const d of (deals.data ?? []) as { id: string; name: string; notification: string; accc_notified_on: string | null; determination: string | null; planned_completion_on: string | null }[]) {
        if (d.notification === "required" && !d.determination) add("mergers", d.accc_notified_on ? "Acquisition waiting for the ACCC" : "Acquisition to notify to the ACCC", d.id, d.name, d.planned_completion_on);
        else if (d.notification === "unknown" && soon(d.planned_completion_on, 60)) add("mergers", "Acquisition to test for ACCC notification", d.id, d.name, d.planned_completion_on);
      }
    }),
    safely(async () => {
      // Anti-bribery: actions on bribery risks I own, and the risk assessment review
      if (!supabase) return;
      const [risks, assessments] = await Promise.all([
        supabase.from("abc_risks").select("id, area, description, action_due_on, owner_user_id, assessment_id").eq("organisation_id", organisationId).eq("owner_user_id", userId),
        manage ? supabase.from("abc_assessments").select("id, title, status, next_review_on").eq("organisation_id", organisationId) : Promise.resolve({ data: [], error: null }),
      ]);
      if (risks.error) return;
      for (const r of (risks.data ?? []) as { id: string; description: string; action_due_on: string | null }[]) {
        if (soon(r.action_due_on, 14)) add("abc", "Bribery risk action due", r.id, r.description, r.action_due_on);
      }
      const list = (assessments.data ?? []) as { id: string; title: string; status: string; next_review_on: string | null }[];
      if (!list.some((a) => a.status === "draft")) {
        const approved = list.filter((a) => a.status === "approved").sort((a, b) => (b.next_review_on ?? "").localeCompare(a.next_review_on ?? ""))[0];
        if (approved && soon(approved.next_review_on, 30)) add("abc", "Bribery risk assessment due for review", approved.id, approved.title, approved.next_review_on);
      }
    }),
    safely(async () => {
      // Privacy and cyber: breaches to assess, notify or report; holdings and automated decisions I own to review
      if (!supabase) return;
      const [br, hold, adm] = await Promise.all([
        manage ? supabase.from("privacy_breaches").select("id, title, assessment_due_on, eligible, oaic_notified_at, individuals_notified_at, notify_exception, ransom_paid, ransom_paid_at, ransom_reported_at").eq("organisation_id", organisationId).eq("status", "open") : Promise.resolve({ data: [], error: null }),
        supabase.from("personal_info_holdings").select("id, name, review_on, owner_user_id").eq("organisation_id", organisationId).eq("status", "active"),
        supabase.from("automated_decisions").select("id, name, review_on, owner_user_id").eq("organisation_id", organisationId).eq("status", "active"),
      ]);
      if (hold.error) return;
      for (const b of (br.data ?? []) as { id: string; title: string; assessment_due_on: string; eligible: boolean | null; oaic_notified_at: string | null; individuals_notified_at: string | null; notify_exception: string | null; ransom_paid: boolean; ransom_paid_at: string | null; ransom_reported_at: string | null }[]) {
        if (b.ransom_paid && !b.ransom_reported_at) add("privacy", "Ransomware payment: report to the ASD within 72 hours", `r-${b.id}`, b.title, b.ransom_paid_at!.slice(0, 10));
        if (b.eligible === null) add("privacy", "Possible data breach to assess (30-day limit)", `a-${b.id}`, b.title, b.assessment_due_on);
        else if (b.eligible && !b.oaic_notified_at) add("privacy", "Eligible data breach: notify the OAIC", `o-${b.id}`, b.title, null);
        else if (b.eligible && !b.individuals_notified_at && !b.notify_exception) add("privacy", "Eligible data breach: tell the people affected", `i-${b.id}`, b.title, null);
      }
      for (const h of [...((hold.data ?? []) as { id: string; name: string; review_on: string | null; owner_user_id: string | null }[]), ...((adm.data ?? []) as { id: string; name: string; review_on: string | null; owner_user_id: string | null }[])]) {
        if ((h.owner_user_id === userId || (!h.owner_user_id && manage)) && soon(h.review_on, 14)) add("privacy", "Privacy review due", h.id, h.name, h.review_on);
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
        if ((h.owner_user_id === userId || !h.owner_user_id) && soon(h.review_on, 14)) add("whs", "Hazard review due", h.id, h.title, h.review_on, { label: "Reviewed: next review in 12 months", run: async () => must(await supabase!.from("whs_hazards").update({ review_on: inMonths(12) }).eq("id", h.id)) });
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
