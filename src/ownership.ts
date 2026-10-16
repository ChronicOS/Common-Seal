import { supabase } from "./supabase";

// Ownership (migration 0044): register of members, share classes, startup mode.

export type ShareClass = {
  id: string;
  entity_id: string;
  name: string;
  code: string | null;
  kind: "ordinary" | "preference" | "other";
  votes_per_share: number;
  dividend_rights: string | null;
  capital_rights: string | null;
  other_rights: string | null;
  issue_price: number | null;
  currency: string;
  liq_pref_multiple: number | null;
  liq_participation: "non_participating" | "participating" | "capped" | null;
  liq_cap_multiple: number | null;
  liq_seniority: number | null;
  anti_dilution: "none" | "broad_based" | "narrow_based" | "full_ratchet" | null;
  converts_to_class_id: string | null;
  conversion_ratio: number;
  auto_conversion: string | null;
  dividend_preference: string | null;
  pro_rata: string | null;
  board_seats: number | null;
  information_rights: string | null;
  redemption: string | null;
  rights_source: string | null;
  is_active: boolean;
};
export type ClassValues = Omit<ShareClass, "id" | "entity_id">;

export type Holder = {
  id: string;
  name: string;
  kind: "individual" | "company" | "trust" | "fund" | "other";
  address: string | null;
  email: string | null;
  registration: string | null;
  holder_entity_id: string | null;
  person_id: string | null;
  is_beneficial: boolean;
  held_for: string | null;
  notes: string | null;
};
export type HolderValues = Omit<Holder, "id">;

export type MovementKind = "issue" | "transfer" | "buy_back" | "cancellation" | "redemption" | "conversion" | "split" | "consolidation";
export type Movement = {
  id: string;
  kind: MovementKind;
  class_id: string;
  shares: number | null;
  from_holder_id: string | null;
  to_holder_id: string | null;
  to_class_id: string | null;
  to_shares: number | null;
  ratio_from: number | null;
  ratio_to: number | null;
  price_per_share: number | null;
  paid_per_share: number | null;
  unpaid_per_share: number;
  consideration: string | null;
  effective_on: string;
  resolution_id: string | null;
  approval_note: string | null;
  certificate_number: string | null;
  cancelled_certificate: string | null;
  asic_due_on: string | null;
  asic_lodged_on: string | null;
  asic_reference: string | null;
  esop_grant_id: string | null;
  convertible_id: string | null;
  notes: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
};
export type MovementValues = Pick<Movement, "kind" | "class_id" | "shares" | "from_holder_id" | "to_holder_id" | "to_class_id" | "to_shares" | "ratio_from" | "ratio_to"
  | "price_per_share" | "paid_per_share" | "unpaid_per_share" | "consideration" | "effective_on" | "resolution_id" | "approval_note" | "certificate_number" | "cancelled_certificate" | "notes">;

export type Position = { shareholder_id: string; class_id: string; shares: number; paid: number; unpaid: number };

export type Plan = {
  id: string;
  name: string;
  class_id: string | null;
  pool_size: number;
  adopted_on: string | null;
  resolution_id: string | null;
  startup_concession: boolean | null;
  notes: string | null;
  status: "active" | "closed";
  /** Migration 0045 */
  plan_type: "esop" | "mip";
  hurdle_value: number | null;
  hurdle_note: string | null;
  performance_conditions: string | null;
  exit_only: boolean | null;
  funding: "nil_cost" | "paid" | "loan_funded" | null;
  settlement: "equity" | "cash";
};
export type PlanValues = Omit<Plan, "id">;
export type Grant = {
  id: string;
  plan_id: string;
  holder_name: string;
  person_id: string | null;
  instrument: "option" | "right" | "share" | "unit";
  number: number;
  exercise_price: number;
  granted_on: string;
  vesting_start_on: string | null;
  vesting_months: number | null;
  cliff_months: number | null;
  vesting_every: "monthly" | "quarterly" | "annually";
  acceleration: string | null;
  leaver_terms: string | null;
  expires_on: string | null;
  exercised: number;
  lapsed: number;
  resolution_id: string | null;
  notes: string | null;
  /** Migration 0045 */
  performance_conditions: string | null;
  loan_amount: number | null;
  loan_terms: string | null;
  settled: number;
};
export type GrantValues = Omit<Grant, "id" | "exercised">;

