import { supabase } from "./supabase";

/** AI register: tools, approved and prohibited uses, and AI projects (migration 0069) */

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
const check = (e: { message: string } | null) => {
  if (e) throw new Error(/does not exist|schema cache|could not find/i.test(e.message) ? "The AI register needs migration 0069 to be run in Supabase." : e.message);
};

export type AiTool = {
  id: string; name: string; url: string | null; vendor: string | null; category: string; status: string; data_allowed: string | null;
  company_account: boolean; owner_name: string | null; approved_by: string | null; approved_on: string | null; review_on: string | null; notes: string | null;
};
export type AiRule = { id: string; tool_id: string | null; kind: "approved" | "prohibited"; text: string; position: number };
export type AiProject = {
  id: string; entity_id: string | null; name: string; purpose: string | null; owner_name: string | null; status: string; risk_level: string | null;
  personal_info: boolean; decisions_about_people: boolean; customer_facing: boolean; models: string | null; tool_id: string | null; data_location: string | null;
  human_oversight: string | null; testing: string | null; approved_by: string | null; approved_on: string | null; go_live_on: string | null; review_on: string | null;
};
export type AiData = { tools: AiTool[]; rules: AiRule[]; projects: AiProject[] };

export const TOOL_STATUS: Record<string, string> = {
  approved: "Approved",
  limited: "Approved with limits",
  review: "Under review",
  prohibited: "Not allowed",
  retired: "Retired",
};
export const DATA_ALLOWED: Record<string, string> = {
  public: "Public information only",
  internal: "Internal information",
  confidential: "Confidential information",
  personal: "Personal information (with care)",
};
export const CATEGORIES: Record<string, string> = {
  chat: "Chat assistant", writing: "Writing", coding: "Coding", meeting: "Meeting notes", image: "Images and design",
  search: "Search and research", analytics: "Data and analytics", built_in: "Built into other software", other: "Other",
};
export const PROJECT_STATUS: Record<string, string> = {
  idea: "Idea", assessing: "Being assessed", building: "Being built", pilot: "Pilot", live: "Live", paused: "Paused", retired: "Retired",
};
export const RISK_LEVEL: Record<string, string> = {
  minimal: "Minimal", limited: "Limited", high: "High", unacceptable: "Unacceptable (do not proceed)",
};

/** Well-known tools, so a dropped link gets a proper name, vendor and kind */
const KNOWN: [RegExp, string, string, string][] = [
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/, "ChatGPT", "OpenAI", "chat"],
  [/(^|\.)openai\.com$/, "OpenAI", "OpenAI", "chat"],
  [/(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, "Claude", "Anthropic", "chat"],
  [/copilot\.microsoft\.com$|m365\.cloud\.microsoft$|(^|\.)office\.com$/, "Microsoft Copilot", "Microsoft", "chat"],
  [/gemini\.google\.com$/, "Gemini", "Google", "chat"],
  [/(^|\.)perplexity\.ai$/, "Perplexity", "Perplexity", "search"],
  [/(^|\.)github\.com$/, "GitHub Copilot", "GitHub", "coding"],
  [/(^|\.)cursor\.(com|sh)$/, "Cursor", "Anysphere", "coding"],
  [/(^|\.)grammarly\.com$/, "Grammarly", "Grammarly", "writing"],
  [/(^|\.)otter\.ai$/, "Otter.ai", "Otter.ai", "meeting"],
  [/(^|\.)fireflies\.ai$/, "Fireflies.ai", "Fireflies.ai", "meeting"],
  [/(^|\.)midjourney\.com$/, "Midjourney", "Midjourney", "image"],
  [/(^|\.)canva\.com$/, "Canva (Magic Studio)", "Canva", "image"],
  [/(^|\.)notion\.(so|com)$/, "Notion AI", "Notion", "writing"],
  [/(^|\.)deepl\.com$/, "DeepL", "DeepL", "writing"],
];

export function guessTool(raw: string): { url: string; name: string; vendor: string | null; category: string } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (!u.hostname.includes(".")) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const hit = KNOWN.find(([re]) => re.test(host));
  if (hit) return { url: u.toString(), name: hit[1], vendor: hit[2], category: hit[3] };
  const base = host.split(".").slice(-2, -1)[0] ?? host;
  return { url: u.toString(), name: base.charAt(0).toUpperCase() + base.slice(1), vendor: null, category: "other" };
}

/** Starting points for the rules that apply to every AI tool */
export const SUGGESTED_RULES: { kind: "approved" | "prohibited"; text: string }[] = [
  { kind: "approved", text: "Drafting and summarising internal documents, checked by a person before use" },
  { kind: "approved", text: "Research and brainstorming using public information" },
  { kind: "approved", text: "Writing and checking code, reviewed before it is released" },
  { kind: "prohibited", text: "Putting personal, customer or employee information into a tool without a company account" },
  { kind: "prohibited", text: "Putting confidential, price-sensitive or privileged information into a tool without a company account" },
  { kind: "prohibited", text: "Making decisions about people (hiring, pay, performance, credit) without human review" },
  { kind: "prohibited", text: "Giving legal, medical or financial advice to customers from AI output" },
  { kind: "prohibited", text: "Passing off AI-generated content as a person's own professional judgement without checking it" },
];

export async function loadAi(organisationId: string): Promise<AiData> {
  const client = db();
  const [t, r, p] = await Promise.all([
    client.from("ai_tools").select("*").eq("organisation_id", organisationId).order("name"),
    client.from("ai_use_rules").select("*").eq("organisation_id", organisationId).order("position"),
    client.from("ai_projects").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: false }),
  ]);
  check(t.error);
  check(r.error);
  check(p.error);
  return { tools: (t.data ?? []) as AiTool[], rules: (r.data ?? []) as AiRule[], projects: (p.data ?? []) as AiProject[] };
}

export async function addTools(organisationId: string, tools: { url: string; name: string; vendor: string | null; category: string }[], status: string) {
  const today = new Date().toLocaleDateString("en-CA");
  const review = new Date(Date.now() + 365 * 864e5).toLocaleDateString("en-CA");
  const { error } = await db().from("ai_tools").insert(
    tools.map((t) => ({
      organisation_id: organisationId, ...t, status,
      approved_on: status === "approved" || status === "limited" ? today : null,
      review_on: status === "prohibited" ? null : review,
    })),
  );
  if (error && /duplicate|unique/i.test(error.message)) throw new Error("One of those tools is already in the register.");
  check(error);
}

export async function saveTool(id: string, patch: Partial<AiTool>) {
  check((await db().from("ai_tools").update(patch).eq("id", id)).error);
}
export async function deleteTool(id: string) {
  check((await db().from("ai_tools").delete().eq("id", id)).error);
}
export async function addRule(organisationId: string, toolId: string | null, kind: "approved" | "prohibited", text: string, position: number) {
  check((await db().from("ai_use_rules").insert({ organisation_id: organisationId, tool_id: toolId, kind, text: text.trim(), position })).error);
}
export async function deleteRule(id: string) {
  check((await db().from("ai_use_rules").delete().eq("id", id)).error);
}
export async function saveProject(organisationId: string, p: Partial<AiProject> & { id?: string }) {
  const { id, ...rest } = p;
  const client = db();
  check((id ? await client.from("ai_projects").update(rest).eq("id", id) : await client.from("ai_projects").insert({ organisation_id: organisationId, ...rest })).error);
}
export async function deleteProject(id: string) {
  check((await db().from("ai_projects").delete().eq("id", id)).error);
}
