import { companyChoice } from "./currentCompany";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Attachments from "./Attachments";
import { today } from "./authorities";
import { formatDay } from "./board";
import {
  addDays, addDocument, addFiling, addMonths, appointOfficer, ASIC_ROLES, currentReviewDate, decideFiling, DOC_CATEGORIES, docLabel, FORM_LABELS, loadCompanyRegister,
  lodgeFiling, nextReviewDate, ROLE_LABELS, saveOfficerDetails, saveReview, setOfficerDates, updateCompany,
  type AnnualReview, type DocCategory, type Filing, type Officer, type OfficerDetails, type RegisterData,
} from "./companyRegister";
import { loadOwnership, MOVEMENT_LABELS, updateMovementRecords, type Movement, type OwnershipData } from "./ownership";
import {
  ConsentToAct, FilingSheet, PrintView, RegisterOfMembers, RegisterOfOfficers, RegisterOfOptions, ShareCertificate, ShareFilingSheet, SolvencyResolution,
} from "./RegisterDocs";
import { FORM_LABELS as ENTITY_FORMS, type Entity, type GroupData } from "./types";

type Sub = "overview" | "officers" | "documents" | "filings" | "review" | "registers";
type Props = { organisationId: string; group: GroupData | null; canEdit: boolean; onChanged: () => void | Promise<void>; onAddEntity: () => void };
type Sheet = { title: string; body: ReactNode } | null;

const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");