export const PLAN_TYPES = { esop: "Employee share option plan (ESOP)", mip: "Management incentive plan (MIP)" } as const;
export const FUNDING_LABELS = { nil_cost: "Nil cost", paid: "Paid for in full", loan_funded: "Funded by a loan from the company" } as const;
export const INSTRUMENT_LABELS: Record<Grant["instrument"], string> = { option: "Options", right: "Rights", share: "Shares", unit: "Phantom units (cash)" };

export type ConvertibleKind = "safe" | "convertible_note" | "warrant" | "investor_option" | "other";
export type Convertible = {
  id: string;
  kind: ConvertibleKind;
  holder_name: string;
  principal: number | null;
  currency: string;
  valuation_cap: number | null;
  discount_pct: number | null;
  interest_rate: number | null;
  issued_on: string | null;
  maturity_on: string | null;
  conversion_trigger: string | null;
  converts_class_id: string | null;
  mfn: boolean | null;
  shares: number | null;
  exercise_price: number | null;
  expires_on: string | null;
  status: "outstanding" | "converted" | "exercised" | "repaid" | "lapsed" | "cancelled";
  resolution_id: string | null;
  notes: string | null;
};
export type ConvertibleValues = Omit<Convertible, "id">;

export type Terms = {
  agreement_dated: string | null;
  drag_along: string | null;
  tag_along: string | null;
  first_refusal: string | null;
  pre_emptive: string | null;
  exit_consents: string | null;
  other_terms: string | null;
};
export type Matter = {
  id: string;
  matter: string;
  consent_from: string;
  class_id: string | null;
  clause: string | null;
  all_contracts: boolean;
  contracts_from: number | null;
  related_party: boolean;
  share_issues: boolean;
  is_active: boolean;
  notes: string | null;
  created_at?: string;
};
export type MatterValues = Omit<Matter, "id" | "created_at">;
export type Consent = { id: string; matter_id: string; subject_table: string; subject_id: string; given_by: string; given_on: string; notes: string | null };
export type EssReport = { id: string; fy_end: number; statements_given_on: string | null; ato_lodged_on: string | null; notes: string | null };
export type ResolutionOption = { id: string; text: string; created_at: string };

export type OwnershipData = {
  ready: boolean;
  classes: ShareClass[];
  holders: Holder[];
  movements: Movement[];
  positions: Position[];
  plans: Plan[];
  grants: Grant[];
  convertibles: Convertible[];
  terms: Terms | null;
  matters: Matter[];
  consents: Consent[];
  ess: EssReport[];
  resolutions: ResolutionOption[];
};

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  issue: "Issue",
  transfer: "Transfer",
  buy_back: "Buy-back",
  cancellation: "Cancellation",
  redemption: "Redemption",
  conversion: "Conversion",
  split: "Split",
  consolidation: "Consolidation",
};
export const HOLDER_KINDS: { id: Holder["kind"]; label: string }[] = [
  { id: "individual", label: "Individual" },
  { id: "company", label: "Company" },
  { id: "trust", label: "Trust (trustee)" },
  { id: "fund", label: "Fund" },
  { id: "other", label: "Other" },
];
export const CONVERTIBLE_LABELS: Record<ConvertibleKind, string> = {
  safe: "SAFE",
  convertible_note: "Convertible note",
  warrant: "Warrant",
  investor_option: "Investor option",
  other: "Other",
};
export const PARTICIPATION_LABELS: Record<NonNullable<ShareClass["liq_participation"]>, string> = {
  non_participating: "Non-participating (preference or convert, whichever is higher)",
  participating: "Participating (preference, then shares in the rest)",
  capped: "Participating up to a cap",
};
export const ANTI_DILUTION_LABELS: Record<NonNullable<ShareClass["anti_dilution"]>, string> = {
  none: "None",
  broad_based: "Broad-based weighted average",
  narrow_based: "Narrow-based weighted average",
  full_ratchet: "Full ratchet",
};

export const blankClass = (): ClassValues => ({
  name: "", code: null, kind: "ordinary", votes_per_share: 1, dividend_rights: null, capital_rights: null, other_rights: null, issue_price: null, currency: "AUD",
  liq_pref_multiple: null, liq_participation: null, liq_cap_multiple: null, liq_seniority: null, anti_dilution: null, converts_to_class_id: null, conversion_ratio: 1,
  auto_conversion: null, dividend_preference: null, pro_rata: null, board_seats: null, information_rights: null, redemption: null, rights_source: null, is_active: true,
});
export const blankHolder = (): HolderValues => ({
  name: "", kind: "individual", address: null, email: null, registration: null, holder_entity_id: null, person_id: null, is_beneficial: true, held_for: null, notes: null,
});

