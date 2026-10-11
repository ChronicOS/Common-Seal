import { loadContracts } from "./contracts";
import { loadDeclarations } from "./declarations";
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
  const manage = MANAGE_ROLES.includes(role);
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
      const d = await loadTraining(organisationId);
      for (const a of d.assignments.filter((x) => x.user_id === userId && !x.completed_at)) {
        const m = d.modules.find((x) => x.id === a.module_id);
        if (m) items.push({ key: `training-${a.id}`, tab: "training", kind: "Training to complete", title: m.title, due: a.due_on, overdue: isOverdue(a) });
      }
    }),
    safely(async () => {
      const d = await loadWorkflows(organisationId);
      for (const s of d.runSteps.filter((x) => x.status === "open" && (manage ? x.assignee_role === null || x.assignee_role === role : x.assignee_role === role))) {
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
      if (!manage) return;
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
    }),
  ]);

  return items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}
