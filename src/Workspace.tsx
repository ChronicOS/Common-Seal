import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, loadAssurance, type AssuranceSummary } from "./board";
import { CHECKIN_KEY, dueCheckIns, progress } from "./checks";
import { createEntity, loadGroup, setPrompt } from "./data";
import EntityDetail from "./EntityDetail";
import GroupChart from "./GroupChart";
import MeetingPage from "./MeetingPage";
import Meetings from "./Meetings";
import Members from "./Members";
import type { GroupData, Membership } from "./types";

const RECORDS_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const BOARD_WRITE_ROLES = ["owner", "admin", "secretary"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Tab = "overview" | "meetings" | "people";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "meetings", label: "Meetings" },
  { id: "people", label: "People" },
];

export default function Workspace({ membership, userId }: { membership: Membership; userId: string }) {
  const { organisation, role } = membership;
  const canEdit = RECORDS_ROLES.includes(role);

  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<GroupData | null>(null);
  const [assurance, setAssurance] = useState<AssuranceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  // Entities opened in this visit are not nagged about again until the next visit.
  const [visited, setVisited] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await loadGroup(organisation.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your entities.");
    }
  }, [organisation.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh the summary whenever the overview comes back into view.
  const onOverview = tab === "overview" && !entityId;
  useEffect(() => {
    if (!onOverview) return;
    loadAssurance(organisation.id)
      .then(setAssurance)
      .catch(() => setAssurance(null));
  }, [onOverview, organisation.id]);

  const openEntity = (id: string) => {
    setVisited((v) => (v.includes(id) ? v : [...v, id]));
    setEntityId(id);
  };

  const go = (next: Tab) => {
    setTab(next);
    setEntityId(null);
    setMeetingId(null);
  };

  const nav = (
    <nav className="tabs" aria-label="Sections">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={tab === t.id ? "tab on" : "tab"}
          aria-current={tab === t.id ? "page" : undefined}
          onClick={() => go(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );

  if (error && !data) {
    return (
      <p className="error" role="alert">
        Could not load your entities: {error}
      </p>
    );
  }
  if (!data) return <p className="lead">Loading…</p>;

  if (tab === "people") {
    return (
      <>
        {nav}
        <Members organisationId={organisation.id} role={role} />
      </>
    );
  }

  if (tab === "meetings") {
    return (
      <>
        {nav}
        {meetingId ? (
          <MeetingPage
            key={meetingId}
            organisationId={organisation.id}
            meetingId={meetingId}
            role={role}
            userId={userId}
            onBack={() => setMeetingId(null)}
          />
        ) : (
          <Meetings
            organisationId={organisation.id}
            group={data}
            canWrite={BOARD_WRITE_ROLES.includes(role)}
            onOpen={setMeetingId}
          />
        )}
      </>
    );
  }

  const open = entityId ? data.entities.find((e) => e.id === entityId) : undefined;
  if (open) {
    return (
      <>
        {nav}
        <EntityDetail
          key={open.id}
          organisationId={organisation.id}
          entity={open}
          data={data}
          canEdit={canEdit}
          reload={reload}
          onBack={() => setEntityId(null)}
        />
      </>
    );
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter the entity's name.");
    setBusy(true);
    try {
      const created = await createEntity(organisation.id, name);
      setName("");
      await reload();
      openEntity(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the entity.");
    } finally {
      setBusy(false);
    }
  }

  async function snooze(id: string) {
    try {
      await setPrompt(organisation.id, id, CHECKIN_KEY, "snoozed", new Date(Date.now() + WEEK_MS));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    }
  }

  const checkIn = canEdit ? dueCheckIns(data).find((e) => !visited.includes(e.id)) : undefined;
  const passed = assurance?.decisions.filter((d) => d.outcome === "passed") ?? [];

  return (
    <>
      {nav}
      <p className="eyebrow">Director assurance view</p>
      <h1>{organisation.name}</h1>
      <dl className="facts">
        <div>
          <dt>Your role</dt>
          <dd className="capitalise">{role}</dd>
        </div>
        <div>
          <dt>Tier</dt>
          <dd className="capitalise">{organisation.tier}</dd>
        </div>
        <div>
          <dt>Entities</dt>
          <dd>{data.entities.length}</dd>
        </div>
      </dl>

      {checkIn && (
        <section className="card checkin" aria-label="Reminder">
          <p>
            You started telling us about <strong>{checkIn.name}</strong>. Do you want to complete its details?
          </p>
          <div className="row">
            <button type="button" onClick={() => openEntity(checkIn.id)}>
              Continue
            </button>
            <button type="button" className="quiet" onClick={() => void snooze(checkIn.id)}>
              Not now
            </button>
          </div>
        </section>
      )}

      <div className="tiles block">
        <section className="card">
          <h2>Decisions on record</h2>
          <p className="big-number">{assurance ? passed.length : "–"}</p>
          {passed.length === 0 ? (
            <p>Resolutions appear here once a meeting's minutes are locked.</p>
          ) : (
            <ul className="plain">
              {passed.slice(0, 3).map((d) => (
                <li key={d.id}>
                  {d.text} <span className="muted">· {formatDay(d.meeting.scheduled_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Open actions</h2>
          <p className="big-number">{assurance ? assurance.openActions : "–"}</p>
          <p>
            {assurance && assurance.overdueActions > 0 ? (
              <strong className="warning-text">{assurance.overdueActions} overdue</strong>
            ) : (
              "None overdue"
            )}
          </p>
        </section>
        <section className="card">
          <h2>Obligations status</h2>
          <p className="status-unknown">Unknown</p>
          <p>No obligations are recorded yet, so nothing is reported as on track.</p>
        </section>
      </div>

      <section className="block">
        <h2>Group structure</h2>
        {data.entities.length === 0 ? (
          <p className="muted">No entities yet. Add your first company below; a name is enough to start.</p>
        ) : (
          <>
            <GroupChart data={data} onOpen={openEntity} />
            <ul className="entity-list">
              {data.entities.map((entity) => {
                const p = progress(data, entity);
                return (
                  <li key={entity.id}>
                    <button type="button" className="entity-row" onClick={() => openEntity(entity.id)}>
                      <span className="entity-name">{entity.name}</span>
                      <span className={p.queue.length ? "muted" : undefined}>
                        {p.answered} of {p.total} details
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {canEdit && (
          <form className="card form" onSubmit={add}>
            <label htmlFor="entity-name">Add an entity</label>
            <div className="row">
              <input
                id="entity-name"
                className="grow"
                placeholder="Company name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </section>
    </>
  );
}
