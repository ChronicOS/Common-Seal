import { supabase } from "./supabase";

export type Category = { id: string; position: number; name: string; covers: string | null; examples: string | null; is_active: boolean };
export type Contact = { id: string; category_id: string; role: "responsible" | "manager"; name: string; title: string | null; email: string };
export type Owner = { user_id: string; is_backup: boolean };
export type Frequency = "once" | "monthly" | "quarterly" | "half_yearly" | "annually";
export type Review = {
  id: string;
  name: string;
  forum: string | null;
  frequency: Frequency;
  forum_on: string;
  start_on: string;
  respond_by: string;
  reminder2_on: string;
  escalate_on: string;
  status: "scheduled" | "collecting" | "final" | "cancelled";
  finalised_at: string | null;
};
export type Request = {
  id: string;
  review_id: string;
  category_id: string;
  token: string;
  sent_at: string | null;
  reminder1_sent_at: string | null;
  reminder2_sent_at: string | null;
  escalated_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  nothing_to_report: boolean;
  query: string | null;
};
export type Item = {
  id: string;
  review_id: string;
  category_id: string;
  position: number;
  title: string;
  detail: string | null;
  action: string;
  actioner: string | null;
  actioner_email: string | null;
  due_on: string | null;
  is_closed: boolean;
  resolution: string | null;
  carried_from_id: string | null;
  entered_by: string | null;
  prompt_week_sent_at: string | null;
  prompt_due_sent_at: string | null;
};
export type ItemUpdate = { id: string; item_id: string; by_name: string; resolved: boolean; note: string; created_at: string };
export type RiskData = {
  categories: Category[];
  contacts: Contact[];
  owners: Owner[];
  reviews: Review[];
  requests: Request[];
  items: Item[];
  updates: ItemUpdate[];
  links: Record<string, string>;
};
export type RequestEmail = "request" | "reminder1" | "reminder2" | "escalation";