function db() {
  if (!supabase) throw new Error("The site is not connected to its database.");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const tidy = <T extends object>(v: T) => {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = typeof x === "string" ? x.trim() || null : x;
  return out;
};
const num = (x: unknown) => (x == null ? null : Number(x));

export const EMPTY: OwnershipData = {
  ready: false, classes: [], holders: [], movements: [], positions: [], plans: [], grants: [], convertibles: [], terms: null, matters: [], consents: [], ess: [], resolutions: [],
};

export async function loadOwnership(organisationId: string, entityId: string): Promise<OwnershipData> {
  const c = db();
  const [classes, holders, movements, positions, plans, grants, convertibles, terms, matters, consents, ess, resolutions] = await Promise.all([
    c.from("share_classes").select("*").eq("entity_id", entityId).order("created_at"),
    c.from("shareholders").select("*").eq("entity_id", entityId).order("name"),
    c.from("share_movements").select("*").eq("entity_id", entityId).order("effective_on").order("created_at"),
    c.rpc("share_register", { p_entity: entityId, p_as_of: null }),
    c.from("esop_plans").select("*").eq("entity_id", entityId).order("created_at"),
    c.from("esop_grants").select("*").eq("entity_id", entityId).order("granted_on"),
    c.from("convertibles").select("*").eq("entity_id", entityId).order("created_at"),
    c.from("ownership_terms").select("*").eq("entity_id", entityId).maybeSingle(),
    c.from("reserved_matters").select("*").eq("entity_id", entityId).order("created_at"),
    c.from("investor_consents").select("*").eq("entity_id", entityId).order("given_on"),
    c.from("ess_reports").select("*").eq("entity_id", entityId).order("fy_end"),
    c.from("resolutions").select("id, text, created_at").eq("organisation_id", organisationId).eq("outcome", "passed").order("created_at", { ascending: false }).limit(300),
  ]);
  if (classes.error) return EMPTY;
  const n = <T,>(rows: unknown, keys: string[]) =>
    ((rows ?? []) as Record<string, unknown>[]).map((r) => {
      const o = { ...r };
      for (const k of keys) o[k] = num(r[k]);
      return o as T;
    });
  return {
    ready: true,
    classes: n<ShareClass>(classes.data, ["votes_per_share", "issue_price", "liq_pref_multiple", "liq_cap_multiple", "conversion_ratio"]),
    holders: (holders.data ?? []) as Holder[],
    movements: n<Movement>(movements.data, ["shares", "to_shares", "price_per_share", "paid_per_share", "unpaid_per_share"]),
    positions: n<Position>(positions.data, ["shares", "paid", "unpaid"]),
    plans: n<Plan>(plans.data, ["pool_size", "hurdle_value"]).map((x) => ({ ...x, plan_type: x.plan_type ?? "esop", settlement: x.settlement ?? "equity" })),
    grants: n<Grant>(grants.data, ["number", "exercise_price", "exercised", "lapsed", "loan_amount", "settled"]).map((x) => ({ ...x, settled: x.settled ?? 0 })),
    convertibles: n<Convertible>(convertibles.data, ["principal", "valuation_cap", "discount_pct", "interest_rate", "shares", "exercise_price"]),
    terms: (terms.data ?? null) as Terms | null,
    matters: n<Matter>(matters.data, ["contracts_from"]),
    consents: (consents.data ?? []) as Consent[],
    ess: (ess.data ?? []) as EssReport[],
    resolutions: (resolutions.data ?? []) as ResolutionOption[],
  };
}

export async function registerAsAt(entityId: string, asOf: string): Promise<Position[]> {
  const { data, error } = await db().rpc("share_register", { p_entity: entityId, p_as_of: asOf });
  check(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ shareholder_id: r.shareholder_id as string, class_id: r.class_id as string, shares: Number(r.shares), paid: Number(r.paid), unpaid: Number(r.unpaid) }));
}

export async function setStartupMode(entityId: string, on: boolean) {
  check((await db().from("entities").update({ startup_mode: on }).eq("id", entityId)).error);
}

