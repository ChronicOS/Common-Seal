import { supabase } from "./supabase";

// Financial Approval Matrix and Signing Delegation (migration 0030).

export type Kind = "financial" | "signing";
export type VersionStatus = "draft" | "proposed" | "in_force" | "superseded" | "rejected" | "withdrawn";

export type Version = {
  id: string;
  kind: Kind;
  number: number;
  status: VersionStatus;
  based_on_id: string | null;
  change_note: string | null;
  meeting_id: string | null;
  agenda_item_id: string | null;
  resolution_id: string | null;
  approval_note: string | null;
  proposed_at: string | null;
  in_force_from: string | null;
  ended_at: string | null;
  created_at: string;
};
export type Fn = { id: string; version_id: string; name: string; position: number; copied_from: string | null };
export type Vertical = { id: string; version_id: string; name: string; description: string | null; position: number; copied_from: string | null };
export type Band = {
  id: string;
  version_id: string;
  vertical_id: string;
  entity_id: string | null;
  position: number;
  up_to: number | null;
  currency: string;
  board: boolean;
  copied_from: string | null;
};
export type Cell = {
  id: string;
  version_id: string;
  band_id: string;
  function_id: string | null;
  operational_position_id: string | null;
  finance_position_id: string | null;
};
export type Position = { id: string; title: string; is_active: boolean };
export type Holding = { id: string; position_id: string; starts_on: string; ends_on: string | null; is_acting: boolean; person: { id: string; full_name: string } };
export type Meeting = { id: string; title: string; scheduled_at: string; status: string; body: { name: string; kind: string } | null };

export type AuthData = {
  versions: Version[];
  functions: Fn[];
  verticals: Vertical[];
  bands: Band[];
  cells: Cell[];
  positions: Position[];
  holdings: Holding[];
  meetings: Meeting[];
  people: { id: string; full_name: string }[];
};

export const KIND_LABEL: Record<Kind, string> = { financial: "Financial Approval Matrix", signing: "Signing Delegation" };
export const STATUS_LABEL: Record<VersionStatus, string> = {
  draft: "Draft",
  proposed: "Awaiting board ratification",
  in_force: "In force",
  superseded: "Superseded",
  rejected: "Not approved by the board",
  withdrawn: "Withdrawn",
};

function db() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadAuthorities(organisationId: string): Promise<AuthData> {
  const client = db();
  check((await client.rpc("ensure_authorities", { p_org: organisationId })).error);
  const versions = await client.from("auth_versions").select("*").eq("organisation_id", organisationId).order("number");
  check(versions.error);
  const all = (versions.data ?? []) as Version[];
  // Only the versions on screen are loaded in full: in force, and any open change
  const live = all.filter((v) => ["in_force", "draft", "proposed"].includes(v.status)).map((v) => v.id);
  const ids = live.length ? live : ["00000000-0000-0000-0000-000000000000"];
  const [functions, verticals, bands, cells, positions, holdings, meetings, people] = await Promise.all([
    client.from("auth_functions").select("id, version_id, name, position, copied_from").in("version_id", ids).order("position"),
    client.from("auth_verticals").select("id, version_id, name, description, position, copied_from").in("version_id", ids).order("position"),
    client.from("auth_bands").select("id, version_id, vertical_id, entity_id, position, up_to, currency, board, copied_from").in("version_id", ids).order("position"),
    client.from("auth_cells").select("id, version_id, band_id, function_id, operational_position_id, finance_position_id").in("version_id", ids),
    client.from("positions").select("id, title, is_active").eq("organisation_id", organisationId).order("title"),
    client.from("position_assignments").select("id, position_id, starts_on, ends_on, is_acting, person:people(id, full_name)").eq("organisation_id", organisationId),
    client
      .from("meetings")
      .select("id, title, scheduled_at, status, body:bodies(name, kind)")
      .eq("organisation_id", organisationId)
      .in("status", ["scheduled", "in_progress"])
      .gte("scheduled_at", new Date(Date.now() - 86_400_000).toISOString())
      .order("scheduled_at"),
    client.from("people").select("id, full_name").eq("organisation_id", organisationId).order("full_name"),
  ]);
  check(functions.error ?? verticals.error ?? bands.error ?? cells.error ?? positions.error ?? holdings.error ?? meetings.error ?? people.error);
  return {
    versions: all,
    functions: (functions.data ?? []) as Fn[],
    verticals: (verticals.data ?? []) as Vertical[],
    bands: ((bands.data ?? []) as Band[]).map((b) => ({ ...b, up_to: num(b.up_to) })),
    cells: (cells.data ?? []) as Cell[],
    positions: (positions.data ?? []) as Position[],
    holdings: (holdings.data ?? []) as unknown as Holding[],
    meetings: (meetings.data ?? []) as unknown as Meeting[],
    people: (people.data ?? []) as { id: string; full_name: string }[],
  };
}