function Text({ id, label, value, onChange, type = "text", wide, placeholder }: { id: string; label: string; value: string | null; onChange: (v: string) => void; type?: string; wide?: boolean; placeholder?: string }) {
  return (
    <span className={wide ? "field grow" : "field"}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

/** Company, Company register: documents, officers' details, ASIC filings, the annual review and the statutory registers */
export default function CompanyRegister({ organisationId, group, canEdit, onChanged, onAddEntity }: Props) {
  const entities = useMemo(() => (group?.entities ?? []).filter((e) => e.status !== "deregistered"), [group]);
  const [entityId, setEntityIdState] = useState<string | null>(() => (entities.some((e) => e.id === companyChoice.id) ? companyChoice.id : entities[0]?.id ?? null));
  const setEntityId = (id: string | null) => {
    companyChoice.id = id;
    setEntityIdState(id);
  };
  useEffect(() => {
    if ((!entityId || !entities.some((e) => e.id === entityId)) && entities[0]) setEntityIdState(entities[0].id);
  }, [entities, entityId]);
  const entity = entities.find((e) => e.id === entityId) ?? null;
  const [sub, setSub] = useState<Sub>("overview");
  const [data, setData] = useState<RegisterData | null>(null);
  const [own, setOwn] = useState<OwnershipData | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const t = today();

  const reload = useCallback(async () => {
    if (!entityId) return;
    try {
      const [r, o] = await Promise.all([loadCompanyRegister(organisationId, entityId), loadOwnership(organisationId, entityId).catch(() => null)]);
      setData(r);
      setOwn(o);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load the register.");
    }
  }, [organisationId, entityId]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  const run = async (work: () => Promise<unknown>, done: string, alsoGroup = false) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      if (alsoGroup) await onChanged();
      setNotice(done);
      await reload();
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <>
      <p className="eyebrow">Company</p>
      <h1>Company register</h1>
      <p className="lead">The company's records in one place: incorporation documents, constitution and certificates, office holders' details, the statutory registers, and every change that needs telling ASIC, with the form filled in ready to lodge.</p>
      {entities.length > 0 && (
        <div className="row wrap block-gap entity-picker">
          <span className="field">
            <label htmlFor="reg-entity">Company</label>
            <select id="reg-entity" value={entityId ?? ""} onChange={(e) => { setEntityId(e.target.value); setSub("overview"); setNotice(null); }}>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </span>
          {canEdit && <button type="button" className="quiet" onClick={onAddEntity}>+ Add entity</button>}
        </div>
      )}
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!entity) return <>{header}<p className="muted">No companies yet.</p>{canEdit && <button type="button" onClick={onAddEntity}>Add a company</button>}</>;
  if (!data) return <>{header}<p className="muted">Loading…</p></>;
  if (!data.ready) return <>{header}<p className="card warning">The company register is not set up yet. Run migration 0047 in Supabase, then reload.</p></>;

  const ctx = { entity, officers: data.officers, details: data.details, own: own ?? ({ holders: [], classes: [], positions: [], movements: [], grants: [], plans: [], convertibles: [] } as unknown as OwnershipData) };
  const shareFilings = (own?.movements ?? []).filter((m) => !m.voided_at && m.asic_due_on && !m.asic_lodged_on);
  const toCheck = data.filings.filter((f) => f.status === "to_check");
  const toLodge = data.filings.filter((f) => f.status === "to_lodge");
  const overdue = toLodge.filter((f) => f.due_on! < t).length + shareFilings.filter((m) => m.asic_due_on! < t).length;
  const gaps = documentGaps(entity, data, own);
  const subs: { id: Sub; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "officers", label: "Office holders" },
    { id: "documents", label: `Documents${gaps.length ? ` (${gaps.length} missing)` : ""}` },
    { id: "filings", label: `ASIC filings${toCheck.length + toLodge.length + shareFilings.length ? ` (${toCheck.length + toLodge.length + shareFilings.length})` : ""}` },
    { id: "review", label: "Annual review" },
    { id: "registers", label: "Registers" },
  ];

  return (
    <>
      {header}
      {sheet && <PrintView title={sheet.title} onClose={() => setSheet(null)}>{sheet.body}</PrintView>}
      <dl className="facts">
        <div><dt>To check</dt><dd className={toCheck.length ? "warning-text" : undefined}>{toCheck.length}</dd></div>
        <div><dt>To lodge with ASIC</dt><dd className={overdue ? "warning-text" : undefined}>{toLodge.length + shareFilings.length}{overdue ? ` (${overdue} overdue)` : ""}</dd></div>
        <div><dt>Documents missing</dt><dd className={gaps.length ? "warning-text" : undefined}>{gaps.length}</dd></div>
        <div><dt>Next annual review</dt><dd>{day(nextReviewDate(entity.incorporated_on, t)) || <span className="warning-text">Registration date not recorded</span>}</dd></div>
      </dl>
      <span className="segmented block-gap" role="group" aria-label="Company register sections">
        {subs.map((x) => (
          <button key={x.id} type="button" className={sub === x.id ? "on" : undefined} aria-pressed={sub === x.id} onClick={() => { setSub(x.id); setNotice(null); setProblem(null); }}>
            {x.label}
          </button>
        ))}
      </span>
      {sub === "overview" && <OverviewView entity={entity} group={group} data={data} canEdit={canEdit} busy={busy}
        onSave={(patch) => run(() => updateCompany(entity.id, patch), "Saved. If an address changed, check whether ASIC needs to be told under ASIC filings.", true)} />}
      {sub === "officers" && <OfficersView entity={entity} data={data} canEdit={canEdit} busy={busy} today={t} onSheet={setSheet} ctx={ctx}
        onAppoint={(v) => run(() => appointOfficer(organisationId, entity.id, v), "Appointed. The ASIC notice is under ASIC filings.", true)}
        onDates={(id, patch, done) => run(() => setOfficerDates(id, patch), done, true)}
        onDetails={(personId, exists, v) => run(() => saveOfficerDetails(organisationId, personId, exists, v), "Details saved.")} />}
      {sub === "documents" && <DocumentsView entity={entity} data={data} own={own} gaps={gaps} canEdit={canEdit} busy={busy} onSheet={setSheet} ctx={ctx}
        onAdd={(v) => run(() => addDocument(organisationId, entity.id, v), "Document recorded. Attach the file below it.")} />}
      {sub === "filings" && <FilingsView data={data} shareFilings={shareFilings} canEdit={canEdit} busy={busy} today={t} onSheet={setSheet} ctx={ctx}
        onDecide={(id, needed, on, reason) => run(() => decideFiling(id, needed, on, reason), needed ? "Marked as a change to lodge. The form is ready under Prepare." : "Recorded: no filing needed.")}
        onLodge={(id, on, ref) => run(() => lodgeFiling(id, on, ref), "Recorded as lodged.")}
        onLodgeShares={(id, on, ref) => run(() => updateMovementRecords(id, { asic_lodged_on: on, asic_reference: ref || null }), "Recorded as lodged.")}
        onAdd={(form, title, on) => run(() => addFiling(entity.id, form, title, on), "Added.")} />}
      {sub === "review" && <ReviewView entity={entity} data={data} own={own} canEdit={canEdit} busy={busy} today={t} onSheet={setSheet} ctx={ctx}
        onSave={(existing, date, patch) => run(() => saveReview(organisationId, entity.id, existing, date, patch), "Saved.")} />}
      {sub === "registers" && <RegistersView onSheet={setSheet} ctx={ctx} hasOwnership={Boolean(own?.ready)} />}
    </>
  );
}

// ---------------------------------------------------------------------
// What is missing from the documents
// ---------------------------------------------------------------------
type Gap = { key: string; text: string; category: DocCategory; personId?: string; movement?: Movement; officer?: Officer };
function documentGaps(entity: Entity, data: RegisterData, own: OwnershipData | null): Gap[] {
  const gaps: Gap[] = [];
  const has = (c: DocCategory, f?: (d: RegisterData["docs"][number]) => boolean) => data.docs.some((d) => d.category === c && (!f || f(d)));
  if (!has("certificate_of_registration")) gaps.push({ key: "cert", text: "Certificate of registration", category: "certificate_of_registration" });
  if (entity.constitution_kind !== "replaceable_rules" && !has("constitution")) gaps.push({ key: "const", text: entity.constitution_kind ? "Constitution" : "Constitution (or record that the company relies on the replaceable rules)", category: "constitution" });
  const t = today();
  if (!has("company_statement", (d) => Boolean(d.effective_on && d.effective_on >= addMonths(t, -13)))) gaps.push({ key: "stmt", text: "Annual company statement from the last 13 months", category: "company_statement" });
  for (const o of data.officers.filter((x) => !x.ceased_on && ASIC_ROLES.includes(x.role))) {
    if (!has("consent_to_act", (d) => d.person_id === o.person.id)) gaps.push({ key: `c-${o.id}`, text: `Signed consent to act: ${o.person.full_name} (${ROLE_LABELS[o.role].toLowerCase()})`, category: "consent_to_act", personId: o.person.id, officer: o });
  }
  for (const m of (own?.movements ?? []).filter((x) => !x.voided_at && (x.kind === "issue" || x.kind === "transfer"))) {
    if (!has("share_certificate", (d) => d.share_movement_id === m.id)) gaps.push({ key: `s-${m.id}`, text: `Share certificate${m.certificate_number ? ` ${m.certificate_number}` : ""}: ${MOVEMENT_LABELS[m.kind].toLowerCase()} of ${m.shares?.toLocaleString("en-AU")} shares on ${day(m.effective_on)}`, category: "share_certificate", movement: m });
  }
  return gaps;
}

// ---------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------
function OverviewView({ entity, group, data, canEdit, busy, onSave }: { entity: Entity; group: GroupData | null; data: RegisterData; canEdit: boolean; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ registered_office: entity.registered_office, principal_place: entity.principal_place ?? null, constitution_kind: entity.constitution_kind ?? null,
    ultimate_holding_name: entity.ultimate_holding_name ?? null, ultimate_holding_acn: entity.ultimate_holding_acn ?? null, ultimate_holding_country: entity.ultimate_holding_country ?? null });
  // The top of the group chain above this company
  const top = useMemo(() => {
    let cur = entity.id;
    const seen = new Set<string>();
    for (;;) {
      const parent = group?.relationships.find((r) => r.child_entity_id === cur && !r.ends_on && (r.ownership_pct ?? 0) > 50);
      if (!parent || seen.has(parent.parent_entity_id)) break;
      seen.add(cur);
      cur = parent.parent_entity_id;
    }
    return group?.entities.find((e) => e.id === cur) ?? entity;
  }, [group, entity]);
  const uhc = top.ultimate_holding_name ? `${top.ultimate_holding_name}${top.id !== entity.id ? ` (through ${top.name})` : ""}` : top.id !== entity.id ? top.name : "None recorded (this company is at the top)";
  const directors = data.officers.filter((o) => !o.ceased_on && (o.role === "director" || o.role === "alternate_director"));
  const secretaries = data.officers.filter((o) => !o.ceased_on && o.role === "secretary");
  const row = (label: string, value: ReactNode, missing = false) => (
    <div><dt>{label}</dt><dd className={missing ? "warning-text" : undefined}>{value}</dd></div>
  );
  if (editing) {
    return (
      <div className="card form">
        <h2>Company details</h2>
        <p className="muted small">Changing an address here flags it under ASIC filings, where you confirm whether it is a real change (to notify within 28 days) or a correction.</p>
        <Text id="r-office" label="Registered office" value={v.registered_office} onChange={(x) => setV({ ...v, registered_office: x })} wide />
        <Text id="r-ppb" label="Principal place of business" value={v.principal_place} onChange={(x) => setV({ ...v, principal_place: x })} wide />
        <span className="field">
          <label htmlFor="r-const">Constitution</label>
          <select id="r-const" value={v.constitution_kind ?? ""} onChange={(e) => setV({ ...v, constitution_kind: (e.target.value || null) as "own" | "replaceable_rules" | null })}>
            <option value="">Not recorded</option>
            <option value="own">Has its own constitution</option>
            <option value="replaceable_rules">Relies on the replaceable rules</option>
          </select>
        </span>
        {top.id === entity.id && (
          <fieldset className="plain-fieldset">
            <legend>Ultimate holding company outside the group (if any)</legend>
            <div className="row wrap">
              <Text id="r-uhc" label="Name" value={v.ultimate_holding_name} onChange={(x) => setV({ ...v, ultimate_holding_name: x })} wide />
              <Text id="r-uhc-acn" label="ACN or ABN" value={v.ultimate_holding_acn} onChange={(x) => setV({ ...v, ultimate_holding_acn: x })} />
              <Text id="r-uhc-c" label="Country (if overseas)" value={v.ultimate_holding_country} onChange={(x) => setV({ ...v, ultimate_holding_country: x })} />
            </div>
          </fieldset>
        )}
        <div className="row">
          <button type="button" disabled={busy} onClick={async () => { if (await onSave(v)) setEditing(false); }}>Save</button>
          <button type="button" className="quiet" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <section className="card block">
      <div className="row spread">
        <h2>{entity.name}</h2>
        {canEdit && <button type="button" className="link-dark small" onClick={() => setEditing(true)}>Edit details</button>}
      </div>
      <dl className="detail-list compact">
        {row("Type", entity.legal_form ? ENTITY_FORMS[entity.legal_form] : "Not recorded", !entity.legal_form)}
        {row("ACN", entity.acn ?? "Not recorded", !entity.acn)}
        {row("ABN", entity.abn ?? "Not recorded")}
        {row("Registered", entity.incorporated_on ? day(entity.incorporated_on) : "Not recorded", !entity.incorporated_on)}
        {row("Registered office", entity.registered_office ?? "Not recorded", !entity.registered_office)}
        {row("Principal place of business", entity.principal_place ?? "Not recorded", !entity.principal_place)}
        {row("Constitution", entity.constitution_kind === "own" ? "Its own constitution" : entity.constitution_kind === "replaceable_rules" ? "Replaceable rules" : "Not recorded", !entity.constitution_kind)}
        {row("Ultimate holding company", uhc)}
        {row("Directors", directors.map((o) => o.person.full_name).join(", ") || "None recorded", directors.length === 0)}
        {row("Company secretary", secretaries.map((o) => o.person.full_name).join(", ") || (entity.legal_form === "public_company" ? "None recorded: a public company must have one" : "None"), entity.legal_form === "public_company" && secretaries.length === 0)}
        {(entity.former_names ?? []).length > 0 && row("Former names", (entity.former_names ?? []).join(", "))}
      </dl>
      <p className="muted small">Company name, ACN, ABN and type are edited under Company Info. A change of name there is flagged for Form 205.</p>
    </section>
  );
}

// ---------------------------------------------------------------------
// Office holders
// ---------------------------------------------------------------------
type DetailsValues = Omit<OfficerDetails, "person_id">;
function OfficersView({ entity, data, canEdit, busy, today: t, onSheet, ctx, onAppoint, onDates, onDetails }: {
  entity: Entity; data: RegisterData; canEdit: boolean; busy: boolean; today: string; onSheet: (s: Sheet) => void; ctx: Parameters<typeof ConsentToAct>[0]["ctx"];
  onAppoint: (v: { personId: string | null; fullName: string; role: Officer["role"]; appointedOn: string | null }) => Promise<boolean>;
  onDates: (id: string, patch: { appointed_on?: string | null; ceased_on?: string | null }, done: string) => Promise<boolean>;
  onDetails: (personId: string, exists: boolean, v: DetailsValues) => Promise<boolean>;
}) {
  const [appoint, setAppoint] = useState<{ name: string; personId: string | null; role: Officer["role"]; on: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DetailsValues | null>(null);
  const [cease, setCease] = useState<{ id: string; on: string } | null>(null);
  const [dateFor, setDateFor] = useState<{ id: string; on: string } | null>(null);
  const current = data.officers.filter((o) => !o.ceased_on);
  const former = data.officers.filter((o) => o.ceased_on);
  const detailsOf = (personId: string) => data.details.find((d) => d.person_id === personId);
  const hasConsent = (personId: string) => data.docs.some((d) => d.category === "consent_to_act" && d.person_id === personId);
  const card = (o: Officer) => {
    const pd = detailsOf(o.person.id);
    const asic = ASIC_ROLES.includes(o.role);
    const missing = asic ? [!pd?.date_of_birth && "date of birth", !pd?.place_of_birth && "place of birth", !pd?.residential_address && "residential address",
      o.role !== "secretary" && !pd?.director_id_confirmed_on && "Director ID confirmation"].filter(Boolean) as string[] : [];
    return (
      <li key={o.id}>
        <div className="row spread">
          <span>
            <strong>{o.person.full_name}</strong> <span className="muted small">· {ROLE_LABELS[o.role]}</span>
            <span className="small"> · appointed {o.appointed_on ? day(o.appointed_on) : <span className="warning-text">date not recorded</span>}{o.ceased_on ? ` · ceased ${day(o.ceased_on)}` : ""}</span>
          </span>
          <span className="row">
            {asic && !o.ceased_on && <button type="button" className="link-dark small" onClick={() => onSheet({ title: `Consent to act: ${o.person.full_name}`, body: <ConsentToAct o={o} ctx={ctx} /> })}>Consent to act</button>}
            {canEdit && <button type="button" className="link-dark small" onClick={() => { setEditing(o.person.id); setForm({ date_of_birth: pd?.date_of_birth ?? null, place_of_birth: pd?.place_of_birth ?? null, residential_address: pd?.residential_address ?? null, former_names: pd?.former_names ?? null, director_id_confirmed_on: pd?.director_id_confirmed_on ?? null, director_id: pd?.director_id ?? null }); }}>Details</button>}
            {canEdit && !o.appointed_on && <button type="button" className="link-dark small" onClick={() => setDateFor({ id: o.id, on: "" })}>Add appointment date</button>}
            {canEdit && !o.ceased_on && <button type="button" className="link-dark small" onClick={() => setCease({ id: o.id, on: t })}>Ceased</button>}
          </span>
        </div>
        {asic && !o.ceased_on && (
          <div className="small">
            {missing.length ? <span className="warning-text">For ASIC, not yet recorded: {missing.join(", ")}</span> : <span className="muted">ASIC details complete</span>}
            {" · "}
            {hasConsent(o.person.id) ? <span className="muted">consent on file</span> : <span className="warning-text">no signed consent on file</span>}
          </div>
        )}
        {dateFor?.id === o.id && (
          <span className="row wrap">
            <input aria-label="Appointment date" type="date" max={t} value={dateFor.on} onChange={(e) => setDateFor({ ...dateFor, on: e.target.value })} />
            <button type="button" disabled={busy || !dateFor.on} onClick={async () => { if (await onDates(o.id, { appointed_on: dateFor.on }, "Appointment date saved.")) setDateFor(null); }}>Save date</button>
          </span>
        )}
        {cease?.id === o.id && (
          <span className="row wrap">
            <label className="small" htmlFor={`cease-${o.id}`}>Ceased on</label>
            <input id={`cease-${o.id}`} type="date" max={t} value={cease.on} onChange={(e) => setCease({ ...cease, on: e.target.value })} />
            <button type="button" disabled={busy || !cease.on} onClick={async () => { if (await onDates(o.id, { ceased_on: cease.on }, `${o.person.full_name} recorded as ceased. The ASIC notice is under ASIC filings.`)) setCease(null); }}>Record</button>
            <button type="button" className="link-dark small" onClick={() => setCease(null)}>Cancel</button>
          </span>
        )}
        {editing === o.person.id && form && (
          <div className="card form">
            <p className="muted small">Only owners, administrators, the secretary, legal and compliance can see these, and the person themselves. ASIC needs them for the officeholder register.</p>
            <div className="row wrap">
              <Text id="od-dob" label="Date of birth" type="date" value={form.date_of_birth} onChange={(x) => setForm({ ...form, date_of_birth: x || null })} />
              <Text id="od-pob" label="Place of birth (town, and state or country)" value={form.place_of_birth} onChange={(x) => setForm({ ...form, place_of_birth: x })} wide />
            </div>
            <Text id="od-addr" label="Residential address" value={form.residential_address} onChange={(x) => setForm({ ...form, residential_address: x })} wide />
            <Text id="od-former" label="Former names (if any)" value={form.former_names} onChange={(x) => setForm({ ...form, former_names: x })} wide />
            {o.role !== "secretary" && (
              <div className="row wrap">
                <Text id="od-did-on" label="Director ID confirmed on" type="date" value={form.director_id_confirmed_on} onChange={(x) => setForm({ ...form, director_id_confirmed_on: x || null })} />
                <Text id="od-did" label="Director ID (optional)" value={form.director_id} onChange={(x) => setForm({ ...form, director_id: x })} />
              </div>
            )}
            <div className="row">
              <button type="button" disabled={busy} onClick={async () => { if (await onDetails(o.person.id, Boolean(pd), form)) setEditing(null); }}>Save</button>
              <button type="button" className="quiet" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        )}
      </li>
    );
  };
  return (
    <>
      <p className="muted small">Directors need a Director ID before they are appointed. Appointing or removing a director or secretary, or a change to their name or address, must be notified to ASIC within 28 days; each is flagged under ASIC filings with the form ready.</p>
      {current.length === 0 ? <p className="muted">No office holders recorded.</p> : <ul className="plain rows">{current.map(card)}</ul>}
      {canEdit && !appoint && <p><button type="button" onClick={() => setAppoint({ name: "", personId: null, role: "director", on: t })}>Appoint an office holder</button></p>}
      {appoint && (
        <div className="card form">
          <h3>Appoint an office holder</h3>
          <div className="row wrap">
            <Text id="ap-name" label="Full name" value={appoint.name} onChange={(x) => setAppoint({ ...appoint, name: x, personId: null })} wide />
            <span className="field">
              <label htmlFor="ap-role">Role</label>
              <select id="ap-role" value={appoint.role} onChange={(e) => setAppoint({ ...appoint, role: e.target.value as Officer["role"] })}>
                {(["director", "alternate_director", "secretary", "chair", "public_officer"] as Officer["role"][]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </span>
            <Text id="ap-on" label="Appointed on" type="date" value={appoint.on} onChange={(x) => setAppoint({ ...appoint, on: x })} />
          </div>
          {entity && current.length > 0 && (
            <p className="small">
              Or someone already here:{" "}
              {[...new Map(data.officers.map((o) => [o.person.id, o.person])).values()].map((p, i) => (
                <span key={p.id}>{i ? ", " : ""}<button type="button" className="link-dark small" onClick={() => setAppoint({ ...appoint, name: p.full_name, personId: p.id })}>{p.full_name}</button></span>
              ))}
            </p>
          )}
          {appoint.role !== "secretary" && ASIC_ROLES.includes(appoint.role) && <p className="muted small">Check they hold a Director ID before the appointment takes effect.</p>}
          <div className="row">
            <button type="button" disabled={busy || appoint.name.trim().length < 2 || !appoint.on} onClick={async () => { if (await onAppoint({ personId: appoint.personId, fullName: appoint.name, role: appoint.role, appointedOn: appoint.on })) setAppoint(null); }}>Appoint</button>
            <button type="button" className="quiet" onClick={() => setAppoint(null)}>Cancel</button>
          </div>
        </div>
      )}
      {former.length > 0 && (
        <>
          <h3>Former office holders</h3>
          <ul className="plain rows">{former.map(card)}</ul>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------
type NewDoc = { category: DocCategory; title: string; effective_on: string | null; person_id: string | null; share_movement_id: string | null; notes: string | null };
function DocumentsView({ entity, data, own, gaps, canEdit, busy, onSheet, ctx, onAdd }: {
  entity: Entity; data: RegisterData; own: OwnershipData | null; gaps: Gap[]; canEdit: boolean; busy: boolean; onSheet: (s: Sheet) => void; ctx: Parameters<typeof ConsentToAct>[0]["ctx"];
  onAdd: (v: NewDoc) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState<NewDoc | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const start = (g?: Gap): NewDoc => ({ category: g?.category ?? "certificate_of_registration", title: g ? g.text.replace(/^Signed /, "") : "", effective_on: g?.movement?.effective_on ?? null, person_id: g?.personId ?? null, share_movement_id: g?.movement?.id ?? null, notes: null });
  const byCat = DOC_CATEGORIES.map((c) => ({ ...c, docs: data.docs.filter((d) => d.category === c.id) })).filter((c) => c.docs.length);
  const people = [...new Map(data.officers.map((o) => [o.person.id, o.person])).values()];
  return (
    <>
      {gaps.length > 0 && (
        <section className="card warning block">
          <h2>Missing from the register</h2>
          <ul className="plain rows">
            {gaps.map((g) => (
              <li key={g.key} className="row spread">
                <span>{g.text}</span>
                <span className="row">
                  {g.movement && <button type="button" className="link-dark small" onClick={() => onSheet({ title: "Share certificate", body: <ShareCertificate m={g.movement!} ctx={ctx} /> })}>Prepare certificate</button>}
                  {g.officer && <button type="button" className="link-dark small" onClick={() => onSheet({ title: "Consent to act", body: <ConsentToAct o={g.officer!} ctx={ctx} /> })}>Prepare consent</button>}
                  {canEdit && <button type="button" className="link-dark small" onClick={() => setAdding(start(g))}>Add the signed copy</button>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {adding && (
        <div className="card form">
          <h3>Add a document</h3>
          <div className="row wrap">
            <span className="field">
              <label htmlFor="d-cat">Kind</label>
              <select id="d-cat" value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value as DocCategory })}>
                {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </span>
            <Text id="d-title" label="Title" placeholder={docLabel(adding.category)} value={adding.title} onChange={(x) => setAdding({ ...adding, title: x })} wide />
            <Text id="d-date" label="Dated" type="date" value={adding.effective_on} onChange={(x) => setAdding({ ...adding, effective_on: x || null })} />
          </div>
          {(adding.category === "consent_to_act" || adding.category === "director_id") && (
            <span className="field">
              <label htmlFor="d-person">Whose</label>
              <select id="d-person" value={adding.person_id ?? ""} onChange={(e) => setAdding({ ...adding, person_id: e.target.value || null })}>
                <option value="">Choose</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </span>
          )}
          {adding.category === "share_certificate" && own && (
            <span className="field">
              <label htmlFor="d-move">For which issue or transfer</label>
              <select id="d-move" value={adding.share_movement_id ?? ""} onChange={(e) => setAdding({ ...adding, share_movement_id: e.target.value || null })}>
                <option value="">Choose</option>
                {own.movements.filter((m) => !m.voided_at && (m.kind === "issue" || m.kind === "transfer")).map((m) => (
                  <option key={m.id} value={m.id}>{day(m.effective_on)} · {MOVEMENT_LABELS[m.kind]} of {m.shares?.toLocaleString("en-AU")} to {own.holders.find((h) => h.id === m.to_holder_id)?.name}{m.certificate_number ? ` · ${m.certificate_number}` : ""}</option>
                ))}
              </select>
            </span>
          )}
          <div className="row">
            <button type="button" disabled={busy} onClick={async () => { if (await onAdd({ ...adding, title: adding.title.trim() || docLabel(adding.category) })) { setAdding(null); } }}>Save, then attach the file</button>
            <button type="button" className="quiet" onClick={() => setAdding(null)}>Cancel</button>
          </div>
        </div>
      )}
      {byCat.length === 0 && !adding && <p className="muted">No documents recorded for {entity.name} yet.</p>}
      {byCat.map((c) => (
        <section key={c.id} className="block">
          <h3>{c.label}</h3>
          <ul className="plain rows">
            {c.docs.map((d) => (
              <li key={d.id}>
                <div className="row spread">
                  <span>
                    <strong>{d.title}</strong>
                    {d.effective_on && <span className="muted small"> · {day(d.effective_on)}</span>}
                    {d.person_id && <span className="muted small"> · {people.find((p) => p.id === d.person_id)?.full_name}</span>}
                  </span>
                  <button type="button" className="link-dark small" onClick={() => setOpenId(openId === d.id ? null : d.id)}>{openId === d.id ? "Close" : "Files"}</button>
                </div>
                {openId === d.id && <Attachments subjectTable="corporate_documents" subjectId={d.id} canAttach={canEdit} label="Files" />}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {canEdit && !adding && <p><button type="button" className="quiet" onClick={() => setAdding(start())}>Add a document</button></p>}
    </>
  );
}

// ---------------------------------------------------------------------
// ASIC filings
// ---------------------------------------------------------------------
function FilingsView({ data, shareFilings, canEdit, busy, today: t, onSheet, ctx, onDecide, onLodge, onLodgeShares, onAdd }: {
  data: RegisterData; shareFilings: Movement[]; canEdit: boolean; busy: boolean; today: string; onSheet: (s: Sheet) => void; ctx: Parameters<typeof ConsentToAct>[0]["ctx"];
  onDecide: (id: string, needed: boolean, on: string | null, reason: string | null) => Promise<boolean>;
  onLodge: (id: string, on: string, ref: string) => Promise<boolean>;
  onLodgeShares: (id: string, on: string, ref: string) => Promise<boolean>;
  onAdd: (form: Filing["form"], title: string, on: string | null) => Promise<boolean>;
}) {
  const [act, setAct] = useState<{ id: string; mode: "real" | "no" | "lodge"; on: string; text: string } | null>(null);
  const [extra, setExtra] = useState<{ form: Filing["form"]; title: string; on: string } | null>(null);
  const toCheck = data.filings.filter((f) => f.status === "to_check");
  const toLodge = data.filings.filter((f) => f.status === "to_lodge").sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? ""));
  const done = data.filings.filter((f) => f.status === "lodged" || f.status === "not_required");
  const due = (iso: string | null) => (iso ? <span className={iso < t ? "warning-text" : undefined}>{iso < t ? "overdue since" : "due"} {day(iso)}</span> : null);
  const actions = (id: string, kind: "filing" | "shares") => act?.id === id && (
    <span className="row wrap">
      {act.mode !== "no" && <input aria-label={act.mode === "lodge" ? "Date lodged" : "Date of the change"} type="date" max={t} value={act.on} onChange={(e) => setAct({ ...act, on: e.target.value })} />}
      {act.mode !== "real" && <input aria-label={act.mode === "lodge" ? "ASIC document number" : "Why no filing is needed"} placeholder={act.mode === "lodge" ? "ASIC document number (optional)" : "Correction of a typo; already on ASIC's record"} value={act.text} onChange={(e) => setAct({ ...act, text: e.target.value })} />}
      <button type="button" disabled={busy || (act.mode !== "no" && !act.on) || (act.mode === "no" && act.text.trim().length < 5)} onClick={async () => {
        const ok = act.mode === "lodge" ? (kind === "shares" ? await onLodgeShares(id, act.on, act.text) : await onLodge(id, act.on, act.text)) : await onDecide(id, act.mode === "real", act.mode === "real" ? act.on : null, act.mode === "no" ? act.text : null);
        if (ok) setAct(null);
      }}>Save</button>
      <button type="button" className="link-dark small" onClick={() => setAct(null)}>Cancel</button>
    </span>
  );
  return (
    <>
      {toCheck.length > 0 && (
        <section className="card warning block">
          <h2>To check</h2>
          <p className="small">These might need telling ASIC, or might only be corrections or details already on ASIC's record. Say which.</p>
          <ul className="plain rows">
            {toCheck.map((f) => (
              <li key={f.id}>
                <div className="row spread">
                  <span><strong>{f.title}</strong> <span className="muted small">· {FORM_LABELS[f.form]} · flagged {day(f.created_at)}</span></span>
                  {canEdit && act?.id !== f.id && (
                    <span className="row">
                      <button type="button" className="link-dark small" onClick={() => setAct({ id: f.id, mode: "real", on: f.event_on ?? t, text: "" })}>It's a real change</button>
                      <button type="button" className="link-dark small" onClick={() => setAct({ id: f.id, mode: "no", on: "", text: "" })}>No filing needed</button>
                    </span>
                  )}
                </div>
                {f.detail.old != null && <div className="small muted">From “{String(f.detail.old)}” to “{String(f.detail.new)}”</div>}
                {actions(f.id, "filing")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card block">
        <h2>To lodge with ASIC</h2>
        {toLodge.length + shareFilings.length === 0 ? <p className="muted small">Nothing waiting.</p> : (
          <ul className="plain rows">
            {toLodge.map((f) => (
              <li key={f.id}>
                <div className="row spread">
                  <span><strong>{f.title}</strong> <span className="small"> · {FORM_LABELS[f.form]} · {due(f.due_on)}</span></span>
                  <span className="row">
                    <button type="button" className="link-dark small" onClick={() => onSheet({ title: `${FORM_LABELS[f.form]}: ${f.title}`, body: <FilingSheet filing={f} ctx={ctx} /> })}>Prepare</button>
                    {canEdit && act?.id !== f.id && <button type="button" className="link-dark small" onClick={() => setAct({ id: f.id, mode: "lodge", on: t, text: "" })}>Mark lodged</button>}
                  </span>
                </div>
                {actions(f.id, "filing")}
              </li>
            ))}
            {shareFilings.map((m) => (
              <li key={m.id}>
                <div className="row spread">
                  <span><strong>{MOVEMENT_LABELS[m.kind]} of shares, {day(m.effective_on)}</strong> <span className="small"> · Form 484 · {due(m.asic_due_on)}</span></span>
                  <span className="row">
                    <button type="button" className="link-dark small" onClick={() => onSheet({ title: `Form 484: ${MOVEMENT_LABELS[m.kind]} of shares`, body: <ShareFilingSheet m={m} ctx={ctx} /> })}>Prepare</button>
                    {canEdit && act?.id !== m.id && <button type="button" className="link-dark small" onClick={() => setAct({ id: m.id, mode: "lodge", on: t, text: "" })}>Mark lodged</button>}
                  </span>
                </div>
                {actions(m.id, "shares")}
              </li>
            ))}
          </ul>
        )}
        {canEdit && !extra && <button type="button" className="quiet" onClick={() => setExtra({ form: "484", title: "", on: t })}>Add something else to file</button>}
        {extra && (
          <div className="row wrap">
            <select aria-label="Form" value={extra.form} onChange={(e) => setExtra({ ...extra, form: e.target.value as Filing["form"] })}>
              {(["484", "205", "485", "other"] as Filing["form"][]).map((f) => <option key={f} value={f}>{FORM_LABELS[f]}</option>)}
            </select>
            <input aria-label="What needs filing" placeholder="What needs filing" value={extra.title} onChange={(e) => setExtra({ ...extra, title: e.target.value })} />
            <input aria-label="Date of the change" type="date" max={t} value={extra.on} onChange={(e) => setExtra({ ...extra, on: e.target.value })} />
            <button type="button" disabled={busy || extra.title.trim().length < 3} onClick={async () => { if (await onAdd(extra.form, extra.title, extra.on || null)) setExtra(null); }}>Add</button>
            <button type="button" className="link-dark small" onClick={() => setExtra(null)}>Cancel</button>
          </div>
        )}
      </section>
      {done.length > 0 && (
        <section className="block">
          <h3>Done</h3>
          <ul className="plain rows small">
            {done.map((f) => (
              <li key={f.id}>
                {f.title} · {f.status === "lodged" ? `lodged ${day(f.lodged_on)}${f.reference ? ` (${f.reference})` : ""}${f.due_on && f.lodged_on && f.lodged_on > f.due_on ? " · late" : ""}` : `no filing needed: ${f.not_required_reason}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Annual review
// ---------------------------------------------------------------------
function ReviewView({ entity, data, own, canEdit, busy, today: t, onSheet, ctx, onSave }: {
  entity: Entity; data: RegisterData; own: OwnershipData | null; canEdit: boolean; busy: boolean; today: string; onSheet: (s: Sheet) => void; ctx: Parameters<typeof ConsentToAct>[0]["ctx"];
  onSave: (existing: AnnualReview | undefined, reviewDate: string, patch: Partial<AnnualReview>) => Promise<boolean>;
}) {
  const reviewDate = currentReviewDate(entity.incorporated_on, t);
  if (!entity.incorporated_on) return <p className="card warning">Record the date the company was registered (under Company Info) to work out its annual review date.</p>;
  if (!reviewDate) return <p className="muted">The first annual review is on {day(nextReviewDate(entity.incorporated_on, t))}, a year after registration.</p>;
  const r = data.reviews.find((x) => x.review_date === reviewDate);
  const step = (label: string, dueOn: string | null, doneOn: string | null, key: keyof AnnualReview, extra?: ReactNode) => (
    <li>
      <div className="row spread">
        <span>
          <strong>{label}</strong>
          <span className="small"> · {doneOn ? <span className="muted">done {day(doneOn)}</span> : dueOn ? <span className={dueOn < t ? "warning-text" : undefined}>{dueOn < t ? "overdue since" : "due by"} {day(dueOn)}</span> : null}</span>
        </span>
        {canEdit && !doneOn && <button type="button" className="link-dark small" disabled={busy} onClick={() => onSave(r, reviewDate, { [key]: t } as Partial<AnnualReview>)}>Mark done today</button>}
      </div>
      {extra}
    </li>
  );
  const twoMonths = addMonths(reviewDate, 2);
  return (
    <>
      <section className="card block">
        <h2>Annual review: {day(reviewDate)}</h2>
        <p className="small muted">ASIC sends the annual company statement after the review date (the registration anniversary). Next review: {day(addMonths(reviewDate, 12))}.</p>
        <ol className="plain rows">
          {step("Company statement received", null, r?.statement_received_on ?? null, "statement_received_on", <p className="small muted">Add the statement under Documents as an annual company statement.</p>)}
          {step("Details checked against our records, changes notified", addDays(reviewDate, 28), r?.details_checked_on ?? null, "details_checked_on")}
          {step("Annual review fee paid", twoMonths, r?.fee_paid_on ?? null, "fee_paid_on")}
          <li>
            <div className="row spread">
              <span>
                <strong>Directors' solvency resolution</strong>
                <span className="small"> · {r?.financial_report_lodged ? <span className="muted">not needed: a financial report was lodged in the last 12 months</span>
                  : r?.solvency_resolution_on ? <span className={r.solvency_outcome === "negative" ? "warning-text" : "muted"}>{r.solvency_outcome === "negative" ? "negative" : "passed"} {day(r.solvency_resolution_on)}</span>
                  : <span className={twoMonths < t ? "warning-text" : undefined}>{twoMonths < t ? "overdue since" : "due by"} {day(twoMonths)}</span>}</span>
              </span>
              <button type="button" className="link-dark small" onClick={() => onSheet({ title: "Solvency resolution", body: <SolvencyResolution review={r} reviewDate={reviewDate} ctx={ctx} /> })}>Prepare the resolution</button>
            </div>
            {canEdit && !r?.solvency_resolution_on && !r?.financial_report_lodged && (
              <span className="row wrap">
                <button type="button" className="quiet" disabled={busy} onClick={() => onSave(r, reviewDate, { solvency_outcome: "positive", solvency_resolution_on: t })}>Passed today</button>
                <button type="button" className="quiet" disabled={busy} onClick={() => onSave(r, reviewDate, { solvency_outcome: "negative", solvency_resolution_on: t })}>Could not be passed</button>
                <label className="check small"><input type="checkbox" checked={false} onChange={() => onSave(r, reviewDate, { financial_report_lodged: true })} /> A financial report was lodged with ASIC in the last 12 months</label>
              </span>
            )}
            {r?.solvency_outcome === "negative" && <p className="small warning-text">Form 485 must be lodged within 7 days: it is under ASIC filings.</p>}
          </li>
        </ol>
        {own?.resolutions && r?.solvency_resolution_on && (
          <span className="field">
            <label htmlFor="ar-res">Link the board resolution</label>
            <select id="ar-res" value={r.resolution_id ?? ""} disabled={!canEdit || busy} onChange={(e) => onSave(r, reviewDate, { resolution_id: e.target.value || null })}>
              <option value="">Not linked</option>
              {own.resolutions.map((x) => <option key={x.id} value={x.id}>{day(x.created_at)}: {x.text.slice(0, 80)}</option>)}
            </select>
          </span>
        )}
      </section>
      {data.reviews.filter((x) => x.review_date !== reviewDate).length > 0 && (
        <section className="block">
          <h3>Earlier reviews</h3>
          <ul className="plain rows small">
            {data.reviews.filter((x) => x.review_date !== reviewDate).map((x) => (
              <li key={x.id}>{day(x.review_date)} · fee {x.fee_paid_on ? `paid ${day(x.fee_paid_on)}` : "not recorded"} · solvency {x.financial_report_lodged ? "not needed" : x.solvency_resolution_on ? `${x.solvency_outcome} ${day(x.solvency_resolution_on)}` : "not recorded"}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Registers
// ---------------------------------------------------------------------
function RegistersView({ onSheet, ctx, hasOwnership }: { onSheet: (s: Sheet) => void; ctx: Parameters<typeof ConsentToAct>[0]["ctx"]; hasOwnership: boolean }) {
  const items: { title: string; text: string; body: ReactNode; needsOwnership?: boolean }[] = [
    { title: "Register of members", text: "Section 169: every member, their address, shares by class, amounts paid and unpaid, whether held beneficially, certificates, and former members.", body: <RegisterOfMembers ctx={ctx} />, needsOwnership: true },
    { title: "Register of option holders", text: "Section 170: options over unissued shares, including employee and investor options and warrants.", body: <RegisterOfOptions ctx={ctx} />, needsOwnership: true },
    { title: "Register of office holders", text: "Directors and secretaries, with appointment and cessation dates, and the details ASIC holds.", body: <RegisterOfOfficers ctx={ctx} /> },
  ];
  return (
    <ul className="plain rows">
      {items.map((x) => (
        <li key={x.title} className="row spread">
          <span><strong>{x.title}</strong><br /><span className="small muted">{x.text}</span></span>
          <button type="button" className="quiet" disabled={x.needsOwnership && !hasOwnership} onClick={() => onSheet({ title: x.title, body: x.body })}>View and print</button>
        </li>
      ))}
    </ul>
  );
}
