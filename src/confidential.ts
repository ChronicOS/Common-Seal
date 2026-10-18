import { supabase } from "./supabase";

// Confidential projects (migration 0054)

export type Kind = "acquisition" | "investment" | "partnership" | "licensing" | "other";
export type Project = {
  id: string; organisation_id: string; entity_id: string | null; code_name: string; kind: Kind; status: "open" | "paused" | "closed";
  started_on: string; expected_close_on: string | null; closed_on: string | null; outcome: "completed" | "not_proceeding" | "other" | null; outcome_note: string | null;
  lead_user_id: string; legal_user_id: string | null; purpose: string | null; counterparty: string | null; counterparty_listed: boolean; counterparty_competitor: boolean; related_project: string | null;
  nda_status: "pending" | "signed" | "not_needed"; nda_signed_on: string | null; conf_term_months: number | null; conf_ends_on: string | null;
  trade_secret_split: boolean; trade_secret_ends_on: string | null; non_solicit_ends_on: string | null; standstill_ends_on: string | null;
  return_destroy: "on_request" | "on_close" | "none" | null; certify_within_days: number | null; nda_notes: string | null; nda_request: NdaRequest;
  dl_address: string | null; dl_synced_at: string | null; kickoff_text: string | null; kickoff_issued_at: string | null;
  closure_text: string | null; closure_needs_deletion: boolean; closure_issued_at: string | null; ended_notice_at: string | null; created_at: string;
};
export type Member = {
  id: string; project_id: string; user_id: string | null; full_name: string; email: string | null; title: string | null; function: string | null; organisation_name: string | null;
  reason: string; added_by: string | null; added_at: string; removed_at: string | null; token: string;
  acknowledged_at: string | null; ack_name: string | null; ack_method: "in_app" | "link" | "recorded" | null;
  closure_confirmed_at: string | null; closure_name: string | null; closure_method: "in_app" | "link" | "recorded" | null;
};
export type RegisterRow = {
  id: string; code_name: string; status: Project["status"]; started_on: string; expected_close_on: string | null; closed_on: string | null; conf_ends_on: string | null;
  lead_name: string | null; legal_name: string; on_list: number; not_acknowledged: number; closure_outstanding: number; dl_out_of_date: boolean; overdue: boolean; can_read: boolean; can_manage: boolean;
};
/** The external NDA form: kept now, sent for signature once the template is in place */
export type NdaRequest = {
  counterparty_legal_name?: string; counterparty_abn?: string; counterparty_address?: string; signatory_name?: string; signatory_title?: string; signatory_email?: string;
  mutual?: "mutual" | "we_disclose" | "they_disclose"; our_entity_id?: string; our_signatory?: string; term_years?: number; trade_secret_term?: string; governing_law?: string; notes?: string;
};
export const KIND_LABELS: Record<Kind, string> = { acquisition: "Acquisition or sale", investment: "Investment", partnership: "Partnership or joint venture", licensing: "Licensing or supply", other: "Other" };
export const STATUS_LABELS: Record<Project["status"], string> = { open: "Open", paused: "Paused", closed: "Closed" };
export const OUTCOME_LABELS: Record<NonNullable<Project["outcome"]>, string> = { completed: "Completed", not_proceeding: "Not proceeding", other: "Other" };

const fmt = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "");

// ---------------------------------------------------------------------
// Code names: neutral words that say nothing about the deal. Names already recorded are never offered.
// ---------------------------------------------------------------------
const WORDS = [
  "Kestrel", "Osprey", "Heron", "Wren", "Ibis", "Plover", "Curlew", "Lorikeet", "Gannet", "Petrel", "Bittern", "Kingfisher", "Shearwater", "Avocet", "Dotterel",
  "Larch", "Juniper", "Cedar", "Aspen", "Rowan", "Banksia", "Wattle", "Myrtle", "Hazel", "Linden", "Sequoia", "Tamarind", "Waratah", "Boronia", "Grevillea",
  "Quartz", "Basalt", "Garnet", "Opal", "Jasper", "Onyx", "Cobalt", "Beryl", "Topaz", "Agate", "Obsidian", "Zircon", "Feldspar", "Malachite", "Mica",
  "Orion", "Vega", "Lyra", "Altair", "Sirius", "Rigel", "Draco", "Carina", "Pavo", "Cygnus", "Antares", "Canopus", "Achernar", "Hadar", "Mimosa",
  "Nimbus", "Zephyr", "Cirrus", "Mistral", "Sirocco", "Monsoon", "Aurora", "Solstice", "Equinox", "Meridian", "Tidewater", "Headland", "Estuary", "Lagoon", "Granite",
];
export async function suggestName(organisationId: string, avoid: string[] = []): Promise<string> {
  const pool = [...WORDS].sort(() => Math.random() - 0.5);
  for (const w of pool.slice(0, 20)) {
    if (avoid.some((a) => a.toLowerCase() === w.toLowerCase())) continue;
    if (await nameAvailable(organisationId, w)) return w;
  }
  // Fall back to two words
  for (let i = 0; i < 20; i++) {
    const w = `${pool[i]} ${pool[(i * 7 + 3) % pool.length]}`;
    if (await nameAvailable(organisationId, w)) return w;
  }
  throw new Error("Could not find a free code name. Type one instead.");
}
export async function nameAvailable(organisationId: string, name: string) {
  const { data, error } = await db().rpc("conf_name_available", { p_org: organisationId, p_name: name });
  check(error);
  return Boolean(data);
}