// ---- Versions ----
export async function lockAuthority(versionId: string, note: string) {
  check((await db().rpc("lock_authority", { p_version: versionId, p_note: note })).error);
}
export async function startChange(organisationId: string, kind: Kind) {
  check((await db().rpc("start_authority_change", { p_org: organisationId, p_kind: kind })).error);
}
export async function proposeChange(versionId: string, meetingId: string, note: string) {
  check((await db().rpc("propose_authority_change", { p_version: versionId, p_meeting: meetingId, p_note: note })).error);
}
export async function withdrawChange(versionId: string) {
  check((await db().rpc("withdraw_authority_change", { p_version: versionId })).error);
}
export async function reopenChange(versionId: string) {
  check((await db().rpc("reopen_authority_change", { p_version: versionId })).error);
}
export async function gaps(versionId: string): Promise<string[]> {
  const { data, error } = await db().rpc("authority_gaps", { p_version: versionId });
  check(error);
  return (data ?? []) as string[];
}

// ---- Editing a draft ----
export async function addFunction(organisationId: string, versionId: string, name: string, position: number) {
  check((await db().from("auth_functions").insert({ organisation_id: organisationId, version_id: versionId, name: name.trim(), position })).error);
}
export async function renameFunction(id: string, name: string) {
  check((await db().from("auth_functions").update({ name: name.trim() }).eq("id", id)).error);
}
export async function removeFunction(id: string) {
  check((await db().from("auth_functions").delete().eq("id", id)).error);
}
export async function addVertical(organisationId: string, versionId: string, name: string, position: number) {
  const created = await db().from("auth_verticals").insert({ organisation_id: organisationId, version_id: versionId, name: name.trim(), position }).select("id").single();
  check(created.error);
  // A new vertical starts with one band that goes to the board
  check((await db().from("auth_bands").insert({ organisation_id: organisationId, version_id: versionId, vertical_id: created.data!.id, position: 1, board: true })).error);
}
export async function renameVertical(id: string, name: string) {
  check((await db().from("auth_verticals").update({ name: name.trim() }).eq("id", id)).error);
}
export async function removeVertical(id: string) {
  check((await db().from("auth_verticals").delete().eq("id", id)).error);
}

/** Adds a band below the top one, so the board band stays last. Positions are renumbered. */
export async function addBand(organisationId: string, versionId: string, verticalId: string, entityId: string | null, list: Band[]) {
  const client = db();
  const sorted = [...list].sort((a, b) => a.position - b.position);
  const top = sorted[sorted.length - 1];
  const below = sorted.filter((b) => b !== top);
  const highest = below.length ? below[below.length - 1].up_to : null;
  // Renumber first, leaving a gap before the top band
  for (const [n, b] of below.entries()) if (b.position !== n + 1) check((await client.from("auth_bands").update({ position: n + 1 }).eq("id", b.id)).error);
  if (top) check((await client.from("auth_bands").update({ position: below.length + 2 }).eq("id", top.id)).error);
  check(
    (
      await client.from("auth_bands").insert({
        organisation_id: organisationId,
        version_id: versionId,
        vertical_id: verticalId,
        entity_id: entityId,
        position: below.length + 1,
        up_to: highest ? highest * 10 : 10000,
        board: false,
      })
    ).error,
  );
}
export async function updateBand(id: string, patch: Partial<Pick<Band, "up_to" | "board">>) {
  check((await db().from("auth_bands").update(patch).eq("id", id)).error);
}
export async function removeBand(id: string) {
  check((await db().from("auth_bands").delete().eq("id", id)).error);
}

