import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  addAction,
  addAgendaItem,
  addAttendee,
  addResolution,
  decideWipe,
  draftMinutes,
  executeWipe,
  finaliseMinutes,
  formatDay,
  formatWhen,
  loadMeeting,
  placeHold,
  releaseHold,
  removeAgendaItem,
  requestWipe,
  saveCapture,
  saveMinutes,
  setAttendance,
  setMeetingStatus,
  STATUS_LABELS,
  type AgendaItem,
  type AttendanceStatus,
  type ItemKind,
  type MeetingDetail,
  type Outcome,
} from "./board";

type Props = { organisationId: string; meetingId: string; role: string; userId: string; onBack: () => void };
/** Runs a change, reloads the meeting, and reports whether it succeeded. */
type Run = (action: () => Promise<void>) => Promise<boolean>;

const KIND_LABELS: Record<ItemKind, string> = { noting: "For noting", discussion: "For discussion", decision: "For decision" };
const OUTCOME_LABELS: Record<Outcome, string> = { passed: "Passed", not_passed: "Not passed", deferred: "Deferred" };
const ATTEND: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "apology", label: "Apology" },
  { value: "absent", label: "Absent" },
];

function AddAgendaItem({ onAdd, busy }: { onAdd: (title: string, kind: ItemKind) => void; busy: boolean }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ItemKind>("discussion");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length < 2) return;
    onAdd(title, kind);
    setTitle("");
  }
  return (
    <form className="row" onSubmit={submit}>
      <input
        className="grow"
        aria-label="New agenda item"
        placeholder="New agenda item"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <select aria-label="Item type" value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
        {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <button type="submit" className="quiet" disabled={busy}>
        Add item
      </button>
    </form>
  );
}

