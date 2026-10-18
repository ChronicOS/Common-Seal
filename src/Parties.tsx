import PersonPicker from "./PersonPicker";
import { has, only } from "./roles";
import { useCallback, useEffect, useState } from "react";
import { formatDay, formatWhen } from "./board";
import { attachFile, downloadFile, listFiles, type LinkedFile } from "./files";
import { QuestionnaireAnswers } from "./DdQuestionnaire";
import {
  addMitigation,
  completeMitigation,
  DD_LABELS,
  decideCase,
  escalateCase,
  EXEMPTIONS,
  FINAL_LABELS,
  KIND_LABELS,
  loadParties,
  loadQuestionnaires,
  questionnaireLink,
  sendQuestionnaire,
  cancelQuestionnaire,
  type Questionnaire,
  PARTY_TYPES,
  partyTypeLabel,
  requestDueDiligence,
  resolveEscalation,
  RISK_LABELS,
  saveCheck,
  setConcerns,
  STAGES,
  TOPIC_HELP,
  TOPIC_LABELS,
  TRIGGERS,
  type DdCase,
  type DdCheck,
  type PartiesData,
  type Party,
  type PartyDetails,
} from "./parties";

type Props = { organisationId: string; role: string; userId?: string };
type View = { kind: "list" } | { kind: "party"; id: string } | { kind: "request"; partyId: string | null };

const RECORDS = ["owner", "admin", "secretary", "legal", "compliance"];
const today = () => new Date().toLocaleDateString("en-CA");

function partyChip(p: Party, exempt: boolean): { text: string; alert: boolean } {
  if (!p.dd_status) return exempt ? { text: "Out of scope (recorded)", alert: false } : { text: "No due diligence", alert: true };
  return {
    text: `${DD_LABELS[p.dd_status]}${p.risk_rating ? ` · ${RISK_LABELS[p.risk_rating]}` : ""}`,
    alert: p.dd_status === "rejected" || p.dd_status === "open",
  };
}

function CheckRow({ check, canEdit, busy, onSave }: { check: DdCheck; canEdit: boolean; busy: boolean; onSave: (result: DdCheck["result"], notes: string) => void }) {
  const [result, setResult] = useState(check.result);
  const [notes, setNotes] = useState(check.notes ?? "");
  const changed = result !== check.result || notes !== (check.notes ?? "");
  const id = `check-${check.id}`;
  return (
    <div className="check-row">
      <label htmlFor={id}>
        {TOPIC_LABELS[check.topic]}
        {TOPIC_HELP[check.topic] && <span className="muted small"> · {TOPIC_HELP[check.topic]}</span>}
      </label>
      <div className="row">
        <select id={id} disabled={!canEdit} value={result} onChange={(e) => setResult(e.target.value as DdCheck["result"])}>
          <option value="pending">Not done</option>
          <option value="clear">Clear</option>
          <option value="concern">Concern found</option>
        </select>
        <input className="grow" disabled={!canEdit} aria-label={`Notes for ${TOPIC_LABELS[check.topic]}`} placeholder="What was checked, the source, and what was found" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {canEdit && (
          <button type="button" className="quiet" disabled={busy || !changed} onClick={() => onSave(result, notes)}>
            Save
          </button>
        )}
      </div>
    </div>
  );
}

const blankDetails = (userId: string): PartyDetails => ({ name: "", party_type: "", country: "", countries: [], registration_number: "", website: "", description: "", business_owner_user_id: userId, annual_value: "" });