// ---------------------------------------------------------------------
// The notices. Short, generic, and editable before they go out.
// ---------------------------------------------------------------------
export type NoticeContext = { project: Project; organisation: string; lead: string; legal: string; members?: Member[] };
const projectName = (c: NoticeContext) => `Project ${c.project.code_name}`;
const purposeOf = (c: NoticeContext) => c.project.purpose?.trim() || "evaluate the proposed transaction";

export function kickoffNotice(c: NoticeContext, variant: "full" | "core" = "full") {
  const p = c.project;
  const name = projectName(c);
  if (variant === "core") {
    return {
      subject: `${name}: kick-off (confidentiality reminder)`,
      body: [
        `${name} has started.`,
        `Information you receive on it is covered by the confidentiality notice you have already acknowledged. No action is needed.`,
        `Questions: ${c.legal}.`,
      ].join("\n\n"),
    };
  }
  const extra: string[] = [];
  if (p.counterparty_listed) extra.push(`Listed company. The other party is listed. Do not deal in its shares or other securities, or encourage anyone else to, during the project and until you are told otherwise. Speak to ${c.legal} before any dealing.`);
  if (p.counterparty_competitor) extra.push(`Competitor. The other party is a competitor. Only people approved by ${c.legal} may see its competitively sensitive information, and do not share our own plans, pricing or launches with it.`);
  if (p.related_project?.trim()) extra.push(`Related project. ${p.related_project.trim()} is related. Keep this project's information away from that team.`);
  const lines = [
    `You are on the confidential list for ${name}. Please read this note and confirm you will follow it.`,
    `1. Keep it in the team. Only discuss the project with people on the list. Ask ${c.lead} before involving anyone else: they must be added to the list first.`,
    `2. Use it only for the purpose. Use what you learn only to ${purposeOf(c).replace(/\.$/, "")}.`,
    `3. Keep it secure. Store material only in restricted project folders. Put "${name}" (never the other party's name) in every email subject, file name and meeting invite${p.dl_address ? `, and email the team through ${p.dl_address}` : ""}.`,
    `4. One channel. Contact the other side and its advisers only through ${c.lead} or the people they nominate.`,
    `5. Hands off their people. Do not approach their employees, customers or suppliers without speaking to ${c.legal}.`,
    `6. If something goes wrong (a wrong recipient, a leak, a lost device), tell ${c.lead} and ${c.legal} straight away, and do not contact the other side about it.`,
    `7. It lasts. Your obligations continue after the project ends, including if it does not go ahead, until you are told otherwise. At the end you may be asked to delete the material and confirm you have.`,
    ...extra,
    `Questions: ${c.legal}.`,
    `Please confirm by replying "I have read and will follow this notice", or acknowledge it in VeraPhius.`,
  ];
  return { subject: `${name}: confidentiality notice (please acknowledge)`, body: lines.join("\n\n") };
}

export function inviteText(c: NoticeContext) {
  const name = projectName(c);
  return [
    `Confidential: ${name}.`,
    `Only people on the ${name} confidential list may attend or receive this invitation. Do not forward it.`,
    `Use "${name}" (never the other party's name) in the subject of every email, in file names and in meeting titles${c.project.dl_address ? `, and email the team only through ${c.project.dl_address}` : ""}.`,
  ].join("\n");
}

export function closureNotice(c: NoticeContext, opts: { outcome: NonNullable<Project["outcome"]>; note?: string; deletion: boolean; byDate?: string }) {
  const p = c.project;
  const name = projectName(c);
  const what = opts.outcome === "completed" ? `${name} has completed.` : opts.outcome === "not_proceeding" ? `${name} will not proceed.` : `${name} has closed.`;
  const until = p.conf_ends_on ? ` until ${fmt(p.conf_ends_on)}` : "";
  const ts = p.trade_secret_split ? (p.trade_secret_ends_on ? ` Trade secrets stay confidential until ${fmt(p.trade_secret_ends_on)}.` : " Trade secrets stay confidential for as long as they remain trade secrets.") : "";
  const lines = [
    `${what} Thank you for your work on it.`,
    ...(opts.note?.trim() ? [opts.note.trim()] : []),
    `Confidentiality continues. The other party's information is still confidential${until}.${ts} Do not use it for anything else, including any similar project in future. If you are unsure whether you can work on something related, ask ${c.legal}.`,
    ...(p.non_solicit_ends_on ? [`Do not approach the other party's employees until ${fmt(p.non_solicit_ends_on)} without speaking to ${c.legal}.`] : []),
    ...(p.counterparty_listed ? [`Do not deal in the other party's securities until you are told you can.`] : []),
    ...(opts.deletion
      ? [
          `Please now:`,
          `1. Delete emails, files, notes and drafts containing the project's information. Search your inbox and drives for "${name}" and the other party's name.`,
          `2. Destroy printed copies.`,
          `3. Send anything new you receive from the other party to ${c.legal}.`,
          `4. Confirm you have done this${opts.byDate ? ` by ${fmt(opts.byDate)}` : ""}: reply "Done", or confirm in VeraPhius.`,
        ]
      : [`If you receive anything further from the other party, send it to ${c.legal}.`]),
  ];
  return { subject: `${name}: closed. What to do now`, body: lines.join("\n\n") };
}