async function save(table: string, organisationId: string, entityId: string, id: string | null, values: object) {
  if (id) {
    check((await db().from(table).update(tidy(values)).eq("id", id)).error);
    return id;
  }
  const { data, error } = await db().from(table).insert({ ...tidy(values), organisation_id: organisationId, entity_id: entityId }).select("id").single();
  check(error);
  return data!.id as string;
}
export const saveClass = (o: string, e: string, id: string | null, v: ClassValues) => save("share_classes", o, e, id, v);
export const saveHolder = (o: string, e: string, id: string | null, v: HolderValues) => save("shareholders", o, e, id, v);
export const recordMovement = (o: string, e: string, v: MovementValues) => save("share_movements", o, e, null, v);
export const savePlan = (o: string, e: string, id: string | null, v: PlanValues) => save("esop_plans", o, e, id, v);
export const saveGrant = (o: string, e: string, id: string | null, v: GrantValues) => save("esop_grants", o, e, id, v);
export const saveConvertible = (o: string, e: string, id: string | null, v: ConvertibleValues) => save("convertibles", o, e, id, v);
export const saveMatter = (o: string, e: string, id: string | null, v: MatterValues) => save("reserved_matters", o, e, id, v);

export async function updateMovementRecords(id: string, patch: Partial<Pick<Movement, "resolution_id" | "approval_note" | "certificate_number" | "cancelled_certificate" | "asic_lodged_on" | "asic_reference" | "notes">>) {
  check((await db().from("share_movements").update(tidy(patch)).eq("id", id)).error);
}
export async function voidMovement(id: string, reason: string) {
  check((await db().rpc("void_share_movement", { p_movement: id, p_reason: reason })).error);
}
export async function issueFromInstrument(source: "esop_grants" | "convertibles", id: string, v: { shareholderId: string; classId: string; shares: number; price: number | null; effectiveOn: string; certificate: string; resolutionId: string | null }) {
  const { error } = await db().rpc("issue_from_instrument", {
    p_source: source, p_id: id, p_shareholder: v.shareholderId, p_class: v.classId, p_shares: v.shares, p_price: v.price, p_effective_on: v.effectiveOn,
    p_certificate: v.certificate || null, p_resolution: v.resolutionId,
  });
  check(error);
}
export async function saveTerms(organisationId: string, entityId: string, t: Terms, exists: boolean) {
  const values = tidy(t);
  if (exists) check((await db().from("ownership_terms").update(values).eq("entity_id", entityId)).error);
  else check((await db().from("ownership_terms").insert({ ...values, entity_id: entityId, organisation_id: organisationId })).error);
}
export async function recordConsent(organisationId: string, entityId: string, v: { matterId: string; subjectTable: string; subjectId: string; givenBy: string; givenOn: string; notes: string }) {
  check((await db().from("investor_consents").insert({
    organisation_id: organisationId, entity_id: entityId, matter_id: v.matterId, subject_table: v.subjectTable, subject_id: v.subjectId,
    given_by: v.givenBy.trim(), given_on: v.givenOn, notes: v.notes.trim() || null,
  })).error);
}
export async function saveEss(organisationId: string, entityId: string, fyEnd: number, existing: EssReport | undefined, patch: Partial<Pick<EssReport, "statements_given_on" | "ato_lodged_on">>) {
  if (existing) check((await db().from("ess_reports").update(patch).eq("id", existing.id)).error);
  else check((await db().from("ess_reports").insert({ organisation_id: organisationId, entity_id: entityId, fy_end: fyEnd, ...patch })).error);
}

// ---------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------
export const fmt = (n: number, dp = 0) => n.toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const money = (n: number | null | undefined, currency = "AUD") =>
  n == null ? "" : `${currency === "AUD" ? "$" : `${currency} `}${n.toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(2)}%` : "");

const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return Math.max(0, m);
};

/** How many of a grant have vested by a date. null when no vesting schedule is recorded. */
export function vestedBy(g: Grant, asOf: string): number | null {
  if (g.vesting_months == null) return null;
  if (g.vesting_months === 0) return g.number;
  const start = g.vesting_start_on ?? g.granted_on;
  if (asOf < start) return 0;
  const elapsed = monthsBetween(start, asOf);
  if (g.cliff_months && elapsed < g.cliff_months) return 0;
  const step = g.vesting_every === "annually" ? 12 : g.vesting_every === "quarterly" ? 3 : 1;
  const months = Math.min(g.vesting_months, Math.floor(elapsed / step) * step);
  return Math.floor((g.number * months) / g.vesting_months);
}
export const outstanding = (g: Grant) => g.number - g.exercised - g.lapsed - (g.settled ?? 0);
export function vestingSummary(g: Grant) {
  if (g.vesting_months == null) return "No vesting schedule recorded";
  if (g.vesting_months === 0) return "Vested on grant";
  const every = g.vesting_every === "annually" ? "yearly" : g.vesting_every;
  return `${g.vesting_months} months, ${every}${g.cliff_months ? `, ${g.cliff_months}-month cliff` : ""}`;
}

