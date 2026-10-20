import { useState } from "react";
import { formatDay } from "./board";
import {
  decideCase, loadCaseTargets, mediaSearch, saveCheck, screenCase, screenParty, subjectOf, TOPIC_LABELS,
  type DdCase, type DdCheck, type Party, type PartyDetails, type Screening, type SubjectType,
} from "./parties";

// Due Diligence essentials for the Small tier: as few questions and decisions as possible.

/** Asking for due diligence: name, what they do, one risk question, and who gets the questionnaire */
export function SmallRequestForm({ party, subject, userId, busy, progress, onRequest, onCancel }: {
  /** What is happening while the checks run straight after starting */
  progress?: string;
  party: Party | null;
  subject: SubjectType;
  userId: string;
  busy: boolean;
  onRequest: (d: PartyDetails, trigger: string, contact: { name: string; email: string }, answers: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const person = subject === "individual";
  const [name, setName] = useState(party?.name ?? "");
  const [what, setWhat] = useState(party?.description ?? "");
  const [actsForUs, setActsForUs] = useState<"" | "yes" | "no">(party?.party_type === "sales_agent" ? "yes" : party ? "no" : "");
  const [dob, setDob] = useState("");
  const [contact, setContact] = useState({ name: "", email: "" });
  const [missing, setMissing] = useState<string | null>(null);

  const submit = () => {
    if (name.trim().length < 2) return setMissing(person ? "Give the person's full name." : "Give the organisation's name.");
    if (what.trim().length < 3) return setMissing("Say in a few words what they will do for you.");
    if (!actsForUs) return setMissing("Answer whether they will act for you with customers or officials.");
    if (contact.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim())) return setMissing("That email address does not look right.");
    setMissing(null);
    onRequest(
      {
        name: name.trim(), description: what.trim(), country: party?.country ?? "", countries: party?.countries ?? [], registration_number: "", website: "",
        business_owner_user_id: party?.business_owner_user_id ?? userId, annual_value: "",
        party_type: actsForUs === "yes" ? "sales_agent" : person ? "service_provider" : party?.party_type && party.party_type !== "sales_agent" ? party.party_type : "supplier",
        subject_type: subject, ...(person ? { date_of_birth: dob } : {}),
      },
      party ? (party.dd_status ? "Periodic review" : "Existing third party never checked") : "New third party",
      contact,
      {},
    );
  };

  return (
    <>
      <p className="eyebrow">Due diligence</p>
      <h1>{party ? `Check ${party.name}` : person ? "Check a person" : "Check an organisation"}</h1>
      <p className="lead">Three quick questions, then one click runs every check: sanctions, politically exposed people, watch lists and the news.</p>
      <section className="card form">
        {!party && (
          <>
            <label htmlFor="sdd-name">{person ? "Full name" : "Organisation name"}</label>
            <input id="sdd-name" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}
        <label htmlFor="sdd-what">What will they do for you?</label>
        <input id="sdd-what" value={what} placeholder={person ? "e.g. marketing consultant" : "e.g. supplies packaging"} onChange={(e) => setWhat(e.target.value)} />
        <fieldset className="plain-fieldset">
          <legend>Will they act for you with customers or government officials (for example as an agent or introducer)?</legend>
          <div className="row">
            {(["no", "yes"] as const).map((v) => (
              <label key={v} className="check"><input type="radio" name="sdd-acts" checked={actsForUs === v} onChange={() => setActsForUs(v)} /> {v === "yes" ? "Yes" : "No"}</label>
            ))}
          </div>
        </fieldset>
        {person ? (
          <>
            <label htmlFor="sdd-dob">Date of birth (optional, cuts false alarms in the checks)</label>
            <input id="sdd-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={{ maxWidth: "12em" }} />
          </>
        ) : (
          <>
            <p className="small"><strong>Who should fill in the questionnaire?</strong> <span className="muted">Optional: leave blank to skip it, or send it later.</span></p>
            <div className="row wrap">
              <span className="field"><label htmlFor="sdd-cname">Their name</label><input id="sdd-cname" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></span>
              <span className="field grow"><label htmlFor="sdd-cemail">Their email</label><input id="sdd-cemail" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></span>
            </div>
          </>
        )}
      </section>
      {missing && <p className="error block" role="alert">{missing}</p>}
      <div className="row block">
        <button type="button" disabled={busy} onClick={submit}>{busy ? progress || "Starting…" : person || !contact.email.trim() ? "Run the checks" : "Run the checks and prepare the questionnaire"}</button>
        <button type="button" className="link-dark" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

/** Runs every automatic check for a case: lists first, then the news. Returns a plain-English summary. */
export async function runAllChecks(o: { partyId: string; partyName: string; caseId: string; listsForEveryone: boolean; onProgress: (text: string) => void }): Promise<string> {
  o.onProgress("Checking sanctions, PEP and watch lists…");
  const lists = o.listsForEveryone ? await screenCase(o.caseId, true) : await screenParty(o.partyId, true).then((r) => ({ subjects: 1, total_hits: r.total_hits }));
  const targets = await loadCaseTargets(o.caseId).catch(() => [{ key: "party", name: o.partyName }]);
  let media = 0;
  const missed: string[] = [];
  for (const [i, t] of targets.entries()) {
    o.onProgress(`Searching the news ${i + 1} of ${targets.length}: ${t.name}…`);
    try {
      media += (await mediaSearch(o.partyId, o.caseId, t.key)).findings;
    } catch (e) {
      missed.push(`${t.name} (${e instanceof Error ? e.message : "failed"})`);
    }
  }
  const found = lists.total_hits + media;
  const tail = missed.length ? ` News not searched for: ${missed.join("; ")}.` : "";
  return found === 0 ? `Checks done for ${lists.subjects === 1 ? o.partyName : `${lists.subjects} names`}: nothing found.${tail}` : `Checks done: ${found} possible match${found === 1 ? "" : "es"} to look at below.${tail}`;
}

const mark = (r: DdCheck["result"]) => (r === "clear" ? "✓" : r === "concern" ? "!" : "…");

/** The case in three steps: questionnaire, checks, decision */
export function SmallSteps({ party, current, checks, questionnaire, screenings, canEdit, canDecide, onDone }: {
  party: Party;
  current: DdCase;
  checks: DdCheck[];
  questionnaire: "none" | "sent" | "returned";
  screenings: Screening[];
  canEdit: boolean;
  canDecide: boolean;
  onDone: (notice: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [manual, setManual] = useState(false);
  const person = subjectOf(party) === "individual";
  const pending = checks.filter((k) => k.result === "pending");
  const concerns = checks.filter((k) => k.result === "concern");
  const toReview = (() => {
    const latest = new Map<string, Screening>();
    for (const s of screenings) {
      const k = `${s.kind ?? "lists"}:${s.subject_key ?? "party"}`;
      if (!latest.has(k)) latest.set(k, s);
    }
    return [...latest.values()].reduce((n, s) => n + s.hits.filter((h) => !s.reviews[h.id]).length, 0);
  })();
  const ran = screenings.length > 0;

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setProblem(null);
    try {
      await onDone(await work());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const runAll = () => act(() => runAllChecks({ partyId: party.id, partyName: party.name, caseId: current.id, listsForEveryone: !person && questionnaire === "returned", onProgress: setProgress }));

  const step = (n: number, done: boolean, title: string, body: React.ReactNode) => (
    <li className={done ? "small-step done" : "small-step"}>
      <span className="small-step-n" aria-hidden="true">{done ? "✓" : n}</span>
      <div><strong>{title}</strong><div className="small">{body}</div></div>
    </li>
  );
  let n = 0;
  return (
    <section className="card block small-steps">
      <h2>{party.name}: what's next</h2>
      <p className="small muted">Contracts with them can't be approved until you decide.</p>
      {problem && <p className="error" role="alert">{problem}</p>}
      <ol className="plain">
        {!person && step(++n, questionnaire !== "sent", "Questionnaire",
          questionnaire === "returned" ? "Returned. Their answers are below." : questionnaire === "sent" ? "Sent. Waiting for them to fill it in. You can run the checks now on the name and again when it comes back." : "Not sent (optional). Send it below if you want their owners and managers checked too.")}
        {step(++n, ran && toReview === 0, "Checks",
          <>
            {!ran ? "Sanctions, politically exposed people, watch lists and the news, in one click." : toReview > 0 ? `${toReview} possible match${toReview === 1 ? "" : "es"} to look at below. Mark each "Not them" or "It is them".` : "Done."}
            {canEdit && (
              <p><button type="button" className={ran ? "quiet" : undefined} disabled={busy} onClick={() => void runAll()}>{busy && progress ? progress : ran ? "Run the checks again" : "Run the checks"}</button></p>
            )}
          </>)}
        {step(++n, false, "Decide",
          !canDecide ? "Legal, compliance or an administrator decides." : pending.length > 0 ? (
            <>
              Waiting for: {pending.map((k) => TOPIC_LABELS[k.topic].toLowerCase()).join(", ")}.
              {canEdit && <> <button type="button" className="link-dark" onClick={() => setManual(!manual)}>{manual ? "Hide" : "Mark checks by hand"}</button></>}
            </>
          ) : (
            <>
              {concerns.length > 0 ? <p className="warning-text">Something was found: {concerns.map((k) => TOPIC_LABELS[k.topic].toLowerCase()).join(", ")}. To approve anyway, say why (and any conditions).</p> : <p>Everything is clear.</p>}
              {(concerns.length > 0 || rejecting) && (
                <input aria-label="Reason" placeholder={rejecting ? "Why you are rejecting them" : "Why it is acceptable, and any conditions"} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} />
              )}
              <div className="row">
                {!rejecting && (
                  <button type="button" disabled={busy || (concerns.length > 0 && note.trim().length < 5)}
                    onClick={() => void act(async () => { await decideCase(current.id, concerns.length ? "cleared_with_conditions" : "cleared", note); setNote(""); return `${party.name} approved.`; })}>
                    Approve
                  </button>
                )}
                {rejecting ? (
                  <>
                    <button type="button" disabled={busy || note.trim().length < 5} onClick={() => void act(async () => { await decideCase(current.id, "rejected", note); setNote(""); return `${party.name} rejected. Contracts with them are blocked.`; })}>Reject</button>
                    <button type="button" className="link-dark" onClick={() => setRejecting(false)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="quiet" disabled={busy} onClick={() => setRejecting(true)}>Reject…</button>
                )}
              </div>
            </>
          ))}
      </ol>
      {manual && (
        <div className="block-gap">
          <p className="small muted">If a check can't run automatically (for example screening isn't switched on), record what you checked yourself.</p>
          {pending.map((k) => <ManualCheck key={k.id} k={k} busy={busy} onSave={(r, notes) => void act(async () => { await saveCheck(k.id, r, notes); return "Saved."; })} />)}
        </div>
      )}
      <p className="small muted">
        Checks: {checks.map((k) => `${mark(k.result)} ${TOPIC_LABELS[k.topic]}`).join(" · ")}
        {current.target_on ? ` · aim to finish by ${formatDay(current.target_on)}` : ""}
      </p>
    </section>
  );
}

function ManualCheck({ k, busy, onSave }: { k: DdCheck; busy: boolean; onSave: (r: DdCheck["result"], notes: string) => void }) {
  const [notes, setNotes] = useState("");
  return (
    <div className="row wrap check-row">
      <span className="field grow">
        <label htmlFor={`mc-${k.id}`}>{TOPIC_LABELS[k.topic]}: what did you check?</label>
        <input id={`mc-${k.id}`} value={notes} placeholder="e.g. searched DFAT consolidated list on 20 Oct, no match" onChange={(e) => setNotes(e.target.value)} />
      </span>
      <button type="button" className="quiet" disabled={busy || notes.trim().length < 5} onClick={() => onSave("clear", notes)}>Nothing found</button>
      <button type="button" className="quiet" disabled={busy || notes.trim().length < 5} onClick={() => onSave("concern", notes)}>Found something</button>
    </div>
  );
}
