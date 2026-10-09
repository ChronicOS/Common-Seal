import { supabase } from "./supabase";

export type Policy = {
  id: string;
  title: string;
  category: string;
  owner_user_id: string;
  review_every_months: number;
  next_review_on: string | null;
  last_reviewed_on: string | null;
  is_retired: boolean;
};
export type PolicyVersion = {
  id: string;
  policy_id: string;
  version_no: number;
  content: string;
  change_note: string | null;
  status: "draft" | "approved" | "superseded";
  written_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  effective_on: string | null;
};
export type PolicyData = { policies: Policy[]; versions: PolicyVersion[] };

export const POLICY_CATEGORIES = ["Conduct", "Anti-bribery and corruption", "Privacy and data", "People", "Finance", "Governance", "Technology and AI", "Health and safety", "General"];

/** The sections a policy is expected to have. A line starting with "# " is a section heading. */
export const STANDARD_SECTIONS = ["Purpose", "Who this applies to", "The rules", "Roles and responsibilities", "Raising concerns", "Breaches", "Review"];

const skeleton = (rules: string) =>
  [
    "# Purpose\nWhy this policy exists, in one or two sentences.",
    "# Who this applies to\nEveryone who works for the company, including directors, employees and contractors.",
    `# The rules\n${rules}`,
    "# Roles and responsibilities\nThe policy owner keeps this policy current. Managers make sure their teams know it. Everyone follows it.",
    "# Raising concerns\nIf you see or suspect a breach, tell your manager, Legal or Compliance, or use the speak-up channel.",
    "# Breaches\nBreaches may lead to disciplinary action, up to and including dismissal.",
    "# Review\nThe owner reviews this policy at least once in each review cycle, and sooner if the law or the business changes.",
  ].join("\n\n");

/** Starting points. Each is a skeleton to rewrite, not finished wording. */
export const POLICY_STARTERS: { name: string; category: string; content: string }[] = [
  { name: "Blank with standard sections", category: "General", content: skeleton("State each rule as a short sentence saying who must do what.") },
  {
    name: "Anti-bribery and corruption",
    category: "Anti-bribery and corruption",
    content: skeleton(
      "Never offer, give, ask for or accept a bribe.\nNever make a facilitation payment.\nGet approval before offering anything of value to a public official.\nCarry out due diligence before appointing anyone to act for the company.\nRecord every payment accurately.",
    ),
  },
  {
    name: "Gifts, hospitality and conflicts",
    category: "Conduct",
    content: skeleton(
      "Declare every gift or hospitality you give or receive in connection with work.\nGet a decision first where the value is above the company threshold or a public official is involved.\nNever give or accept cash or cash equivalents.\nDeclare any personal interest that could affect your judgement, as soon as you know about it.",
    ),
  },
  {
    name: "Speak-up (whistleblower)",
    category: "Conduct",
    content: skeleton(
      "Anyone may raise a concern about suspected misconduct, and may do so anonymously.\nReports go to the people appointed to receive them.\nThe reporter's identity is confidential.\nNobody may be treated badly for raising, or planning to raise, a concern.\nEvery report is assessed, and investigated where appropriate.",
    ),
  },
  {
    name: "Expenses",
    category: "Finance",
    content: skeleton(
      "Claim only costs you incurred for the business.\nKeep a receipt for each expense above the company threshold.\nNobody approves their own claim.\nHospitality and gifts are declared as well as claimed.\nSubmit claims within the period the company sets.",
    ),
  },
  {
    name: "Use of AI tools",
    category: "Technology and AI",
    content: skeleton(
      "Use only AI tools the company has approved.\nDo not put personal, confidential or privileged information into a tool that is not approved for it.\nCheck AI output before relying on it; you remain responsible for your work.\nTell Legal before using AI to make or support decisions about people.",
    ),
  },
];

export type Readability = { words: number; minutes: number; longSentences: string[]; missing: string[] };

/** A plain-English check. Flags sentences over 30 words and standard sections that are missing. */
export function checkWording(content: string): Readability {
  const body = content
    .split("\n")
    .filter((l) => !l.startsWith("# "))
    .join(" ");
  const words = body.split(/\s+/).filter(Boolean);
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const headings = content
    .split("\n")
    .filter((l) => l.startsWith("# "))
    .map((l) => l.slice(2).trim().toLowerCase());
  return {
    words: words.length,
    minutes: Math.max(1, Math.round(words.length / 200)),
    longSentences: sentences.filter((s) => s.split(/\s+/).length > 30),
    missing: STANDARD_SECTIONS.filter((s) => !headings.includes(s.toLowerCase())),
  };
}

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadPolicies(organisationId: string): Promise<PolicyData> {
  const client = db();
  const [policies, versions] = await Promise.all([
    client.from("policies").select("*").eq("organisation_id", organisationId).order("title"),
    client.from("policy_versions").select("*").eq("organisation_id", organisationId).order("version_no", { ascending: false }),
  ]);
  check(policies.error ?? versions.error);
  return { policies: (policies.data ?? []) as Policy[], versions: (versions.data ?? []) as PolicyVersion[] };
}

export async function createPolicy(organisationId: string, p: { title: string; category: string; ownerId: string; reviewMonths: number; content: string }) {
  const { data, error } = await db().rpc("create_policy", {
    p_org: organisationId,
    p_title: p.title,
    p_category: p.category,
    p_owner: p.ownerId,
    p_review_months: p.reviewMonths,
    p_content: p.content,
  });
  check(error);
  return data as string;
}

export async function savePolicyDraft(policyId: string, content: string, changeNote: string) {
  check((await db().rpc("save_policy_draft", { p_policy: policyId, p_content: content, p_change_note: changeNote })).error);
}
export async function approvePolicyDraft(policyId: string) {
  check((await db().rpc("approve_policy_draft", { p_policy: policyId })).error);
}
export async function confirmPolicyReview(policyId: string) {
  check((await db().rpc("confirm_policy_review", { p_policy: policyId })).error);
}
export async function updatePolicy(policyId: string, patch: Partial<Pick<Policy, "owner_user_id" | "is_retired" | "review_every_months">>) {
  check((await db().from("policies").update(patch).eq("id", policyId)).error);
}

export type PolicySummary = { inForce: number; overdue: number; draftOnly: number };

/** For the overview. Reads as empty until the policies migration has been run. */
export async function loadPolicySummary(organisationId: string, todayIso: string): Promise<PolicySummary> {
  const client = db();
  const [policies, versions] = await Promise.all([
    client.from("policies").select("id, next_review_on, is_retired").eq("organisation_id", organisationId).eq("is_retired", false),
    client.from("policy_versions").select("policy_id").eq("organisation_id", organisationId).eq("status", "approved"),
  ]);
  if (policies.error || versions.error) return { inForce: 0, overdue: 0, draftOnly: 0 };
  const approved = new Set(((versions.data ?? []) as { policy_id: string }[]).map((v) => v.policy_id));
  const rows = (policies.data ?? []) as { id: string; next_review_on: string | null }[];
  const inForce = rows.filter((p) => approved.has(p.id));
  return {
    inForce: inForce.length,
    overdue: inForce.filter((p) => p.next_review_on && p.next_review_on < todayIso).length,
    draftOnly: rows.length - inForce.length,
  };
}
