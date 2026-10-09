import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import Authority from "./Authority";
import Contracts from "./Contracts";
import Declarations from "./Declarations";
import Training from "./Training";
import Workflows from "./Workflows";
import Policies from "./Policies";
import SpeakUp from "./SpeakUp";
import Expenses from "./Expenses";
import Horizon from "./Horizon";
import { loadPolicySummary, type PolicySummary } from "./policies";
import { loadSpeakUpSummary, type SpeakUpSummary } from "./speakup";
import { loadExpenseSummary, type ExpenseSummary } from "./expenses";
import { loadWorkflowSummary, type WorkflowSummary } from "./workflows";
import { loadTrainingSummary, today, type TrainingSummary } from "./training";
import { formatDay, loadAssurance, type AssuranceSummary } from "./board";
import { CHECKIN_KEY, dueCheckIns, progress } from "./checks";
import { createEntity, loadGroup, setPrompt } from "./data";
import EntityDetail from "./EntityDetail";
import Intercompany from "./Intercompany";
import GroupChart from "./GroupChart";
import MeetingPage from "./MeetingPage";
import Meetings from "./Meetings";
import Members from "./Members";
import Parties from "./Parties";
import { loadPartySummary, type PartySummary } from "./parties";
import Register from "./Register";
import { loadRegisterSummary, type RegisterSummary } from "./register";
import type { GroupData, Membership } from "./types";