/** Asking for due diligence: the basics about the third party. The rest comes from the third party's questionnaire. */
function RequestForm({ party, people, userId, busy, onRequest, onCancel }: {
  party: Party | null;
  people: { user_id: string | null; full_name: string }[];
  userId: string;
  busy: boolean;
  onRequest: (d: PartyDetails, trigger: string, contact: { name: string; email: string }) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<PartyDetails>(
    party
      ? { name: party.name, party_type: party.party_type ?? "", country: party.country ?? "", countries: party.countries ?? [], registration_number: party.registration_number ?? "", website: party.website ?? "", description: party.description ?? "", business_owner_user_id: party.business_owner_user_id ?? userId, annual_value: party.annual_value != null ? String(party.annual_value) : "" }
      : blankDetails(userId),
  );
  const [countriesText, setCountriesText] = useState((party?.countries ?? []).join(", "));
  const [trigger, setTrigger] = useState(party ? (party.dd_status ? "Periodic review" : "Existing third party never checked") : "New third party");
  const [contact, setContact] = useState({ name: "", email: "" });
  const [missing, setMissing] = useState<string | null>(null);
  const set = (patch: Partial<PartyDetails>) => setD({ ...d, ...patch });

  const submit = () => {
    if (d.name.trim().length < 2) return setMissing("Give the third party's name.");
    if (!d.party_type) return setMissing("Choose what kind of third party it is.");
    if (!d.description.trim()) return setMissing("Say what they will do for us.");
    if (contact.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim())) return setMissing("That email address does not look right.");
    setMissing(null);
    onRequest({ ...d, countries: countriesText.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean) }, trigger, contact);
  };

  return (
    <>
      <p className="eyebrow">Due diligence</p>
      <h1>{party ? `Due diligence: ${party.name}` : "Due diligence a third party"}</h1>
      <p className="lead">Do this before agreeing anything binding. Tell us the basics; the third party then answers a short questionnaire about its owners, office holders, any litigation, insolvency or adverse press, and its licences. No contract can be approved until due diligence is cleared.</p>

      <section className="card form">
        <h2>The third party</h2>
        {!party && (
          <>
            <label htmlFor="dd-name">Name</label>
            <input id="dd-name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
          </>
        )}
        <label htmlFor="dd-type">What kind of third party is it?</label>
        <select id="dd-type" value={d.party_type} onChange={(e) => set({ party_type: e.target.value as PartyDetails["party_type"] })}>
          <option value="">Choose</option>
          {PARTY_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.help ? ` (${t.help})` : ""}
            </option>
          ))}
        </select>
        <div className="row wrap">
          <span className="field">
            <label htmlFor="dd-country">Country where it is based</label>
            <input id="dd-country" value={d.country} onChange={(e) => set({ country: e.target.value })} />
          </span>
          <span className="field grow">
            <label htmlFor="dd-countries">Countries where it will work for us or deliver to (comma between)</label>
            <input id="dd-countries" value={countriesText} onChange={(e) => setCountriesText(e.target.value)} />
          </span>
          <span className="field">
            <label htmlFor="dd-value">Expected value a year (AUD)</label>
            <input id="dd-value" inputMode="decimal" value={d.annual_value} onChange={(e) => set({ annual_value: e.target.value })} />
          </span>
        </div>
        <label htmlFor="dd-desc">What will they do for us?</label>
        <textarea id="dd-desc" rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} />
        <div className="row wrap">
          <span className="field">
            <label htmlFor="dd-owner">Business owner (responsible for the relationship)</label>
            <select id="dd-owner" value={d.business_owner_user_id} onChange={(e) => set({ business_owner_user_id: e.target.value })}>
              {people.filter((p) => p.user_id).map((p) => (
                <option key={p.user_id!} value={p.user_id!}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </span>
          <span className="field grow">
            <label htmlFor="dd-trigger">Why now?</label>
            <select id="dd-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {TRIGGERS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </span>
        </div>
        <h3>Who should answer the questionnaire?</h3>
        <div className="row wrap">
          <span className="field">
            <label htmlFor="dd-contact">Contact name</label>
            <input id="dd-contact" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          </span>
          <span className="field grow">
            <label htmlFor="dd-contact-email">Contact email</label>
            <input id="dd-contact-email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          </span>
        </div>
        <p className="muted small">You can also send the questionnaire later from the third party's page.</p>
      </section>

      {missing && (
        <p className="error block" role="alert">
          {missing}
        </p>
      )}
      <div className="row block">
        <button type="button" disabled={busy} onClick={submit}>
          Request due diligence
        </button>
        <button type="button" className="link-dark" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

export default function Parties({ organisationId, role, userId = "" }: Props) {
  const canEdit = has(role, ...RECORDS);
  const canAdd = !only(role, "auditor");

  const [data, setData] = useState<PartiesData | null>(null);
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [qLink, setQLink] = useState<{ caseId: string; token: string | null } | null>(null);
  const [qContact, setQContact] = useState({ name: "", email: "" });
  const [files, setFiles] = useState<LinkedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [filter, setFilter] = useState<"all" | "open" | "attention" | "mine">("all");

  const [conditions, setConditions] = useState("");
  const [concerns, setConcernsText] = useState<string | null>(null);
  const [mitigation, setMitigation] = useState({ action: "", timing: "before" as "before" | "during", owner: "", due: "" });
  const [escalation, setEscalation] = useState("");
  const [final, setFinal] = useState({ decision: "proceed_conditions" as keyof typeof FINAL_LABELS, by: "", note: "" });

  const reload = useCallback(async () => {
    const d = await loadParties(organisationId);
    setData(d);
    setFiles(await listFiles("dd_cases", d.cases.map((c) => c.id)));
    setQuestionnaires(await loadQuestionnaires(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load due diligence."));
  }, [reload]);

  // The personal link for the open case's questionnaire (only those who can send it can read it)
  const viewPartyId = view.kind === "party" ? view.id : null;
  const openCaseId = viewPartyId ? data?.cases.find((c) => c.counterparty_id === viewPartyId && c.status === "open")?.id ?? null : null;
  const openQ = openCaseId ? questionnaires.find((q) => q.case_id === openCaseId && q.status === "sent")?.id ?? null : null;
  useEffect(() => {
    if (!openCaseId || !openQ) {
      setQLink(null);
      return;
    }
    let live = true;
    questionnaireLink(openCaseId).then((token) => live && setQLink({ caseId: openCaseId, token }));
    return () => {
      live = false;
    };
  }, [openCaseId, openQ]);

  async function run(action: () => Promise<void>, done?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const go = (v: View) => {
    setView(v);
    setError(null);
    setNotice(null);
    setConcernsText(null);
    setConditions("");
    setEscalation("");
  };

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const who = (uid: string | null | undefined) => data.people.find((p) => p.user_id === uid)?.full_name ?? "a member";
  const messages = (
    <>
      {notice && (
        <p className="card note" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );
  const isExempt = (p: Party) => data.exemptions.some((x) => x.counterparty_id === p.id);
  const beforeOutstanding = (p: Party) => data.mitigations.some((m) => m.timing === "before" && !m.done_at && data.cases.find((c) => c.id === m.case_id)?.counterparty_id === p.id);

  // ---------- Request ----------
  if (view.kind === "request") {
    const party = view.partyId ? data.parties.find((p) => p.id === view.partyId) ?? null : null;
    if (!data.ready)
      return (
        <>
          <p className="card warning">Run migration 0039 to turn on due diligence requests.</p>
          <button type="button" className="link-dark" onClick={() => go({ kind: "list" })}>
            ← Back
          </button>
        </>
      );
    return (
      <>
        <button type="button" className="back" onClick={() => go(party ? { kind: "party", id: party.id } : { kind: "list" })}>
          ← Back
        </button>
        <RequestForm
          party={party}
          people={data.people}
          userId={userId}
          busy={busy}
          onCancel={() => go(party ? { kind: "party", id: party.id } : { kind: "list" })}
          onRequest={(d, trigger, contact) => {
            let pid = "";
            void run(async () => {
              const r = await requestDueDiligence(organisationId, party?.id ?? null, d, trigger, {});
              pid = r.partyId;
              if (contact.name.trim() || contact.email.trim()) await sendQuestionnaire(r.caseId, contact.name, contact.email);
            }).then((ok) => {
              if (!ok) return;
              go(pid ? { kind: "party", id: pid } : { kind: "list" });
              setNotice(contact.email.trim() ? "Due diligence requested. Send the questionnaire to the third party using the email below." : "Due diligence requested. Send the third party its questionnaire below.");
            });
          }}
        />
        {messages}
      </>
    );
  }

  // ---------- One party ----------
  const party = view.kind === "party" ? data.parties.find((p) => p.id === view.id) : undefined;
  if (party) {
    const cases = data.cases.filter((c) => c.counterparty_id === party.id);
    const current = cases.find((c) => c.status === "open");
    const latest: DdCase | undefined = cases[0];
    const past = cases.filter((c) => c.status !== "open");
    const checks = current ? data.checks.filter((k) => k.case_id === current.id) : [];
    const pending = checks.some((k) => k.result === "pending");
    const concern = checks.some((k) => k.result === "concern");
    const exemptions = data.exemptions.filter((x) => x.counterparty_id === party.id);
    const advised = current ?? latest;
    const mitigations = advised ? data.mitigations.filter((m) => m.case_id === advised.id) : [];
    const caseFiles = advised ? files.filter((f) => f.subject_id === advised.id) : [];
    const isOwner = party.business_owner_user_id === userId || advised?.requested_by === userId;
    const overdue = current?.target_on && current.target_on < today();
    const chip = partyChip(party, exemptions.length > 0);
    const seniorProceed = latest?.status === "rejected" && (latest.final_decision === "proceed" || latest.final_decision === "proceed_conditions");

    return (
      <>
        <button type="button" className="back" onClick={() => go({ kind: "list" })}>
          ← Back to due diligence
        </button>
        <p className="eyebrow">
          {partyTypeLabel(party.party_type) ?? KIND_LABELS[party.kind]}
          {party.country ? ` · ${party.country}` : ""}
        </p>
        <h1>{party.name}</h1>
        <p className="lead">
          <span className={chip.alert ? "chip chip-alert" : "chip"}>{chip.text}</span>
          {party.next_review_on ? ` Next review ${formatDay(party.next_review_on)}` : ""}
        </p>
        <dl className="detail-list compact key-facts">
          {party.description && <div><dt>What they do for us</dt><dd>{party.description}</dd></div>}
          {(party.countries ?? []).length > 0 && <div><dt>Countries</dt><dd>{party.countries!.join(", ")}</dd></div>}
          {party.annual_value != null && <div><dt>Expected value a year</dt><dd>{party.currency ?? "AUD"} {party.annual_value.toLocaleString("en-AU")}</dd></div>}
          <div><dt>Business owner</dt><dd>{party.business_owner_user_id ? who(party.business_owner_user_id) : <span className="muted">Not recorded</span>}</dd></div>
          {party.registration_number && <div><dt>Registration</dt><dd>{party.registration_number}</dd></div>}
        </dl>
        {party.dd_status === "rejected" && !seniorProceed && (
          <p className="card warning" role="alert">
            <strong>Rejected.</strong> Contracts with this party cannot be approved.
          </p>
        )}
        {party.dd_status === "open" && (
          <p className="card warning" role="alert">
            <strong>Due diligence is not finished.</strong> Contracts with this party cannot be approved until it is cleared.
          </p>
        )}
        {beforeOutstanding(party) && (
          <p className="card warning" role="alert">
            <strong>Mitigations to complete first.</strong> Contracts cannot be approved until the "before the engagement" mitigations below are done.
          </p>
        )}
        {messages}

        {(current || questionnaires.some((q) => cases.some((c) => c.id === q.case_id))) && (() => {
          const caseQs = questionnaires.filter((q) => cases.some((c) => c.id === q.case_id));
          const returned = caseQs.find((q) => q.status === "submitted");
          const sent = current ? caseQs.find((q) => q.case_id === current.id && q.status === "sent") : undefined;
          const mayPush = canEdit || isOwner;
          const link = sent && qLink && qLink.caseId === current?.id && qLink.token ? `${window.location.origin}/?d=${qLink.token}` : null;
          const mail = link && sent
            ? `mailto:${encodeURIComponent(sent.contact_email ?? "")}?subject=${encodeURIComponent(`Due diligence questionnaire: ${party.name}`)}&body=${encodeURIComponent(`Dear ${sent.contact_name?.split(" ")[0] ?? "colleague"},\n\nBefore we can work together we ask every business partner to answer a short questionnaire about the company, its office holders and shareholders, and its licences. It takes about ten minutes and needs no account:\n\n${link}\n\nThank you`)}`
            : null;
          return (
            <section className="card form block">
              <h2>Questionnaire to the third party</h2>
              {returned?.answers ? (
                <>
                  <p className="small">
                    Returned {returned.submitted_at ? formatDay(returned.submitted_at) : ""}
                    {returned.contact_name ? ` by ${returned.contact_name}` : ""}.
                  </p>
                  <QuestionnaireAnswers a={returned.answers} submittedAt={returned.submitted_at} />
                  {["supplier", "service_provider", "sub_contractor", "distributor"].includes(party.party_type ?? "") && (
                    <p className="note small">
                      Next step for a supplier: send the modern slavery supplier questionnaire too (Risk and compliance → Modern slavery). It covers labour practices and supply chains, which this questionnaire does not.
                    </p>
                  )}
                </>
              ) : sent ? (
                <>
                  <p className="small">
                    Sent {sent.sent_at ? formatDay(sent.sent_at) : ""}
                    {sent.contact_name || sent.contact_email ? ` to ${[sent.contact_name, sent.contact_email].filter(Boolean).join(", ")}` : ""} ·{" "}
                    {sent.opened_at ? `opened ${formatDay(sent.opened_at)}, not yet submitted` : "not yet opened"}
                  </p>
                  {mayPush && link && (
                    <div className="row wrap">
                      {mail && sent.contact_email && (
                        <a className="button-link" href={mail}>
                          Open the email
                        </a>
                      )}
                      <button type="button" className="quiet" onClick={() => void navigator.clipboard.writeText(link).then(() => setNotice("Link copied."), () => setError("Could not copy."))}>
                        Copy the link
                      </button>
                      <button type="button" className="link-dark small" disabled={busy} onClick={() => { if (window.confirm("Cancel this link? The third party will not be able to use it.")) void run(() => cancelQuestionnaire(sent.id), "Link cancelled."); }}>
                        Cancel the link
                      </button>
                    </div>
                  )}
                  {!sent.contact_email && mayPush && <p className="muted small">No email recorded: copy the link and send it yourself.</p>}
                </>
              ) : current && mayPush ? (
                <>
                  <p className="muted small">Send the third party a personal link. They answer about their company, office holders, shareholders, litigation, insolvency, press coverage and licences.</p>
                  <div className="row wrap">
                    <input aria-label="Contact name" placeholder="Contact name" value={qContact.name} onChange={(e) => setQContact({ ...qContact, name: e.target.value })} />
                    <input aria-label="Contact email" type="email" placeholder="Contact email" value={qContact.email} onChange={(e) => setQContact({ ...qContact, email: e.target.value })} />
                    <button type="button" disabled={busy} onClick={() => void run(() => sendQuestionnaire(current.id, qContact.name, qContact.email).then(() => undefined), "Questionnaire link created.").then((ok) => ok && setQContact({ name: "", email: "" }))}>
                      Create the link
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted small">Not sent yet.</p>
              )}
            </section>
          );
        })()}

        {current && (
          <section className="card form block">
            <div className="row spread">
              <h2>Checks</h2>
              <span className={overdue ? "chip chip-alert" : "chip"}>
                {RISK_LABELS[current.risk_rating]} · target {current.target_on ? formatDay(current.target_on) : "not set"}
                {overdue ? " (overdue)" : ""}
              </span>
            </div>
            <p className="muted small">
              Requested {formatWhen(current.created_at)}
              {current.requested_by ? ` by ${who(current.requested_by)}` : ""}
              {current.trigger_reason ? ` · ${current.trigger_reason}` : ""}
            </p>
            {(current.risk_reasons ?? []).length > 0 && (
              <ul className="small">
                {current.risk_reasons!.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            {canEdit ? (
              STAGES.map((s) => {
                const list = checks.filter((k) => s.topics.includes(k.topic));
                if (!list.length) return null;
                return (
                  <div key={s.label}>
                    <h3>{s.label}</h3>
                    {list.map((k) => (
                      <CheckRow key={`${k.id}-${k.result}-${k.notes ?? ""}`} check={k} canEdit={canEdit} busy={busy} onSave={(result, notes) => void run(() => saveCheck(k.id, result, notes))} />
                    ))}
                  </div>
                );
              })
            ) : (
              <p>Legal or compliance is running the checks. You will see their advice here.</p>
            )}
            {canEdit && checks.length === 0 && <p className="muted">No checks are recorded for this case.</p>}
          </section>
        )}

        {advised && canEdit && (
          <section className="card form block">
            <h2>{current ? "Engagement advice" : "Advice and mitigations"}</h2>
            <label htmlFor="dd-concerns">Areas of concern</label>
            <textarea id="dd-concerns" rows={2} value={concerns ?? advised.concerns ?? ""} onChange={(e) => setConcernsText(e.target.value)} />
            {concerns !== null && concerns !== (advised.concerns ?? "") && (
              <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => setConcerns(advised.id, concerns), "Saved.").then((ok) => ok && setConcernsText(null))}>
                Save concerns
              </button>
            )}
            {data.ready && (current || advised.status === "cleared_with_conditions") && (
              <>
                <h3>Add a mitigation</h3>
                <div className="row wrap">
                  <span className="field grow">
                    <label htmlFor="mt-action">Action</label>
                    <input id="mt-action" placeholder="e.g. completes anti-bribery training; audit rights in the contract" value={mitigation.action} onChange={(e) => setMitigation({ ...mitigation, action: e.target.value })} />
                  </span>
                  <span className="field">
                    <label htmlFor="mt-timing">When</label>
                    <select id="mt-timing" value={mitigation.timing} onChange={(e) => setMitigation({ ...mitigation, timing: e.target.value as "before" | "during" })}>
                      <option value="before">Before the engagement</option>
                      <option value="during">During the engagement</option>
                    </select>
                  </span>
                  <span className="field">
                    <label htmlFor="mt-owner">Who</label>
                    <PersonPicker id="mt-owner" value={mitigation.owner} onChange={(name) => setMitigation({ ...mitigation, owner: name })} />
                  </span>
                  <span className="field">
                    <label htmlFor="mt-due">By</label>
                    <input id="mt-due" type="date" value={mitigation.due} onChange={(e) => setMitigation({ ...mitigation, due: e.target.value })} />
                  </span>
                </div>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy || mitigation.action.trim().length < 5}
                  onClick={() => void run(() => addMitigation(advised.id, mitigation.action, mitigation.timing, mitigation.owner, mitigation.due), "Mitigation added.").then((ok) => ok && setMitigation({ action: "", timing: "before", owner: "", due: "" }))}
                >
                  Add mitigation
                </button>
              </>
            )}
            {current && (
              <>
                <h3>Decision</h3>
                {pending && <p className="muted">Complete every check before clearing. You can reject at any time.</p>}
                {concern && <p className="warning-text">A check raised a concern, so this can only be cleared with conditions or rejected.</p>}
                <label htmlFor="dd-conditions">Conditions (needed to clear with conditions; the reason, to reject)</label>
                <input id="dd-conditions" value={conditions} onChange={(e) => setConditions(e.target.value)} />
                <div className="row">
                  <button type="button" disabled={busy || pending || concern} onClick={() => void run(() => decideCase(current.id, "cleared", ""), "Cleared.").then((ok) => ok && setConditions(""))}>
                    Clear
                  </button>
                  <button type="button" className="quiet" disabled={busy || pending} onClick={() => void run(() => decideCase(current.id, "cleared_with_conditions", conditions), "Cleared with conditions.").then((ok) => ok && setConditions(""))}>
                    Clear with conditions
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Reject ${party.name}? Its contracts will be blocked from approval.`)) void run(() => decideCase(current.id, "rejected", conditions), "Rejected.").then((ok) => ok && setConditions(""));
                    }}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {advised && (mitigations.length > 0 || caseFiles.length > 0 || (!canEdit && advised.status !== "open")) && (
          <section className="block">
            {!canEdit && advised.status !== "open" && (
              <>
                <h2>Engagement advice</h2>
                <p>
                  <strong>{DD_LABELS[advised.status]}</strong>
                  {advised.decided_at ? ` on ${formatDay(advised.decided_at)}` : ""}
                  {advised.conditions ? `. Conditions: ${advised.conditions}` : ""}
                </p>
                {advised.concerns && <p>Areas of concern: {advised.concerns}</p>}
              </>
            )}
            {mitigations.length > 0 && (
              <>
                <h2>Mitigations</h2>
                <ul className="plain rows">
                  {mitigations.map((m) => (
                    <li key={m.id} className="row spread">
                      <span>
                        <span className={m.done_at ? "chip" : m.timing === "before" ? "chip chip-alert" : "chip"}>{m.done_at ? "Done" : m.timing === "before" ? "Before the engagement" : "During the engagement"}</span> {m.action}
                        <span className="muted small">
                          {m.owner_name ? ` · ${m.owner_name}` : ""}
                          {m.due_on ? ` · by ${formatDay(m.due_on)}` : ""}
                          {m.done_at ? ` · done ${formatDay(m.done_at)}${m.done_note ? `: ${m.done_note}` : ""}` : ""}
                        </span>
                      </span>
                      {!m.done_at && (canEdit || isOwner) && (
                        <button
                          type="button"
                          className="quiet"
                          disabled={busy}
                          onClick={() => {
                            const note = window.prompt("How was it done? (optional)") ?? "";
                            void run(() => completeMitigation(m.id, note), "Marked as done.");
                          }}
                        >
                          Mark as done
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {caseFiles.length > 0 && (
              <>
                <h2>Reports and evidence</h2>
                <ul className="plain rows">
                  {caseFiles.map((f) => (
                    <li key={f.storage_path}>
                      <button type="button" className="quiet" onClick={() => void downloadFile(f.storage_path, f.file_name).catch((e) => setError(e.message))}>
                        ⤓ {f.file_name}
                      </button>{" "}
                      <span className="muted small">{formatDay(f.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
        {advised && canEdit && (
          <p className="block">
            <label className="quiet file-button">
              Attach a report or evidence
              <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(() => attachFile("dd_cases", advised.id, f).then(() => undefined), "Attached."); e.target.value = ""; }} />
            </label>
          </p>
        )}

        {latest && data.ready && (latest.status === "rejected" || latest.status === "cleared_with_conditions") && (
          <section className="card form block">
            <h2>Disagree with the advice?</h2>
            {latest.escalated_at ? (
              <>
                <p>
                  Escalated {formatDay(latest.escalated_at)}: {latest.escalation_note}
                </p>
                {latest.final_decision ? (
                  <p>
                    <strong>Final decision: {FINAL_LABELS[latest.final_decision]}</strong>, by {latest.final_decided_by_name}
                    {latest.final_decided_at ? `, ${formatDay(latest.final_decided_at)}` : ""}
                    {latest.final_decision_note ? `. ${latest.final_decision_note}` : ""}
                  </p>
                ) : canEdit ? (
                  <>
                    <p className="muted">Escalate to the business owner's senior functional head and the senior compliance person. Record their decision here.</p>
                    <label htmlFor="fd-decision">Decision</label>
                    <select id="fd-decision" value={final.decision} onChange={(e) => setFinal({ ...final, decision: e.target.value as keyof typeof FINAL_LABELS })}>
                      {Object.entries(FINAL_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="fd-by">Decided by (name and title)</label>
                    <input id="fd-by" value={final.by} onChange={(e) => setFinal({ ...final, by: e.target.value })} />
                    <label htmlFor="fd-note">Conditions or notes</label>
                    <input id="fd-note" value={final.note} onChange={(e) => setFinal({ ...final, note: e.target.value })} />
                    <button type="button" disabled={busy} onClick={() => void run(() => resolveEscalation(latest.id, final.decision, final.by, final.note), "Final decision recorded.")}>
                      Record the decision
                    </button>
                  </>
                ) : (
                  <p className="muted">Waiting for the senior decision.</p>
                )}
              </>
            ) : isOwner || canEdit ? (
              <>
                <p className="muted">The business owner can escalate. It goes to the most senior functional head and the senior compliance person, who decide.</p>
                <label htmlFor="esc-note">Why you disagree</label>
                <textarea id="esc-note" rows={2} value={escalation} onChange={(e) => setEscalation(e.target.value)} />
                <button type="button" className="quiet" disabled={busy || escalation.trim().length < 10} onClick={() => void run(() => escalateCase(latest.id, escalation), "Escalated.")}>
                  Escalate
                </button>
              </>
            ) : null}
          </section>
        )}

        {!current && canAdd && (
          <p className="block">
            <button type="button" onClick={() => go({ kind: "request", partyId: party.id })}>
              {cases.length ? "Start a new review" : "Request due diligence"}
            </button>
          </p>
        )}

        {(past.length > 0 || exemptions.length > 0) && (
          <section className="block">
            <h2>History</h2>
            <ul className="plain rows">
              {exemptions.map((x) => (
                <li key={x.id}>
                  <strong>Out of scope</strong> · {EXEMPTIONS.find((e) => e.id === x.exemption)?.label}
                  <span className="muted"> · {formatWhen(x.created_at)} by {who(x.recorded_by)}</span>
                  <br />
                  {x.reason}
                  {x.evidence ? ` (evidence: ${x.evidence})` : ""}
                </li>
              ))}
              {past.map((c) => (
                <li key={c.id}>
                  <strong>{DD_LABELS[c.status]}</strong> · {RISK_LABELS[c.risk_rating]}
                  <span className="muted">{c.decided_at ? ` · ${formatWhen(c.decided_at)} by ${who(c.decided_by)}` : ""}</span>
                  {c.conditions && (
                    <>
                      <br />
                      Conditions: {c.conditions}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted small">Due diligence records are kept for the life of the relationship and seven years after.</p>
          </section>
        )}
      </>
    );
  }

  // ---------- List ----------
  const mine = (p: Party) => p.business_owner_user_id === userId || data.cases.some((c) => c.counterparty_id === p.id && c.requested_by === userId);
  const attention = (p: Party) => p.dd_status === "open" || p.dd_status === "rejected" || beforeOutstanding(p) || (!p.dd_status && !isExempt(p)) || Boolean(p.next_review_on && p.next_review_on < today());
  const shown = data.parties.filter((p) => filter === "all" || (filter === "open" && p.dd_status === "open") || (filter === "attention" && attention(p)) || (filter === "mine" && mine(p)));
  const openCases = data.cases.filter((c) => c.status === "open");

  return (
    <>
      <p className="eyebrow">Third parties</p>
      <h1>Due Diligence</h1>
      <p className="lead">Every supplier, agent, distributor, partner or customer goes through due diligence before we agree anything binding.</p>
      {messages}
      {canAdd && (
        <p>
          <button type="button" onClick={() => go({ kind: "request", partyId: null })}>
            Due diligence a third party
          </button>
        </p>
      )}
      {canEdit && (
        <dl className="facts">
          <div>
            <dt>Open</dt>
            <dd>{openCases.length}</dd>
          </div>
          <div>
            <dt>Past target date</dt>
            <dd className={openCases.some((c) => c.target_on && c.target_on < today()) ? "warning-text" : undefined}>{openCases.filter((c) => c.target_on && c.target_on < today()).length}</dd>
          </div>
          <div>
            <dt>High risk</dt>
            <dd>{data.parties.filter((p) => p.risk_rating === "high").length}</dd>
          </div>
          <div>
            <dt>No due diligence</dt>
            <dd className={data.parties.some((p) => !p.dd_status && !isExempt(p)) ? "warning-text" : undefined}>{data.parties.filter((p) => !p.dd_status && !isExempt(p)).length}</dd>
          </div>
        </dl>
      )}
      <span className="segmented block-gap" role="group" aria-label="Show">
        {(
          [
            ["all", "All"],
            ["attention", "Needs attention"],
            ["open", "Open"],
            ["mine", "Mine"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" className={filter === k ? "on" : undefined} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {l}
          </button>
        ))}
      </span>
      {shown.length === 0 ? (
        <p className="muted">{data.parties.length === 0 ? "No third parties yet. Counterparties from contracts appear here too." : "Nothing to show."}</p>
      ) : (
        <ul className="entity-list">
          {shown.map((p) => {
            const chip = partyChip(p, isExempt(p));
            const c = data.cases.find((x) => x.counterparty_id === p.id && x.status === "open");
            return (
              <li key={p.id}>
                <button type="button" className="entity-row" onClick={() => go({ kind: "party", id: p.id })}>
                  <span>
                    <span className="entity-name">{p.name}</span>
                    <span className="muted">
                      {" "}
                      · {partyTypeLabel(p.party_type) ?? KIND_LABELS[p.kind]}
                      {p.country ? ` · ${p.country}` : ""}
                      {c?.target_on ? ` · target ${formatDay(c.target_on)}` : p.next_review_on ? ` · review ${formatDay(p.next_review_on)}` : ""}
                    </span>
                    {beforeOutstanding(p) && <strong className="warning-text"> · mitigations to complete first</strong>}
                  </span>
                  <span className={chip.alert ? "chip chip-alert" : "chip"}>{chip.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