/** Financial year (ending 30 June) that a date falls in */
export const fyOf = (iso: string) => (Number(iso.slice(5, 7)) >= 7 ? Number(iso.slice(0, 4)) + 1 : Number(iso.slice(0, 4)));
export type EssDue = { fyEnd: number; grants: number; statementsDue: string; atoDue: string; report?: EssReport };
/** Employee share scheme reporting: statements to employees by 14 July and the ATO report by 14 August after each year with grants */
export function essDue(data: Pick<OwnershipData, "grants" | "ess">): EssDue[] {
  const years = new Map<number, number>();
  // Cash-settled units are not employee share scheme interests
  for (const g of data.grants.filter((x) => x.instrument !== "unit")) years.set(fyOf(g.granted_on), (years.get(fyOf(g.granted_on)) ?? 0) + 1);
  return [...years.entries()].sort((a, b) => b[0] - a[0]).map(([fy, n]) => ({
    fyEnd: fy, grants: n, statementsDue: `${fy}-07-14`, atoDue: `${fy}-08-14`, report: data.ess.find((r) => r.fy_end === fy),
  }));
}

/**
 * Reserved matters that need investor consent for a share issue, grant or convertible, and have none.
 * Only for things dated on or after the shareholders' agreement (or, if its date is not recorded, after the
 * matter was entered): issues before the investors came in did not need their consent.
 */
export function consentsMissing(data: Pick<OwnershipData, "matters" | "consents" | "terms">, subjectTable: string, subjectId: string, subjectDate: string | null) {
  return data.matters.filter((m) => {
    if (!m.is_active || !m.share_issues) return false;
    const from = data.terms?.agreement_dated ?? m.created_at?.slice(0, 10) ?? null;
    if (from && subjectDate && subjectDate < from) return false;
    return !data.consents.some((c) => c.matter_id === m.id && c.subject_table === subjectTable && c.subject_id === subjectId);
  });
}

export type DilutedRow = { key: string; holder: string; instrument: string; shares: number; how: string; estimate?: boolean };
export type Diluted = { rows: DilutedRow[]; total: number; issued: number; notEstimated: { holder: string; why: string }[]; baseClass: ShareClass | null };

/**
 * Fully diluted ownership, in shares of the main ordinary class. Every row says how it is worked out.
 * SAFEs and notes are estimated at their valuation cap (the price the cap implies on the fully diluted
 * shares before they convert); one with no cap cannot be estimated until the next round is priced.
 */
