import { useCallback, useEffect, useState, type ReactNode } from "react";
import LawNote from "./LawNote";
import Attachments from "./Attachments";
import { today as todayIso } from "./authorities";
import { formatDay } from "./board";
import { has } from "./roles";
import {
  CONTROL_LABELS, DANGEROUS, ELEMENTS, KIND_LABELS, loadSummary, loadWhs, PSYCHOSOCIAL, REASON_LABELS, REGULATORS, reportIncident, saveHazard, saveReview,
  score, scoreLabel, SERIOUS, SEVERITY_LABELS, signOffReview, STATES, updateIncident,
  type DdReview, type Hazard, type HazardValues, type Incident, type Summary, type WhsData,
} from "./whs";
import type { GroupData } from "./types";

type Sub = "incidents" | "hazards" | "officers";
type Props = { organisationId: string; role: string; userId: string; group: GroupData | null };
const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function Field({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return <span className={wide ? "field grow" : "field"}><label htmlFor={id}>{label}</label>{children}</span>;
}

/** Risk and compliance, Work health and safety */
export default function Whs({ organisationId, role, userId, group }: Props) {
  const manage = has(role, "owner", "admin", "secretary", "legal", "compliance");
  const board = manage || has(role, "director", "auditor");
  const canSign = has(role, "owner", "admin", "secretary", "director");
  const [sub, setSub] = useState<Sub>("incidents");
  const [data, setData] = useState<WhsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const t = todayIso();

  const reload = useCallback(async () => {
    try {
      setData(await loadWhs(organisationId));
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
      <h1>Work health and safety</h1>
      <p className="lead">Report incidents, decide quickly whether the regulator must be told, keep the hazard register (including psychosocial hazards), and give directors the evidence of their due diligence as officers.</p>
      <LawNote library="whs" />
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!data) return <>{header}<p className="muted">Loading…</p></>;
  if (!data.ready) return <>{header}<p className="card warning">Not set up yet: run migration 0049 in Supabase.</p></>;

  const notNotified = data.incidents.filter((i) => i.status === "open" && i.notifiable && !i.regulator_notified_at);
  const notAssessed = data.incidents.filter((i) => i.status === "open" && i.notifiable === null);
  const subs: { id: Sub; label: string }[] = [
    { id: "incidents", label: manage ? `Incidents (${data.incidents.filter((i) => i.status === "open").length} open)` : "Report an incident" },
    { id: "hazards", label: `Hazards (${data.hazards.filter((h) => h.status === "active").length})` },
    ...(board ? [{ id: "officers" as Sub, label: "Officer due diligence" }] : []),
  ];

  return (
    <>
      {header}
      {manage && (notNotified.length > 0 || notAssessed.length > 0) && (
        <section className="card warning block" role="alert">
          {notNotified.length > 0 && <p><strong>{notNotified.length} notifiable incident{notNotified.length === 1 ? " has" : "s have"} not been recorded as notified to the regulator.</strong> Notification must be immediate.</p>}
          {notAssessed.length > 0 && <p>{notAssessed.length} incident{notAssessed.length === 1 ? " is" : "s are"} waiting for a decision on whether it is notifiable.</p>}
        </section>
      )}
      <span className="segmented block-gap" role="group" aria-label="WHS sections">
        {subs.map((x) => <button key={x.id} type="button" className={sub === x.id ? "on" : undefined} aria-pressed={sub === x.id} onClick={() => { setSub(x.id); setOpenId(null); setReporting(false); }}>{x.label}</button>)}
      </span>

      {sub === "incidents" && (
        reporting ? (
          <ReportForm group={group} busy={busy} onCancel={() => setReporting(false)}
            onSave={async (v) => { if (await run(async () => { const id = await reportIncident(organisationId, v); setOpenId(id); }, "Reported. Thank you. The people who manage WHS have been told under For you.")) setReporting(false); }} />
        ) : openId && data.incidents.find((i) => i.id === openId) ? (
          <IncidentDetail incident={data.incidents.find((i) => i.id === openId)!} manage={manage} mine={data.incidents.find((i) => i.id === openId)!.reported_by === userId} busy={busy} group={group}
            onBack={() => setOpenId(null)} onSave={(patch, done) => run(() => updateIncident(openId, patch), done)} />
        ) : (
          <>
            <p><button type="button" onClick={() => setReporting(true)}>Report an incident or near miss</button></p>
            {!manage && <p className="muted small">You see incidents you reported. The people who manage WHS see all of them.</p>}
            {data.incidents.length === 0 ? <p className="muted">No incidents recorded.</p> : (
              <div className="table-scroll">
                <table className="report-table wide">
                  <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Severity</th><th scope="col">Notifiable</th><th scope="col">Investigation</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {data.incidents.map((i) => (
                      <tr key={i.id} className="clickable" onClick={() => setOpenId(i.id)}>
                        <th scope="row"><button type="button" className="link-dark" onClick={() => setOpenId(i.id)}>{day(i.occurred_at)}</button><span className="muted small"><br />{i.location}{i.state ? `, ${i.state}` : ""}</span></th>
                        <td>{KIND_LABELS[i.kind].split(" (")[0]}<span className="muted small"><br />{i.description.slice(0, 80)}</span></td>
                        <td>{i.severity ? SEVERITY_LABELS[i.severity] : <span className="muted">Not recorded</span>}</td>
                        <td className={i.notifiable === null || (i.notifiable && !i.regulator_notified_at) ? "warning-text" : undefined}>
                          {i.notifiable === null ? "Not yet decided" : i.notifiable ? (i.regulator_notified_at ? `Yes, notified ${day(i.regulator_notified_at)}` : "Yes, NOT YET NOTIFIED") : "No"}
                        </td>
                        <td>{i.investigation_status.replace("_", " ")}</td>
                        <td>{i.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}
      {sub === "hazards" && <Hazards data={data} manage={manage} userId={userId} group={group} busy={busy} today={t}
        onSave={(id, v) => run(() => saveHazard(organisationId, id, v), "Hazard saved.")} />}
      {sub === "officers" && board && <Officers organisationId={organisationId} data={data} canEdit={manage || has(role, "director")} canSign={canSign} busy={busy} today={t}
        onSave={(id, period, answers) => run(() => saveReview(organisationId, id, period, answers), "Saved.")}
        onSign={(id) => run(() => signOffReview(id), "Signed off. The summary at today's date is kept with it.")} />}
    </>
  );
}

function ReportForm({ group, busy, onSave, onCancel }: { group: GroupData | null; busy: boolean; onSave: (v: Partial<Incident>) => void; onCancel: () => void }) {
  const [v, setV] = useState<Partial<Incident>>({ occurred_at: localNow(), kind: "injury", state: "NSW", severity: null });
  const set = (p: Partial<Incident>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h2>Report an incident or near miss</h2>
      <p className="muted small">If anyone is seriously hurt, get help first: call 000. Then report it here as soon as you can.</p>
      <div className="row wrap">
        <Field id="i-when" label="When"><input id="i-when" type="datetime-local" max={localNow()} value={v.occurred_at ?? ""} onChange={(e) => set({ occurred_at: e.target.value })} /></Field>
        <Field id="i-where" label="Where" wide><input id="i-where" value={v.location ?? ""} onChange={(e) => set({ location: e.target.value })} /></Field>
        <Field id="i-state" label="State"><select id="i-state" value={v.state ?? ""} onChange={(e) => set({ state: e.target.value || null })}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        {(group?.entities.length ?? 0) > 0 && (
          <Field id="i-entity" label="Company"><select id="i-entity" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}><option value="">Not sure</option>{group!.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        )}
      </div>
      <div className="row wrap">
        <Field id="i-kind" label="What kind"><select id="i-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as Incident["kind"] })}>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="i-sev" label="How serious"><select id="i-sev" value={v.severity ?? ""} onChange={(e) => set({ severity: (e.target.value || null) as Incident["severity"] })}><option value="">Not sure yet</option>{Object.entries(SEVERITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <Field id="i-desc" label="What happened" wide><textarea id="i-desc" rows={4} value={v.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field id="i-who" label="Who was involved (names and roles)" wide><input id="i-who" value={v.persons_involved ?? ""} onChange={(e) => set({ persons_involved: e.target.value })} /></Field>
      <Field id="i-act" label="What was done straight away" wide><input id="i-act" value={v.immediate_action ?? ""} onChange={(e) => set({ immediate_action: e.target.value })} /></Field>
      <p className="muted small">Only the people who manage WHS and you can see this report. Directors see totals without names.</p>
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if (!v.occurred_at) return setMissing("Say when it happened.");
          if ((v.description ?? "").trim().length < 10) return setMissing("Describe what happened.");
          onSave({ ...v, occurred_at: new Date(v.occurred_at).toISOString() });
        }}>Report</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function IncidentDetail({ incident: i, manage, mine, busy, group, onBack, onSave }: {
  incident: Incident; manage: boolean; mine: boolean; busy: boolean; group: GroupData | null; onBack: () => void; onSave: (patch: Partial<Incident>, done: string) => Promise<boolean>;
}) {
  const [death, setDeath] = useState<boolean | null>(null);
  const [serious, setSerious] = useState<boolean | null>(null);
  const [dangerous, setDangerous] = useState<boolean | null>(null);
  const [basis, setBasis] = useState("");
  const [notified, setNotified] = useState(localNow());
  const [ref, setRef] = useState("");
  const [inv, setInv] = useState({ investigation_status: i.investigation_status, root_cause: i.root_cause ?? "", corrective_actions: i.corrective_actions ?? "", actions_due_on: i.actions_due_on ?? "", actions_done_on: i.actions_done_on ?? "" });
  const regulator = REGULATORS[i.state ?? ""] ?? "the WHS regulator for the state";
  const yn = (name: string, value: boolean | null, on: (v: boolean) => void) => (
    <span className="row">
      <label className="check"><input type="radio" name={name} checked={value === true} onChange={() => on(true)} /> Yes</label>
      <label className="check"><input type="radio" name={name} checked={value === false} onChange={() => on(false)} /> No</label>
    </span>
  );
  const decided = death !== null && (death || (serious !== null && (serious || dangerous !== null)));
  const result = death ? "death" : serious ? "serious_injury_illness" : dangerous ? "dangerous_incident" : null;
  return (
    <>
      <p><button type="button" className="back" onClick={onBack}>← Back to incidents</button></p>
      <section className="card block">
        <h2>{KIND_LABELS[i.kind].split(" (")[0]}, {when(i.occurred_at)}</h2>
        <dl className="detail-list compact">
          <div><dt>Where</dt><dd>{i.location ?? "Not recorded"}{i.state ? `, ${i.state}` : ""}</dd></div>
          {i.entity_id && <div><dt>Company</dt><dd>{group?.entities.find((e) => e.id === i.entity_id)?.name}</dd></div>}
          <div><dt>What happened</dt><dd>{i.description}</dd></div>
          <div><dt>Who</dt><dd>{i.persons_involved ?? "Not recorded"}</dd></div>
          <div><dt>Severity</dt><dd>{i.severity ? SEVERITY_LABELS[i.severity] : "Not recorded"}</dd></div>
          {i.immediate_action && <div><dt>Immediate action</dt><dd>{i.immediate_action}</dd></div>}
          <div><dt>Reported</dt><dd>{when(i.created_at)}</dd></div>
        </dl>
        <Attachments subjectTable="whs_incidents" subjectId={i.id} canAttach={manage || mine} label="Photos, statements and reports" />
      </section>

      {manage && (
        <section className={i.notifiable === null || (i.notifiable && !i.regulator_notified_at) ? "card warning block" : "card block"}>
          <h2>Does the regulator need to be told?</h2>
          {i.notifiable === null ? (
            <>
              <p className="small">A death, a serious injury or illness, or a dangerous incident arising out of the work must be notified to {regulator} immediately, by the fastest means (usually its phone line or online form).</p>
              <fieldset className="plain-fieldset question"><legend>Did anyone die?</legend>{yn("q-death", death, setDeath)}</fieldset>
              {death === false && (
                <fieldset className="plain-fieldset question">
                  <legend>Was there a serious injury or illness? Any of these:</legend>
                  <ul className="small">{SERIOUS.map((s) => <li key={s}>{s}</li>)}</ul>
                  {yn("q-serious", serious, setSerious)}
                </fieldset>
              )}
              {death === false && serious === false && (
                <fieldset className="plain-fieldset question">
                  <legend>Was it a dangerous incident, exposing anyone to a serious risk, even if no one was hurt? Any of these:</legend>
                  <ul className="small">{DANGEROUS.map((s) => <li key={s}>{s}</li>)}</ul>
                  {yn("q-dangerous", dangerous, setDangerous)}
                </fieldset>
              )}
              {decided && (
                <>
                  <p className={result ? "warning-text" : undefined}><strong>{result ? `Notifiable: ${REASON_LABELS[result].toLowerCase()}.` : "Not notifiable."}</strong></p>
                  <Field id="n-basis" label="Why (briefly)" wide><input id="n-basis" value={basis} onChange={(e) => setBasis(e.target.value)} placeholder={result ? "Admitted to hospital overnight" : "First aid only, no exposure to serious risk"} /></Field>
                  <button type="button" disabled={busy || basis.trim().length < 3} onClick={() => onSave({ notifiable: Boolean(result), notifiable_reason: result, notifiable_basis: basis, regulator: result ? regulator : null }, result ? `Recorded as notifiable. Notify ${regulator} now.` : "Recorded as not notifiable.")}>Record the decision</button>
                </>
              )}
            </>
          ) : i.notifiable ? (
            <>
              <p><strong>Notifiable: {REASON_LABELS[i.notifiable_reason!].toLowerCase()}.</strong> {i.notifiable_basis}</p>
              {!i.regulator_notified_at ? (
                <>
                  <ul className="small">
                    <li>Notify {i.regulator ?? regulator} <strong>immediately</strong>, by phone or its online form.</li>
                    <li>Keep the site undisturbed until an inspector arrives or the regulator says otherwise (except to help an injured person, make it safe, or for police).</li>
                    <li>If the regulator asks for written notice, give it within 48 hours.</li>
                    <li>Keep the record of a notifiable incident for at least five years.</li>
                  </ul>
                  <div className="row wrap">
                    <Field id="n-at" label="Notified at"><input id="n-at" type="datetime-local" max={localNow()} value={notified} onChange={(e) => setNotified(e.target.value)} /></Field>
                    <Field id="n-ref" label="Regulator's reference"><input id="n-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                    <label className="check"><input type="checkbox" checked={i.site_preserved === true} onChange={(e) => onSave({ site_preserved: e.target.checked }, "Saved.")} /> Site preserved</label>
                  </div>
                  <button type="button" disabled={busy || !notified} onClick={() => onSave({ regulator_notified_at: new Date(notified).toISOString(), regulator_reference: ref }, "Notification recorded.")}>Record the notification</button>
                </>
              ) : (
                <p className="small muted">Notified to {i.regulator} at {when(i.regulator_notified_at)}{i.regulator_reference ? `, reference ${i.regulator_reference}` : ""}.{i.site_preserved ? " Site preserved." : ""}</p>
              )}
            </>
          ) : (
            <p className="small">Not notifiable. {i.notifiable_basis}</p>
          )}
        </section>
      )}

      {manage && (
        <section className="card form block">
          <h2>Investigation</h2>
          <div className="row wrap">
            <Field id="v-status" label="Status"><select id="v-status" value={inv.investigation_status} onChange={(e) => setInv({ ...inv, investigation_status: e.target.value as Incident["investigation_status"] })}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="complete">Complete</option></select></Field>
          </div>
          <Field id="v-root" label="Root cause" wide><textarea id="v-root" rows={2} value={inv.root_cause} onChange={(e) => setInv({ ...inv, root_cause: e.target.value })} /></Field>
          <Field id="v-act" label="Corrective actions" wide><textarea id="v-act" rows={2} value={inv.corrective_actions} onChange={(e) => setInv({ ...inv, corrective_actions: e.target.value })} /></Field>
          <div className="row wrap">
            <Field id="v-due" label="Actions due"><input id="v-due" type="date" value={inv.actions_due_on} onChange={(e) => setInv({ ...inv, actions_due_on: e.target.value })} /></Field>
            <Field id="v-done" label="Actions done"><input id="v-done" type="date" value={inv.actions_done_on} onChange={(e) => setInv({ ...inv, actions_done_on: e.target.value })} /></Field>
          </div>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => onSave({ ...inv, actions_due_on: inv.actions_due_on || null, actions_done_on: inv.actions_done_on || null }, "Investigation saved.")}>Save</button>
            {i.status === "open" ? (
              <button type="button" className="quiet" disabled={busy} onClick={() => onSave({ status: "closed" }, "Incident closed.")}>Close the incident</button>
            ) : (
              <button type="button" className="quiet" disabled={busy} onClick={() => onSave({ status: "open" }, "Reopened.")}>Reopen</button>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function Hazards({ data, manage, userId, group, busy, today: t, onSave }: { data: WhsData; manage: boolean; userId: string; group: GroupData | null; busy: boolean; today: string; onSave: (id: string | null, v: HazardValues) => Promise<boolean> }) {
  const [editing, setEditing] = useState<Hazard | "new" | null>(null);
  const who = (uid: string | null) => (uid ? data.people.find((p) => p.user_id === uid)?.full_name ?? "" : "");
  if (editing) return <HazardForm initial={editing === "new" ? null : editing} people={data.people} group={group} busy={busy} onCancel={() => setEditing(null)} onSave={async (v) => { if (await onSave(editing === "new" ? null : editing.id, v)) setEditing(null); }} />;
  const list = [...data.hazards].sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || score(b) - score(a));
  return (
    <>
      {list.length === 0 ? <p className="muted">No hazards recorded. Include psychosocial hazards such as workload, bullying and harassment.</p> : (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead><tr><th scope="col">Hazard</th><th scope="col">Risk</th><th scope="col">Controls</th><th scope="col">Owner</th><th scope="col">Review</th></tr></thead>
            <tbody>
              {list.map((h) => {
                const s = score(h);
                return (
                  <tr key={h.id} className={h.status === "closed" ? "muted" : undefined}>
                    <th scope="row">
                      {manage || h.owner_user_id === userId ? <button type="button" className="link-dark" onClick={() => setEditing(h)}>{h.title}</button> : h.title}
                      <span className="muted small"><br />{h.kind === "psychosocial" ? `Psychosocial: ${PSYCHOSOCIAL.find((p) => p.id === h.psychosocial_type)?.label}` : h.kind}{h.where_who ? ` · ${h.where_who}` : ""}</span>
                    </th>
                    <td className={s >= 15 ? "warning-text" : undefined}>{scoreLabel(s)} ({s})<span className="muted small"><br />{h.residual_likelihood ? `after controls; ${h.likelihood * h.consequence} before` : "before controls"}</span></td>
                    <td className="small">{h.controls ?? <span className="warning-text">None recorded</span>}{h.control_level ? <><br /><span className="muted">{CONTROL_LABELS[h.control_level]}</span></> : null}</td>
                    <td>{who(h.owner_user_id) || <span className="warning-text">None</span>}</td>
                    <td className={h.review_on && h.review_on < t ? "warning-text" : undefined}>{day(h.review_on)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {manage && <p className="block"><button type="button" onClick={() => setEditing("new")}>Add a hazard</button></p>}
    </>
  );
}

function HazardForm({ initial, people, group, busy, onSave, onCancel }: { initial: Hazard | null; people: WhsData["people"]; group: GroupData | null; busy: boolean; onSave: (v: HazardValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<HazardValues>(initial ? (({ id: _id, ...r }) => r)(initial) : {
    entity_id: null, title: "", kind: "physical", psychosocial_type: null, where_who: null, likelihood: 3, consequence: 3, controls: null, control_level: null,
    residual_likelihood: null, residual_consequence: null, owner_user_id: null, review_on: null, status: "active",
  });
  const set = (p: Partial<HazardValues>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  const scale = (id: string, label: string, value: number | null, on: (n: number | null) => void, optional = false) => (
    <Field id={id} label={label}>
      <select id={id} value={value ?? ""} onChange={(e) => on(e.target.value ? Number(e.target.value) : null)}>
        {optional && <option value="">Not assessed</option>}
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
  );
  return (
    <div className="card form">
      <h2>{initial ? initial.title : "New hazard"}</h2>
      <div className="row wrap">
        <Field id="h-title" label="Hazard" wide><input id="h-title" value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field id="h-kind" label="Kind"><select id="h-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as Hazard["kind"], psychosocial_type: e.target.value === "psychosocial" ? v.psychosocial_type ?? "job_demands" : null })}>
          {["physical", "psychosocial", "chemical", "plant", "ergonomic", "biological", "other"].map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
        </select></Field>
        {v.kind === "psychosocial" && <Field id="h-psy" label="Type"><select id="h-psy" value={v.psychosocial_type ?? ""} onChange={(e) => set({ psychosocial_type: e.target.value })}>{PSYCHOSOCIAL.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>}
      </div>
      <div className="row wrap">
        <Field id="h-where" label="Where it arises and who is exposed" wide><input id="h-where" value={v.where_who ?? ""} onChange={(e) => set({ where_who: e.target.value })} /></Field>
        {(group?.entities.length ?? 0) > 1 && <Field id="h-ent" label="Company"><select id="h-ent" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}><option value="">All</option>{group!.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>}
      </div>
      <div className="row wrap">
        {scale("h-l", "Likelihood (1 to 5)", v.likelihood, (n) => set({ likelihood: n ?? 1 }))}
        {scale("h-c", "Consequence (1 to 5)", v.consequence, (n) => set({ consequence: n ?? 1 }))}
        <span className="field"><span className="small">Risk before controls</span><strong className={v.likelihood * v.consequence >= 15 ? "warning-text" : undefined}>{scoreLabel(v.likelihood * v.consequence)} ({v.likelihood * v.consequence})</strong></span>
      </div>
      <Field id="h-controls" label="Controls" wide><textarea id="h-controls" rows={2} value={v.controls ?? ""} onChange={(e) => set({ controls: e.target.value })} /></Field>
      <div className="row wrap">
        <Field id="h-level" label="Highest level of control"><select id="h-level" value={v.control_level ?? ""} onChange={(e) => set({ control_level: (e.target.value || null) as Hazard["control_level"] })}><option value="">Not recorded</option>{Object.entries(CONTROL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {scale("h-rl", "Likelihood after controls", v.residual_likelihood, (n) => set({ residual_likelihood: n }), true)}
        {scale("h-rc", "Consequence after controls", v.residual_consequence, (n) => set({ residual_consequence: n }), true)}
      </div>
      <div className="row wrap">
        <Field id="h-owner" label="Owner"><select id="h-owner" value={v.owner_user_id ?? ""} onChange={(e) => set({ owner_user_id: e.target.value || null })}><option value="">No owner yet</option>{people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}</select></Field>
        <Field id="h-review" label="Review by"><input id="h-review" type="date" value={v.review_on ?? ""} onChange={(e) => set({ review_on: e.target.value || null })} /></Field>
        {initial && <label className="check"><input type="checkbox" checked={v.status === "closed"} onChange={(e) => set({ status: e.target.checked ? "closed" : "active" })} /> No longer present</label>}
      </div>
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => (v.title.trim().length < 3 ? setMissing("Name the hazard.") : onSave(v))}>Save</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
      {initial && <Attachments subjectTable="whs_hazards" subjectId={initial.id} canAttach label="Risk assessments and photos" />}
    </div>
  );
}

function Officers({ organisationId, data, canEdit, canSign, busy, today: t, onSave, onSign }: {
  organisationId: string; data: WhsData; canEdit: boolean; canSign: boolean; busy: boolean; today: string;
  onSave: (id: string | null, period: string, answers: DdReview["answers"]) => Promise<boolean>; onSign: (id: string) => Promise<boolean>;
}) {
  const quarterEnd = (() => {
    const [y, m] = t.split("-").map(Number);
    const qm = Math.ceil(m / 3) * 3;
    return new Date(Date.UTC(y, qm, 0)).toISOString().slice(0, 10);
  })();
  const from = (() => {
    const [y, m] = t.split("-").map(Number);
    return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  })();
  const current = data.reviews.find((r) => r.period_end === quarterEnd);
  const [answers, setAnswers] = useState<DdReview["answers"]>(current?.answers ?? {});
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    void loadSummary(organisationId, from, quarterEnd).then(setSummary);
  }, [organisationId, from, quarterEnd, data]);
  useEffect(() => {
    setAnswers(current?.answers ?? {});
  }, [current?.id]);
  const signed = Boolean(current?.signed_off_at);
  const who = (uid: string | null) => (uid ? data.people.find((p) => p.user_id === uid)?.full_name : null) ?? "a director";
  return (
    <>
      <section className="card block">
        <h2>This quarter: {day(from)} to {day(quarterEnd)}</h2>
        {!summary ? <p className="muted">Loading…</p> : (
          <>
            <dl className="facts">
              <div><dt>Incidents</dt><dd>{summary.incidents}</dd></div>
              <div><dt>Time lost or serious</dt><dd className={summary.lost_time ? "warning-text" : undefined}>{summary.lost_time}</dd></div>
              <div><dt>Notifiable</dt><dd className={summary.notifiable.length ? "warning-text" : undefined}>{summary.notifiable.length}</dd></div>
              <div><dt>High hazards</dt><dd className={summary.hazards_high ? "warning-text" : undefined}>{summary.hazards_high} of {summary.hazards}</dd></div>
            </dl>
            <ul className="plain small">
              <li>By kind: {Object.entries(summary.by_kind).map(([k, n]) => `${KIND_LABELS[k as Incident["kind"]]?.split(" (")[0] ?? k} ${n}`).join(", ") || "none"}</li>
              <li>Open incidents {summary.open_incidents} · not yet assessed for notification <span className={summary.not_assessed ? "warning-text" : undefined}>{summary.not_assessed}</span> · corrective actions overdue <span className={summary.actions_overdue ? "warning-text" : undefined}>{summary.actions_overdue}</span></li>
              <li>Psychosocial hazards recorded {summary.psychosocial} · hazard reviews overdue <span className={summary.hazards_review_overdue ? "warning-text" : undefined}>{summary.hazards_review_overdue}</span></li>
              {summary.notifiable.map((n, k) => (
                <li key={k} className={n.notified_at ? undefined : "warning-text"}>Notifiable {day(n.occurred_on)}: {REASON_LABELS[n.reason as keyof typeof REASON_LABELS]?.toLowerCase()} · {n.notified_at ? `notified ${day(n.notified_at)}` : "not yet notified"} · investigation {n.investigation.replace("_", " ")}</li>
              ))}
            </ul>
            <p className="muted small">No names: directors see what they need for their due diligence, not people's health details.</p>
          </>
        )}
      </section>
      <section className="card form block">
        <h2>Officers' due diligence (WHS Act s 27)</h2>
        <p className="small muted">Each director must exercise due diligence to ensure the company meets its WHS duties. Record how each element is met this quarter, with the evidence.</p>
        {ELEMENTS.map((el) => {
          const a = answers[el.key] ?? {};
          return (
            <fieldset key={el.key} className="plain-fieldset question">
              <legend><strong>{el.label}</strong></legend>
              <p className="small">{el.prompt}</p>
              <div className="row">
                {(["met", "partly", "not_met"] as const).map((s) => (
                  <label key={s} className="check"><input type="radio" name={`dd-${el.key}`} disabled={!canEdit || signed} checked={a.status === s} onChange={() => setAnswers({ ...answers, [el.key]: { ...a, status: s } })} /> {s === "met" ? "Met" : s === "partly" ? "Partly" : "Not met"}</label>
                ))}
              </div>
              <input aria-label={`${el.label} evidence`} disabled={!canEdit || signed} placeholder="Evidence: board papers, training, audits, site visits" value={a.evidence ?? ""} onChange={(e) => setAnswers({ ...answers, [el.key]: { ...a, evidence: e.target.value } })} />
            </fieldset>
          );
        })}
        {signed ? (
          <p className="muted small">Signed off by {who(current!.signed_off_by)} on {day(current!.signed_off_at)}. It can no longer be changed.</p>
        ) : (
          <div className="row">
            {canEdit && <button type="button" disabled={busy} onClick={() => onSave(current?.id ?? null, quarterEnd, answers)}>Save</button>}
            {canSign && current && <button type="button" className="quiet" disabled={busy} onClick={() => onSign(current.id)}>Sign off this quarter</button>}
          </div>
        )}
        {current && <Attachments subjectTable="whs_due_diligence" subjectId={current.id} canAttach={canEdit && !signed} label="Board papers and evidence" />}
      </section>
      {data.reviews.filter((r) => r.period_end !== quarterEnd).length > 0 && (
        <section className="block">
          <h3>Earlier quarters</h3>
          <ul className="plain rows small">
            {data.reviews.filter((r) => r.period_end !== quarterEnd).map((r) => (
              <li key={r.id}>Quarter to {day(r.period_end)} · {r.signed_off_at ? `signed off ${day(r.signed_off_at)}` : "not signed off"} · {ELEMENTS.filter((e) => r.answers[e.key]?.status === "met").length} of 6 met</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
