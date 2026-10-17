import { useCallback, useEffect, useState } from "react";
import Attachments from "./Attachments";
import { today as todayIso } from "./authorities";
import { formatDay } from "./board";
import { has } from "./roles";
import { loadAcquisitions, saveAcquisition, type Acquisition, type AcquisitionValues } from "./regulatory";
import type { GroupData } from "./types";

type Props = { organisationId: string; role: string; group: GroupData | null };
const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
const m = (x: number | null | undefined) => (x === null || x === undefined ? "?" : `$${x.toLocaleString("en-AU", { maximumFractionDigits: 1 })}m`);
const STATUS: Record<Acquisition["status"], string> = { considering: "Being considered", notified: "Notified, waiting", determined: "Determined", completed: "Completed", abandoned: "Abandoned" };
const NOTIFY: Record<Acquisition["notification"], string> = { required: "ACCC approval required", not_required: "Not notifiable", unknown: "Test not finished" };
const DETERMINATION: Record<NonNullable<Acquisition["determination"]>, string> = { approved: "Approved", approved_with_conditions: "Approved with conditions", waiver: "Waiver granted", not_approved: "Not approved" };

const stripDeal = (d: Acquisition): Partial<AcquisitionValues> => (({ id: _i, aggregated_target_revenue: _a, notification: _n, reasons: _r, created_at: _c, ...r }) => r)(d);

/** A preview of the database's test (the database's answer is the one kept) */
export function previewTest(v: Partial<AcquisitionValues>, prior: Acquisition[]) {
  const t = v.target_revenue ?? null;
  const a = v.acquirer_group_revenue ?? null;
  if (v.gives_control === false) return { result: "not_required" as const, text: "It does not give control of the target." };
  if (v.target_in_australia === false) return { result: "not_required" as const, text: "The target does not carry on business in Australia." };
  if ((v.exception ?? "").trim()) return { result: "not_required" as const, text: "An exception is relied on: confirm it applies." };
  if (a === null || t === null) return { result: "unknown" as const, text: "Enter the acquirer group's and the target's Australian revenue." };
  const add = t >= 2 ? prior.filter((p) => (v.related_ids ?? []).includes(p.id) && p.status === "completed" && (p.target_revenue ?? 0) >= 2 && !p.accc_notified_on).reduce((s, p) => s + (p.target_revenue ?? 0), 0) : 0;
  const agg = t + add;
  const A = a + t >= 200 && (agg >= 50 || (v.transaction_value ?? 0) >= 250);
  const B = a >= 500 && agg >= 10;
  const unsure = v.gives_control === null || v.gives_control === undefined || v.target_in_australia === null || v.target_in_australia === undefined;
  return { result: (A || B ? (unsure ? "unknown" : "required") : unsure ? "unknown" : "not_required") as Acquisition["notification"], text: `Combined revenue ${m(a + t)}; target revenue ${m(agg)}${add ? ` including ${m(add)} from related acquisitions` : ""}${v.transaction_value ? `; value ${m(v.transaction_value)}` : ""}.` };
}