export function fullyDiluted(data: OwnershipData, today: string): Diluted {
  const rows: DilutedRow[] = [];
  const notEstimated: { holder: string; why: string }[] = [];
  const cls = (id: string | null) => data.classes.find((c) => c.id === id);
  const base = data.classes.find((c) => c.kind === "ordinary") ?? data.classes[0] ?? null;
  const holder = (id: string) => data.holders.find((h) => h.id === id)?.name ?? "Unknown holder";
  const asConverted = (c: ShareClass | undefined, shares: number) => {
    if (!c || !base || c.id === base.id || !c.converts_to_class_id) return { shares, how: `${fmt(shares)} ${c?.name ?? ""} shares` };
    return { shares: Math.floor(shares * c.conversion_ratio), how: `${fmt(shares)} ${c.name} × ${c.conversion_ratio} = ${fmt(Math.floor(shares * c.conversion_ratio))} ${cls(c.converts_to_class_id)?.name ?? "shares"} as converted` };
  };
  let issued = 0;
  for (const p of data.positions) {
    const c = cls(p.class_id);
    const r = asConverted(c, p.shares);
    issued += r.shares;
    rows.push({ key: `p-${p.shareholder_id}-${p.class_id}`, holder: holder(p.shareholder_id), instrument: c?.name ?? "Shares", shares: r.shares, how: r.how });
  }
  for (const plan of data.plans) {
    const grants = data.grants.filter((g) => g.plan_id === plan.id);
    if (plan.settlement === "cash") {
      const units = grants.reduce((s, g) => s + outstanding(g), 0);
      if (units > 0) notEstimated.push({ holder: plan.name, why: `${fmt(units)} phantom units are settled in cash, so they do not dilute shareholders (but they are a cost on an exit)` });
      continue;
    }
    for (const g of grants) {
      const o = outstanding(g);
      if (o <= 0) continue;
      const r = asConverted(cls(plan.class_id), o);
      rows.push({ key: `g-${g.id}`, holder: g.holder_name, instrument: `${plan.plan_type === "mip" ? "MIP" : "ESOP"} ${g.instrument}s`, shares: r.shares, how: `${fmt(g.number)} granted − ${fmt(g.exercised)} exercised − ${fmt(g.lapsed)} lapsed = ${fmt(o)} outstanding` });
    }
    if (plan.status === "active") {
      const unallocated = plan.pool_size - grants.reduce((s, g) => s + g.number - g.lapsed, 0);
      if (unallocated > 0) rows.push({ key: `u-${plan.id}`, holder: "Unallocated pool", instrument: plan.name, shares: unallocated, how: `Pool ${fmt(plan.pool_size)} − ${fmt(plan.pool_size - unallocated)} granted (net of lapses)` });
    }
  }
  for (const c of data.convertibles.filter((x) => x.status === "outstanding" && (x.kind === "warrant" || x.kind === "investor_option" || (x.kind === "other" && x.shares)))) {
    const r = asConverted(cls(c.converts_class_id), c.shares ?? 0);
    rows.push({ key: `c-${c.id}`, holder: c.holder_name, instrument: CONVERTIBLE_LABELS[c.kind], shares: r.shares, how: `${fmt(c.shares ?? 0)} shares${c.exercise_price != null ? ` at ${money(c.exercise_price, c.currency)} each` : ""}` });
  }
  const preMoney = rows.reduce((s, r) => s + r.shares, 0);
  for (const c of data.convertibles.filter((x) => x.status === "outstanding" && (x.kind === "safe" || x.kind === "convertible_note"))) {
    if (!c.valuation_cap || !c.principal) {
      notEstimated.push({ holder: c.holder_name, why: `${CONVERTIBLE_LABELS[c.kind]} of ${money(c.principal, c.currency)} has no valuation cap, so its shares depend on the next round price` });
      continue;
    }
    if (preMoney <= 0) {
      notEstimated.push({ holder: c.holder_name, why: "No shares are on the register yet, so the cap price cannot be worked out" });
      continue;
    }
    const years = c.interest_rate && c.issued_on ? Math.max(0, (new Date(`${today}T00:00:00`).getTime() - new Date(`${c.issued_on}T00:00:00`).getTime()) / (365.25 * 86_400_000)) : 0;
    const amount = c.principal * (1 + ((c.interest_rate ?? 0) / 100) * years);
    const price = c.valuation_cap / preMoney;
    const shares = Math.floor(amount / price);
    rows.push({
      key: `c-${c.id}`, holder: c.holder_name, instrument: CONVERTIBLE_LABELS[c.kind], shares, estimate: true,
      how: `Estimate at the cap: ${money(Math.round(amount), c.currency)}${years ? " (with interest to date)" : ""} ÷ ${c.currency === "AUD" ? "$" : `${c.currency} `}${price.toFixed(4)} a share (cap ${money(c.valuation_cap, c.currency)} ÷ ${fmt(preMoney)} shares)`,
    });
  }
  return { rows, total: rows.reduce((s, r) => s + r.shares, 0), issued, notEstimated, baseClass: base };
}

/** Preference stack, most senior first: what each preference class takes before ordinary shareholders */
export function preferenceStack(data: OwnershipData) {
  return data.classes
    .filter((c) => c.kind === "preference")
    .map((c) => {
      const shares = data.positions.filter((p) => p.class_id === c.id).reduce((s, p) => s + p.shares, 0);
      const amount = c.liq_pref_multiple != null && c.issue_price != null ? shares * c.issue_price * c.liq_pref_multiple : null;
      return { cls: c, shares, amount };
    })
    .sort((a, b) => (a.cls.liq_seniority ?? 99) - (b.cls.liq_seniority ?? 99));
}

/** Brings the group chart (entity_relationships) into line with the register for a group company shareholder */
export async function syncGroupChart(organisationId: string, childId: string, parentId: string, pct: number, relId: string | null) {
  if (relId) check((await db().from("entity_relationships").update({ ownership_pct: pct }).eq("id", relId)).error);
  else check((await db().from("entity_relationships").insert({ organisation_id: organisationId, parent_entity_id: parentId, child_entity_id: childId, ownership_pct: pct })).error);
}
