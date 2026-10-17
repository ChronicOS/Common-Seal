import { useCallback, useEffect, useState, type ReactNode } from "react";
import Attachments from "./Attachments";
import { today as todayIso } from "./authorities";
import { formatDay } from "./board";
import { has } from "./roles";
import {
  ADM_DEADLINE, CAUSE_LABELS, daysTo, HIGH_RISK, INFO_LABELS, loadPrivacy, OTHER_NOTICES, policyWording, reportBreach, saveDecision, saveHolding, SIZE_LABELS, updateBreach,
  type Breach, type Decision, type DecisionValues, type Holding, type HoldingValues, type InfoKind, type OtherNotice, type PrivacyData,
} from "./privacy";
import type { GroupData } from "./types";

type Sub = "breaches" | "holdings" | "decisions";
type Props = { organisationId: string; organisationName: string; role: string; userId: string; group: GroupData | null };
const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const KINDS = Object.keys(INFO_LABELS) as InfoKind[];
const short = (k: InfoKind) => INFO_LABELS[k].split(" (")[0];

function Field({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return <span className={wide ? "field grow" : "field"}><label htmlFor={id}>{label}</label>{children}</span>;
}
function Kinds({ name, value, onChange, disabled }: { name: string; value: InfoKind[]; onChange: (v: InfoKind[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="plain-fieldset">
      <legend>Kinds of personal information</legend>
      <div className="check-grid">
        {KINDS.map((k) => (
          <label key={k} className="check"><input type="checkbox" name={name} disabled={disabled} checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} /> {short(k)}</label>
        ))}
      </div>
    </fieldset>
  );
}

/** Risk and compliance, Privacy and cyber */
export default function Privacy({ organisationId, organisationName, role, userId, group }: Props) {
  const manage = has(role, "owner", "admin", "secretary", "legal", "compliance");
  const board = manage || has(role, "director", "auditor");
  const [sub, setSub] = useState<Sub>("breaches");
  const [data, setData] = useState<PrivacyData | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const t = todayIso();

  const reload = useCallback(async () => {
    try {
      setData(await loadPrivacy(organisationId));
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
      <h1>Privacy and cyber</h1>
      <p className="lead">Report a possible data breach, run the 30-day assessment, notify the OAIC and the people affected, report any ransomware payment within 72 hours, and keep the record of the personal information you hold and the automated decisions you make with it.</p>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!data) return <>{header}<p className="muted">Loading…</p></>;
  if (!data.ready) return <>{header}<p className="card warning">Not set up yet: run migration 0050 in Supabase.</p></>;

  const open = data.breaches.filter((b) => b.status === "open");
  const urgent = open.filter((b) => (b.ransom_paid && !b.ransom_reported_at) || (b.eligible && !b.oaic_notified_at) || (b.eligible === null && daysTo(b.assessment_due_on, t) <= 7));
  const subs: { id: Sub; label: string }[] = [
    { id: "breaches", label: manage ? `Data breaches (${open.length} open)` : "Report a data breach" },
    ...(board ? [{ id: "holdings" as Sub, label: `Personal information (${data.holdings.filter((h) => h.status === "active").length})` }, { id: "decisions" as Sub, label: "Automated decisions" }] : []),
  ];

  return (
    <>
      {header}
      {manage && urgent.length > 0 && (
        <section className="card warning block" role="alert">
          <p><strong>{urgent.length} breach{urgent.length === 1 ? " needs" : "es need"} action now.</strong></p>
          <ul className="small">{urgent.map((b) => <li key={b.id}><button type="button" className="link-dark" onClick={() => { setSub("breaches"); setOpenId(b.id); setReporting(false); }}>{b.title}</button>: {nextStep(b, t)}</li>)}</ul>
        </section>
      )}
      <span className="segmented block-gap" role="group" aria-label="Privacy sections">
        {subs.map((x) => <button key={x.id} type="button" className={sub === x.id ? "on" : undefined} aria-pressed={sub === x.id} onClick={() => { setSub(x.id); setOpenId(null); setReporting(false); }}>{x.label}</button>)}
      </span>

      {sub === "breaches" && (
        reporting ? (
          <ReportForm group={group} busy={busy} onCancel={() => setReporting(false)}
            onSave={async (v) => { if (await run(async () => { const id = await reportBreach(organisationId, v); setOpenId(id); }, "Reported. Thank you. The people who manage privacy have been told under For you.")) setReporting(false); }} />
        ) : openId && data.breaches.find((b) => b.id === openId) ? (
          <BreachDetail breach={data.breaches.find((b) => b.id === openId)!} manage={manage} mine={data.breaches.find((b) => b.id === openId)!.reported_by === userId} busy={busy} today={t} group={group}
            onBack={() => setOpenId(null)} onSave={(patch, done) => run(() => updateBreach(openId, patch), done)} />
        ) : (
          <>
            <p><button type="button" onClick={() => setReporting(true)}>Report a possible data breach</button></p>
            {!manage && <p className="muted small">Report anything that might have exposed personal information: a lost laptop, an email to the wrong person, a suspicious login. You see the reports you made.</p>}
            {data.breaches.length === 0 ? <p className="muted">No breaches recorded.</p> : (
              <div className="table-scroll">
                <table className="report-table wide">
                  <thead><tr><th scope="col">Breach</th><th scope="col">Suspected</th><th scope="col">Assessment</th><th scope="col">OAIC</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {data.breaches.map((b) => {
                      const left = daysTo(b.assessment_due_on, t);
                      return (
                        <tr key={b.id} className="clickable" onClick={() => setOpenId(b.id)}>
                          <th scope="row"><button type="button" className="link-dark" onClick={() => setOpenId(b.id)}>{b.title}</button><span className="muted small"><br />{b.cause ? CAUSE_LABELS[b.cause].split(" (")[0] : "Cause not known"}{b.ransom_demanded ? " · ransomware" : ""}</span></th>
                          <td>{day(b.suspected_on)}</td>
                          <td className={b.eligible === null && b.status === "open" && left <= 7 ? "warning-text" : undefined}>
                            {b.eligible === null ? (b.status === "open" ? (left >= 0 ? `Due in ${left} day${left === 1 ? "" : "s"}` : `${-left} days late`) : "Not assessed") : b.eligible ? "Eligible data breach" : "Not eligible"}
                          </td>
                          <td className={b.eligible && !b.oaic_notified_at ? "warning-text" : undefined}>{b.eligible === null ? <span className="muted">After the assessment</span> : b.eligible ? (b.oaic_notified_at ? `Notified ${day(b.oaic_notified_at)}` : "NOT YET NOTIFIED") : "Not needed"}</td>
                          <td>{b.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}
      {sub === "holdings" && board && <Holdings data={data} manage={manage} userId={userId} group={group} busy={busy} today={t} onSave={(id, v) => run(() => saveHolding(organisationId, id, v), "Saved.")} />}
      {sub === "decisions" && board && <Decisions data={data} manage={manage} userId={userId} busy={busy} today={t} organisationName={organisationName} onSave={(id, v) => run(() => saveDecision(organisationId, id, v), "Saved.")} />}
    </>
  );
}

function nextStep(b: Breach, t: string) {
  if (b.ransom_paid && !b.ransom_reported_at) {
    const by = new Date(new Date(b.ransom_paid_at!).getTime() + 72 * 3600e3);
    return `report the ransomware payment to the Australian Signals Directorate by ${when(by.toISOString())}`;
  }
  if (b.eligible && !b.oaic_notified_at) return "notify the OAIC and the people affected as soon as practicable";
  const left = daysTo(b.assessment_due_on, t);
  return left >= 0 ? `finish the assessment by ${day(b.assessment_due_on)} (${left} day${left === 1 ? "" : "s"} left)` : `the assessment was due ${day(b.assessment_due_on)}`;
}

function ReportForm({ group, busy, onSave, onCancel }: { group: GroupData | null; busy: boolean; onSave: (v: Partial<Breach>) => void; onCancel: () => void }) {
  const t = todayIso();
  const [v, setV] = useState<Partial<Breach>>({ suspected_on: t, info_kinds: [], ransom_demanded: false });
  const set = (p: Partial<Breach>) => setV({ ...v, ...p });
  const [missing, setMissing] = useState<string | null>(null);
  return (
    <div className="card form">
      <h2>Report a possible data breach</h2>
      <p className="muted small">Report it even if you are not sure. If systems are under attack, disconnect them and call your IT support first.</p>
      <div className="row wrap">
        <Field id="b-title" label="In a few words" wide><input id="b-title" value={v.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="Payroll file emailed to the wrong person" /></Field>
        <Field id="b-when" label="When it was noticed"><input id="b-when" type="date" max={t} value={v.suspected_on ?? ""} onChange={(e) => set({ suspected_on: e.target.value })} /></Field>
        <Field id="b-occ" label="When it happened (if known)"><input id="b-occ" type="date" max={t} value={v.occurred_on ?? ""} onChange={(e) => set({ occurred_on: e.target.value || null })} /></Field>
      </div>
      <div className="row wrap">
        <Field id="b-cause" label="What caused it"><select id="b-cause" value={v.cause ?? ""} onChange={(e) => set({ cause: (e.target.value || null) as Breach["cause"] })}><option value="">Not sure</option>{Object.entries(CAUSE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="b-n" label="About how many people"><input id="b-n" type="number" min={0} value={v.individuals_affected ?? ""} onChange={(e) => set({ individuals_affected: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        {(group?.entities.length ?? 0) > 1 && <Field id="b-ent" label="Company"><select id="b-ent" value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}><option value="">Not sure</option>{group!.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>}
      </div>
      <Field id="b-desc" label="What happened" wide><textarea id="b-desc" rows={4} value={v.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Kinds name="b-kinds" value={v.info_kinds ?? []} onChange={(k) => set({ info_kinds: k })} />
      <label className="check"><input type="checkbox" checked={!!v.ransom_demanded} onChange={(e) => set({ ransom_demanded: e.target.checked })} /> Someone has demanded payment (ransomware or extortion)</label>
      {missing && <p className="error">{missing}</p>}
      <div className="row">
        <button type="button" disabled={busy} onClick={() => {
          if ((v.title ?? "").trim().length < 3) return setMissing("Say in a few words what happened.");
          if ((v.description ?? "").trim().length < 10) return setMissing("Describe what happened.");
          onSave(v);
        }}>Report</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function BreachDetail({ breach: b, manage, mine, busy, today: t, group, onBack, onSave }: {
  breach: Breach; manage: boolean; mine: boolean; busy: boolean; today: string; group: GroupData | null; onBack: () => void; onSave: (patch: Partial<Breach>, done: string) => Promise<boolean>;
}) {
  const [q1, setQ1] = useState<boolean | null>(null);
  const [q2, setQ2] = useState<boolean | null>(null);
  const [q3, setQ3] = useState<boolean | null>(null);
  const [basis, setBasis] = useState("");
  const [oaicAt, setOaicAt] = useState(localNow());
  const [oaicRef, setOaicRef] = useState("");
  const [indAt, setIndAt] = useState(localNow());
  const [option, setOption] = useState<Breach["notify_option"]>("all");
  const [exception, setException] = useState("");
  const [paidAt, setPaidAt] = useState(localNow());
  const [repAt, setRepAt] = useState(localNow());
  const [repRef, setRepRef] = useState("");
  const [contain, setContain] = useState({ contained_at: b.contained_at ? b.contained_at.slice(0, 16) : "", remedial_action: b.remedial_action ?? "", lessons: b.lessons ?? "" });
  const left = daysTo(b.assessment_due_on, t);
  const decided = q1 === false || (q1 === true && (q2 === false || (q2 === true && q3 !== null)));
  const eligible = q1 === true && q2 === true && q3 === false;
  const high = b.info_kinds.filter((k) => HIGH_RISK.includes(k));
  const notices = b.other_notifications ?? [];
  const setNotices = (n: OtherNotice[], done: string) => onSave({ other_notifications: n }, done);
  return (
    <>
      <p><button type="button" className="back" onClick={onBack}>← Back to breaches</button></p>
      <section className="card block">
        <h2>{b.title}</h2>
        <dl className="detail-list compact">
          <div><dt>Suspected</dt><dd>{day(b.suspected_on)}{b.occurred_on ? ` (happened ${day(b.occurred_on)})` : ""}</dd></div>
          {b.entity_id && <div><dt>Company</dt><dd>{group?.entities.find((e) => e.id === b.entity_id)?.name}</dd></div>}
          <div><dt>What happened</dt><dd>{b.description}</dd></div>
          <div><dt>Cause</dt><dd>{b.cause ? CAUSE_LABELS[b.cause] : "Not known"}</dd></div>
          <div><dt>Information</dt><dd>{b.info_kinds.length ? b.info_kinds.map(short).join(", ") : "Not recorded"}</dd></div>
          <div><dt>People affected</dt><dd>{b.individuals_affected ?? "Not known"}</dd></div>
          <div><dt>Reported</dt><dd>{when(b.created_at)}</dd></div>
        </dl>
        <Attachments subjectTable="privacy_breaches" subjectId={b.id} canAttach={manage || mine} label="Evidence, logs and correspondence" />
      </section>

      {manage && (
        <section className="card form block">
          <h2>Contain it</h2>
          <p className="small muted">Stop the breach and limit the harm first: recall the email, disable accounts, change passwords, remotely wipe the device. Acting quickly can mean serious harm is no longer likely.</p>
          <div className="row wrap"><Field id="c-at" label="Contained at"><input id="c-at" type="datetime-local" max={localNow()} value={contain.contained_at} onChange={(e) => setContain({ ...contain, contained_at: e.target.value })} /></Field></div>
          <Field id="c-rem" label="What was done" wide><textarea id="c-rem" rows={2} value={contain.remedial_action} onChange={(e) => setContain({ ...contain, remedial_action: e.target.value })} /></Field>
          <Field id="c-les" label="Lessons and changes made" wide><textarea id="c-les" rows={2} value={contain.lessons} onChange={(e) => setContain({ ...contain, lessons: e.target.value })} /></Field>
          <button type="button" disabled={busy} onClick={() => onSave({ contained_at: contain.contained_at ? new Date(contain.contained_at).toISOString() : null, remedial_action: contain.remedial_action, lessons: contain.lessons }, "Saved.")}>Save</button>
        </section>
      )}

      {manage && (
        <section className={b.eligible === null || (b.eligible && !b.oaic_notified_at) ? "card warning block" : "card block"}>
          <h2>Is it an eligible data breach?</h2>
          {b.eligible === null ? (
            <>
              <p className={left <= 7 ? "warning-text" : "small"}><strong>{left >= 0 ? `Finish this assessment by ${day(b.assessment_due_on)}: ${left} day${left === 1 ? "" : "s"} left.` : `This assessment was due ${day(b.assessment_due_on)}.`}</strong> The Privacy Act requires a reasonable and quick assessment within 30 days of suspecting a breach.</p>
              <fieldset className="plain-fieldset question"><legend>1. Was there unauthorised access to, or disclosure of, personal information, or was it lost where that is likely to happen?</legend>
                <span className="row"><label className="check"><input type="radio" name="q1" checked={q1 === true} onChange={() => setQ1(true)} /> Yes</label><label className="check"><input type="radio" name="q1" checked={q1 === false} onChange={() => setQ1(false)} /> No</label></span>
              </fieldset>
              {q1 && (
                <fieldset className="plain-fieldset question"><legend>2. Would a reasonable person conclude it is likely to result in serious harm (physical, psychological, emotional, financial or reputational) to anyone affected?</legend>
                  <ul className="small">
                    <li>The kinds of information: {b.info_kinds.length ? b.info_kinds.map(short).join(", ") : "not yet recorded"}{high.length ? <strong className="warning-text"> (includes {high.map(short).join(", ").toLowerCase()}, which often makes serious harm likely)</strong> : null}</li>
                    <li>How sensitive it is, and whether it was protected (for example encrypted), and how likely that protection is to be overcome</li>
                    <li>Who has it, and what they could do with it (a malicious actor raises the risk; a trusted recipient who deleted it lowers it)</li>
                    <li>The nature of the harm, and how many people</li>
                  </ul>
                  <span className="row"><label className="check"><input type="radio" name="q2" checked={q2 === true} onChange={() => setQ2(true)} /> Yes, likely</label><label className="check"><input type="radio" name="q2" checked={q2 === false} onChange={() => setQ2(false)} /> No, not likely</label></span>
                </fieldset>
              )}
              {q1 && q2 && (
                <fieldset className="plain-fieldset question"><legend>3. Has action already taken meant serious harm is no longer likely (for example the email was deleted unread, or the device was wiped before it was accessed)?</legend>
                  <span className="row"><label className="check"><input type="radio" name="q3" checked={q3 === true} onChange={() => setQ3(true)} /> Yes</label><label className="check"><input type="radio" name="q3" checked={q3 === false} onChange={() => setQ3(false)} /> No</label></span>
                </fieldset>
              )}
              {decided && (
                <>
                  <p className={eligible ? "warning-text" : undefined}><strong>{eligible ? "This is an eligible data breach. The OAIC and the people affected must be told as soon as practicable." : "This is not an eligible data breach."}</strong></p>
                  <Field id="a-basis" label="Reasons (kept as the record of the assessment)" wide><textarea id="a-basis" rows={2} value={basis} onChange={(e) => setBasis(e.target.value)} /></Field>
                  <button type="button" disabled={busy || basis.trim().length < 10} onClick={() => onSave({ eligible, assessment_basis: basis }, eligible ? "Recorded as an eligible data breach. Notify the OAIC and the people affected now." : "Recorded as not an eligible data breach.")}>Record the assessment</button>
                </>
              )}
            </>
          ) : b.eligible ? (
            <>
              <p><strong>Eligible data breach</strong>{b.assessed_at ? `, assessed ${when(b.assessed_at)}` : ""}. {b.assessment_basis}</p>
              {!b.oaic_notified_at ? (
                <>
                  <p className="small">Give the OAIC a statement using its online Notifiable Data Breach form. It must set out:</p>
                  <ul className="small">
                    <li>your name and contact details</li>
                    <li>a description of the breach</li>
                    <li>the kinds of information involved: {b.info_kinds.map(short).join(", ").toLowerCase() || "record these above"}</li>
                    <li>the steps people should take in response</li>
                  </ul>
                  <div className="row wrap">
                    <Field id="o-at" label="OAIC notified at"><input id="o-at" type="datetime-local" max={localNow()} value={oaicAt} onChange={(e) => setOaicAt(e.target.value)} /></Field>
                    <Field id="o-ref" label="OAIC reference"><input id="o-ref" value={oaicRef} onChange={(e) => setOaicRef(e.target.value)} /></Field>
                  </div>
                  <button type="button" disabled={busy || !oaicAt} onClick={() => onSave({ oaic_notified_at: new Date(oaicAt).toISOString(), oaic_reference: oaicRef }, "OAIC notification recorded.")}>Record the OAIC notification</button>
                </>
              ) : (
                <p className="small muted">OAIC notified {when(b.oaic_notified_at)}{b.oaic_reference ? `, reference ${b.oaic_reference}` : ""}.</p>
              )}
              {!b.individuals_notified_at ? (
                <fieldset className="plain-fieldset question block">
                  <legend>The people affected</legend>
                  <p className="small">Tell them what the statement to the OAIC says, as soon as practicable. Choose how:</p>
                  <span className="row wrap">
                    <label className="check"><input type="radio" name="opt" checked={option === "all"} onChange={() => setOption("all")} /> Everyone affected</label>
                    <label className="check"><input type="radio" name="opt" checked={option === "at_risk"} onChange={() => setOption("at_risk")} /> Only those at risk of serious harm</label>
                    <label className="check"><input type="radio" name="opt" checked={option === "publish"} onChange={() => setOption("publish")} /> Publish it on the website and publicise it (only if telling them directly is not practicable)</label>
                  </span>
                  <div className="row wrap">
                    <Field id="i-at" label="Told at"><input id="i-at" type="datetime-local" max={localNow()} value={indAt} onChange={(e) => setIndAt(e.target.value)} /></Field>
                  </div>
                  <div className="row">
                    <button type="button" disabled={busy || !indAt} onClick={() => onSave({ individuals_notified_at: new Date(indAt).toISOString(), notify_option: option }, "Recorded.")}>Record that they were told</button>
                  </div>
                  <Field id="i-ex" label="Or the exception relied on (for example another entity notified, or an enforcement body asked for a delay)" wide><input id="i-ex" value={exception} onChange={(e) => setException(e.target.value)} /></Field>
                  <button type="button" className="quiet" disabled={busy || exception.trim().length < 5} onClick={() => onSave({ notify_exception: exception }, "Exception recorded.")}>Record the exception</button>
                </fieldset>
              ) : (
                <p className="small muted">People affected told {when(b.individuals_notified_at)} ({b.notify_option === "all" ? "everyone affected" : b.notify_option === "at_risk" ? "those at risk" : "published"}).</p>
              )}
              {b.notify_exception && <p className="small muted">Exception: {b.notify_exception}</p>}
            </>
          ) : (
            <p className="small">Not an eligible data breach{b.assessed_at ? `, assessed ${when(b.assessed_at)}` : ""}. {b.assessment_basis}</p>
          )}
        </section>
      )}

      {manage && (b.ransom_demanded || b.cause === "malicious_cyber") && (
        <section className={b.ransom_paid && !b.ransom_reported_at ? "card warning block" : "card block"}>
          <h2>Ransomware</h2>
          {!b.ransom_demanded ? (
            <button type="button" className="quiet" disabled={busy} onClick={() => onSave({ ransom_demanded: true }, "Saved.")}>A payment has been demanded</button>
          ) : !b.ransom_paid ? (
            <>
              <p className="small">A payment has been demanded. The government advises against paying. Speak to the insurer and get legal advice first: a payment may not get the data back, and may breach sanctions laws.</p>
              <p className="small">If a payment is made (by you, or by someone for you), a business with annual turnover over $3 million must report it to the Australian Signals Directorate within 72 hours.</p>
              <div className="row wrap"><Field id="r-paid" label="Paid at"><input id="r-paid" type="datetime-local" max={localNow()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field></div>
              <button type="button" className="quiet" disabled={busy} onClick={() => onSave({ ransom_paid: true, ransom_paid_at: new Date(paidAt).toISOString() }, "Payment recorded. Report it within 72 hours.")}>Record that a payment was made</button>
            </>
          ) : !b.ransom_reported_at ? (
            <>
              <p className="warning-text"><strong>Report the payment to the Australian Signals Directorate by {when(new Date(new Date(b.ransom_paid_at!).getTime() + 72 * 3600e3).toISOString())}.</strong></p>
              <p className="small">The report covers who you are, the incident, the demand, the payment, and what you know about the attacker.</p>
              <div className="row wrap">
                <Field id="r-at" label="Reported at"><input id="r-at" type="datetime-local" max={localNow()} value={repAt} onChange={(e) => setRepAt(e.target.value)} /></Field>
                <Field id="r-ref" label="Reference"><input id="r-ref" value={repRef} onChange={(e) => setRepRef(e.target.value)} /></Field>
              </div>
              <button type="button" disabled={busy} onClick={() => onSave({ ransom_reported_at: new Date(repAt).toISOString(), ransom_reference: repRef }, "Ransomware payment report recorded.")}>Record the report</button>
            </>
          ) : (
            <p className="small muted">Payment made {when(b.ransom_paid_at)}; reported {when(b.ransom_reported_at)}{b.ransom_reference ? `, reference ${b.ransom_reference}` : ""}.</p>
          )}
        </section>
      )}

      {manage && (
        <section className="card block">
          <h2>Other notifications</h2>
          {notices.length > 0 && (
            <ul className="plain rows">
              {notices.map((n, k) => (
                <li key={k} className="row wrap">
                  <span className="grow"><strong>{n.body}</strong>{n.due_at && !n.done_at ? <span className={new Date(n.due_at) < new Date() ? "warning-text small" : "muted small"}> · due {when(n.due_at)}</span> : null}{n.done_at ? <span className="muted small"> · done {day(n.done_at)}{n.reference ? `, ${n.reference}` : ""}</span> : null}</span>
                  {!n.done_at && <button type="button" className="quiet" disabled={busy} onClick={() => setNotices(notices.map((x, j) => (j === k ? { ...x, done_at: t } : x)), `${n.body}: done.`)}>Done</button>}
                  <button type="button" className="quiet" disabled={busy} onClick={() => setNotices(notices.filter((_, j) => j !== k), "Removed.")}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">Add any that apply:</p>
          <ul className="plain small">
            {OTHER_NOTICES.filter((o) => !notices.some((n) => n.body === o.body)).map((o) => (
              <li key={o.body}>
                <button type="button" className="link-dark" disabled={busy} onClick={() => setNotices([...notices, { body: o.body, due_at: o.hours ? new Date(new Date(`${b.suspected_on}T09:00:00`).getTime() + o.hours * 3600e3).toISOString() : null, done_at: null }], `${o.body} added.`)}>+ {o.body}</button> <span className="muted">{o.when}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {manage && (
        <p className="row">
          {b.status === "open" ? (
            <button type="button" className="quiet" disabled={busy} onClick={() => onSave({ status: "closed" }, "Breach closed.")}>Close the breach</button>
          ) : (
            <button type="button" className="quiet" disabled={busy} onClick={() => onSave({ status: "open" }, "Reopened.")}>Reopen</button>
          )}
        </p>
      )}
    </>
  );
}

function Holdings({ data, manage, userId, group, busy, today: t, onSave }: { data: PrivacyData; manage: boolean; userId: string; group: GroupData | null; busy: boolean; today: string; onSave: (id: string | null, v: HoldingValues) => Promise<boolean> }) {
  const [editing, setEditing] = useState<Holding | "new" | null>(null);
  const who = (uid: string | null) => (uid ? data.people.find((p) => p.user_id === uid)?.full_name ?? "" : "");
  if (editing) return <HoldingForm initial={editing === "new" ? null : editing} people={data.people} group={group} busy={busy} canEdit={manage || (editing !== "new" && editing.owner_user_id === userId)} onCancel={() => setEditing(null)} onSave={async (v) => { if (await onSave(editing === "new" ? null : editing.id, v)) setEditing(null); }} />;
  return (
    <>
      <p className="small muted">The personal information the business holds: what, whose, why, where, for how long and how it is protected. It is the starting point for the privacy policy, a breach assessment and any access request.</p>
      {data.holdings.length === 0 ? <p className="muted">Nothing recorded yet. Start with customers, employees (payroll and HR) and any marketing lists.</p> : (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead><tr><th scope="col">Holding</th><th scope="col">Information</th><th scope="col">People</th><th scope="col">Overseas</th><th scope="col">Owner</th><th scope="col">Review</th></tr></thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.id} className={h.status === "retired" ? "muted" : undefined}>
                  <th scope="row"><button type="button" className="link-dark" onClick={() => setEditing(h)}>{h.name}</button><span className="muted small"><br />{h.system}{h.whose ? ` · ${h.whose}` : ""}</span></th>
                  <td className="small">{h.info_kinds.map((k) => <span key={k} className={HIGH_RISK.includes(k) ? "warning-text" : undefined}>{short(k)}<br /></span>)}</td>
                  <td>{h.individuals ? SIZE_LABELS[h.individuals] : ""}</td>
                  <td>{h.overseas || "No"}</td>
                  <td>{who(h.owner_user_id) || <span className="warning-text">None</span>}</td>
                  <td className={h.review_on && h.review_on < t ? "warning-text" : undefined}>{day(h.review_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manage && <p className="block"><button type="button" onClick={() => setEditing("new")}>Add a holding</button></p>}
    </>
  );
}

function HoldingForm({ initial, people, group, busy, canEdit, onSave, onCancel }: { initial: Holding | null; people: PrivacyData["people"]; group: GroupData | null; busy: boolean; canEdit: boolean; onSave: (v: HoldingValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<HoldingValues>(initial ? (({ id: _id, ...r }) => r)(initial) : {
    entity_id: null, name: "", system: null, info_kinds: [], individuals: null, whose: null, purpose: null, collected_from: null, disclosed_to: null, overseas: null,
    retention: null, deletion: null, security_controls: null, owner_user_id: null, review_on: null, status: "active",
  });
  const set = (p: Partial<HoldingValues>) => setV({ ...v, ...p });
  const text = (id: string, label: string, key: keyof HoldingValues, placeholder?: string) => (
    <Field id={id} label={label} wide><input id={id} disabled={!canEdit} placeholder={placeholder} value={(v[key] as string | null) ?? ""} onChange={(e) => set({ [key]: e.target.value } as Partial<HoldingValues>)} /></Field>
  );
  return (
    <div className="card form">
      <h2>{initial ? initial.name : "New holding"}</h2>
      <div className="row wrap">
        {text("ph-name", "Name", "name", "Customer accounts")}
        {text("ph-sys", "System or place", "system", "CRM, payroll system, shared drive")}
      </div>
      <div className="row wrap">
        {text("ph-whose", "Whose information", "whose", "Customers, employees, job applicants")}
        <Field id="ph-n" label="How many people"><select id="ph-n" disabled={!canEdit} value={v.individuals ?? ""} onChange={(e) => set({ individuals: (e.target.value || null) as Holding["individuals"] })}><option value="">Not known</option>{Object.entries(SIZE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {(group?.entities.length ?? 0) > 1 && <Field id="ph-ent" label="Company"><select id="ph-ent" disabled={!canEdit} value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}><option value="">All</option>{group!.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>}
      </div>
      <Kinds name="ph-kinds" disabled={!canEdit} value={v.info_kinds} onChange={(k) => set({ info_kinds: k })} />
      {text("ph-purpose", "Why it is held", "purpose")}
      <div className="row wrap">{text("ph-from", "Collected from", "collected_from")}{text("ph-to", "Disclosed to", "disclosed_to", "Payroll provider, auditors")}</div>
      <div className="row wrap">{text("ph-os", "Stored or accessed overseas (countries)", "overseas")}{text("ph-ret", "How long it is kept", "retention", "7 years after employment ends")}</div>
      <div className="row wrap">{text("ph-del", "How it is destroyed or de-identified", "deletion")}{text("ph-sec", "Security controls", "security_controls", "MFA, encryption at rest, access reviews")}</div>
      <div className="row wrap">
        <Field id="ph-owner" label="Owner"><select id="ph-owner" disabled={!canEdit} value={v.owner_user_id ?? ""} onChange={(e) => set({ owner_user_id: e.target.value || null })}><option value="">No owner yet</option>{people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}</select></Field>
        <Field id="ph-review" label="Review by"><input id="ph-review" type="date" disabled={!canEdit} value={v.review_on ?? ""} onChange={(e) => set({ review_on: e.target.value || null })} /></Field>
        {initial && <label className="check"><input type="checkbox" disabled={!canEdit} checked={v.status === "retired"} onChange={(e) => set({ status: e.target.checked ? "retired" : "active" })} /> No longer held</label>}
      </div>
      <div className="row">
        {canEdit && <button type="button" disabled={busy || v.name.trim().length < 2} onClick={() => onSave(v)}>Save</button>}
        <button type="button" className="quiet" onClick={onCancel}>{canEdit ? "Cancel" : "Back"}</button>
      </div>
      {initial && <Attachments subjectTable="personal_info_holdings" subjectId={initial.id} canAttach={canEdit} label="Privacy impact assessments and data maps" />}
    </div>
  );
}

function Decisions({ data, manage, userId, busy, today: t, organisationName, onSave }: { data: PrivacyData; manage: boolean; userId: string; busy: boolean; today: string; organisationName: string; onSave: (id: string | null, v: DecisionValues) => Promise<boolean> }) {
  const [editing, setEditing] = useState<Decision | "new" | null>(null);
  const [copied, setCopied] = useState(false);
  const wording = policyWording(data.decisions, organisationName);
  const left = daysTo(ADM_DEADLINE, t);
  if (editing) return <DecisionForm initial={editing === "new" ? null : editing} holdings={data.holdings} people={data.people} busy={busy} canEdit={manage || (editing !== "new" && editing.owner_user_id === userId)} onCancel={() => setEditing(null)} onSave={async (v) => { if (await onSave(editing === "new" ? null : editing.id, v)) setEditing(null); }} />;
  return (
    <>
      <p className={left >= 0 && left <= 60 ? "card warning" : "small muted"}>
        {left >= 0 ? <><strong>From {day(ADM_DEADLINE)} ({left} days)</strong>, the privacy policy</> : "The privacy policy"} must say what kinds of personal information are used by computer programs that make, or substantially and directly help make, decisions that could reasonably be expected to significantly affect someone's rights or interests, and what kinds of decisions those are. Examples: credit or payment terms, pricing for an individual, hiring and rostering, access to a service, fraud flags that block an account.
      </p>
      {data.decisions.length === 0 ? <p className="muted">No automated decisions recorded.</p> : (
        <ul className="plain rows">
          {data.decisions.map((d) => (
            <li key={d.id} className={d.status === "retired" ? "muted" : undefined}>
              <button type="button" className="link-dark" onClick={() => setEditing(d)}>{d.name}</button>: {d.decision}
              <span className="muted small"><br />{d.role === "solely" ? "Made by the program" : "Program substantially helps"} · {d.significant ? "significant effect" : "not significant (not in the policy)"} · {d.info_kinds.map(short).join(", ") || "information not recorded"}{d.status === "retired" ? " · retired" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {manage && <p className="block"><button type="button" onClick={() => setEditing("new")}>Add an automated decision</button></p>}
      <section className="card block">
        <h2>Privacy policy wording</h2>
        {wording ? (
          <>
            <pre className="policy-wording">{wording}</pre>
            <button type="button" className="quiet" onClick={() => { void navigator.clipboard?.writeText(wording).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy the wording"}</button>
            <p className="small muted">A starting point: check it against how the programs actually work, and have it reviewed before it goes in the policy.</p>
          </>
        ) : <p className="muted small">Record the automated decisions that significantly affect people and the wording appears here.</p>}
      </section>
    </>
  );
}

function DecisionForm({ initial, holdings, people, busy, canEdit, onSave, onCancel }: { initial: Decision | null; holdings: Holding[]; people: PrivacyData["people"]; busy: boolean; canEdit: boolean; onSave: (v: DecisionValues) => void; onCancel: () => void }) {
  const [v, setV] = useState<DecisionValues>(initial ? (({ id: _id, ...r }) => r)(initial) : {
    name: "", decision: "", role: "solely", significant: true, info_kinds: [], info_detail: null, holding_id: null, human_review: null, owner_user_id: null, review_on: null, status: "active",
  });
  const set = (p: Partial<DecisionValues>) => setV({ ...v, ...p });
  return (
    <div className="card form">
      <h2>{initial ? initial.name : "New automated decision"}</h2>
      <div className="row wrap">
        <Field id="ad-name" label="Program or process" wide><input id="ad-name" disabled={!canEdit} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Credit limit engine" /></Field>
        <Field id="ad-hold" label="Uses information from"><select id="ad-hold" disabled={!canEdit} value={v.holding_id ?? ""} onChange={(e) => { const h = holdings.find((x) => x.id === e.target.value); set({ holding_id: e.target.value || null, info_kinds: h && v.info_kinds.length === 0 ? h.info_kinds : v.info_kinds }); }}><option value="">Not linked</option>{holdings.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
      </div>
      <Field id="ad-dec" label="The decision, in plain words (as it will read in the policy)" wide><input id="ad-dec" disabled={!canEdit} value={v.decision} onChange={(e) => set({ decision: e.target.value })} placeholder="Whether to offer trade credit, and the credit limit" /></Field>
      <fieldset className="plain-fieldset question">
        <legend>What does the program do?</legend>
        <span className="row wrap">
          <label className="check"><input type="radio" name="ad-role" disabled={!canEdit} checked={v.role === "solely"} onChange={() => set({ role: "solely" })} /> Makes the decision itself</label>
          <label className="check"><input type="radio" name="ad-role" disabled={!canEdit} checked={v.role === "substantially"} onChange={() => set({ role: "substantially" })} /> Does something substantially and directly related to it (for example scores or ranks, and a person usually follows it)</label>
        </span>
      </fieldset>
      <label className="check"><input type="checkbox" disabled={!canEdit} checked={v.significant} onChange={(e) => set({ significant: e.target.checked })} /> It could reasonably be expected to significantly affect someone's rights or interests (for example their access to credit, a job, a service, or a significant benefit)</label>
      <Kinds name="ad-kinds" disabled={!canEdit} value={v.info_kinds} onChange={(k) => set({ info_kinds: k })} />
      <Field id="ad-detail" label="Any other kinds of information, in words" wide><input id="ad-detail" disabled={!canEdit} value={v.info_detail ?? ""} onChange={(e) => set({ info_detail: e.target.value })} placeholder="payment history with us" /></Field>
      <Field id="ad-review" label="How someone can ask a person to review it" wide><input id="ad-review" disabled={!canEdit} value={v.human_review ?? ""} onChange={(e) => set({ human_review: e.target.value })} placeholder="Email credit@example.com and a person will reconsider it within 10 business days." /></Field>
      <div className="row wrap">
        <Field id="ad-owner" label="Owner"><select id="ad-owner" disabled={!canEdit} value={v.owner_user_id ?? ""} onChange={(e) => set({ owner_user_id: e.target.value || null })}><option value="">No owner yet</option>{people.filter((p) => p.user_id).map((p) => <option key={p.user_id!} value={p.user_id!}>{p.full_name}</option>)}</select></Field>
        <Field id="ad-rev" label="Review by"><input id="ad-rev" type="date" disabled={!canEdit} value={v.review_on ?? ""} onChange={(e) => set({ review_on: e.target.value || null })} /></Field>
        {initial && <label className="check"><input type="checkbox" disabled={!canEdit} checked={v.status === "retired"} onChange={(e) => set({ status: e.target.checked ? "retired" : "active" })} /> No longer used</label>}
      </div>
      <div className="row">
        {canEdit && <button type="button" disabled={busy || v.name.trim().length < 2 || v.decision.trim().length < 5} onClick={() => onSave(v)}>Save</button>}
        <button type="button" className="quiet" onClick={onCancel}>{canEdit ? "Cancel" : "Back"}</button>
      </div>
      {initial && <Attachments subjectTable="automated_decisions" subjectId={initial.id} canAttach={canEdit} label="Assessments and testing" />}
    </div>
  );
}