export function endedNotice(c: NoticeContext) {
  const p = c.project;
  const name = projectName(c);
  const lines = [
    `The confidentiality period for ${name} ended on ${fmt(p.conf_ends_on)}. You no longer need to treat the other party's information from the project as confidential under that agreement.`,
    ...(p.trade_secret_split ? [p.trade_secret_ends_on && p.trade_secret_ends_on <= new Date().toISOString().slice(0, 10) ? `The separate period for trade secrets has also ended.` : `Trade secrets are different: they stay confidential ${p.trade_secret_ends_on ? `until ${fmt(p.trade_secret_ends_on)}` : "for as long as they remain trade secrets"}.`] : []),
    `Other laws may still apply (for example insider trading, privacy and competition law). If in doubt, ask ${c.legal}.`,
  ];
  return { subject: `${name}: confidentiality period ended`, body: lines.join("\n\n") };
}

/** Opens the user's email program with the DL as recipient */
export function mailto(to: string | null, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export const personalLink = (token: string) => `${window.location.origin}/?c=${token}`;

// ---------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------
function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = (v: object) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x.trim() || null : x]));

export type ConfData = { ready: boolean; register: RegisterRow[]; projects: Project[]; members: Member[]; people: { user_id: string | null; full_name: string; email: string | null }[] };
export async function loadConfidential(organisationId: string): Promise<ConfData> {
  const c = db();
  const reg = await c.rpc("conf_register", { p_org: organisationId });
  if (reg.error) return { ready: false, register: [], projects: [], members: [], people: [] };
  const [projects, members, people] = await Promise.all([
    c.from("conf_projects").select("*").eq("organisation_id", organisationId),
    c.from("conf_members").select("*").eq("organisation_id", organisationId).order("added_at"),
    c.from("people").select("user_id, full_name, email").eq("organisation_id", organisationId),
  ]);
  return {
    ready: true,
    register: (reg.data ?? []) as RegisterRow[],
    projects: (projects.data ?? []) as Project[],
    members: (members.data ?? []) as Member[],
    people: (people.data ?? []) as ConfData["people"],
  };
}
export async function startProject(organisationId: string, codeName: string, kind: Kind, expectedClose: string | null, reason: string) {
  const { data, error } = await db().rpc("start_conf_project", { p_org: organisationId, p_code_name: codeName, p_kind: kind, p_expected_close: expectedClose, p_reason: reason });
  check(error);
  return data as string;
}
export async function updateProject(id: string, patch: Partial<Project>) {
  check((await db().from("conf_projects").update(tidy(patch)).eq("id", id)).error);
}
export async function addMember(organisationId: string, projectId: string, v: Partial<Member>) {
  check((await db().from("conf_members").insert({ ...tidy(v), organisation_id: organisationId, project_id: projectId })).error);
}
export async function removeMember(id: string) {
  check((await db().from("conf_members").update({ removed_at: new Date().toISOString() }).eq("id", id)).error);
}
export async function recordReply(memberId: string, what: "ack" | "closure") {
  check((await db().rpc("conf_record", { p_member: memberId, p_what: what })).error);
}
/** Copying a person's link gives it a fresh 30 days */
export async function renewLink(memberId: string) {
  const { data, error } = await db().rpc("conf_renew_link", { p_member: memberId });
  check(error);
  return personalLink(data as string);
}
export async function acknowledge(memberId: string, name: string) {
  check((await db().rpc("conf_acknowledge", { p_member: memberId, p_name: name })).error);
}
export async function confirmClosure(memberId: string, name: string) {
  check((await db().rpc("conf_confirm_closure", { p_member: memberId, p_name: name })).error);
}
export type LinkView = { code_name: string; organisation: string; full_name: string; removed: boolean; stage: "kickoff" | "closure"; notice: string | null; needs_deletion: boolean; acknowledged_at: string | null; closure_confirmed_at: string | null };
export async function openLink(token: string): Promise<LinkView | null> {
  const { data, error } = await db().rpc("conf_link", { p_token: token });
  check(error);
  return (data as LinkView | null) ?? null;
}
export async function confirmLink(token: string, name: string) {
  check((await db().rpc("conf_link_confirm", { p_token: token, p_name: name })).error);
}