export const FREQUENCY: Record<Frequency, string> = { once: "One-off", monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half yearly", annually: "Annually" };
export const REVIEW_STATUS: Record<Review["status"], string> = { scheduled: "Scheduled", collecting: "In progress", final: "Final", cancelled: "Cancelled" };
export const EMAIL_NAME: Record<RequestEmail, string> = { request: "Request", reminder1: "First reminder", reminder2: "Second reminder", escalation: "Escalation to manager" };

const ITEM_COLUMNS =
  "id, review_id, category_id, position, title, detail, action, actioner, actioner_email, due_on, is_closed, resolution, carried_from_id, entered_by, prompt_week_sent_at, prompt_due_sent_at";

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadRisk(organisationId: string): Promise<RiskData> {
  const client = db();
  // Adds the default categories the first time, and starts any scheduled review whose date has arrived
  await client.rpc("ensure_risk_categories", { p_org: organisationId });
  await client.rpc("start_due_risk_reviews", { p_org: organisationId });
  const [categories, contacts, owners, reviews, requests, items, updates, links] = await Promise.all([
    client.from("risk_categories").select("id, position, name, covers, examples, is_active").eq("organisation_id", organisationId).order("position"),
    client.from("risk_contacts").select("id, category_id, role, name, title, email").eq("organisation_id", organisationId).order("created_at"),
    client.from("risk_owners").select("user_id, is_backup").eq("organisation_id", organisationId),
    client.from("risk_reviews").select("*").eq("organisation_id", organisationId).order("forum_on", { ascending: false }),
    client.from("risk_requests").select("*").eq("organisation_id", organisationId),
    client.from("risk_items").select(ITEM_COLUMNS).eq("organisation_id", organisationId).order("position"),
    client.from("risk_item_updates").select("id, item_id, by_name, resolved, note, created_at").eq("organisation_id", organisationId).order("created_at"),
    client.rpc("risk_action_links", { p_org: organisationId }),
  ]);
  check(categories.error ?? reviews.error ?? items.error);
  return {
    categories: (categories.data ?? []) as Category[],
    // Contacts, requests and links are readable only by the people running the review
    contacts: (contacts.data ?? []) as Contact[],
    owners: (owners.data ?? []) as Owner[],
    reviews: (reviews.data ?? []) as Review[],
    requests: (requests.data ?? []) as Request[],
    items: (items.data ?? []) as Item[],
    updates: (updates.data ?? []) as ItemUpdate[],
    links: Object.fromEntries(((links.data ?? []) as { item_id: string; token: string }[]).map((l) => [l.item_id, l.token])),
  };
}

export async function saveCategory(organisationId: string, c: { id?: string; name: string; covers: string; examples: string; is_active: boolean; position: number }) {
  const row = { name: c.name.trim(), covers: c.covers.trim() || null, examples: c.examples.trim() || null, is_active: c.is_active };
  if (c.id) check((await db().from("risk_categories").update(row).eq("id", c.id)).error);
  else check((await db().from("risk_categories").insert({ ...row, organisation_id: organisationId, position: c.position })).error);
}
export async function addContact(organisationId: string, categoryId: string, k: { role: Contact["role"]; name: string; title: string; email: string }) {
  check(
    (await db().from("risk_contacts").insert({ organisation_id: organisationId, category_id: categoryId, role: k.role, name: k.name.trim(), title: k.title.trim() || null, email: k.email.trim() })).error,
  );
}
export async function removeContact(id: string) {
  check((await db().from("risk_contacts").delete().eq("id", id)).error);
}
export async function setOwner(organisationId: string, userId: string, isBackup: boolean) {
  const client = db();
  // There is one owner; naming a new one replaces the last
  if (!isBackup) check((await client.from("risk_owners").delete().eq("organisation_id", organisationId).eq("is_backup", false)).error);
  check((await client.from("risk_owners").delete().eq("organisation_id", organisationId).eq("user_id", userId)).error);
  check((await client.from("risk_owners").insert({ organisation_id: organisationId, user_id: userId, is_backup: isBackup })).error);
}
export async function removeOwner(organisationId: string, userId: string) {
  check((await db().from("risk_owners").delete().eq("organisation_id", organisationId).eq("user_id", userId)).error);
}

export async function createReview(organisationId: string, r: { name: string; forum: string; forumOn: string | null; frequency: Frequency }) {
  const { data, error } = await db().rpc("create_risk_review", { p_org: organisationId, p_name: r.name, p_forum: r.forum, p_forum_on: r.forumOn, p_frequency: r.frequency });
  check(error);
  return data as string;
}
export async function updateReview(id: string, patch: Partial<Pick<Review, "name" | "forum" | "frequency" | "forum_on" | "start_on" | "respond_by" | "reminder2_on" | "escalate_on">>) {
  check((await db().from("risk_reviews").update(patch).eq("id", id)).error);
}
export async function cancelReview(id: string) {
  check((await db().rpc("cancel_risk_review", { p_review: id })).error);
}
export async function finaliseReview(id: string) {
  check((await db().rpc("finalise_risk_review", { p_review: id })).error);
}
export async function markRequestSent(id: string, kind: RequestEmail) {
  const column = kind === "request" ? "sent_at" : kind === "reminder1" ? "reminder1_sent_at" : kind === "reminder2" ? "reminder2_sent_at" : "escalated_at";
  check((await db().from("risk_requests").update({ [column]: new Date().toISOString() }).eq("id", id)).error);
}
export async function sendBack(requestId: string, query: string) {
  check((await db().rpc("reopen_risk_request", { p_request: requestId, p_query: query })).error);
}
export async function saveItem(organisationId: string, reviewId: string, categoryId: string, i: Partial<Item> & { title: string; action: string }) {
  const row = {
    title: i.title.trim(),
    detail: i.detail?.trim() || null,
    action: i.action.trim(),
    actioner: i.actioner?.trim() || null,
    actioner_email: i.actioner_email?.trim() || null,
    due_on: i.due_on || null,
    is_closed: Boolean(i.is_closed),
  };
  if (i.id) check((await db().from("risk_items").update(row).eq("id", i.id)).error);
  else check((await db().from("risk_items").insert({ ...row, organisation_id: organisationId, review_id: reviewId, category_id: categoryId, position: 999, entered_by: "Report owner" })).error);
}
export async function deleteItem(id: string) {
  check((await db().from("risk_items").delete().eq("id", id)).error);
}
export async function markPromptSent(itemId: string, kind: "week" | "due") {
  check((await db().rpc("mark_risk_prompt_sent", { p_item: itemId, p_kind: kind })).error);
}

export const respondLink = (token: string) => `${window.location.origin}/?r=${token}`;
export const actionLink = (token: string) => `${window.location.origin}/?a=${token}`;

/** Which email a category's request is due, if any. The latest step that has fallen due wins. */
export function requestEmailDue(review: Review, q: Request, on: string): RequestEmail | null {
  if (review.status !== "collecting" || q.submitted_at) return null;
  if (!q.sent_at) return "request";
  if (on >= review.escalate_on && !q.escalated_at) return "escalation";
  if (on >= review.reminder2_on && !q.reminder2_sent_at && !q.escalated_at) return "reminder2";
  if (on >= review.respond_by && !q.reminder1_sent_at && !q.reminder2_sent_at && !q.escalated_at) return "reminder1";
  return null;
}

/** Open actions that are current: not closed, and not taken over by a newer review. */
export function liveActions(data: RiskData): Item[] {
  const superseded = new Set(data.items.map((i) => i.carried_from_id).filter(Boolean));
  const live = new Set(data.reviews.filter((r) => r.status === "collecting" || r.status === "final").map((r) => r.id));
  return data.items.filter((i) => !i.is_closed && !superseded.has(i.id) && live.has(i.review_id));
}
/** The prompt an actioner is due: a week before the due date, then on it. */
export function promptDue(i: Item, on: string): "week" | "due" | null {
  if (i.is_closed || !i.due_on || !i.actioner_email) return null;
  if (on >= i.due_on && !i.prompt_due_sent_at) return "due";
  if (on >= addDays(i.due_on, -7) && !i.prompt_week_sent_at && !i.prompt_due_sent_at) return "week";
  return null;
}

export function mailto(to: string[], subject: string, body: string, cc: string[] = []) {
  return `mailto:${to.map(encodeURIComponent).join(",")}?${cc.length ? `cc=${cc.map(encodeURIComponent).join(",")}&` : ""}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ---- Public pages: no sign-in ----
export type PublicItem = { id: string | null; title: string; detail: string; action: string; actioner: string; actioner_email: string; due_on: string; is_closed: boolean; carried: boolean };
export type PublicRequest = {
  organisation: string;
  review: string;
  forum: string | null;
  forum_on: string;
  respond_by: string;
  open: boolean;
  submitted_at: string | null;
  nothing_to_report: boolean;
  query: string | null;
  category: string;
  covers: string | null;
  examples: string | null;
  people: string[];
  items: (Omit<PublicItem, "detail" | "actioner" | "actioner_email" | "due_on"> & { detail: string | null; actioner: string | null; actioner_email: string | null; due_on: string | null })[];
};
export async function openRequest(token: string): Promise<PublicRequest> {
  const { data, error } = await db().rpc("risk_request", { p_token: token });
  check(error);
  return data as PublicRequest;
}
export async function submitRequest(token: string, name: string, nothing: boolean, items: PublicItem[]) {
  check((await db().rpc("risk_submit", { p_token: token, p_name: name, p_nothing: nothing, p_items: items.map((i) => ({ ...i, due_on: i.due_on || null })) })).error);
}
export type PublicAction = {
  organisation: string;
  category: string;
  title: string;
  detail: string | null;
  action: string;
  actioner: string | null;
  due_on: string | null;
  is_closed: boolean;
  resolution: string | null;
  superseded: boolean;
  updates: { by_name: string; resolved: boolean; note: string; created_at: string }[];
};
export async function openAction(token: string): Promise<PublicAction> {
  const { data, error } = await db().rpc("risk_action", { p_token: token });
  check(error);
  return data as PublicAction;
}
export async function updateAction(token: string, name: string, resolved: boolean, note: string) {
  check((await db().rpc("risk_action_update", { p_token: token, p_name: name, p_resolved: resolved, p_note: note })).error);
}

export type RiskSummary = { review: Review | null; awaiting: number; openActions: number; overdueActions: number };
export async function loadRiskSummary(organisationId: string): Promise<RiskSummary> {
  const client = db();
  const [reviews, requests, items] = await Promise.all([
    client.from("risk_reviews").select("*").eq("organisation_id", organisationId).in("status", ["collecting", "final"]).order("forum_on", { ascending: false }).limit(1),
    client.from("risk_requests").select("review_id, submitted_at").eq("organisation_id", organisationId),
    client.from("risk_items").select("id, review_id, is_closed, due_on, carried_from_id").eq("organisation_id", organisationId),
  ]);
  if (reviews.error || items.error) return { review: null, awaiting: 0, openActions: 0, overdueActions: 0 };
  const review = ((reviews.data ?? []) as Review[])[0] ?? null;
  const all = (items.data ?? []) as { id: string; review_id: string; is_closed: boolean; due_on: string | null; carried_from_id: string | null }[];
  const superseded = new Set(all.map((i) => i.carried_from_id).filter(Boolean));
  const open = all.filter((i) => !i.is_closed && !superseded.has(i.id));
  return {
    review,
    awaiting: review ? ((requests.data ?? []) as { review_id: string; submitted_at: string | null }[]).filter((q) => q.review_id === review.id && !q.submitted_at).length : 0,
    openActions: open.length,
    overdueActions: open.filter((i) => i.due_on && i.due_on < today()).length,
  };
}