function ItemNotes({
  item,
  index,
  detail,
  organisationId,
  run,
  track,
  busy,
}: {
  item: AgendaItem;
  index: number;
  detail: MeetingDetail;
  organisationId: string;
  run: Run;
  track: (saving: Promise<void>) => void;
  busy: boolean;
}) {
  const saved = detail.captures.find((c) => c.agenda_item_id === item.id);
  const [notes, setNotes] = useState(saved?.notes ?? "");
  const [conflicts, setConflicts] = useState(saved?.conflicts ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const last = useRef({ notes: saved?.notes ?? "", conflicts: saved?.conflicts ?? "" });
  const [resolution, setResolution] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("passed");
  const [action, setAction] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");

  function save() {
    if (notes === last.current.notes && conflicts === last.current.conflicts) return;
    const snapshot = { notes, conflicts };
    setState("saving");
    track(
      saveCapture(organisationId, detail.meeting.id, item.id, notes, conflicts)
        .then(() => {
          last.current = snapshot;
          setState("saved");
        })
        .catch(() => setState("failed")),
    );
  }

  const resolutions = detail.resolutions.filter((r) => r.agenda_item_id === item.id);
  const actions = detail.actions.filter((a) => a.agenda_item_id === item.id);
  const id = `item-${item.id}`;

  return (
    <section className="card item">
      <p className="item-kind">{KIND_LABELS[item.kind]}</p>
      <h3>
        {index + 1}. {item.title}
      </h3>

      <label htmlFor={`${id}-notes`}>Discussion notes</label>
      <textarea id={`${id}-notes`} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={save} />
      <label htmlFor={`${id}-conflicts`}>Interests declared</label>
      <input id={`${id}-conflicts`} value={conflicts} onChange={(e) => setConflicts(e.target.value)} onBlur={save} />
      <p className="save-state" role="status">
        {state === "saving" && "Saving…"}
        {state === "saved" && "Notes saved"}
        {state === "failed" && "Could not save these notes. Check your connection and click out of the box again."}
      </p>

      {resolutions.length > 0 && (
        <ul className="plain">
          {resolutions.map((r) => (
            <li key={r.id}>
              <strong>{OUTCOME_LABELS[r.outcome]}:</strong> {r.text}
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (resolution.trim().length < 5) return;
          void run(() => addResolution(organisationId, detail.meeting.id, item.id, resolution, outcome)).then(
            (ok) => ok && setResolution(""),
          );
        }}
      >
        <input
          className="grow"
          aria-label={`Resolution for ${item.title}`}
          placeholder="Resolution, e.g. That the budget be approved"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
        <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
          {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABELS[o]}
            </option>
          ))}
        </select>
        <button type="submit" className="quiet" disabled={busy}>
          Record resolution
        </button>
      </form>

      {actions.length > 0 && (
        <ul className="plain">
          {actions.map((a) => (
            <li key={a.id}>
              <strong>Action:</strong> {a.title}
              {a.assignee_person_id && ` · ${detail.people.find((p) => p.id === a.assignee_person_id)?.full_name ?? ""}`}
              {a.due_at && ` · due ${formatDay(a.due_at)}`}
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (action.trim().length < 2) return;
          void run(() => addAction(organisationId, detail.meeting.id, item.id, action, owner || null, due || null)).then(
            (ok) => {
              if (!ok) return;
              setAction("");
              setOwner("");
              setDue("");
            },
          );
        }}
      >
        <input
          className="grow"
          aria-label={`Action for ${item.title}`}
          placeholder="Action arising"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <select aria-label="Action owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Owner…</option>
          {detail.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
        <input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button type="submit" className="quiet" disabled={busy}>
          Add action
        </button>
      </form>
    </section>
  );
}

export default function MeetingPage({ organisationId, meetingId, role, userId, onBack }: Props) {
  const canWrite = ["owner", "admin", "secretary"].includes(role);
  const canRecords = ["owner", "admin", "secretary", "legal", "compliance"].includes(role);
  const canHold = ["owner", "admin", "legal"].includes(role);

  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attendee, setAttendee] = useState("");
  const [minutesText, setMinutesText] = useState<string | null>(null);
  const [holdName, setHoldName] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const pending = useRef(new Set<Promise<void>>());

  const reload = useCallback(async () => {
    const fresh = await loadMeeting(organisationId, meetingId);
    setDetail(fresh);
    return fresh;
  }, [organisationId, meetingId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the meeting."));
  }, [reload]);

  const run: Run = async (action) => {
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
  };

  const track = (saving: Promise<void>) => {
    pending.current.add(saving);
    void saving.finally(() => pending.current.delete(saving));
  };

  if (!detail) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const { meeting, agenda, attendees, minutes } = detail;
  const status = meeting.status;
  const who = (uid: string | null) => detail.people.find((p) => p.user_id === uid)?.full_name ?? "another member";

  const endMeeting = () =>
    run(async () => {
      await Promise.all([...pending.current]);
      await setMeetingStatus(meetingId, "minutes_draft");
      const fresh = await loadMeeting(organisationId, meetingId);
      if (!fresh.minutes) await saveMinutes(organisationId, meetingId, draftMinutes(fresh));
      setMinutesText(null);
    });

  const draftText = minutesText ?? minutes?.content ?? "";

  const lockMinutes = () => {
    if (!window.confirm("Lock these minutes? They become the permanent record and cannot be changed afterwards.")) return;
    void run(async () => {
      await saveMinutes(organisationId, meetingId, draftText);
      await finaliseMinutes(meetingId, draftText);
      setMinutesText(null);
    });
  };

  const latest = detail.requests[0];
  const activeHolds = detail.holds.filter((h) => h.status === "active");

  return (
    <>
      <button type="button" className="back" onClick={onBack}>
        ← Back to meetings
      </button>
      <p className="eyebrow">
        {meeting.body.entity.name} · {meeting.body.name}
      </p>
      <h1>{meeting.title}</h1>
      <p className="lead">
        {formatWhen(meeting.scheduled_at)}
        {meeting.location ? ` · ${meeting.location}` : ""} · <span className="chip">{STATUS_LABELS[status]}</span>
      </p>

      {detail.onHold && (
        <p className="card warning" role="alert">
          <strong>Legal hold.</strong> This meeting is under a legal hold. Nothing connected to it can be deleted until
          the hold is released.
        </p>
      )}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}

      {/* ---------- Before and during the meeting ---------- */}
      {(status === "scheduled" || status === "in_progress") && (
        <>
          <section className="block">
            <h2>Attendance</h2>
            {attendees.length === 0 && (
              <p className="muted">No attendees yet. Directors recorded for the entity are added automatically.</p>
            )}
            <ul className="plain rows">
              {attendees.map((a) => (
                <li key={a.id} className="row spread">
                  <span>
                    <strong>{a.person.full_name}</strong>
                    {a.capacity && <span className="muted"> · {a.capacity}</span>}
                  </span>
                  {status === "in_progress" && canWrite && (
                    <span className="segmented" role="group" aria-label={`Attendance for ${a.person.full_name}`}>
                      {ATTEND.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={a.status === option.value ? "on" : undefined}
                          aria-pressed={a.status === option.value}
                          disabled={busy}
                          onClick={() => void run(() => setAttendance(a.id, option.value))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {canWrite && (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (attendee.trim().length < 2) return;
                  void run(() => addAttendee(organisationId, meetingId, attendee)).then((ok) => ok && setAttendee(""));
                }}
              >
                <input
                  className="grow"
                  aria-label="Add an attendee"
                  placeholder="Add an attendee by name"
                  value={attendee}
                  onChange={(e) => setAttendee(e.target.value)}
                />
                <button type="submit" className="quiet" disabled={busy}>
                  Add attendee
                </button>
              </form>
            )}
          </section>

          <section className="block">
            <h2>Agenda</h2>
            {status === "scheduled" && (
              <ol className="agenda">
                {agenda.map((item) => (
                  <li key={item.id}>
                    <span className="row spread">
                      <span>
                        <strong>{item.title}</strong> <span className="muted">· {KIND_LABELS[item.kind]}</span>
                      </span>
                      {canWrite && (
                        <button
                          type="button"
                          className="link-dark"
                          aria-label={`Remove ${item.title}`}
                          disabled={busy}
                          onClick={() => void run(() => removeAgendaItem(item.id))}
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {status === "in_progress" &&
              (canWrite ? (
                agenda.map((item, index) => (
                  <ItemNotes
                    key={item.id}
                    item={item}
                    index={index}
                    detail={detail}
                    organisationId={organisationId}
                    run={run}
                    track={track}
                    busy={busy}
                  />
                ))
              ) : (
                <p className="muted">The secretary is taking notes. The minutes appear here once they are final.</p>
              ))}
            {canWrite && (
              <AddAgendaItem
                busy={busy}
                onAdd={(title, kind) =>
                  void run(() =>
                    addAgendaItem(
                      organisationId,
                      meetingId,
                      title,
                      kind,
                      Math.max(0, ...agenda.map((a) => a.position)) + 1,
                    ),
                  )
                }
              />
            )}
          </section>

          {canWrite && (
            <div className="row block">
              {status === "scheduled" ? (
                <button type="button" disabled={busy} onClick={() => void run(() => setMeetingStatus(meetingId, "in_progress"))}>
                  Start meeting
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void endMeeting()}>
                  End meeting and draft minutes
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ---------- Draft minutes ---------- */}
      {status === "minutes_draft" && (
        <section className="block">
          <h2>Draft minutes</h2>
          {canWrite ? (
            <>
              <p className="muted">
                Drafted from the attendance, notes, resolutions and actions you recorded. Edit freely, then lock.
              </p>
              <textarea
                className="minutes-edit"
                aria-label="Draft minutes"
                rows={24}
                value={draftText}
                onChange={(e) => setMinutesText(e.target.value)}
              />
              <div className="row">
                <button type="button" disabled={busy} onClick={lockMinutes}>
                  Approve and lock minutes
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => void run(() => saveMinutes(organisationId, meetingId, draftText))}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Replace the draft with a fresh one built from the notes? Your edits will be lost."))
                      setMinutesText(draftMinutes(detail));
                  }}
                >
                  Redraft from notes
                </button>
                <button
                  type="button"
                  className="link-dark"
                  disabled={busy}
                  onClick={() => void run(() => setMeetingStatus(meetingId, "in_progress"))}
                >
                  Back to note taking
                </button>
              </div>
            </>
          ) : (
            <p className="muted">The minutes are being drafted. They appear here once they are final.</p>
          )}
        </section>
      )}

      {/* ---------- Final record ---------- */}
      {status === "minutes_final" && minutes && (
        <>
          <section className="block">
            <h2>Minutes</h2>
            <p className="locked">
              Locked{minutes.finalised_at ? ` on ${formatWhen(minutes.finalised_at)}` : ""} by {who(minutes.finalised_by)}
              . This is the permanent record.
            </p>
            <pre className="minutes">{minutes.content}</pre>
          </section>

          <section className="block">
            <h2>Decisions</h2>
            {detail.resolutions.length === 0 ? (
              <p className="muted">No resolutions were recorded.</p>
            ) : (
              <ul className="plain rows">
                {detail.resolutions.map((r) => (
                  <li key={r.id}>
                    <strong>{OUTCOME_LABELS[r.outcome]}:</strong> {r.text}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="block">
            <h2>Actions</h2>
            {detail.actions.length === 0 ? (
              <p className="muted">No actions were recorded.</p>
            ) : (
              <ul className="plain rows">
                {detail.actions.map((a) => (
                  <li key={a.id}>
                    {a.title}
                    <span className="muted">
                      {a.assignee_person_id &&
                        ` · ${detail.people.find((p) => p.id === a.assignee_person_id)?.full_name ?? ""}`}
                      {a.due_at && ` · due ${formatDay(a.due_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canRecords && (
            <section className="card block">
              <h2>Draft notes</h2>
              {detail.certificates.map((c) => (
                <div key={c.id} className="certificate">
                  <p>
                    <strong>Deletion certificate</strong>
                  </p>
                  <p>{c.subject_description}.</p>
                  <p className="muted">
                    Deleted {formatWhen(c.deleted_at)} · Certificate {c.id.slice(0, 8)} · {c.file_hashes.length}{" "}
                    fingerprint(s) retained
                  </p>
                </div>
              ))}
              {latest?.status === "pending" &&
                (latest.requested_by === userId ? (
                  <p>
                    You asked for the draft notes to be wiped on {formatDay(latest.requested_at)}. A second person must
                    approve it.
                  </p>
                ) : (
                  <>
                    <p>
                      {who(latest.requested_by)} asked for the draft notes to be wiped. The minutes stay as they are.
                    </p>
                    <div className="row">
                      <button type="button" disabled={busy} onClick={() => void run(() => decideWipe(latest.id, "approved"))}>
                        Approve wipe
                      </button>
                      <button
                        type="button"
                        className="quiet"
                        disabled={busy}
                        onClick={() => void run(() => decideWipe(latest.id, "rejected"))}
                      >
                        Reject
                      </button>
                    </div>
                  </>
                ))}
              {latest?.status === "approved" && (
                <>
                  <p>The wipe was approved by {who(latest.decided_by)}. Deleting the draft notes cannot be undone.</p>
                  <button type="button" disabled={busy || detail.onHold} onClick={() => void run(() => executeWipe(latest.id))}>
                    Wipe draft notes now
                  </button>
                </>
              )}
              {latest?.status === "blocked_by_hold" && (
                <p className="warning-text">
                  The last wipe request was blocked because the meeting was under a legal hold.
                </p>
              )}
              {(!latest || !["pending", "approved"].includes(latest.status)) &&
                (detail.captures.length > 0 ? (
                  <>
                    <p>
                      {detail.captures.length} draft note record(s) are still held. Now the minutes are final they can
                      be wiped, with a second person's approval.
                    </p>
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy || detail.onHold}
                      onClick={() => void run(() => requestWipe(meetingId))}
                    >
                      Request wipe of draft notes
                    </button>
                    {detail.onHold && <p className="warning-text">Not available while the legal hold is active.</p>}
                  </>
                ) : (
                  detail.certificates.length === 0 && <p className="muted">No draft notes are held for this meeting.</p>
                ))}
            </section>
          )}
        </>
      )}

      {/* ---------- Legal hold ---------- */}
      {canHold && (
        <section className="card block">
          <h2>Legal hold</h2>
          {activeHolds.map((h) => (
            <div key={h.id} className="row spread">
              <span>
                <strong>{h.name}</strong> <span className="muted">· {h.reason}</span>
              </span>
              <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => releaseHold(h.id))}>
                Release hold
              </button>
            </div>
          ))}
          {activeHolds.length === 0 && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                if (holdName.trim().length < 2 || holdReason.trim().length < 2)
                  return setError("Give the hold a name and a reason.");
                void run(() => placeHold(organisationId, meetingId, holdName, holdReason)).then((ok) => {
                  if (!ok) return;
                  setHoldName("");
                  setHoldReason("");
                });
              }}
            >
              <p className="muted">
                Place a hold if litigation or an investigation is on foot or expected. It stops any deletion for this
                meeting.
              </p>
              <div className="row">
                <input
                  className="grow"
                  aria-label="Hold name"
                  placeholder="Matter name"
                  value={holdName}
                  onChange={(e) => setHoldName(e.target.value)}
                />
                <input
                  className="grow"
                  aria-label="Reason for hold"
                  placeholder="Reason"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                />
                <button type="submit" className="quiet" disabled={busy}>
                  Place hold
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  );
}