/** Sets one approver in a cell, creating the cell if needed. */
export async function setApprover(
  organisationId: string,
  versionId: string,
  bandId: string,
  functionId: string | null,
  existing: Cell | undefined,
  column: "operational_position_id" | "finance_position_id",
  positionId: string | null,
) {
  const client = db();
  if (existing) check((await client.from("auth_cells").update({ [column]: positionId }).eq("id", existing.id)).error);
  else check((await client.from("auth_cells").insert({ organisation_id: organisationId, version_id: versionId, band_id: bandId, function_id: functionId, [column]: positionId })).error);
}

/** A company's own bands for one vertical, starting as a copy of the group's. */
export async function varyForCompany(organisationId: string, versionId: string, verticalId: string, entityId: string, groupBands: Band[], cells: Cell[]) {
  const client = db();
  for (const b of [...groupBands].sort((x, y) => x.position - y.position)) {
    const created = await client
      .from("auth_bands")
      .insert({ organisation_id: organisationId, version_id: versionId, vertical_id: verticalId, entity_id: entityId, position: b.position, up_to: b.up_to, currency: b.currency, board: b.board })
      .select("id")
      .single();
    check(created.error);
    const copies = cells
      .filter((c) => c.band_id === b.id)
      .map((c) => ({
        organisation_id: organisationId,
        version_id: versionId,
        band_id: created.data!.id,
        function_id: c.function_id,
        operational_position_id: c.operational_position_id,
        finance_position_id: c.finance_position_id,
      }));
    if (copies.length) check((await client.from("auth_cells").insert(copies)).error);
  }
}
export async function removeVariation(bandIds: string[]) {
  if (bandIds.length) check((await db().from("auth_bands").delete().in("id", bandIds)).error);
}

// ---- Positions and who holds them ----
export async function addPosition(organisationId: string, title: string): Promise<string> {
  const created = await db().from("positions").insert({ organisation_id: organisationId, title: title.trim() }).select("id").single();
  check(created.error);
  return created.data!.id as string;
}
export async function assignHolder(organisationId: string, positionId: string, person: { id?: string; name?: string }, isActing: boolean) {
  const client = db();
  let personId = person.id;
  if (!personId) {
    const created = await client.from("people").insert({ organisation_id: organisationId, full_name: (person.name ?? "").trim() }).select("id").single();
    check(created.error);
    personId = created.data!.id as string;
  }
  check((await client.from("position_assignments").insert({ organisation_id: organisationId, position_id: positionId, person_id: personId, is_acting: isActing })).error);
}
export async function endHolding(id: string) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  check((await db().from("position_assignments").update({ ends_on: today }).eq("id", id)).error);
}

// ---- Reading ----
export const money = (n: number, currency = "AUD") =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);

export function bandLabel(band: Band, previous: Band | undefined) {
  const from = previous?.up_to ?? null;
  if (band.board) return from === null ? "Any amount: the board" : `Above ${money(from, band.currency)}: the board`;
  if (band.up_to === null) return from === null ? "Any amount" : `Above ${money(from, band.currency)}`;
  return from === null ? `Up to ${money(band.up_to, band.currency)}` : `${money(from, band.currency)} to ${money(band.up_to, band.currency)}`;
}