/** Risk and compliance, Merger control */
export default function MergerControl({ organisationId, role, group }: Props) {
  const manage = has(role, "owner", "admin", "secretary", "legal", "compliance");
  const [deals, setDeals] = useState<Acquisition[] | null>(null);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const t = todayIso();
  const reload = useCallback(async () => {
    try {
      const r = await loadAcquisitions(organisationId);
      setReady(r.ready);
      setDeals(r.deals);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load.");
    }
  }, [organisationId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await work();
      await reload();
      setNotice(done);
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
      <p className="eyebrow">Risk and compliance</p>
      <h1>Merger control</h1>
      <p className="lead">From 1 January 2026, an acquisition that meets the thresholds must be notified to the ACCC and approved before it completes. One completed without approval is void, and penalties apply. Test each acquisition here, including earlier related acquisitions in the last three years.</p>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!deals) return <>{header}<p className="muted">Loading…</p></>;
  if (!ready) return <>{header}<p className="card warning">Not set up yet: run migration 0053 in Supabase.</p></>;
  if (editing) {
    const deal = editing === "new" ? null : deals.find((d) => d.id === editing) ?? null;
    return <>{header}<DealForm key={editing} deal={deal} others={deals.filter((d) => d.id !== editing)} group={group} canEdit={manage} busy={busy} today={t}
      onCancel={() => setEditing(null)} onSave={async (v, done) => { let id: string | null = deal?.id ?? null; const ok = await run(async () => { id = await saveAcquisition(organisationId, deal?.id ?? null, v); }, done); if (ok && id) setEditing(id); }} /></>;
  }
  const live = deals.filter((d) => d.status === "considering" || d.status === "notified");
  const urgent = live.filter((d) => d.notification === "required" && !d.determination);
  return (
    <>
      {header}
      {urgent.length > 0 && (
        <section className="card warning block" role="alert">
          <p><strong>{urgent.length} acquisition{urgent.length === 1 ? " needs" : "s need"} ACCC approval before completing.</strong></p>
          <ul className="small">{urgent.map((d) => <li key={d.id}>{d.name}: {d.accc_notified_on ? `notified ${day(d.accc_notified_on)}, waiting for the determination` : "not yet notified"}{d.planned_completion_on ? ` · planned completion ${day(d.planned_completion_on)}` : ""}</li>)}</ul>
        </section>
      )}
      {deals.length === 0 ? <p className="muted">No acquisitions recorded. Record completed acquisitions from the last three years too: they count towards the thresholds for later related deals.</p> : (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead><tr><th scope="col">Acquisition</th><th scope="col">Test</th><th scope="col">Status</th><th scope="col">Dates</th></tr></thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className={d.status === "abandoned" ? "muted" : undefined}>
                  <th scope="row"><button type="button" className="link-dark" onClick={() => setEditing(d.id)}>{d.name}</button><span className="muted small"><br />{d.target}{d.market ? ` · ${d.market}` : ""}</span></th>
                  <td className={d.notification === "not_required" ? undefined : "warning-text"}>{NOTIFY[d.notification]}</td>
                  <td>{STATUS[d.status]}{d.determination ? <span className="muted small"><br />{DETERMINATION[d.determination]}</span> : null}</td>
                  <td className="small">{d.completed_on ? `Completed ${day(d.completed_on)}` : d.planned_completion_on ? `Planned ${day(d.planned_completion_on)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage && <p className="block"><button type="button" onClick={() => setEditing("new")}>Add an acquisition</button></p>}
      <p className="small muted">This applies the notification thresholds only. Get advice on control, the exceptions, and whether to seek a waiver or notify voluntarily.</p>
    </>
  );
}

function DealForm({ deal, others, group, canEdit, busy, today: t, onSave, onCancel }: {
  deal: Acquisition | null; others: Acquisition[]; group: GroupData | null; canEdit: boolean; busy: boolean; today: string;
  onSave: (v: Partial<AcquisitionValues>, done: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<Partial<AcquisitionValues>>(deal ? stripDeal(deal) : {
    entity_id: null, name: "", target: "", kind: "shares", market: null, acquirer_group_revenue: null, target_revenue: null, transaction_value: null, gives_control: null,
    target_in_australia: null, exception: null, related_ids: [], status: "considering", planned_completion_on: null,
  });
  const set = (p: Partial<AcquisitionValues>) => setV({ ...v, ...p });
  const [completeOn, setCompleteOn] = useState(t);
  const prev = previewTest(v, others);
  const money = (id: string, label: string, key: "acquirer_group_revenue" | "target_revenue" | "transaction_value", hint: string) => (
    <span className="field"><label htmlFor={id}>{label}</label><input id={id} type="number" min={0} step="0.1" disabled={!canEdit} value={v[key] ?? ""} onChange={(e) => set({ [key]: e.target.value === "" ? null : Number(e.target.value) })} /><span className="muted small">{hint}</span></span>
  );
  const yn = (name: string, label: string, key: "gives_control" | "target_in_australia") => (
    <fieldset className="plain-fieldset question"><legend>{label}</legend>
      <span className="row wrap">
        <label className="check"><input type="radio" name={name} disabled={!canEdit} checked={v[key] === true} onChange={() => set({ [key]: true })} /> Yes</label>
        <label className="check"><input type="radio" name={name} disabled={!canEdit} checked={v[key] === false} onChange={() => set({ [key]: false })} /> No</label>
        <label className="check"><input type="radio" name={name} disabled={!canEdit} checked={v[key] === null || v[key] === undefined} onChange={() => set({ [key]: null })} /> Not sure</label>
      </span>
    </fieldset>
  );
  const threeYears = new Date(`${v.planned_completion_on ?? t}T12:00:00`);
  threeYears.setFullYear(threeYears.getFullYear() - 3);
  const related = others.filter((o) => o.status === "completed" && o.completed_on && o.completed_on >= threeYears.toISOString().slice(0, 10));
  const TEST = ["acquirer_group_revenue", "target_revenue", "transaction_value", "gives_control", "target_in_australia", "exception", "related_ids"] as const;
  const dirty = !deal || TEST.some((k) => JSON.stringify(v[k] ?? null) !== JSON.stringify(deal[k] ?? null));
  const shown = dirty ? prev.result : deal!.notification;
  return (
    <>
      <p><button type="button" className="back" onClick={onCancel}>← Back to acquisitions</button></p>
      <section className="card form block">
        <h2>{deal ? deal.name : "New acquisition"}</h2>
        <div className="row wrap">
          <span className="field grow"><label htmlFor="mq-name">Project name</label><input id="mq-name" disabled={!canEdit} value={v.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></span>
          <span className="field grow"><label htmlFor="mq-target">Target</label><input id="mq-target" disabled={!canEdit} value={v.target ?? ""} onChange={(e) => set({ target: e.target.value })} /></span>
        </div>
        <div className="row wrap">
          <span className="field"><label htmlFor="mq-kind">What is acquired</label><select id="mq-kind" disabled={!canEdit} value={v.kind} onChange={(e) => set({ kind: e.target.value as Acquisition["kind"] })}><option value="shares">Shares</option><option value="assets">Assets</option><option value="business">A business</option><option value="units">Units in a trust or scheme</option><option value="other">Other</option></select></span>
          <span className="field grow"><label htmlFor="mq-market">Goods or services</label><input id="mq-market" disabled={!canEdit} value={v.market ?? ""} onChange={(e) => set({ market: e.target.value })} placeholder="Industrial resins" /></span>
          {(group?.entities.length ?? 0) > 0 && <span className="field"><label htmlFor="mq-ent">Acquirer</label><select id="mq-ent" disabled={!canEdit} value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}><option value="">Not chosen</option>{group!.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></span>}
          <span className="field"><label htmlFor="mq-plan">Planned completion</label><input id="mq-plan" type="date" disabled={!canEdit} value={v.planned_completion_on ?? ""} onChange={(e) => set({ planned_completion_on: e.target.value || null })} /></span>
        </div>
        <h3>The test (Australian revenue for the last 12 months, A$ millions)</h3>
        <div className="row wrap">
          {money("mq-acq", "Acquirer group revenue", "acquirer_group_revenue", "The acquirer and its connected entities")}
          {money("mq-tgt", "Target revenue", "target_revenue", "Australian revenue of what is acquired")}
          {money("mq-val", "Transaction value", "transaction_value", "The greater of the price and market value")}
        </div>
        {yn("mq-control", "Does it give control of the target (alone or with associates)?", "gives_control")}
        {yn("mq-aus", "Does the target carry on business in Australia?", "target_in_australia")}
        <span className="field grow"><label htmlFor="mq-ex">Exception relied on, if any</label><input id="mq-ex" disabled={!canEdit} value={v.exception ?? ""} onChange={(e) => set({ exception: e.target.value })} placeholder="For example a rights issue, an authorised buy-back, or certain land" /></span>
        {related.length > 0 && (
          <fieldset className="plain-fieldset question">
            <legend>Earlier acquisitions of the same or substitutable goods or services, in the last three years</legend>
            {related.map((o) => (
              <label key={o.id} className="check"><input type="checkbox" disabled={!canEdit} checked={(v.related_ids ?? []).includes(o.id)} onChange={(e) => set({ related_ids: e.target.checked ? [...(v.related_ids ?? []), o.id] : (v.related_ids ?? []).filter((x) => x !== o.id) })} /> {o.name} ({o.target}, {m(o.target_revenue)}, completed {day(o.completed_on)}{o.accc_notified_on ? ", notified: not counted" : (o.target_revenue ?? 0) < 2 ? ", under $2m: not counted" : ""})</label>
            ))}
          </fieldset>
        )}
        <div className={shown === "not_required" ? "card note" : "card warning"}>
          <p><strong>{NOTIFY[shown]}</strong></p>
          <p className="small">{dirty ? prev.text : deal!.reasons}</p>
          {deal && dirty && <p className="small muted">Preview: save to record the test.</p>}
        </div>
        <span className="field grow"><label htmlFor="mq-notes">Notes</label><textarea id="mq-notes" rows={2} disabled={!canEdit} value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></span>
        {canEdit && <button type="button" disabled={busy || (v.name ?? "").trim().length < 2 || (v.target ?? "").trim().length < 2} onClick={() => onSave(v, "Saved and tested.")}>{deal ? "Save and test again" : "Save and test"}</button>}
      </section>

      {deal && deal.notification !== "not_required" && canEdit && deal.status !== "completed" && deal.status !== "abandoned" && (
        <section className="card form block">
          <h2>ACCC</h2>
          <div className="row wrap">
            <span className="field"><label htmlFor="mq-nd">Notified on</label><input id="mq-nd" type="date" max={t} value={v.accc_notified_on ?? ""} onChange={(e) => set({ accc_notified_on: e.target.value || null })} /></span>
            <span className="field"><label htmlFor="mq-ref">ACCC reference</label><input id="mq-ref" value={v.accc_reference ?? ""} onChange={(e) => set({ accc_reference: e.target.value })} /></span>
          </div>
          <div className="row wrap">
            <span className="field"><label htmlFor="mq-det">Determination</label><select id="mq-det" value={v.determination ?? ""} onChange={(e) => set({ determination: (e.target.value || null) as Acquisition["determination"] })}><option value="">Not yet</option>{Object.entries(DETERMINATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span>
            <span className="field"><label htmlFor="mq-dd">Determined on</label><input id="mq-dd" type="date" max={t} value={v.determined_on ?? ""} onChange={(e) => set({ determined_on: e.target.value || null })} /></span>
          </div>
          {v.determination === "approved_with_conditions" && <span className="field grow"><label htmlFor="mq-cond">Conditions</label><textarea id="mq-cond" rows={2} value={v.conditions ?? ""} onChange={(e) => set({ conditions: e.target.value })} /></span>}
          <p className="small muted">Phase 1 runs up to 30 business days from notification; Phase 2 up to a further 90.</p>
          <button type="button" disabled={busy} onClick={() => onSave(v, "Saved.")}>Save</button>
        </section>
      )}

      {deal && canEdit && deal.status !== "completed" && deal.status !== "abandoned" && (
        <section className="card form block">
          <h2>Completion</h2>
          {deal.notification === "required" && !["approved", "approved_with_conditions", "waiver"].includes(deal.determination ?? "") ? (
            <p className="warning-text small"><strong>Do not complete.</strong> It needs ACCC approval first; completing without it makes the acquisition void.</p>
          ) : deal.notification === "unknown" ? (
            <p className="warning-text small">Finish the test before completing.</p>
          ) : (
            <div className="row wrap">
              <span className="field"><label htmlFor="mq-comp">Completed on</label><input id="mq-comp" type="date" max={t} value={completeOn} onChange={(e) => setCompleteOn(e.target.value)} /></span>
              <button type="button" disabled={busy} onClick={() => onSave({ ...v, status: "completed", completed_on: completeOn }, "Completion recorded.")}>Record completion</button>
            </div>
          )}
          <p><button type="button" className="quiet" disabled={busy} onClick={() => onSave({ ...v, status: "abandoned" }, "Marked as abandoned.")}>The deal is not going ahead</button></p>
        </section>
      )}
      {deal && <Attachments subjectTable="acquisitions" subjectId={deal.id} canAttach={canEdit} label="Deal papers, notification and determination" />}
    </>
  );
}
