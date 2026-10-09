import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createMeeting, formatWhen, loadMeetings, STATUS_LABELS, type Meeting } from "./board";
import type { GroupData } from "./types";

type Props = {
  organisationId: string;
  group: GroupData;
  canWrite: boolean;
  onOpen: (meetingId: string) => void;
};

/** Next weekday at 10:00 am, as a value for a datetime-local input. */
function defaultWhen() {
  const d = new Date();
  do d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Meetings({ organisationId, group, canWrite, onOpen }: Props) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityId, setEntityId] = useState(group.entities[0]?.id ?? "");
  const [title, setTitle] = useState("Board meeting");
  const [when, setWhen] = useState(defaultWhen);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMeetings(await loadMeetings(organisationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load meetings.");
    }
  }, [organisationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!entityId) return setError("Choose the company the meeting is for.");
    if (!when) return setError("Choose a date and time.");
    setBusy(true);
    setError(null);
    try {
      onOpen(await createMeeting(organisationId, group, entityId, title, new Date(when).toISOString(), location));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the meeting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Board and company secretarial</p>
      <h1>Meetings</h1>

      {meetings === null && !error && <p className="lead">Loading…</p>}
      {meetings && meetings.length === 0 && <p className="lead">No meetings yet.</p>}
      {meetings && meetings.length > 0 && (
        <ul className="entity-list">
          {meetings.map((m) => (
            <li key={m.id}>
              <button type="button" className="entity-row" onClick={() => onOpen(m.id)}>
                <span>
                  <span className="entity-name">{m.title}</span>
                  <span className="muted"> · {m.body.entity.name}</span>
                  <br />
                  <span className="muted">{formatWhen(m.scheduled_at)}</span>
                </span>
                <span className="chip">{STATUS_LABELS[m.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canWrite &&
        (group.entities.length === 0 ? (
          <p className="card note">Add an entity on the Overview page first; a meeting belongs to a company's board.</p>
        ) : (
          <form className="card form" onSubmit={create}>
            <h2>Schedule a meeting</h2>
            <label htmlFor="m-entity">Company</label>
            <select id="m-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {group.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <label htmlFor="m-title">Title</label>
            <input id="m-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            <label htmlFor="m-when">Date and time</label>
            <input id="m-when" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
            <label htmlFor="m-where">Location (optional)</label>
            <input id="m-where" value={location} onChange={(e) => setLocation(e.target.value)} />
            <p className="muted">
              A standard agenda is added, and the company's recorded directors and secretary are listed as attendees.
              You can change both.
            </p>
            <button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Schedule meeting"}
            </button>
          </form>
        ))}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