/** The bands that apply: the company's own if it has any for this vertical, otherwise the group's. */
export function bandsFor(data: AuthData, verticalId: string, entityId: string | null) {
  const own = entityId ? data.bands.filter((b) => b.vertical_id === verticalId && b.entity_id === entityId) : [];
  const group = data.bands.filter((b) => b.vertical_id === verticalId && b.entity_id === null);
  return { list: (own.length ? own : group).sort((a, b) => a.position - b.position), varied: own.length > 0, group };
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const currentHolders = (data: AuthData, positionId: string) =>
  data.holdings.filter((h) => h.position_id === positionId && h.starts_on <= today() && (!h.ends_on || h.ends_on >= today()));

/** Plain-English list of what a change does, compared with the version in force. */
export function describeChanges(data: AuthData, draft: Version, base: Version, entityName: (id: string) => string): string[] {
  const out: string[] = [];
  const pos = (id: string | null) => (id ? data.positions.find((p) => p.id === id)?.title ?? "a removed position" : "nobody");
  const inV = <T extends { version_id: string }>(list: T[], v: Version) => list.filter((x) => x.version_id === v.id);
  const dF = inV(data.functions, draft), bF = inV(data.functions, base);
  const dV = inV(data.verticals, draft), bV = inV(data.verticals, base);
  const dB = inV(data.bands, draft), bB = inV(data.bands, base);
  const dC = inV(data.cells, draft), bC = inV(data.cells, base);
  for (const f of dF) {
    const was = bF.find((x) => x.id === f.copied_from);
    if (!was) out.push(`New function: ${f.name}`);
    else if (was.name !== f.name) out.push(`Function renamed: ${was.name} to ${f.name}`);
  }
  for (const f of bF) if (!dF.some((x) => x.copied_from === f.id)) out.push(`Function removed: ${f.name}`);
  for (const v of dV) {
    const was = bV.find((x) => x.id === v.copied_from);
    if (!was) out.push(`New vertical: ${v.name}`);
    else if (was.name !== v.name) out.push(`Vertical renamed: ${was.name} to ${v.name}`);
  }
  for (const v of bV) if (!dV.some((x) => x.copied_from === v.id)) out.push(`Vertical removed: ${v.name}`);
  const fnName = (id: string | null, list: Fn[]) => (id ? list.find((f) => f.id === id)?.name ?? "" : "");
  for (const b of dB) {
    const vertical = dV.find((v) => v.id === b.vertical_id)?.name ?? "";
    const scope = b.entity_id ? ` for ${entityName(b.entity_id)}` : "";
    const was = bB.find((x) => x.id === b.copied_from);
    const limit = (x: Band) => (x.board ? "goes to the board" : x.up_to === null ? "no upper limit" : `up to ${money(x.up_to, x.currency)}`);
    if (!was) {
      if (dV.find((v) => v.id === b.vertical_id)?.copied_from) out.push(`${vertical}${scope}: new band, ${limit(b)}`);
      continue;
    }
    if (was.up_to !== b.up_to || was.board !== b.board) out.push(`${vertical}${scope}: band ${b.position} changed from ${limit(was)} to ${limit(b)}`);
    for (const c of dC.filter((x) => x.band_id === b.id)) {
      const fromFn = dF.find((f) => f.id === c.function_id)?.copied_from ?? null;
      const old = bC.find((x) => x.band_id === was.id && (x.function_id ?? null) === fromFn);
      const fn = fnName(c.function_id, dF);
      const label = draft.kind === "financial" ? ["operational approver", "finance approver"] : ["first signatory", "second signatory"];
      if ((old?.operational_position_id ?? null) !== c.operational_position_id)
        out.push(`${vertical}${scope}, band ${b.position}${fn ? `, ${fn}` : ""}: ${label[0]} ${pos(old?.operational_position_id ?? null)} to ${pos(c.operational_position_id)}`);
      if ((old?.finance_position_id ?? null) !== c.finance_position_id)
        out.push(`${vertical}${scope}, band ${b.position}${fn ? `, ${fn}` : ""}: ${label[1]} ${pos(old?.finance_position_id ?? null)} to ${pos(c.finance_position_id)}`);
    }
  }
  for (const b of bB) {
    if (dB.some((x) => x.copied_from === b.id)) continue;
    const vertical = bV.find((v) => v.id === b.vertical_id);
    if (vertical && !dV.some((x) => x.copied_from === vertical.id)) continue;
    out.push(`${vertical?.name ?? ""}${b.entity_id ? ` for ${entityName(b.entity_id)}` : ""}: band ${b.position} removed`);
  }
  return out;
}
