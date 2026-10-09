import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, loadMembers, type Member } from "./board";
import {
  addHandler,
  addNote,
  CASE_STATUS,
  CATEGORIES,
  followUp,
  grantAccess,
  loadSpeakUp,
  OUTCOMES,
  PROTECTION,
  removeHandler,
  replyAsReporter,
  sendMessage,
  submitReport,
  updateCase,
  type CaseStatus,
  type FollowUp,
  type SpeakUpCase,
  type SpeakUpData,
} from "./speakup";

type Props = { organisationId: string; role: string };

function CaseForm({ c, team, busy, onSave }: { c: SpeakUpCase; team: Member[]; busy: boolean; onSave: (patch: Parameters<typeof updateCase>[1]) => void }) {
  const [status, setStatus] = useState<CaseStatus>(c.status);
  const [protection, setProtection] = useState<string>(c.protection);
  const [investigator, setInvestigator] = useState(c.investigator_user_id ?? "");
  const [findings, setFindings] = useState(c.findings ?? "");
  const [outcome, setOutcome] = useState(c.outcome ?? "");
  return (
    <div className="form">
      <div className="row">
        <span className="field">
          <label htmlFor="su-status">Status</label>
          <select id="su-status" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)}>
            {Object.entries(CASE_STATUS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="su-protection">Qualifies for whistleblower protection?</label>
          <select id="su-protection" value={protection} onChange={(e) => setProtection(e.target.value)}>
            {Object.entries(PROTECTION).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <label htmlFor="su-investigator">Investigator</label>
          <select id="su-investigator" value={investigator} onChange={(e) => setInvestigator(e.target.value)}>
            <option value="">Not assigned</option>
            {team.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </select>
        </span>
      </div>
      <label htmlFor="su-findings">Findings</label>
      <textarea id="su-findings" rows={4} value={findings} onChange={(e) => setFindings(e.target.value)} />
      <label htmlFor="su-outcome">Outcome (needed to close)</label>
      <select id="su-outcome" className="short-wide" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
        <option value="">Not decided</option>
        {Object.entries(OUTCOMES).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <button type="button" disabled={busy} onClick={() => onSave({ status, protection, investigator: investigator || null, findings, outcome })}>
        {status === "closed" ? "Save and close the case" : "Save"}
      </button>
    </div>
  );
}

export default function SpeakUp({ organisationId, role }: Props) {
  const isAdmin = role === "owner" || role === "admin";

  const [data, setData] = useState<SpeakUpData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Raising
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [exclude, setExclude] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ reference: string; code: string } | null>(null);

  // Following up
  const [code, setCode] = useState("");
  const [thread, setThread] = useState<FollowUp | null>(null);
  const [reply, setReply] = useState("");

  // Case work
  const [text, setText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [shareWith, setShareWith] = useState("");
  const [newHandler, setNewHandler] = useState("");

  const reload = useCallback(async () => {
    const [speakUp, people] = await Promise.all([loadSpeakUp(organisationId), loadMembers(organisationId).catch(() => [])]);
    setData(speakUp);
    setMembers(people);
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load this page."));
  }, [reload]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const nameOf = (id: string | null | undefined) => members.find((m) => m.user_id === id)?.name ?? "A member of the case team";
  const active = members.filter((m) => m.is_active);
  const errorBlock = error && (
    <p className="error block" role="alert">
      {error}
    </p>
  );

  const open = data.cases.find((c) => c.id === openId);
  if (open) {
    const team = data.access.filter((a) => a.case_id === open.id).map((a) => a.user_id);
    const closed = open.status === "closed";
    return (
      <>
        <p>
          <button
            type="button"
            className="link-dark"
            onClick={() => {
              setOpenId(null);
              setError(null);
            }}
          >
            ← Back to speak-up
          </button>
        </p>
        <p className="eyebrow">Confidential · {open.category}</p>
        <h1>{open.reference}</h1>
        <p className="lead">
          <span className="chip">{CASE_STATUS[open.status]}</span> Received {formatDay(open.received_at)} ·{" "}
          {open.is_anonymous ? "anonymous" : `from ${nameOf(open.reporter_user_id)}`}
          {open.outcome ? ` · ${OUTCOMES[open.outcome]}` : ""}
        </p>
        <p className="card warning">
          Only the people listed under "Who can see this case" can open it. Do not share the reporter's identity, or anything
          that could reveal it, with anyone else unless the law allows it.
        </p>
        {errorBlock}

        <section className="card">
          <h2>What was reported</h2>
          <p className="pre-wrap">{open.description}</p>
        </section>

        <section className="block">
          <h2>Assessment and investigation</h2>
          {closed ? (
            <div className="card">
              <p>
                Closed {open.closed_at ? formatDay(open.closed_at) : ""}. Outcome: {OUTCOMES[open.outcome ?? ""] ?? "not recorded"}. Protection:{" "}
                {PROTECTION[open.protection]}.
              </p>
              {open.findings && <p className="pre-wrap">{open.findings}</p>}
            </div>
          ) : (
            <CaseForm
              key={`${open.id}-${open.status}`}
              c={open}
              team={active.filter((m) => team.includes(m.user_id))}
              busy={busy}
              onSave={(patch) => void run(() => updateCase(open, patch))}
            />
          )}
        </section>

        <section className="block">
          <h2>Messages with the reporter</h2>
          {data.messages.filter((m) => m.case_id === open.id).length === 0 && <p className="muted">No messages yet.</p>}
          <ul className="plain rows">
            {data.messages
              .filter((m) => m.case_id === open.id)
              .map((m) => (
                <li key={m.id}>
                  <strong>{m.from_reporter ? "Reporter" : nameOf(m.author_user_id)}</strong> <span className="muted">· {formatDay(m.created_at)}</span>
                  <br />
                  <span className="pre-wrap">{m.body}</span>
                </li>
              ))}
          </ul>
          <div className="form review">
            <label htmlFor="su-message">Message to the reporter</label>
            <textarea id="su-message" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
            <button type="button" className="quiet" disabled={busy || text.trim() === ""} onClick={() => void run(() => sendMessage(open.id, text)).then((ok) => ok && setText(""))}>
              Send
            </button>
          </div>
        </section>

        <section className="block">
          <h2>Case notes</h2>
          <p className="muted">The reporter never sees these.</p>
          <ul className="plain rows">
            {data.notes
              .filter((n) => n.case_id === open.id)
              .map((n) => (
                <li key={n.id}>
                  <strong>{nameOf(n.author_user_id)}</strong> <span className="muted">· {formatDay(n.created_at)}</span>
                  <br />
                  <span className="pre-wrap">{n.body}</span>
                </li>
              ))}
          </ul>
          <div className="form review">
            <label htmlFor="su-note">Add a note</label>
            <textarea id="su-note" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button type="button" className="quiet" disabled={busy || noteText.trim() === ""} onClick={() => void run(() => addNote(open.id, noteText)).then((ok) => ok && setNoteText(""))}>
              Add note
            </button>
          </div>
        </section>

        <section className="block">
          <h2>Who can see this case</h2>
          <ul>
            {team.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ul>
          <div className="row">
            <select aria-label="Give access to" value={shareWith} onChange={(e) => setShareWith(e.target.value)}>
              <option value="">Give access to…</option>
              {active
                .filter((m) => !team.includes(m.user_id))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="quiet"
              disabled={busy || !shareWith}
              onClick={() => {
                if (window.confirm("Give this person access to the whole case, including the report? Access cannot be removed here.")) {
                  void run(() => grantAccess(open.id, shareWith)).then((ok) => ok && setShareWith(""));
                }
              }}
            >
              Give access
            </button>
          </div>
        </section>

        <section className="block">
          <h2>Case log</h2>
          <ul className="plain rows">
            {data.events
              .filter((e) => e.case_id === open.id)
              .map((e) => (
                <li key={e.id}>
                  {e.event} <span className="muted">· {formatDay(e.created_at)}{e.actor_user_id ? ` · ${nameOf(e.actor_user_id)}` : ""}</span>
                </li>
              ))}
          </ul>
        </section>
      </>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (description.trim().length < 20) return setError("Describe what happened in a little more detail.");
    setBusy(true);
    setError(null);
    try {
      setReceipt(await submitReport(organisationId, category, description, anonymous, exclude));
      setDescription("");
      setExclude([]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the report.");
    } finally {
      setBusy(false);
    }
  }

  async function lookUp(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setThread(await followUp(code));
    } catch (e) {
      setThread(null);
      setError(e instanceof Error ? e.message : "Could not find that report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Confidential</p>
      <h1>Speak up</h1>
      <p className="lead">Raise a concern about something that is wrong, or looks wrong. You do not need proof.</p>
      {errorBlock}

      {receipt && (
        <section className="card warning" role="status">
          <h2>Report {receipt.reference} received</h2>
          <p>Write this code down now. It is shown once and is the only way to follow up your report or read replies.</p>
          <p className="big-number code">{receipt.code}</p>
          <button type="button" className="quiet" onClick={() => setReceipt(null)}>
            I have saved the code
          </button>
        </section>
      )}

      {data.cases.length > 0 && (
        <section className="block">
          <h2>Cases you can see</h2>
          <ul className="entity-list">
            {data.cases.map((c) => (
              <li key={c.id}>
                <button type="button" className="entity-row" onClick={() => setOpenId(c.id)}>
                  <span>
                    <span className="entity-name">{c.reference}</span>
                    <span className="muted"> · {c.category}</span>
                    <br />
                    <span className="muted">
                      Received {formatDay(c.received_at)} · {c.is_anonymous ? "anonymous" : "named"}
                    </span>
                  </span>
                  <span className={c.status === "new" ? "chip chip-alert" : "chip"}>{CASE_STATUS[c.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form className="card form" onSubmit={submit}>
        <h2>Raise a concern</h2>
        {data.handlers.length === 0 ? (
          <p className="warning-text">Nobody has been appointed to receive reports yet, so reports cannot be sent. An owner or administrator appoints them below.</p>
        ) : (
          <>
            <label htmlFor="su-category">What is it about?</label>
            <select id="su-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <label htmlFor="su-description">What happened?</label>
            <textarea id="su-description" rows={6} placeholder="What you saw or suspect, who was involved, when and where." value={description} onChange={(e) => setDescription(e.target.value)} />
            <fieldset className="plain-fieldset question">
              <legend>Your identity</legend>
              <label className="check">
                <input type="radio" name="su-anon" checked={anonymous} onChange={() => setAnonymous(true)} /> Stay anonymous. Your name is not recorded with the report.
              </label>
              <label className="check">
                <input type="radio" name="su-anon" checked={!anonymous} onChange={() => setAnonymous(false)} /> Share my name with the people handling the report.
              </label>
            </fieldset>
            <fieldset className="plain-fieldset question">
              <legend>Who receives it</legend>
              <p className="muted">Untick anyone your concern is about. They will not see the report or know it exists.</p>
              {data.handlers.map((id) => (
                <label key={id} className="check">
                  <input
                    type="checkbox"
                    checked={!exclude.includes(id)}
                    onChange={(e) => setExclude(e.target.checked ? exclude.filter((x) => x !== id) : [...exclude, id])}
                  />{" "}
                  {members.find((m) => m.user_id === id)?.name ?? "A report recipient"}
                </label>
              ))}
            </fieldset>
            <p className="muted">
              Only the people ticked can read your report. If you write details that identify you, they will see those. It is
              against the law to treat someone badly for raising a concern.
            </p>
            <button type="submit" disabled={busy}>
              Send report
            </button>
          </>
        )}
      </form>

      <form className="card form" onSubmit={lookUp}>
        <h2>Follow up a report</h2>
        <label htmlFor="su-code">Your code</label>
        <input id="su-code" className="short-wide" autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className="quiet" disabled={busy || code.trim() === ""}>
          Find my report
        </button>
        {thread && (
          <div className="block-tight">
            <p>
              <strong>{thread.reference}</strong> · <span className="chip">{CASE_STATUS[thread.status]}</span> · received {formatDay(thread.received_at)}
            </p>
            {thread.messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : (
              <ul className="plain rows">
                {thread.messages.map((m, i) => (
                  <li key={i}>
                    <strong>{m.from_reporter ? "You" : "Case team"}</strong> <span className="muted">· {formatDay(m.created_at)}</span>
                    <br />
                    <span className="pre-wrap">{m.body}</span>
                  </li>
                ))}
              </ul>
            )}
            <label htmlFor="su-reply">Reply</label>
            <textarea id="su-reply" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} />
            <button
              type="button"
              className="quiet"
              disabled={busy || reply.trim() === ""}
              onClick={() => {
                setBusy(true);
                setError(null);
                replyAsReporter(code, reply)
                  .then(() => followUp(code))
                  .then((t) => {
                    setThread(t);
                    setReply("");
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : "Could not send."))
                  .finally(() => setBusy(false));
              }}
            >
              Send reply
            </button>
          </div>
        )}
      </form>

      <section className="block">
        <h2>Who receives reports</h2>
        {data.handlers.length === 0 ? (
          <p className="muted">Nobody yet.</p>
        ) : (
          <ul className="plain rows">
            {data.handlers.map((id) => (
              <li key={id} className="row spread">
                <span>{members.find((m) => m.user_id === id)?.name ?? "A report recipient"}</span>
                {isAdmin && (
                  <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => removeHandler(organisationId, id))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <div className="row review">
            <select aria-label="Appoint a recipient" value={newHandler} onChange={(e) => setNewHandler(e.target.value)}>
              <option value="">Appoint…</option>
              {active
                .filter((m) => !data.handlers.includes(m.user_id))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <button type="button" className="quiet" disabled={busy || !newHandler} onClick={() => void run(() => addHandler(organisationId, newHandler)).then((ok) => ok && setNewHandler(""))}>
              Appoint
            </button>
          </div>
        )}
        <p className="muted">
          Recipients see new reports from the day they are appointed. Owners and administrators appoint recipients but cannot
          read reports unless they are recipients themselves.
        </p>
      </section>
    </>
  );
}
