import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Attachments from "./Attachments";
import { today } from "./authorities";
import { formatDay } from "./board";
import {
  ANTI_DILUTION_LABELS, blankClass, blankHolder, consentsMissing, CONVERTIBLE_LABELS, essDue, fmt, fullyDiluted, HOLDER_KINDS, issueFromInstrument, loadOwnership,
  money, MOVEMENT_LABELS, outstanding, PARTICIPATION_LABELS, pct, preferenceStack, recordConsent, recordMovement, registerAsAt, saveClass, saveConvertible, saveEss,
  saveGrant, saveHolder, saveMatter, savePlan, saveTerms, setStartupMode, updateMovementRecords, vestedBy, vestingSummary, voidMovement,
  type ClassValues, type Consent, type Convertible, type ConvertibleValues, type Grant, type GrantValues, type Holder, type HolderValues, type Matter, type MatterValues,
  type Movement, type MovementKind, type MovementValues, type OwnershipData, type PlanValues, type Position, type ShareClass, type Terms,
} from "./ownership";
import type { GroupData } from "./types";

type Sub = "register" | "history" | "classes" | "esop" | "convertibles" | "rights" | "diluted";
type Props = { organisationId: string; group: GroupData | null; canEdit: boolean; onChanged: () => void };

const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");

// ---------------------------------------------------------------------
// Small field helpers
// ---------------------------------------------------------------------
function Field({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return (
    <span className={wide ? "field grow" : "field"}>
      <label htmlFor={id}>{label}</label>
      {children}
    </span>
  );
}
function Text({ id, label, value, onChange, type = "text", wide, placeholder }: { id: string; label: string; value: string | number | null; onChange: (v: string) => void; type?: string; wide?: boolean; placeholder?: string }) {
  return (
    <Field id={id} label={label} wide={wide}>
      <input id={id} type={type} placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
const toNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,\s]/g, "")));
function Yes({ id, label, value, onChange }: { id: string; label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <Field id={id} label={label}>
      <select id={id} value={value == null ? "" : value ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")}>
        <option value="">Not known</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </Field>
  );
}
function ResolutionPick({ id, data, value, onChange }: { id: string; data: OwnershipData; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Field id={id} label="Board resolution" wide>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Not linked</option>
        {data.resolutions.map((r) => (
          <option key={r.id} value={r.id}>
            {day(r.created_at)}: {r.text.slice(0, 90)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export default function Ownership({ organisationId, group, canEdit, onChanged }: Props) {
  const entities = useMemo(() => (group?.entities ?? []).filter((e) => e.status !== "deregistered"), [group]);
  const [entityId, setEntityId] = useState<string | null>(entities[0]?.id ?? null);
  const entity = entities.find((e) => e.id === entityId) ?? null;
  const startup = Boolean(entity?.startup_mode);
  const [sub, setSub] = useState<Sub>("register");
  const [data, setData] = useState<OwnershipData | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<string | null>(null);
  const t = today();

  const reload = useCallback(async () => {
    if (!entityId) return;
    try {
      setData(await loadOwnership(organisationId, entityId));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load the register.");
    }
  }, [organisationId, entityId]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!entityId && entities[0]) setEntityId(entities[0].id);
  }, [entities, entityId]);
  useEffect(() => {
    if (!startup && ["esop", "convertibles", "rights", "diluted"].includes(sub)) setSub("register");
  }, [startup, sub]);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      setForm(null);
      if (done) setNotice(done);
      await reload();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  if (!entities.length) {
    return (
      <>
        <p className="eyebrow">Company</p>
        <h1>Ownership</h1>
        <p className="muted">Add a company under Company Info first.</p>
      </>
    );
  }

  const header = (
    <>
      <p className="eyebrow">Company</p>
      <h1>Ownership</h1>
      <p className="lead">
        The register of members: who holds the shares, of which class, and what was paid. Every holding is worked out from the history of issues, transfers and other changes, so each number traces back to the event and the board approval behind it.
      </p>
      <div className="row wrap block-gap">
        {entities.length > 1 && (
          <span className="field">
            <label htmlFor="own-entity">Company</label>
            <select id="own-entity" value={entityId ?? ""} onChange={(e) => { setEntityId(e.target.value); setForm(null); }}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </span>
        )}
        <label className="check" title="Adds the ESOP, convertibles, investor rights, reserved matters and the fully diluted view">
          <input
            type="checkbox"
            checked={startup}
            disabled={!canEdit || busy}
            onChange={(e) => {
              const on = e.target.checked;
              void run(async () => {
                await setStartupMode(entityId!, on);
                onChanged();
              }, on ? "Startup mode is on for this company." : "Startup mode is off. Nothing recorded has been removed.");
            }}
          />{" "}
          Startup mode <span className="muted small">(ESOP, convertibles, investor rights, fully diluted)</span>
        </label>
      </div>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );

  if (!data) return <>{header}<p className="muted">Loading…</p></>;
  if (!data.ready) return <>{header}<p className="card warning">The ownership tables are not set up yet. Run migration 0044 in Supabase, then reload.</p></>;

  const holderName = (id: string | null) => data.holders.find((h) => h.id === id)?.name ?? "";
  const className = (id: string | null) => data.classes.find((c) => c.id === id)?.name ?? "";
  const issued = data.positions.reduce((s, p) => s + p.shares, 0);
  const live = data.movements.filter((m) => !m.voided_at);
  const asicOpen = live.filter((m) => m.asic_due_on && !m.asic_lodged_on);
  const asicOverdue = asicOpen.filter((m) => m.asic_due_on! < t);
  const noApproval = live.filter((m) => !m.resolution_id && !m.approval_note);
  const subs: { id: Sub; label: string }[] = [
    { id: "register", label: "Register" },
    { id: "history", label: `History (${live.length})` },
    { id: "classes", label: `Share classes (${data.classes.length})` },
    ...(startup
      ? ([
          { id: "esop", label: "ESOP" },
          { id: "convertibles", label: "Convertibles" },
          { id: "rights", label: "Investor rights" },
          { id: "diluted", label: "Fully diluted" },
        ] as { id: Sub; label: string }[])
      : []),
  ];

  return (
    <>
      {header}
      <dl className="facts">
        <div>
          <dt>Shares on issue</dt>
          <dd>{fmt(issued)}</dd>
        </div>
        <div>
          <dt>Shareholders</dt>
          <dd>{new Set(data.positions.map((p) => p.shareholder_id)).size}</dd>
        </div>
        <div>
          <dt>ASIC notices due</dt>
          <dd className={asicOverdue.length ? "warning-text" : undefined}>
            {asicOpen.length}
            {asicOverdue.length ? ` (${asicOverdue.length} overdue)` : ""}
          </dd>
        </div>
        <div>
          <dt>No approval recorded</dt>
          <dd className={noApproval.length ? "warning-text" : undefined}>{noApproval.length}</dd>
        </div>
      </dl>
      <span className="segmented block-gap" role="group" aria-label="Ownership sections">
        {subs.map((x) => (
          <button key={x.id} type="button" className={sub === x.id ? "on" : undefined} aria-pressed={sub === x.id} onClick={() => { setSub(x.id); setForm(null); }}>
            {x.label}
          </button>
        ))}
      </span>
      {sub === "register" && <RegisterView data={data} entityId={entityId!} canEdit={canEdit} busy={busy} form={form} setForm={setForm} group={group}
        onHolder={(id, v) => run(() => saveHolder(organisationId, entityId!, id, v), "Shareholder saved.")}
        onMovement={(v) => run(() => recordMovement(organisationId, entityId!, v), "Recorded. The register has been updated.")} />}
      {sub === "history" && <HistoryView data={data} canEdit={canEdit} busy={busy} startup={startup} holderName={holderName} className={className}
        onUpdate={(id, patch, done) => run(() => updateMovementRecords(id, patch), done)}
        onVoid={(id, reason) => run(() => voidMovement(id, reason), "Voided. It stays in the history, struck through.")}
        onConsent={(v) => run(() => recordConsent(organisationId, entityId!, v), "Consent recorded.")} />}
      {sub === "classes" && <ClassesView data={data} canEdit={canEdit} busy={busy} startup={startup} form={form} setForm={setForm}
        onSave={(id, v) => run(() => saveClass(organisationId, entityId!, id, v), "Share class saved.")} />}
      {sub === "esop" && <EsopView data={data} canEdit={canEdit} busy={busy} form={form} setForm={setForm} today={t}
        onPlan={(id, v) => run(() => savePlan(organisationId, entityId!, id, v), "Plan saved.")}
        onGrant={(id, v) => run(() => saveGrant(organisationId, entityId!, id, v), "Grant saved.")}
        onExercise={(id, v) => run(() => issueFromInstrument("esop_grants", id, v), "Exercised. The shares are now on the register.")}
        onHolder={(v) => saveHolder(organisationId, entityId!, null, v)}
        onEss={(fy, existing, patch) => run(() => saveEss(organisationId, entityId!, fy, existing, patch), "Saved.")}
        onConsent={(v) => run(() => recordConsent(organisationId, entityId!, v), "Consent recorded.")} />}
      {sub === "convertibles" && <ConvertiblesView data={data} canEdit={canEdit} busy={busy} form={form} setForm={setForm}
        onSave={(id, v) => run(() => saveConvertible(organisationId, entityId!, id, v), "Saved.")}
        onConvert={(id, v) => run(() => issueFromInstrument("convertibles", id, v), "Converted. The shares are now on the register.")}
        onHolder={(v) => saveHolder(organisationId, entityId!, null, v)}
        onConsent={(v) => run(() => recordConsent(organisationId, entityId!, v), "Consent recorded.")} />}
      {sub === "rights" && <RightsView data={data} canEdit={canEdit} busy={busy} form={form} setForm={setForm}
        onTerms={(v) => run(() => saveTerms(organisationId, entityId!, v, Boolean(data.terms)), "Exit terms saved.")}
        onMatter={(id, v) => run(() => saveMatter(organisationId, entityId!, id, v), "Reserved matter saved. Contracts it covers now need the consent recorded before approval.")} />}
      {sub === "diluted" && <DilutedView data={data} today={t} />}
    </>
  );
}

// ---------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------
function RegisterView({ data, entityId, canEdit, busy, form, setForm, group, onHolder, onMovement }: {
  data: OwnershipData; entityId: string; canEdit: boolean; busy: boolean; form: string | null; setForm: (f: string | null) => void; group: GroupData | null;
  onHolder: (id: string | null, v: HolderValues) => void; onMovement: (v: MovementValues) => void;
}) {
  const [asOf, setAsOf] = useState("");
  const [past, setPast] = useState<Position[] | null>(null);
  const [pastError, setPastError] = useState<string | null>(null);
  useEffect(() => {
    setPast(null);
    setPastError(null);
    if (!asOf) return;
    registerAsAt(entityId, asOf).then(setPast, (e) => setPastError(e.message));
  }, [asOf, entityId]);
  const positions = asOf ? past ?? [] : data.positions;
  const byClass = (id: string) => positions.filter((p) => p.class_id === id).reduce((s, p) => s + p.shares, 0);
  const rows = [...positions].sort((a, b) => b.shares - a.shares);
  const holder = (id: string) => data.holders.find((h) => h.id === id);
  const editing = form?.startsWith("holder:") ? data.holders.find((h) => h.id === form.slice(7)) : undefined;
  const withoutShares = data.holders.filter((h) => !data.positions.some((p) => p.shareholder_id === h.id));

  if (form === "holder" || editing) {
    return <HolderForm initial={editing ?? blankHolder()} group={group} busy={busy} onSave={(v) => onHolder(editing?.id ?? null, v)} onCancel={() => setForm(null)} />;
  }
  if (form === "movement") return <MovementForm data={data} busy={busy} onSave={onMovement} onCancel={() => setForm(null)} />;

  return (
    <>
      {data.classes.length === 0 && (
        <p className="card note block">Start by adding the company's share classes (for example Ordinary) under Share classes, then the shareholders, then record each issue.</p>
      )}
      <div className="row wrap">
        <span className="field">
          <label htmlFor="own-asof">As at</label>
          <input id="own-asof" type="date" value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value)} />
        </span>
        {asOf && (
          <button type="button" className="link-dark small" onClick={() => setAsOf("")}>
            Back to today
          </button>
        )}
      </div>
      {pastError && <p className="error">{pastError}</p>}
      {rows.length === 0 ? (
        <p className="muted">No shares on the register{asOf ? ` on ${day(asOf)}` : ""}.</p>
      ) : (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead>
              <tr>
                <th scope="col">Shareholder</th>
                <th scope="col">Class</th>
                <th scope="col" className="num">Shares</th>
                <th scope="col" className="num">Of the class</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Unpaid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const h = holder(p.shareholder_id);
                const c = data.classes.find((x) => x.id === p.class_id);
                return (
                  <tr key={`${p.shareholder_id}-${p.class_id}`}>
                    <th scope="row">
                      {canEdit && h ? (
                        <button type="button" className="link-dark" onClick={() => setForm(`holder:${h.id}`)}>
                          {h.name}
                        </button>
                      ) : (
                        h?.name
                      )}
                      {h && !h.is_beneficial && <span className="muted small"><br />Not beneficially held: for {h.held_for}</span>}
                      {h && !h.address && <span className="warning-text small"><br />No address recorded</span>}
                      {h?.address && <span className="muted small"><br />{h.address}</span>}
                    </th>
                    <td>{c?.name}</td>
                    <td className="num">{fmt(p.shares)}</td>
                    <td className="num">{pct(p.shares, byClass(p.class_id))}</td>
                    <td className="num">{money(p.paid, c?.currency)}</td>
                    <td className={p.unpaid ? "num warning-text" : "num"}>{money(p.unpaid, c?.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {data.classes.filter((c) => byClass(c.id) > 0).map((c) => (
                <tr key={c.id}>
                  <th scope="row">Total {c.name}</th>
                  <td />
                  <td className="num">{fmt(byClass(c.id))}</td>
                  <td />
                  <td className="num">{money(positions.filter((p) => p.class_id === c.id).reduce((s, p) => s + p.paid, 0), c.currency)}</td>
                  <td className="num">{money(positions.filter((p) => p.class_id === c.id).reduce((s, p) => s + p.unpaid, 0), c.currency)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
      {withoutShares.length > 0 && !asOf && (
        <p className="muted small">
          Also on file, holding no shares now:{" "}
          {withoutShares.map((h, i) => (
            <span key={h.id}>
              {i ? ", " : ""}
              {canEdit ? (
                <button type="button" className="link-dark small" onClick={() => setForm(`holder:${h.id}`)}>
                  {h.name}
                </button>
              ) : (
                h.name
              )}
            </span>
          ))}
        </p>
      )}
      {canEdit && (
        <p className="row wrap block">
          <button type="button" disabled={!data.classes.length || !data.holders.length} onClick={() => setForm("movement")}>
            Record a share movement
          </button>
          <button type="button" className="quiet" onClick={() => setForm("holder")}>
            Add a shareholder
          </button>
        </p>
      )}
    </>
  );
}

function HolderForm({ initial, group, busy, onSave, onCancel }: { initial: HolderValues; group: GroupData | null; busy: boolean; onSave: (v: HolderValues) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const set = (p: Partial<HolderValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h2>{initial.name ? initial.name : "New shareholder"}</h2>
      <div className="row wrap">
        <Text id="h-name" label="Full name (as it should appear on the register)" value={v.name} onChange={(x) => set({ name: x })} wide />
        <Field id="h-kind" label="Type">
          <select id="h-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as Holder["kind"] })}>
            {HOLDER_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row wrap">
        <Text id="h-addr" label="Address" value={v.address} onChange={(x) => set({ address: x })} wide />
        <Text id="h-email" label="Email (optional)" value={v.email} onChange={(x) => set({ email: x })} />
        {v.kind !== "individual" && <Text id="h-reg" label="ACN, ABN or registration" value={v.registration} onChange={(x) => set({ registration: x })} />}
      </div>
      {v.kind === "company" && (group?.entities.length ?? 0) > 1 && (
        <Field id="h-group" label="Is this one of our group companies?">
          <select id="h-group" value={v.holder_entity_id ?? ""} onChange={(e) => set({ holder_entity_id: e.target.value || null })}>
            <option value="">No</option>
            {group!.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <fieldset className="plain-fieldset">
        <legend>Does the shareholder hold the shares for its own benefit?</legend>
        <div className="row">
          <label className="check">
            <input type="radio" name="h-ben" checked={v.is_beneficial} onChange={() => set({ is_beneficial: true, held_for: null })} /> Yes
          </label>
          <label className="check">
            <input type="radio" name="h-ben" checked={!v.is_beneficial} onChange={() => set({ is_beneficial: false })} /> No, held for someone else
          </label>
        </div>
        {!v.is_beneficial && <Text id="h-for" label="Held for (the register must say so)" value={v.held_for} onChange={(x) => set({ held_for: x })} wide />}
      </fieldset>
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (v.name.trim().length < 1) return setMissing("Give the shareholder's name.");
          if (!v.is_beneficial && !v.held_for?.trim()) return setMissing("Say who the shares are held for.");
          onSave(v);
        }}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MovementForm({ data, busy, onSave, onCancel }: { data: OwnershipData; busy: boolean; onSave: (v: MovementValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<MovementValues>({
    kind: "issue", class_id: data.classes[0]?.id ?? "", shares: null, from_holder_id: null, to_holder_id: null, to_class_id: null, to_shares: null, ratio_from: null, ratio_to: null,
    price_per_share: null, paid_per_share: null, unpaid_per_share: 0, consideration: null, effective_on: today(), resolution_id: null, approval_note: null,
    certificate_number: null, cancelled_certificate: null, notes: null,
  });
  const set = (p: Partial<MovementValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  const k = v.kind;
  const holderSelect = (id: string, label: string, value: string | null, onChange: (x: string | null) => void) => (
    <Field id={id} label={label} wide>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose</option>
        {data.holders.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const submit = () => {
    if (!v.class_id) return setMissing("Choose the share class.");
    if (k === "split" || k === "consolidation") {
      if (!v.ratio_from || !v.ratio_to) return setMissing("Give the ratio.");
    } else if (!v.shares || v.shares <= 0) return setMissing("Give the number of shares.");
    if (k === "issue" && !v.to_holder_id) return setMissing("Choose who the shares were issued to.");
    if (k === "issue" && v.price_per_share == null && v.paid_per_share == null) return setMissing("Give the issue price per share.");
    if (k === "transfer" && (!v.from_holder_id || !v.to_holder_id)) return setMissing("Choose who transferred and who received the shares.");
    if (["buy_back", "cancellation", "redemption", "conversion"].includes(k) && !v.from_holder_id) return setMissing("Choose whose shares these are.");
    if (k === "conversion" && (!v.to_class_id || !v.to_shares)) return setMissing("Choose the new class and how many shares they became.");
    onSave({ ...v, paid_per_share: k === "issue" ? v.paid_per_share ?? v.price_per_share : v.paid_per_share });
  };
  return (
    <div className="card form">
      <h2>Record a share movement</h2>
      <p className="muted small">Record it when it happens. A movement cannot be edited later, only voided with a reason, so the history stays reliable.</p>
      <div className="row wrap">
        <Field id="m-kind" label="What happened">
          <select id="m-kind" value={k} onChange={(e) => set({ kind: e.target.value as MovementKind })}>
            {Object.entries(MOVEMENT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="m-class" label="Share class">
          <select id="m-class" value={v.class_id} onChange={(e) => set({ class_id: e.target.value })}>
            {data.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Text id="m-date" label="Date" type="date" value={v.effective_on} onChange={(x) => set({ effective_on: x })} />
      </div>
      {k === "split" || k === "consolidation" ? (
        <div className="row wrap">
          <Text id="m-rf" label="Every" type="number" value={v.ratio_from} onChange={(x) => set({ ratio_from: toNum(x) })} />
          <Text id="m-rt" label="shares become" type="number" value={v.ratio_to} onChange={(x) => set({ ratio_to: toNum(x) })} />
        </div>
      ) : (
        <>
          <div className="row wrap">
            {k !== "issue" && holderSelect("m-from", k === "transfer" ? "From" : "Shareholder", v.from_holder_id, (x) => set({ from_holder_id: x }))}
            {(k === "issue" || k === "transfer") && holderSelect("m-to", k === "issue" ? "Issued to" : "To", v.to_holder_id, (x) => set({ to_holder_id: x }))}
            <Text id="m-shares" label="Number of shares" type="number" value={v.shares} onChange={(x) => set({ shares: toNum(x) })} />
          </div>
          {k === "conversion" && (
            <div className="row wrap">
              <Field id="m-toclass" label="Converted into">
                <select id="m-toclass" value={v.to_class_id ?? ""} onChange={(e) => set({ to_class_id: e.target.value || null })}>
                  <option value="">Choose</option>
                  {data.classes.filter((c) => c.id !== v.class_id).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Text id="m-toshares" label="Number of new shares" type="number" value={v.to_shares} onChange={(x) => set({ to_shares: toNum(x) })} />
            </div>
          )}
          {k !== "conversion" && (
            <div className="row wrap">
              <Text id="m-price" label={k === "issue" ? "Issue price per share" : "Price per share (if any)"} value={v.price_per_share} onChange={(x) => set({ price_per_share: toNum(x) })} />
              {k === "issue" && (
                <>
                  <Text id="m-paid" label="Paid per share" placeholder="Same as the price" value={v.paid_per_share} onChange={(x) => set({ paid_per_share: toNum(x) })} />
                  <Text id="m-unpaid" label="Unpaid per share" value={v.unpaid_per_share} onChange={(x) => set({ unpaid_per_share: toNum(x) ?? 0 })} />
                </>
              )}
            </div>
          )}
        </>
      )}
      <div className="row wrap">
        <ResolutionPick id="m-res" data={data} value={v.resolution_id} onChange={(x) => set({ resolution_id: x })} />
        {!v.resolution_id && <Text id="m-appr" label="Or how it was approved" placeholder="Circular resolution of directors, 3 March" value={v.approval_note} onChange={(x) => set({ approval_note: x })} wide />}
      </div>
      <div className="row wrap">
        {(k === "issue" || k === "transfer" || k === "conversion") && <Text id="m-cert" label="New certificate number" value={v.certificate_number} onChange={(x) => set({ certificate_number: x })} />}
        {k !== "issue" && k !== "split" && k !== "consolidation" && <Text id="m-cancel" label="Certificate cancelled" value={v.cancelled_certificate} onChange={(x) => set({ cancelled_certificate: x })} />}
        <Text id="m-cons" label="Consideration (if not cash)" value={v.consideration} onChange={(x) => set({ consideration: x })} wide />
      </div>
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={submit}>
          Record
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// History
// ---------------------------------------------------------------------
type ConsentInput = { matterId: string; subjectTable: string; subjectId: string; givenBy: string; givenOn: string; notes: string };
function ConsentLine({ data, subjectTable, subjectId, subjectDate, canEdit, busy, onConsent }: { data: OwnershipData; subjectTable: string; subjectId: string; subjectDate: string | null; canEdit: boolean; busy: boolean; onConsent: (v: ConsentInput) => void }) {
  const missing = consentsMissing(data, subjectTable, subjectId, subjectDate);
  const given = data.consents.filter((c) => c.subject_table === subjectTable && c.subject_id === subjectId);
  const [open, setOpen] = useState<string | null>(null);
  const [by, setBy] = useState("");
  const [on, setOn] = useState(today());
  if (!missing.length && !given.length) return null;
  return (
    <div className="small">
      {given.map((c: Consent) => (
        <div key={c.id} className="muted">
          Investor consent: {data.matters.find((m) => m.id === c.matter_id)?.matter} · given by {c.given_by}, {day(c.given_on)}
        </div>
      ))}
      {missing.map((m: Matter) => (
        <div key={m.id}>
          <span className="warning-text">Needs consent from {m.consent_from}: {m.matter}</span>
          {canEdit && open !== m.id && (
            <button type="button" className="link-dark small" onClick={() => setOpen(m.id)}>
              {" "}Record consent
            </button>
          )}
          {open === m.id && (
            <span className="row wrap">
              <input aria-label="Consent given by" placeholder="Given by" value={by} onChange={(e) => setBy(e.target.value)} />
              <input aria-label="Consent date" type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />
              <button type="button" disabled={busy || by.trim().length < 2} onClick={() => onConsent({ matterId: m.id, subjectTable, subjectId, givenBy: by, givenOn: on, notes: "" })}>
                Save
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function HistoryView({ data, canEdit, busy, startup, holderName, className, onUpdate, onVoid, onConsent }: {
  data: OwnershipData; canEdit: boolean; busy: boolean; startup: boolean; holderName: (id: string | null) => string; className: (id: string | null) => string;
  onUpdate: (id: string, patch: Partial<Movement>, done: string) => void; onVoid: (id: string, reason: string) => void; onConsent: (v: ConsentInput) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [lodged, setLodged] = useState(today());
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [res, setRes] = useState<string | null>(null);
  const t = today();
  const list = [...data.movements].reverse();
  if (!list.length) return <p className="muted">Nothing recorded yet. Record each issue, transfer or other change from the Register.</p>;
  const what = (m: Movement) => {
    const c = className(m.class_id);
    switch (m.kind) {
      case "issue": return `${fmt(m.shares!)} ${c} to ${holderName(m.to_holder_id)}`;
      case "transfer": return `${fmt(m.shares!)} ${c} from ${holderName(m.from_holder_id)} to ${holderName(m.to_holder_id)}`;
      case "conversion": return `${fmt(m.shares!)} ${c} held by ${holderName(m.from_holder_id)} into ${fmt(m.to_shares!)} ${className(m.to_class_id)}`;
      case "split":
      case "consolidation": return `${c}: every ${fmt(m.ratio_from!)} became ${fmt(m.ratio_to!)}`;
      default: return `${fmt(m.shares!)} ${c} from ${holderName(m.from_holder_id)}`;
    }
  };
  return (
    <ul className="plain rows">
      {list.map((m) => {
        const approval = m.resolution_id ? data.resolutions.find((r) => r.id === m.resolution_id)?.text ?? "Board resolution" : m.approval_note;
        const open = openId === m.id;
        return (
          <li key={m.id} className={m.voided_at ? "voided" : undefined}>
            <div className="row spread">
              <span>
                <strong>{day(m.effective_on)} · {MOVEMENT_LABELS[m.kind]}</strong> {what(m)}
                {m.price_per_share != null && <span className="muted small"> · {money(m.price_per_share)} a share</span>}
              </span>
              {canEdit && !m.voided_at && (
                <button type="button" className="link-dark small" onClick={() => { setOpenId(open ? null : m.id); setRef(""); setReason(""); setRes(m.resolution_id); }}>
                  {open ? "Close" : "Update records"}
                </button>
              )}
            </div>
            <div className="small">
              {approval ? <span className="muted">Approved: {approval.slice(0, 140)}</span> : <span className="warning-text">No approval recorded</span>}
              {m.certificate_number && <span className="muted"> · Certificate {m.certificate_number}</span>}
              {m.cancelled_certificate && <span className="muted"> · Cancelled {m.cancelled_certificate}</span>}
              {m.esop_grant_id && <span className="muted"> · ESOP exercise</span>}
              {m.convertible_id && <span className="muted"> · From a convertible</span>}
            </div>
            {m.asic_due_on && !m.voided_at && (
              <div className="small">
                {m.asic_lodged_on ? (
                  <span className="muted">ASIC notice lodged {day(m.asic_lodged_on)}{m.asic_reference ? ` (${m.asic_reference})` : ""}</span>
                ) : (
                  <span className={m.asic_due_on < t ? "warning-text" : undefined}>
                    ASIC notice (usually Form 484) {m.asic_due_on < t ? "overdue since" : "due by"} {day(m.asic_due_on)}
                  </span>
                )}
              </div>
            )}
            {m.voided_at && <div className="small warning-text">Voided {day(m.voided_at)}: {m.void_reason}</div>}
            {startup && m.kind === "issue" && !m.voided_at && <ConsentLine data={data} subjectTable="share_movements" subjectId={m.id} subjectDate={m.effective_on} canEdit={canEdit} busy={busy} onConsent={onConsent} />}
            {open && (
              <div className="card form">
                {!m.asic_lodged_on && m.asic_due_on && (
                  <div className="row wrap">
                    <Text id="mv-lodged" label="ASIC notice lodged on" type="date" value={lodged} onChange={setLodged} />
                    <Text id="mv-ref" label="ASIC reference (optional)" value={ref} onChange={setRef} />
                    <button type="button" disabled={busy || !lodged} onClick={() => onUpdate(m.id, { asic_lodged_on: lodged, asic_reference: ref || null }, "Lodgement recorded.")}>
                      Record lodgement
                    </button>
                  </div>
                )}
                {!m.resolution_id && (
                  <div className="row wrap">
                    <ResolutionPick id="mv-res" data={data} value={res} onChange={setRes} />
                    <button type="button" className="quiet" disabled={busy || !res} onClick={() => onUpdate(m.id, { resolution_id: res }, "Resolution linked.")}>
                      Link
                    </button>
                  </div>
                )}
                <Attachments subjectTable="share_movements" subjectId={m.id} canAttach={canEdit} label="Forms, certificates and approvals" />
                <div className="row wrap">
                  <Text id="mv-void" label="Void it: why?" value={reason} onChange={setReason} wide />
                  <button type="button" className="quiet" disabled={busy || reason.trim().length < 5} onClick={() => onVoid(m.id, reason)}>
                    Void
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------
// Share classes
// ---------------------------------------------------------------------
function ClassesView({ data, canEdit, busy, startup, form, setForm, onSave }: {
  data: OwnershipData; canEdit: boolean; busy: boolean; startup: boolean; form: string | null; setForm: (f: string | null) => void; onSave: (id: string | null, v: ClassValues) => void;
}) {
  const editing = form?.startsWith("class:") ? data.classes.find((c) => c.id === form.slice(6)) : undefined;
  if (form === "class" || editing) {
    const { id: _id, entity_id: _e, ...values } = editing ?? ({ id: "", entity_id: "", ...blankClass() } as ShareClass);
    return <ClassForm initial={values} classes={data.classes.filter((c) => c.id !== editing?.id)} startup={startup} busy={busy} onSave={(v) => onSave(editing?.id ?? null, v)} onCancel={() => setForm(null)} />;
  }
  return (
    <>
      {data.classes.length === 0 && <p className="muted">No share classes yet.</p>}
      {data.classes.map((c) => {
        const onIssue = data.positions.filter((p) => p.class_id === c.id).reduce((s, p) => s + p.shares, 0);
        return (
          <section key={c.id} className="card block">
            <div className="row spread">
              <h2>
                {c.name}
                {c.code ? <span className="muted small"> ({c.code})</span> : null}
              </h2>
              {canEdit && (
                <button type="button" className="link-dark small" onClick={() => setForm(`class:${c.id}`)}>
                  Edit
                </button>
              )}
            </div>
            <p className="small">
              {fmt(onIssue)} on issue · {c.votes_per_share === 0 ? "Non-voting" : `${c.votes_per_share} vote${c.votes_per_share === 1 ? "" : "s"} a share`}
              {c.issue_price != null ? ` · Issued at ${money(c.issue_price, c.currency)}` : ""}
            </p>
            <ul className="plain small">
              {c.dividend_rights && <li>Dividends: {c.dividend_rights}</li>}
              {c.capital_rights && <li>Return of capital: {c.capital_rights}</li>}
              {c.other_rights && <li>Other: {c.other_rights}</li>}
              {c.kind === "preference" && (
                <>
                  <li>
                    Liquidation preference:{" "}
                    {c.liq_pref_multiple != null ? `${c.liq_pref_multiple}× the issue price` : <span className="warning-text">not recorded</span>}
                    {c.liq_participation ? `, ${PARTICIPATION_LABELS[c.liq_participation].split(" (")[0].toLowerCase()}` : ""}
                    {c.liq_participation === "capped" && c.liq_cap_multiple ? ` to ${c.liq_cap_multiple}×` : ""}
                    {c.liq_seniority ? ` · ranks ${c.liq_seniority === 1 ? "first" : `number ${c.liq_seniority}`}` : ""}
                  </li>
                  <li>Anti-dilution: {c.anti_dilution ? ANTI_DILUTION_LABELS[c.anti_dilution] : <span className="warning-text">not recorded</span>}</li>
                  {c.converts_to_class_id && (
                    <li>
                      Converts into {data.classes.find((x) => x.id === c.converts_to_class_id)?.name} at {c.conversion_ratio} for 1{c.auto_conversion ? `; automatically ${c.auto_conversion}` : ""}
                    </li>
                  )}
                </>
              )}
              {c.dividend_preference && <li>Dividend preference: {c.dividend_preference}</li>}
              {c.pro_rata && <li>Pro-rata: {c.pro_rata}</li>}
              {c.board_seats != null && <li>Board seats: {c.board_seats}</li>}
              {c.information_rights && <li>Information rights: {c.information_rights}</li>}
              {c.redemption && <li>Redemption: {c.redemption}</li>}
              {c.rights_source && <li className="muted">Source: {c.rights_source}</li>}
            </ul>
          </section>
        );
      })}
      {canEdit && (
        <p className="block">
          <button type="button" onClick={() => setForm("class")}>
            Add a share class
          </button>
        </p>
      )}
    </>
  );
}

function ClassForm({ initial, classes, startup, busy, onSave, onCancel }: { initial: ClassValues; classes: ShareClass[]; startup: boolean; busy: boolean; onSave: (v: ClassValues) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const set = (p: Partial<ClassValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  const investor = startup || v.kind === "preference";
  return (
    <div className="card form">
      <h2>{initial.name || "New share class"}</h2>
      <div className="row wrap">
        <Text id="c-name" label="Name" placeholder="Ordinary, Series A Preference" value={v.name} onChange={(x) => set({ name: x })} wide />
        <Text id="c-code" label="Short code" placeholder="ORD" value={v.code} onChange={(x) => set({ code: x })} />
        <Field id="c-kind" label="Kind">
          <select id="c-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as ShareClass["kind"] })}>
            <option value="ordinary">Ordinary</option>
            <option value="preference">Preference</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>
      <div className="row wrap">
        <Text id="c-votes" label="Votes per share" type="number" value={v.votes_per_share} onChange={(x) => set({ votes_per_share: toNum(x) ?? 0 })} />
        <Text id="c-price" label="Original issue price" value={v.issue_price} onChange={(x) => set({ issue_price: toNum(x) })} />
        <Text id="c-cur" label="Currency" value={v.currency} onChange={(x) => set({ currency: x.toUpperCase() })} />
      </div>
      <Text id="c-div" label="Dividend rights" value={v.dividend_rights} onChange={(x) => set({ dividend_rights: x })} wide />
      <Text id="c-cap" label="Rights on a return of capital" value={v.capital_rights} onChange={(x) => set({ capital_rights: x })} wide />
      <Text id="c-oth" label="Other rights or restrictions" value={v.other_rights} onChange={(x) => set({ other_rights: x })} wide />
      {investor && (
        <fieldset className="plain-fieldset">
          <legend>Investor rights</legend>
          <div className="row wrap">
            <Text id="c-lpm" label="Liquidation preference (× issue price)" value={v.liq_pref_multiple} onChange={(x) => set({ liq_pref_multiple: toNum(x) })} />
            <Field id="c-part" label="Participation">
              <select id="c-part" value={v.liq_participation ?? ""} onChange={(e) => set({ liq_participation: (e.target.value || null) as ShareClass["liq_participation"] })}>
                <option value="">Not recorded</option>
                {Object.entries(PARTICIPATION_LABELS).map(([id, l]) => (
                  <option key={id} value={id}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {v.liq_participation === "capped" && <Text id="c-capm" label="Cap (× issue price)" value={v.liq_cap_multiple} onChange={(x) => set({ liq_cap_multiple: toNum(x) })} />}
            <Text id="c-sen" label="Ranking (1 is paid first)" type="number" value={v.liq_seniority} onChange={(x) => set({ liq_seniority: toNum(x) })} />
          </div>
          <div className="row wrap">
            <Field id="c-ad" label="Anti-dilution">
              <select id="c-ad" value={v.anti_dilution ?? ""} onChange={(e) => set({ anti_dilution: (e.target.value || null) as ShareClass["anti_dilution"] })}>
                <option value="">Not recorded</option>
                {Object.entries(ANTI_DILUTION_LABELS).map(([id, l]) => (
                  <option key={id} value={id}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="c-conv" label="Converts into">
              <select id="c-conv" value={v.converts_to_class_id ?? ""} onChange={(e) => set({ converts_to_class_id: e.target.value || null })}>
                <option value="">Does not convert</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            {v.converts_to_class_id && <Text id="c-ratio" label="New shares for each share" value={v.conversion_ratio} onChange={(x) => set({ conversion_ratio: toNum(x) ?? 1 })} />}
            {v.converts_to_class_id && <Text id="c-auto" label="Converts automatically when" placeholder="on an IPO or a majority vote of the class" value={v.auto_conversion} onChange={(x) => set({ auto_conversion: x })} wide />}
          </div>
          <div className="row wrap">
            <Text id="c-dp" label="Dividend preference" value={v.dividend_preference} onChange={(x) => set({ dividend_preference: x })} wide />
            <Text id="c-pr" label="Pro-rata rights" placeholder="Right to keep its percentage in later rounds" value={v.pro_rata} onChange={(x) => set({ pro_rata: x })} wide />
          </div>
          <div className="row wrap">
            <Text id="c-bs" label="Board seats" type="number" value={v.board_seats} onChange={(x) => set({ board_seats: toNum(x) })} />
            <Text id="c-ir" label="Information rights" value={v.information_rights} onChange={(x) => set({ information_rights: x })} wide />
            <Text id="c-red" label="Redemption" value={v.redemption} onChange={(x) => set({ redemption: x })} wide />
          </div>
        </fieldset>
      )}
      <Text id="c-src" label="Where the rights come from" placeholder="Constitution cl 4; Shareholders' agreement cl 9" value={v.rights_source} onChange={(x) => set({ rights_source: x })} wide />
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (!v.name.trim()) return setMissing("Give the class a name.");
          if (v.liq_participation === "capped" && !v.liq_cap_multiple) return setMissing("Give the participation cap.");
          onSave(v);
        }}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Issue shares from an ESOP grant or a convertible
// ---------------------------------------------------------------------
type IssueValues = { shareholderId: string; classId: string; shares: number; price: number | null; effectiveOn: string; certificate: string; resolutionId: string | null };
function IssueForm({ title, data, defaultClass, defaultHolder, defaultShares, defaultPrice, note, busy, onIssue, onHolder, onCancel }: {
  title: string; data: OwnershipData; defaultClass: string | null; defaultHolder: string; defaultShares: number | null; defaultPrice: number | null; note?: string; busy: boolean;
  onIssue: (v: IssueValues) => void; onHolder: (v: HolderValues) => Promise<string>; onCancel: () => void;
}) {
  const match = data.holders.find((h) => h.name.trim().toLowerCase() === defaultHolder.trim().toLowerCase());
  const [holderId, setHolderId] = useState<string>(match?.id ?? "new");
  const [classId, setClassId] = useState(defaultClass ?? data.classes[0]?.id ?? "");
  const [shares, setShares] = useState<number | null>(defaultShares);
  const [price, setPrice] = useState<number | null>(defaultPrice);
  const [on, setOn] = useState(today());
  const [cert, setCert] = useState("");
  const [res, setRes] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h2>{title}</h2>
      {note && <p className="muted small">{note}</p>}
      <div className="row wrap">
        <Field id="i-holder" label="Shareholder" wide>
          <select id="i-holder" value={holderId} onChange={(e) => setHolderId(e.target.value)}>
            <option value="new">Add {defaultHolder} to the register</option>
            {data.holders.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        {holderId === "new" && <Text id="i-addr" label="Their address" value={address} onChange={setAddress} wide />}
      </div>
      <div className="row wrap">
        <Field id="i-class" label="Class">
          <select id="i-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {data.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Text id="i-shares" label="Shares issued" type="number" value={shares} onChange={(x) => setShares(toNum(x))} />
        <Text id="i-price" label="Price per share" value={price} onChange={(x) => setPrice(toNum(x))} />
        <Text id="i-date" label="Date" type="date" value={on} onChange={setOn} />
        <Text id="i-cert" label="Certificate number" value={cert} onChange={setCert} />
      </div>
      <ResolutionPick id="i-res" data={data} value={res} onChange={setRes} />
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={async () => {
          if (!shares || shares <= 0) return setMissing("Give the number of shares.");
          if (!classId) return setMissing("Add a share class first.");
          let id = holderId;
          try {
            if (id === "new") id = await onHolder({ ...blankHolder(), name: defaultHolder, address: address || null });
          } catch (e) {
            return setMissing(e instanceof Error ? e.message : "Could not add the shareholder.");
          }
          onIssue({ shareholderId: id, classId, shares, price, effectiveOn: on, certificate: cert, resolutionId: res });
        }}>
          Issue the shares
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// ESOP
// ---------------------------------------------------------------------
function EsopView({ data, canEdit, busy, form, setForm, today: t, onPlan, onGrant, onExercise, onHolder, onEss, onConsent }: {
  data: OwnershipData; canEdit: boolean; busy: boolean; form: string | null; setForm: (f: string | null) => void; today: string;
  onPlan: (id: string | null, v: PlanValues) => void; onGrant: (id: string | null, v: GrantValues) => void; onExercise: (id: string, v: IssueValues) => void;
  onHolder: (v: HolderValues) => Promise<string>; onEss: (fy: number, existing: OwnershipData["ess"][number] | undefined, patch: { statements_given_on?: string | null; ato_lodged_on?: string | null }) => void;
  onConsent: (v: ConsentInput) => void;
}) {
  const [lapse, setLapse] = useState<{ id: string; n: number | null } | null>(null);
  const plan = (id: string) => data.plans.find((p) => p.id === id);
  if (form === "plan" || form?.startsWith("plan:")) {
    const p = form === "plan" ? undefined : plan(form.slice(5));
    return <PlanForm initial={p} data={data} busy={busy} onSave={(v) => onPlan(p?.id ?? null, v)} onCancel={() => setForm(null)} />;
  }
  if (form?.startsWith("grant:") || form?.startsWith("newgrant:")) {
    const g = form.startsWith("grant:") ? data.grants.find((x) => x.id === form.slice(6)) : undefined;
    const planId = g?.plan_id ?? form.slice(9);
    return <GrantForm initial={g} planId={planId} data={data} busy={busy} onSave={(v) => onGrant(g?.id ?? null, v)} onCancel={() => setForm(null)} />;
  }
  if (form?.startsWith("exercise:")) {
    const g = data.grants.find((x) => x.id === form.slice(9))!;
    const v = vestedBy(g, t);
    const can = v == null ? outstanding(g) : Math.max(0, v - g.exercised - g.lapsed);
    return (
      <IssueForm title={`Exercise: ${g.holder_name}`} data={data} defaultClass={plan(g.plan_id)?.class_id ?? null} defaultHolder={g.holder_name}
        defaultShares={can || null} defaultPrice={g.exercise_price} busy={busy} onHolder={onHolder} onCancel={() => setForm(null)} onIssue={(x) => onExercise(g.id, x)}
        note={v == null ? `No vesting schedule is recorded. ${fmt(outstanding(g))} remain under the grant.` : `${fmt(v)} vested to date; ${fmt(can)} vested and not yet exercised. Exercising unvested ${g.instrument}s is only allowed if the plan permits it.`} />
    );
  }
  const ess = essDue(data);
  return (
    <>
      {data.plans.length === 0 && <p className="muted">No employee share plan recorded yet.</p>}
      {data.plans.map((p) => {
        const grants = data.grants.filter((g) => g.plan_id === p.id);
        const granted = grants.reduce((s, g) => s + g.number - g.lapsed, 0);
        return (
          <section key={p.id} className="card block">
            <div className="row spread">
              <h2>{p.name}</h2>
              {canEdit && (
                <button type="button" className="link-dark small" onClick={() => setForm(`plan:${p.id}`)}>
                  Edit plan
                </button>
              )}
            </div>
            <dl className="facts">
              <div><dt>Pool</dt><dd>{fmt(p.pool_size)}</dd></div>
              <div><dt>Granted</dt><dd>{fmt(granted)}</dd></div>
              <div><dt>Exercised</dt><dd>{fmt(grants.reduce((s, g) => s + g.exercised, 0))}</dd></div>
              <div><dt>Unallocated</dt><dd>{fmt(p.pool_size - granted)}</dd></div>
            </dl>
            <p className="small muted">
              Over {data.classes.find((c) => c.id === p.class_id)?.name ?? <span className="warning-text">no class recorded</span>}
              {p.adopted_on ? ` · adopted ${day(p.adopted_on)}` : ""}
              {" · Startup tax concession: "}
              {p.startup_concession == null ? <span className="warning-text">not known</span> : p.startup_concession ? "relied on" : "not relied on"}
            </p>
            {grants.length > 0 && (
              <div className="table-scroll">
                <table className="report-table wide">
                  <thead>
                    <tr>
                      <th scope="col">Holder</th>
                      <th scope="col" className="num">Granted</th>
                      <th scope="col" className="num">Price</th>
                      <th scope="col">Vesting</th>
                      <th scope="col" className="num">Vested</th>
                      <th scope="col" className="num">Exercised</th>
                      <th scope="col" className="num">Lapsed</th>
                      <th scope="col">Expires</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((g: Grant) => {
                      const v = vestedBy(g, t);
                      const expired = g.expires_on && g.expires_on < t && outstanding(g) > 0;
                      return (
                        <tr key={g.id}>
                          <th scope="row">
                            {canEdit ? <button type="button" className="link-dark" onClick={() => setForm(`grant:${g.id}`)}>{g.holder_name}</button> : g.holder_name}
                            <span className="muted small"><br />{g.instrument}s, {day(g.granted_on)}</span>
                            <ConsentLine data={data} subjectTable="esop_grants" subjectId={g.id} subjectDate={g.granted_on} canEdit={canEdit} busy={busy} onConsent={onConsent} />
                          </th>
                          <td className="num">{fmt(g.number)}</td>
                          <td className="num">{money(g.exercise_price)}</td>
                          <td className="small">{vestingSummary(g)}{g.leaver_terms ? <><br /><span className="muted">Leaver: {g.leaver_terms}</span></> : null}</td>
                          <td className={v == null ? "num warning-text" : "num"}>{v == null ? "?" : fmt(v)}</td>
                          <td className="num">{fmt(g.exercised)}</td>
                          <td className="num">{fmt(g.lapsed)}</td>
                          <td className={expired ? "warning-text" : undefined}>{day(g.expires_on)}{expired ? " (passed)" : ""}</td>
                          <td>
                            {canEdit && outstanding(g) > 0 && (
                              <span className="row">
                                <button type="button" className="link-dark small" onClick={() => setForm(`exercise:${g.id}`)}>Exercise</button>
                                <button type="button" className="link-dark small" onClick={() => setLapse({ id: g.id, n: outstanding(g) })}>Lapse</button>
                              </span>
                            )}
                            {lapse?.id === g.id && (
                              <span className="row wrap">
                                <input aria-label="Number lapsing" type="number" value={lapse.n ?? ""} onChange={(e) => setLapse({ id: g.id, n: toNum(e.target.value) })} />
                                <button type="button" disabled={busy || !lapse.n || lapse.n > outstanding(g)} onClick={() => {
                                  const { id: _id, exercised: _x, ...rest } = g;
                                  onGrant(g.id, { ...rest, lapsed: g.lapsed + (lapse.n ?? 0) });
                                  setLapse(null);
                                }}>
                                  Record lapse
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && p.status === "active" && (
              <p>
                <button type="button" className="quiet" onClick={() => setForm(`newgrant:${p.id}`)}>
                  Record a grant
                </button>
              </p>
            )}
            <Attachments subjectTable="esop_plans" subjectId={p.id} canAttach={canEdit} label="Plan rules and offer documents" />
          </section>
        );
      })}
      {canEdit && (
        <p className="block">
          <button type="button" onClick={() => setForm("plan")}>
            Add an employee share plan
          </button>
        </p>
      )}
      {ess.length > 0 && (
        <section className="card block">
          <h2>Employee share scheme reporting</h2>
          <p className="muted small">For each year (to 30 June) in which grants were made: statements to the employees by 14 July, and the ATO report by 14 August.</p>
          <ul className="plain rows">
            {ess.map((y) => (
              <li key={y.fyEnd}>
                <strong>Year to 30 June {y.fyEnd}</strong> <span className="muted small">· {y.grants} grant{y.grants === 1 ? "" : "s"}</span>
                <div className="row wrap small">
                  {[["statements_given_on", "Employee statements", y.statementsDue], ["ato_lodged_on", "ATO report", y.atoDue]].map(([key, label, due]) => {
                    const done = y.report?.[key as "statements_given_on" | "ato_lodged_on"];
                    return (
                      <span key={key} className="field">
                        <span className={!done && due < t ? "warning-text" : undefined}>
                          {label}: {done ? `done ${day(done)}` : `${due < t ? "overdue since" : "due"} ${day(due)}`}
                        </span>
                        {canEdit && !done && (
                          <button type="button" className="link-dark small" disabled={busy} onClick={() => onEss(y.fyEnd, y.report, { [key]: t })}>
                            Mark done today
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PlanForm({ initial, data, busy, onSave, onCancel }: { initial?: OwnershipData["plans"][number]; data: OwnershipData; busy: boolean; onSave: (v: PlanValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<PlanValues>(initial ? (({ id: _id, ...r }) => r)(initial) : { name: "Employee Share Option Plan", class_id: data.classes.find((c) => c.kind === "ordinary")?.id ?? null, pool_size: 0, adopted_on: null, resolution_id: null, startup_concession: null, notes: null, status: "active" });
  const set = (p: Partial<PlanValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h2>{initial ? initial.name : "New employee share plan"}</h2>
      <div className="row wrap">
        <Text id="p-name" label="Name" value={v.name} onChange={(x) => set({ name: x })} wide />
        <Text id="p-pool" label="Pool size (shares)" type="number" value={v.pool_size || null} onChange={(x) => set({ pool_size: toNum(x) ?? 0 })} />
        <Field id="p-class" label="Over which class">
          <select id="p-class" value={v.class_id ?? ""} onChange={(e) => set({ class_id: e.target.value || null })}>
            <option value="">Not recorded</option>
            {data.classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row wrap">
        <Text id="p-adopted" label="Adopted on" type="date" value={v.adopted_on} onChange={(x) => set({ adopted_on: x || null })} />
        <Yes id="p-conc" label="Relies on the startup tax concession" value={v.startup_concession} onChange={(x) => set({ startup_concession: x })} />
        <Field id="p-status" label="Status">
          <select id="p-status" value={v.status} onChange={(e) => set({ status: e.target.value as PlanValues["status"] })}>
            <option value="active">Active</option>
            <option value="closed">Closed to new grants</option>
          </select>
        </Field>
      </div>
      <ResolutionPick id="p-res" data={data} value={v.resolution_id} onChange={(x) => set({ resolution_id: x })} />
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => (v.pool_size > 0 && v.name.trim().length >= 2 ? onSave(v) : setMissing("Give the plan a name and a pool size."))}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function GrantForm({ initial, planId, data, busy, onSave, onCancel }: { initial?: Grant; planId: string; data: OwnershipData; busy: boolean; onSave: (v: GrantValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<GrantValues>(initial ? (({ id: _id, exercised: _x, ...r }) => r)(initial) : {
    plan_id: planId, holder_name: "", person_id: null, instrument: "option", number: 0, exercise_price: 0, granted_on: today(), vesting_start_on: null,
    vesting_months: 48, cliff_months: 12, vesting_every: "monthly", acceleration: null, leaver_terms: null, expires_on: null, lapsed: 0, resolution_id: null, notes: null,
  });
  const set = (p: Partial<GrantValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h2>{initial ? `Grant to ${initial.holder_name}` : "New grant"}</h2>
      <div className="row wrap">
        <Text id="g-name" label="Employee or adviser" value={v.holder_name} onChange={(x) => set({ holder_name: x })} wide />
        <Field id="g-inst" label="What">
          <select id="g-inst" value={v.instrument} onChange={(e) => set({ instrument: e.target.value as Grant["instrument"] })}>
            <option value="option">Options</option>
            <option value="right">Rights</option>
            <option value="share">Shares</option>
          </select>
        </Field>
        <Text id="g-num" label="Number" type="number" value={v.number || null} onChange={(x) => set({ number: toNum(x) ?? 0 })} />
        <Text id="g-price" label="Exercise price" value={v.exercise_price} onChange={(x) => set({ exercise_price: toNum(x) ?? 0 })} />
      </div>
      <div className="row wrap">
        <Text id="g-date" label="Granted on" type="date" value={v.granted_on} onChange={(x) => set({ granted_on: x })} />
        <Text id="g-vs" label="Vesting starts" type="date" value={v.vesting_start_on} onChange={(x) => set({ vesting_start_on: x || null })} />
        <Text id="g-vm" label="Vesting over (months)" type="number" value={v.vesting_months} onChange={(x) => set({ vesting_months: toNum(x) })} />
        <Text id="g-cliff" label="Cliff (months)" type="number" value={v.cliff_months} onChange={(x) => set({ cliff_months: toNum(x) })} />
        <Field id="g-every" label="Vests">
          <select id="g-every" value={v.vesting_every} onChange={(e) => set({ vesting_every: e.target.value as Grant["vesting_every"] })}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Yearly</option>
          </select>
        </Field>
        <Text id="g-exp" label="Expires" type="date" value={v.expires_on} onChange={(x) => set({ expires_on: x || null })} />
      </div>
      <div className="row wrap">
        <Text id="g-acc" label="Acceleration (on a sale)" placeholder="Double trigger: sale and termination" value={v.acceleration} onChange={(x) => set({ acceleration: x })} wide />
        <Text id="g-leave" label="Leaver terms" placeholder="Good leaver keeps vested; bad leaver forfeits all" value={v.leaver_terms} onChange={(x) => set({ leaver_terms: x })} wide />
      </div>
      <ResolutionPick id="g-res" data={data} value={v.resolution_id} onChange={(x) => set({ resolution_id: x })} />
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (!v.holder_name.trim()) return setMissing("Give the holder's name.");
          if (!v.number || v.number <= 0) return setMissing("Give the number granted.");
          if (v.cliff_months != null && v.vesting_months != null && v.cliff_months > v.vesting_months) return setMissing("The cliff cannot be longer than the vesting period.");
          onSave(v);
        }}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
      {initial && <Attachments subjectTable="esop_grants" subjectId={initial.id} canAttach label="Offer letter and acceptance" />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Convertibles
// ---------------------------------------------------------------------
function ConvertiblesView({ data, canEdit, busy, form, setForm, onSave, onConvert, onHolder, onConsent }: {
  data: OwnershipData; canEdit: boolean; busy: boolean; form: string | null; setForm: (f: string | null) => void;
  onSave: (id: string | null, v: ConvertibleValues) => void; onConvert: (id: string, v: IssueValues) => void; onHolder: (v: HolderValues) => Promise<string>; onConsent: (v: ConsentInput) => void;
}) {
  if (form === "conv" || form?.startsWith("conv:")) {
    const c = form === "conv" ? undefined : data.convertibles.find((x) => x.id === form.slice(5));
    return <ConvertibleForm initial={c} data={data} busy={busy} onSave={(v) => onSave(c?.id ?? null, v)} onCancel={() => setForm(null)} />;
  }
  if (form?.startsWith("convert:")) {
    const c = data.convertibles.find((x) => x.id === form.slice(8))!;
    const isSafe = c.kind === "safe" || c.kind === "convertible_note";
    return (
      <IssueForm title={`${isSafe ? "Convert" : "Exercise"}: ${CONVERTIBLE_LABELS[c.kind]}, ${c.holder_name}`} data={data} defaultClass={c.converts_class_id} defaultHolder={c.holder_name}
        defaultShares={isSafe ? null : c.shares} defaultPrice={isSafe ? null : c.exercise_price} busy={busy} onHolder={onHolder} onCancel={() => setForm(null)} onIssue={(x) => onConvert(c.id, x)}
        note={isSafe ? `Give the shares and price set by the round that triggered conversion. If the price is left blank, the ${money(c.principal, c.currency)} invested is treated as paying for the shares.` : undefined} />
    );
  }
  const shown = data.convertibles;
  return (
    <>
      {shown.length === 0 && <p className="muted">No SAFEs, convertible notes, warrants or investor options recorded.</p>}
      {shown.length > 0 && (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead>
              <tr>
                <th scope="col">Holder</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">Amount or shares</th>
                <th scope="col">Key terms</th>
                <th scope="col">Dates</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {shown.map((c: Convertible) => {
                const terms = [
                  c.valuation_cap ? `cap ${money(c.valuation_cap, c.currency)}` : c.kind === "safe" || c.kind === "convertible_note" ? "no cap" : null,
                  c.discount_pct ? `${c.discount_pct}% discount` : null,
                  c.interest_rate ? `${c.interest_rate}% interest` : null,
                  c.exercise_price != null ? `exercise ${money(c.exercise_price, c.currency)}` : null,
                  c.mfn ? "most favoured nation" : null,
                ].filter(Boolean).join(", ");
                const overdue = c.status === "outstanding" && c.maturity_on && c.maturity_on < today();
                return (
                  <tr key={c.id}>
                    <th scope="row">
                      {canEdit ? <button type="button" className="link-dark" onClick={() => setForm(`conv:${c.id}`)}>{c.holder_name}</button> : c.holder_name}
                      <ConsentLine data={data} subjectTable="convertibles" subjectId={c.id} subjectDate={c.issued_on} canEdit={canEdit} busy={busy} onConsent={onConsent} />
                    </th>
                    <td>{CONVERTIBLE_LABELS[c.kind]}</td>
                    <td className="num">{c.principal != null ? money(c.principal, c.currency) : ""}{c.shares ? `${c.principal != null ? " · " : ""}${fmt(c.shares)} shares` : ""}</td>
                    <td className="small">{terms}{c.conversion_trigger ? <><br /><span className="muted">Converts: {c.conversion_trigger}</span></> : null}</td>
                    <td className="small">
                      {c.issued_on ? `Issued ${day(c.issued_on)}` : ""}
                      {c.maturity_on ? <><br /><span className={overdue ? "warning-text" : undefined}>Matures {day(c.maturity_on)}</span></> : null}
                      {c.expires_on ? <><br />Expires {day(c.expires_on)}</> : null}
                    </td>
                    <td>{c.status[0].toUpperCase() + c.status.slice(1)}</td>
                    <td>
                      {canEdit && c.status === "outstanding" && (
                        <button type="button" className="link-dark small" onClick={() => setForm(`convert:${c.id}`)}>
                          {c.kind === "safe" || c.kind === "convertible_note" ? "Convert" : "Exercise"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <p className="block">
          <button type="button" onClick={() => setForm("conv")}>
            Add a SAFE, note, warrant or option
          </button>
        </p>
      )}
    </>
  );
}

function ConvertibleForm({ initial, data, busy, onSave, onCancel }: { initial?: Convertible; data: OwnershipData; busy: boolean; onSave: (v: ConvertibleValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<ConvertibleValues>(initial ? (({ id: _id, ...r }) => r)(initial) : {
    kind: "safe", holder_name: "", principal: null, currency: "AUD", valuation_cap: null, discount_pct: null, interest_rate: null, issued_on: today(), maturity_on: null,
    conversion_trigger: null, converts_class_id: null, mfn: null, shares: null, exercise_price: null, expires_on: null, status: "outstanding", resolution_id: null, notes: null,
  });
  const set = (p: Partial<ConvertibleValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  const money_ = v.kind === "safe" || v.kind === "convertible_note";
  return (
    <div className="card form">
      <h2>{initial ? `${CONVERTIBLE_LABELS[initial.kind]}: ${initial.holder_name}` : "New convertible"}</h2>
      <div className="row wrap">
        <Field id="v-kind" label="Type">
          <select id="v-kind" value={v.kind} disabled={Boolean(initial)} onChange={(e) => set({ kind: e.target.value as Convertible["kind"] })}>
            {Object.entries(CONVERTIBLE_LABELS).map(([id, l]) => (
              <option key={id} value={id}>{l}</option>
            ))}
          </select>
        </Field>
        <Text id="v-holder" label="Holder" value={v.holder_name} onChange={(x) => set({ holder_name: x })} wide />
        <Text id="v-issued" label="Issued on" type="date" value={v.issued_on} onChange={(x) => set({ issued_on: x || null })} />
      </div>
      {money_ ? (
        <div className="row wrap">
          <Text id="v-amt" label="Amount invested" value={v.principal} onChange={(x) => set({ principal: toNum(x) })} />
          <Text id="v-cap" label="Valuation cap" value={v.valuation_cap} onChange={(x) => set({ valuation_cap: toNum(x) })} />
          <Text id="v-disc" label="Discount %" value={v.discount_pct} onChange={(x) => set({ discount_pct: toNum(x) })} />
          {v.kind === "convertible_note" && <Text id="v-int" label="Interest % a year" value={v.interest_rate} onChange={(x) => set({ interest_rate: toNum(x) })} />}
          {v.kind === "convertible_note" && <Text id="v-mat" label="Matures" type="date" value={v.maturity_on} onChange={(x) => set({ maturity_on: x || null })} />}
        </div>
      ) : (
        <div className="row wrap">
          <Text id="v-shares" label="Number of shares" type="number" value={v.shares} onChange={(x) => set({ shares: toNum(x) })} />
          <Text id="v-ex" label="Exercise price" value={v.exercise_price} onChange={(x) => set({ exercise_price: toNum(x) })} />
          <Text id="v-exp" label="Expires" type="date" value={v.expires_on} onChange={(x) => set({ expires_on: x || null })} />
          {v.kind === "other" && <Text id="v-amt2" label="Amount (if any)" value={v.principal} onChange={(x) => set({ principal: toNum(x) })} />}
        </div>
      )}
      <div className="row wrap">
        <Field id="v-class" label="Converts into">
          <select id="v-class" value={v.converts_class_id ?? ""} onChange={(e) => set({ converts_class_id: e.target.value || null })}>
            <option value="">The next round's class</option>
            {data.classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Text id="v-trig" label="What triggers conversion" placeholder="A qualifying round of $2m or more; a sale; maturity" value={v.conversion_trigger} onChange={(x) => set({ conversion_trigger: x })} wide />
        <Yes id="v-mfn" label="Most favoured nation" value={v.mfn} onChange={(x) => set({ mfn: x })} />
      </div>
      <div className="row wrap">
        <ResolutionPick id="v-res" data={data} value={v.resolution_id} onChange={(x) => set({ resolution_id: x })} />
        {initial && initial.status === "outstanding" && (
          <Field id="v-status" label="Status">
            <select id="v-status" value={v.status} onChange={(e) => set({ status: e.target.value as Convertible["status"] })}>
              <option value="outstanding">Outstanding</option>
              <option value="repaid">Repaid</option>
              <option value="lapsed">Lapsed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        )}
      </div>
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (!v.holder_name.trim()) return setMissing("Give the holder's name.");
          if (money_ && !v.principal) return setMissing("Give the amount invested.");
          if (!money_ && v.kind !== "other" && !v.shares) return setMissing("Give the number of shares it covers.");
          onSave(v);
        }}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
      {initial && <Attachments subjectTable="convertibles" subjectId={initial.id} canAttach label="Signed documents" />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Investor rights, exit terms and reserved matters
// ---------------------------------------------------------------------
function RightsView({ data, canEdit, busy, form, setForm, onTerms, onMatter }: {
  data: OwnershipData; canEdit: boolean; busy: boolean; form: string | null; setForm: (f: string | null) => void;
  onTerms: (v: Terms) => void; onMatter: (id: string | null, v: MatterValues) => void;
}) {
  const stack = preferenceStack(data);
  const blankTerms: Terms = { agreement_dated: null, drag_along: null, tag_along: null, first_refusal: null, pre_emptive: null, exit_consents: null, other_terms: null };
  const [terms, setTerms] = useState<Terms>(data.terms ?? blankTerms);
  const outstandingConv = data.convertibles.filter((c) => c.status === "outstanding");
  const unvested = data.grants.filter((g) => outstanding(g) > 0);
  if (form === "matter" || form?.startsWith("matter:")) {
    const m = form === "matter" ? undefined : data.matters.find((x) => x.id === form.slice(7));
    return <MatterForm initial={m} data={data} busy={busy} onSave={(v) => onMatter(m?.id ?? null, v)} onCancel={() => setForm(null)} />;
  }
  const termRow = (key: keyof Terms, label: string) => (data.terms?.[key] ? <li><strong>{label}:</strong> {key === "agreement_dated" ? day(data.terms[key]) : data.terms[key]}</li> : <li><strong>{label}:</strong> <span className="warning-text">not recorded</span></li>);
  return (
    <>
      <section className="card block">
        <h2>What affects an exit</h2>
        <h3>Who is paid first</h3>
        {stack.length === 0 ? (
          <p className="muted small">No preference shares: on a sale every share is paid the same.</p>
        ) : (
          <ol className="small">
            {stack.map(({ cls, shares, amount }) => (
              <li key={cls.id}>
                <strong>{cls.name}</strong>: {fmt(shares)} shares
                {amount != null ? ` × ${money(cls.issue_price, cls.currency)} × ${cls.liq_pref_multiple} = ${money(amount, cls.currency)} before ordinary shareholders` : <span className="warning-text"> · preference or issue price not recorded</span>}
                {cls.liq_participation ? ` · ${PARTICIPATION_LABELS[cls.liq_participation].split(" (")[0].toLowerCase()}${cls.liq_participation === "capped" && cls.liq_cap_multiple ? ` to ${cls.liq_cap_multiple}×` : ""}` : <span className="warning-text"> · participation not recorded</span>}
                {cls.liq_seniority == null && <span className="warning-text"> · ranking not recorded</span>}
              </li>
            ))}
            <li>Then the ordinary shareholders{stack.some((s) => s.cls.liq_participation === "participating" || s.cls.liq_participation === "capped") ? ", sharing with participating classes" : ""}.</li>
          </ol>
        )}
        {stack.length > 0 && (
          <p className="muted small">
            Total preferences ahead of ordinary shares: {money(stack.reduce((s, x) => s + (x.amount ?? 0), 0))}
            {stack.some((x) => x.amount == null) ? " (incomplete: some classes are missing terms)" : ""}. A full exit waterfall is on the to-do list.
          </p>
        )}
        <h3>Shareholders' agreement terms</h3>
        {form === "terms" ? (
          <div className="form">
            <Text id="t-date" label="Agreement dated" type="date" value={terms.agreement_dated} onChange={(x) => setTerms({ ...terms, agreement_dated: x || null })} />
            <Text id="t-drag" label="Drag-along" placeholder="Holders of 75% (including a Series A majority) can require all to sell" value={terms.drag_along} onChange={(x) => setTerms({ ...terms, drag_along: x })} wide />
            <Text id="t-tag" label="Tag-along" value={terms.tag_along} onChange={(x) => setTerms({ ...terms, tag_along: x })} wide />
            <Text id="t-rofr" label="Right of first refusal" value={terms.first_refusal} onChange={(x) => setTerms({ ...terms, first_refusal: x })} wide />
            <Text id="t-pre" label="Pre-emptive rights on new issues" value={terms.pre_emptive} onChange={(x) => setTerms({ ...terms, pre_emptive: x })} wide />
            <Text id="t-exit" label="Consents needed for a sale or IPO" value={terms.exit_consents} onChange={(x) => setTerms({ ...terms, exit_consents: x })} wide />
            <Text id="t-other" label="Anything else that affects an exit" value={terms.other_terms} onChange={(x) => setTerms({ ...terms, other_terms: x })} wide />
            <div className="row">
              <button type="button" disabled={busy} onClick={() => onTerms(terms)}>Save</button>
              <button type="button" className="quiet" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <ul className="plain small">
              {termRow("agreement_dated", "Agreement dated")}
              {termRow("drag_along", "Drag-along")}
              {termRow("tag_along", "Tag-along")}
              {termRow("first_refusal", "First refusal")}
              {termRow("pre_emptive", "Pre-emption")}
              {termRow("exit_consents", "Consents for a sale or IPO")}
              {data.terms?.other_terms && <li><strong>Other:</strong> {data.terms.other_terms}</li>}
            </ul>
            {canEdit && <button type="button" className="link-dark small" onClick={() => { setTerms(data.terms ?? blankTerms); setForm("terms"); }}>Edit these terms</button>}
          </>
        )}
        {(outstandingConv.length > 0 || unvested.length > 0) && (
          <>
            <h3>Would convert or vest on a sale</h3>
            <ul className="plain small">
              {outstandingConv.map((c) => (
                <li key={c.id}>{CONVERTIBLE_LABELS[c.kind]}: {c.holder_name}{c.principal ? `, ${money(c.principal, c.currency)}` : ""}{c.shares ? `, ${fmt(c.shares)} shares` : ""}{c.conversion_trigger ? ` · ${c.conversion_trigger}` : ""}</li>
              ))}
              {unvested.length > 0 && (
                <li>
                  ESOP: {fmt(unvested.reduce((s, g) => s + outstanding(g), 0))} outstanding across {unvested.length} grant{unvested.length === 1 ? "" : "s"}
                  {unvested.some((g) => g.acceleration) ? "; some accelerate on a sale" : unvested.every((g) => !g.acceleration) ? "; no acceleration recorded" : ""}
                </li>
              )}
            </ul>
          </>
        )}
      </section>

      <section className="card block">
        <h2>Investor reserved matters</h2>
        <p className="muted small">Decisions that need investor consent. A contract that falls within one cannot be approved until the consent is recorded on it. Share issues, grants and convertibles show the consent they need.</p>
        {data.matters.length === 0 ? (
          <p className="muted small">None recorded.</p>
        ) : (
          <ul className="plain rows">
            {data.matters.map((m) => (
              <li key={m.id} className={m.is_active ? undefined : "voided"}>
                <div className="row spread">
                  <span>
                    <strong>{m.matter}</strong> <span className="muted small">· consent from {m.consent_from}{m.clause ? ` · ${m.clause}` : ""}</span>
                  </span>
                  {canEdit && <button type="button" className="link-dark small" onClick={() => setForm(`matter:${m.id}`)}>Edit</button>}
                </div>
                <div className="small muted">
                  {[m.all_contracts && "every contract", m.contracts_from != null && `contracts of ${money(m.contracts_from)} or more`, m.related_party && "contracts with group companies", m.share_issues && "issuing shares, options or convertibles"].filter(Boolean).join("; ") || "Not checked automatically: recorded for reference"}
                  {!m.is_active ? " · no longer applies" : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && <button type="button" onClick={() => setForm("matter")}>Add a reserved matter</button>}
      </section>
    </>
  );
}

function MatterForm({ initial, data, busy, onSave, onCancel }: { initial?: Matter; data: OwnershipData; busy: boolean; onSave: (v: MatterValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<MatterValues>(initial ? (({ id: _id, ...r }) => r)(initial) : { matter: "", consent_from: "", class_id: null, clause: null, all_contracts: false, contracts_from: null, related_party: false, share_issues: false, is_active: true, notes: null });
  const set = (p: Partial<MatterValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h2>{initial ? "Reserved matter" : "New reserved matter"}</h2>
      <Text id="r-matter" label="The matter" placeholder="Entering into any contract worth more than $250,000" value={v.matter} onChange={(x) => set({ matter: x })} wide />
      <div className="row wrap">
        <Text id="r-from" label="Consent needed from" placeholder="Series A majority" value={v.consent_from} onChange={(x) => set({ consent_from: x })} wide />
        <Field id="r-class" label="Class (if one)">
          <select id="r-class" value={v.class_id ?? ""} onChange={(e) => set({ class_id: e.target.value || null })}>
            <option value="">None</option>
            {data.classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Text id="r-clause" label="Clause" placeholder="SHA cl 7.2(c)" value={v.clause} onChange={(x) => set({ clause: x })} />
      </div>
      <fieldset className="plain-fieldset">
        <legend>Check it automatically against</legend>
        <label className="check"><input type="checkbox" checked={v.all_contracts} onChange={(e) => set({ all_contracts: e.target.checked })} /> Every contract</label>
        <span className="row wrap">
          <label className="check"><input type="checkbox" checked={v.contracts_from != null} onChange={(e) => set({ contracts_from: e.target.checked ? 0 : null })} /> Contracts worth at least</label>
          {v.contracts_from != null && <input aria-label="Contract value threshold" value={v.contracts_from || ""} onChange={(e) => set({ contracts_from: toNum(e.target.value) ?? 0 })} />}
        </span>
        <label className="check"><input type="checkbox" checked={v.related_party} onChange={(e) => set({ related_party: e.target.checked })} /> Contracts with group companies</label>
        <label className="check"><input type="checkbox" checked={v.share_issues} onChange={(e) => set({ share_issues: e.target.checked })} /> Issuing shares, options or convertibles</label>
        <p className="muted small">Contracts with no value recorded are treated as needing consent when a value threshold applies.</p>
      </fieldset>
      {initial && <label className="check"><input type="checkbox" checked={v.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Still applies</label>}
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (v.matter.trim().length < 3) return setMissing("Describe the matter.");
          if (v.consent_from.trim().length < 2) return setMissing("Say whose consent is needed.");
          onSave(v);
        }}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Fully diluted
// ---------------------------------------------------------------------
function DilutedView({ data, today: t }: { data: OwnershipData; today: string }) {
  const d = fullyDiluted(data, t);
  if (!d.rows.length) return <p className="muted">Nothing on the register yet.</p>;
  return (
    <>
      <p className="muted small">
        In {d.baseClass?.name ?? "ordinary"} shares, as if everything converted or was exercised. Each row shows how it is worked out. SAFEs and notes are estimated at their cap; the real number depends on the next round.
      </p>
      <div className="table-scroll">
        <table className="report-table wide">
          <thead>
            <tr>
              <th scope="col">Holder</th>
              <th scope="col">Instrument</th>
              <th scope="col" className="num">Shares</th>
              <th scope="col" className="num">Fully diluted</th>
              <th scope="col">How</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.holder}</th>
                <td>{r.instrument}{r.estimate ? <span className="muted small"> (estimate)</span> : null}</td>
                <td className="num">{fmt(r.shares)}</td>
                <td className="num">{pct(r.shares, d.total)}</td>
                <td className="small muted">{r.how}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Fully diluted total</th>
              <td />
              <td className="num">{fmt(d.total)}</td>
              <td className="num">100%</td>
              <td className="small muted">Issued (as converted): {fmt(d.issued)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {d.notEstimated.length > 0 && (
        <section className="card warning block">
          <h2>Not included</h2>
          <ul className="plain small">
            {d.notEstimated.map((n, i) => (
              <li key={i}><strong>{n.holder}</strong>: {n.why}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