const RECORDS_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const BOARD_WRITE_ROLES = ["owner", "admin", "secretary"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Tab =
  | "overview" | "meetings" | "register" | "policies" | "training" | "workflows" | "horizon"
  | "contracts" | "intercompany" | "parties" | "authority" | "declarations" | "expenses" | "speakup" | "people";
const TABS: { id: Tab; label: string; group?: string }[] = [
  { id: "overview", label: "Overview", group: "Board" },
  { id: "meetings", label: "Meetings" },
  { id: "register", label: "Register", group: "Risk and compliance" },
  { id: "policies", label: "Policies" },
  { id: "training", label: "Training" },
  { id: "workflows", label: "Workflows" },
  { id: "horizon", label: "Horizon" },
  { id: "contracts", label: "Contracts", group: "Contracts and third parties" },
  { id: "intercompany", label: "Intercompany" },
  { id: "parties", label: "Third parties" },
  { id: "authority", label: "Authority" },
  { id: "declarations", label: "Declarations", group: "Conduct" },
  { id: "expenses", label: "Expenses" },
  { id: "speakup", label: "Speak up" },
  { id: "people", label: "People", group: "Setup" },
];

export default function Workspace({ membership, userId }: { membership: Membership; userId: string }) {
  const { organisation, role } = membership;
  const canEdit = RECORDS_ROLES.includes(role);

  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<GroupData | null>(null);
  const [assurance, setAssurance] = useState<AssuranceSummary | null>(null);
  const [registerSummary, setRegisterSummary] = useState<RegisterSummary | null>(null);
  const [partySummary, setPartySummary] = useState<PartySummary | null>(null);
  const [trainingSummary, setTrainingSummary] = useState<TrainingSummary | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<WorkflowSummary | null>(null);
  const [policySummary, setPolicySummary] = useState<PolicySummary | null>(null);
  const [speakUpSummary, setSpeakUpSummary] = useState<SpeakUpSummary | null>(null);
  const [expenseSummary, setExpenseSummary] = useState<ExpenseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
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
    void loadRegisterSummary(organisation.id).then(setRegisterSummary);
    void loadPartySummary(organisation.id).then(setPartySummary);
    void loadTrainingSummary(organisation.id).then(setTrainingSummary, () => setTrainingSummary(null));
    void loadWorkflowSummary(organisation.id, today()).then(setWorkflowSummary, () => setWorkflowSummary(null));
    void loadPolicySummary(organisation.id, today()).then(setPolicySummary, () => setPolicySummary(null));
    void loadSpeakUpSummary(organisation.id).then(setSpeakUpSummary, () => setSpeakUpSummary(null));
    void loadExpenseSummary(organisation.id).then(setExpenseSummary, () => setExpenseSummary(null));
  }, [onOverview, organisation.id]);

  const openEntity = (id: string) => {
    setVisited((v) => (v.includes(id) ? v : [...v, id]));
    setEntityId(id);
  };

  const go = (next: Tab) => {
    setTab(next);
    setEntityId(null);
    setMeetingId(null);
    setContractId(null);
  };

  const nav = (
    <nav className="side-nav" aria-label="Sections">
      {TABS.map((t) => (
        <Fragment key={t.id}>
          {t.group && <span className="nav-group">{t.group}</span>}
          <button
            type="button"
            className={tab === t.id ? "tab on" : "tab"}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => go(t.id)}
          >
            {t.label}
          </button>
        </Fragment>
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
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Members organisationId={organisation.id} role={role} />
        </div>
      </div>
    );
  }

  if (tab === "register") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Register organisation={organisation} group={data} role={role} reloadGroup={reload} />
        </div>
      </div>
    );
  }

  if (tab === "parties") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Parties organisationId={organisation.id} role={role} />
        </div>
      </div>
    );
  }

  if (tab === "policies") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Policies organisationId={organisation.id} role={role} userId={userId} />
        </div>
      </div>
    );
  }

  if (tab === "speakup") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <SpeakUp organisationId={organisation.id} role={role} />
        </div>
      </div>
    );
  }

  if (tab === "expenses") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Expenses organisationId={organisation.id} role={role} userId={userId} entities={data?.entities ?? []} />
        </div>
      </div>
    );
  }

  if (tab === "horizon") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Horizon canManage={canEdit} onOpenWorkflows={() => go("workflows")} />
        </div>
      </div>
    );
  }

  if (tab === "workflows") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Workflows organisationId={organisation.id} role={role} entities={data?.entities ?? []} />
        </div>
      </div>
    );
  }

  if (tab === "training") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Training organisationId={organisation.id} role={role} userId={userId} />
        </div>
      </div>
    );
  }

  if (tab === "declarations") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Declarations organisationId={organisation.id} role={role} />
        </div>
      </div>
    );
  }

  if (tab === "intercompany") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Intercompany
            organisation={organisation}
            group={data}
            role={role}
            onOpenContract={(id) => {
              setContractId(id);
              setTab("contracts");
            }}
          />
        </div>
      </div>
    );
  }

  if (tab === "contracts") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Contracts key={contractId ?? "list"} organisationId={organisation.id} group={data} role={role} initialOpenId={contractId} />
        </div>
      </div>
    );
  }

  if (tab === "authority") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Authority organisationId={organisation.id} group={data} canEdit={canEdit} />
        </div>
      </div>
    );
  }

  if (tab === "meetings") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
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
        </div>
      </div>
    );
  }

  const open = entityId ? data.entities.find((e) => e.id === entityId) : undefined;
  if (open) {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <EntityDetail
          key={open.id}
          organisationId={organisation.id}
          entity={open}
          data={data}
          canEdit={canEdit}
          reload={reload}
          onBack={() => setEntityId(null)}
        />
        </div>
      </div>
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
    <div className="workspace">
      {nav}
      <div className="workspace-main">
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
          <h2>Authority exceptions</h2>
          <p className="big-number">{assurance ? assurance.exceptions : "–"}</p>
          <p>
            {assurance && assurance.exceptions > 0 ? (
              <strong className="warning-text">Contracts signed out of process</strong>
            ) : (
              "No contracts signed out of process"
            )}
          </p>
        </section>
        <section className="card">
          <h2>High-risk third parties</h2>
          <p className="big-number">{partySummary ? partySummary.highRisk : "–"}</p>
          <p>
            {partySummary && (partySummary.open > 0 || partySummary.rejected > 0) ? (
              <>
                {partySummary.open} with due diligence open · {partySummary.rejected} rejected
              </>
            ) : (
              "No due diligence open"
            )}
          </p>
        </section>
        <section className="card">
          <h2>Obligations status</h2>
          {!registerSummary || registerSummary.active === 0 ? (
            <>
              <p className="status-unknown">Unknown</p>
              <p>
                {registerSummary && registerSummary.proposed > 0
                  ? `${registerSummary.proposed} suggested entries are waiting to be confirmed.`
                  : "Nothing is confirmed on the register yet, so nothing is reported as on track."}
              </p>
            </>
          ) : (
            <>
              <p className="status-unknown">
                {registerSummary.overdue > 0 ? "Overdue" : registerSummary.withGaps > 0 ? "Needs attention" : "On track"}
              </p>
              <p>
                {registerSummary.active} confirmed · {registerSummary.overdue} overdue for review ·{" "}
                {registerSummary.withGaps} with ownership gaps
              </p>
            </>
          )}
        </section>
        <section className="card">
          <h2>Training</h2>
          {!trainingSummary || trainingSummary.assigned === 0 ? (
            <>
              <p className="status-unknown">Unknown</p>
              <p>No training is assigned yet, so nothing is reported as complete.</p>
            </>
          ) : (
            <>
              <p className="big-number">
                {trainingSummary.complete} of {trainingSummary.assigned}
              </p>
              <p>
                {trainingSummary.overdue > 0 ? (
                  <strong className="warning-text">{trainingSummary.overdue} overdue</strong>
                ) : (
                  "Assignments complete · none overdue"
                )}
              </p>
            </>
          )}
        </section>
        <section className="card">
          <h2>Workflow steps open</h2>
          <p className="big-number">{workflowSummary ? workflowSummary.open : "–"}</p>
          <p>
            {workflowSummary && workflowSummary.overdue > 0 ? (
              <strong className="warning-text">{workflowSummary.overdue} overdue</strong>
            ) : (
              "None overdue"
            )}
          </p>
        </section>
        <section className="card">
          <h2>Policies</h2>
          {!policySummary || policySummary.inForce + policySummary.draftOnly === 0 ? (
            <>
              <p className="status-unknown">Unknown</p>
              <p>No policies are recorded yet.</p>
            </>
          ) : (
            <>
              <p className="big-number">{policySummary.inForce}</p>
              <p>
                In force ·{" "}
                {policySummary.overdue > 0 ? <strong className="warning-text">{policySummary.overdue} overdue for review</strong> : "none overdue for review"}
                {policySummary.draftOnly > 0 ? ` · ${policySummary.draftOnly} not yet approved` : ""}
              </p>
            </>
          )}
        </section>
        <section className="card">
          <h2>Speak-up reports</h2>
          {!speakUpSummary ? (
            <>
              <p className="big-number">–</p>
              <p>Numbers are shown to directors and the compliance team.</p>
            </>
          ) : speakUpSummary.recipients === 0 ? (
            <>
              <p className="status-unknown">Unknown</p>
              <p>Nobody is appointed to receive reports, so none can be made.</p>
            </>
          ) : (
            <>
              <p className="big-number">{speakUpSummary.open}</p>
              <p>
                Open ·{" "}
                {speakUpSummary.open_over_90_days > 0 ? (
                  <strong className="warning-text">{speakUpSummary.open_over_90_days} open more than 90 days</strong>
                ) : (
                  "none open more than 90 days"
                )}{" "}
                · {speakUpSummary.received_12_months} received and {speakUpSummary.substantiated_12_months} substantiated in 12 months
              </p>
            </>
          )}
        </section>
        <section className="card">
          <h2>Expense claims waiting</h2>
          <p className="big-number">{expenseSummary ? expenseSummary.awaiting : "–"}</p>
          <p>Awaiting a decision</p>
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
      </div>
    </div>
  );
}
