import { labelled, nameList, people, usePresence } from "./presence";
import { has, roleLabels } from "./roles";
import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import Authority from "./Authority";
import Contracts from "./Contracts";
import Declarations from "./Declarations";
import Training from "./Training";
import Workflows from "./Workflows";
import Policies from "./Policies";
import Employees, { type EmployeesSub } from "./Employees";
import KeyContracts from "./KeyContracts";
import Disputes from "./Disputes";
import Sanctions from "./Sanctions";
import LegalAudit from "./LegalAudit";
import IpRegister from "./IpRegister";
import SpeakUp from "./SpeakUp";
import Expenses from "./Expenses";
import Horizon from "./Horizon";
import ModernSlavery from "./ModernSlavery";
import RiskRegister from "./RiskRegister";
import ForYou from "./ForYou";
import Report from "./Report";
import { loadInbox, type InboxItem } from "./inbox";
import { loadPolicySummary, type PolicySummary } from "./policies";
import { loadSpeakUpSummary, type SpeakUpSummary } from "./speakup";
import { loadExpenseSummary, type ExpenseSummary } from "./expenses";
import { loadWorkflowSummary, type WorkflowSummary } from "./workflows";
import { loadTrainingSummary, today, type TrainingSummary } from "./training";
import { formatDay, loadAssurance, type AssuranceSummary } from "./board";
import { CHECKIN_KEY, dueCheckIns, progress } from "./checks";
import { createEntity, loadGroup, setPrompt } from "./data";
import Authorities from "./Authorities";
import CompanyInfo from "./CompanyInfo";
import Conflicts from "./Conflicts";
import Insurance from "./Insurance";
import EntityDetail from "./EntityDetail";
import Intercompany from "./Intercompany";
import GroupChart from "./GroupChart";
import MeetingPage from "./MeetingPage";
import Meetings from "./Meetings";
import Members from "./Members";
import CompanyRegister from "./CompanyRegister";
import ComplianceCalendar from "./ComplianceCalendar";
import Ownership from "./Ownership";
import Whs from "./Whs";
import { setPickerOrganisation } from "./PersonPicker";
import Privacy from "./Privacy";
import AntiBribery from "./AntiBribery";
import Confidential from "./Confidential";
import MergerControl from "./MergerControl";
import { ClimateReporting, ConsumerLaw, EmploymentLaw } from "./RegulatoryPages";
import Parties from "./Parties";
import { loadPartySummary, type PartySummary } from "./parties";
import Register from "./Register";
import { loadRiskSummary, type RiskSummary } from "./risk";
import { day as insDay, loadInsuranceSummary, type InsuranceSummary } from "./insurance";
import type { GroupData, Membership } from "./types";

const RECORDS_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];
const BOARD_WRITE_ROLES = ["owner", "admin", "secretary"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Tab =
  | "overview" | "company" | "authorities" | "insurance" | "foryou" | "report" | "modernslavery" | "oldregister" | "meetings" | "register" | "policies" | "training" | "workflows" | "horizon"
  | "contracts" | "intercompany" | "parties" | "authority" | "declarations" | "conflicts" | "expenses" | "speakup" | "people" | "keyemployees" | "keycontracts" | "disputes" | "sanctions" | "legalaudit" | "ip" | "ownership" | "companyregister" | "calendar" | "whs" | "privacy" | "abc" | "employment" | "consumer" | "climate" | "mergers" | "confidential";
const SECTIONS = ["Company", "Board", "Risk and compliance", "Contracts", "Third parties", "Conduct"] as const;
const TABS: { id: Tab; label: string; section?: (typeof SECTIONS)[number] }[] = [
  { id: "foryou", label: "For you" },
  { id: "overview", label: "Overview" },
  { id: "confidential", label: "Confidential projects" },
  { id: "company", label: "Company Info", section: "Company" },
  { id: "ownership", label: "Ownership", section: "Company" },
  { id: "companyregister", label: "Company register", section: "Company" },
  { id: "insurance", label: "Insurance", section: "Company" },
  { id: "keyemployees", label: "Employees", section: "Company" },
  { id: "ip", label: "IP Register", section: "Company" },
  { id: "meetings", label: "Meetings", section: "Board" },
  { id: "report", label: "Board report", section: "Board" },
  { id: "people", label: "Appointments", section: "Board" },
  { id: "authorities", label: "Authorities", section: "Board" },
  { id: "calendar", label: "Compliance calendar", section: "Risk and compliance" },
  { id: "register", label: "Risk Register", section: "Risk and compliance" },
  { id: "whs", label: "Work health and safety", section: "Risk and compliance" },
  { id: "privacy", label: "Privacy and cyber", section: "Risk and compliance" },
  { id: "abc", label: "Anti-bribery", section: "Risk and compliance" },
  { id: "employment", label: "Employment law", section: "Risk and compliance" },
  { id: "consumer", label: "Consumer law", section: "Risk and compliance" },
  { id: "climate", label: "Climate reporting", section: "Risk and compliance" },
  { id: "mergers", label: "Merger control", section: "Risk and compliance" },
  { id: "oldregister", label: "(Old Register)", section: "Risk and compliance" },
  { id: "policies", label: "Policies", section: "Risk and compliance" },
  { id: "modernslavery", label: "Modern slavery", section: "Risk and compliance" },
  { id: "training", label: "Training", section: "Risk and compliance" },
  { id: "legalaudit", label: "Legal Audit", section: "Risk and compliance" },
  { id: "workflows", label: "Workflows", section: "Risk and compliance" },
  { id: "horizon", label: "Horizon", section: "Risk and compliance" },
  { id: "contracts", label: "Contract Management", section: "Contracts" },
  { id: "keycontracts", label: "Key Contracts", section: "Contracts" },
  { id: "intercompany", label: "Intercompany", section: "Contracts" },
  { id: "sanctions", label: "Sanctions", section: "Contracts" },
  { id: "authority", label: "(Old Authority)", section: "Contracts" },
  { id: "parties", label: "Due Diligence", section: "Third parties" },
  { id: "disputes", label: "Disputes", section: "Third parties" },
  { id: "declarations", label: "Gifts and hospitality", section: "Conduct" },
  { id: "conflicts", label: "Conflicts of interest", section: "Conduct" },
  { id: "expenses", label: "Expenses", section: "Conduct" },
];

export default function Workspace({ membership, userId, userName, onPassword }: { membership: Membership; userId: string; userName: string; onPassword: () => void }) {
  const { organisation, role } = membership;
  setPickerOrganisation(organisation.id);
  const canEdit = has(role, ...RECORDS_ROLES);

  const [tab, setTab] = useState<Tab>("overview");
  const [trainingModule, setTrainingModule] = useState<string | null>(null);
  const [employeesSub, setEmployeesSub] = useState<EmployeesSub>("key");
  // Sections the person has opened by clicking. All start closed; the one holding the current page is marked.
  const [openSections, setOpenSections] = useState<string[]>([]);
  // Speak up is never shown to others: being seen there could identify a reporter or a handler
  const others = usePresence(organisation.id, userId, userName, tab === "speakup" || (tab === "keyemployees" && employeesSub === "investigations") ? null : tab);
  const [data, setData] = useState<GroupData | null>(null);
  const [assurance, setAssurance] = useState<AssuranceSummary | null>(null);
  const [riskSummary, setRiskSummary] = useState<RiskSummary | null>(null);
  const [insurance, setInsurance] = useState<InsuranceSummary | null>(null);
  const [partySummary, setPartySummary] = useState<PartySummary | null>(null);
  const [trainingSummary, setTrainingSummary] = useState<TrainingSummary | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<WorkflowSummary | null>(null);
  const [policySummary, setPolicySummary] = useState<PolicySummary | null>(null);
  const [speakUpSummary, setSpeakUpSummary] = useState<SpeakUpSummary | null>(null);
  const [expenseSummary, setExpenseSummary] = useState<ExpenseSummary | null>(null);
  const [inbox, setInbox] = useState<InboxItem[] | null>(null);
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
    void loadRiskSummary(organisation.id).then(setRiskSummary, () => setRiskSummary(null));
    void loadInsuranceSummary(organisation.id).then(setInsurance, () => setInsurance(null));
    void loadPartySummary(organisation.id).then(setPartySummary);
    void loadTrainingSummary(organisation.id).then(setTrainingSummary, () => setTrainingSummary(null));
    void loadWorkflowSummary(organisation.id, today()).then(setWorkflowSummary, () => setWorkflowSummary(null));
    void loadPolicySummary(organisation.id, today()).then(setPolicySummary, () => setPolicySummary(null));
    void loadSpeakUpSummary(organisation.id).then(setSpeakUpSummary, () => setSpeakUpSummary(null));
    void loadExpenseSummary(organisation.id).then(setExpenseSummary, () => setExpenseSummary(null));
  }, [onOverview, organisation.id]);

  // Refreshed on every change of section, so the count in the menu stays current
  useEffect(() => {
    let live = true;
    loadInbox(organisation.id, role, userId).then(
      (items) => live && setInbox(items),
      () => live && setInbox([]),
    );
    return () => {
      live = false;
    };
  }, [organisation.id, role, userId, tab]);

  const openEntity = (id: string) => {
    setVisited((v) => (v.includes(id) ? v : [...v, id]));
    setEntityId(id);
  };

  const go = (next: Tab) => {
    // Investigations live under Company, Employees
    setEmployeesSub(next === "speakup" ? "investigations" : "key");
    setTab(next === "speakup" ? "keyemployees" : next);
    setTrainingModule(null);
    setEntityId(null);
    setMeetingId(null);
    setContractId(null);
  };

  const dot = (list: typeof others) =>
    list.length > 0 && <span className={people(list).every((o) => o.idle) ? "presence-dot idle" : "presence-dot"} role="img" aria-label={`${labelled(list)} ${people(list).length === 1 ? "is" : "are"} here`} title={labelled(list)} />;
  const item = (t: (typeof TABS)[number]) => {
    const here = t.id === "speakup" ? [] : others.filter((o) => o.tab === t.id);
    return (
      <Fragment key={t.id}>
        <button type="button" className={tab === t.id ? "tab on" : "tab"} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
          {t.label}
          {t.id === "foryou" && inbox && inbox.length > 0 && <span className="nav-count">{inbox.length}</span>}
          {dot(here)}
        </button>
        {tab === t.id && here.length > 0 && (
          <span className="presence-here">
            {people(here).every((o) => o.idle)
              ? `${nameList(people(here).map((o) => o.name))} ${people(here).length === 1 ? "has" : "have"} this tab open but ${people(here).length === 1 ? "has" : "have"} been inactive for 15 minutes or more`
              : `${labelled(here)} ${people(here).length === 1 ? "is" : "are"} also working on this tab`}
          </span>
        )}
      </Fragment>
    );
  };
  const nav = (
    <nav className="side-nav" aria-label="Sections">
      {others.length > 0 && (
        <p className="presence" role="status">
          <span className={people(others).every((o) => o.idle) ? "presence-dot idle" : "presence-dot"} aria-hidden="true" />
          Also online: {labelled(others)}
        </p>
      )}
      <div className="nav-section solo">{item(TABS.find((t) => t.id === "foryou")!)}</div>
      <div className="nav-section solo">{item(TABS.find((t) => t.id === "overview")!)}</div>
      {SECTIONS.map((section) => {
        const items = TABS.filter((t) => t.section === section);
        const current = items.some((t) => t.id === tab);
        const isOpen = openSections.includes(section);
        const inside = others.filter((o) => o.tab !== "speakup" && items.some((t) => t.id === o.tab));
        return (
          <div key={section} className={isOpen ? "nav-section open" : "nav-section"}>
            <button
              type="button"
              className={current ? "nav-head on" : "nav-head"}
              aria-expanded={isOpen}
              onClick={() => setOpenSections((list) => (list.includes(section) ? list.filter((x) => x !== section) : [...list, section]))}
            >
              {section}
              {!isOpen && dot(inside)}
            </button>
            <div className="nav-items">{items.map(item)}</div>
          </div>
        );
      })}
      <div className="nav-section solo">{item(TABS.find((t) => t.id === "confidential")!)}</div>
      <div className={openSections.includes("Settings") ? "nav-section open" : "nav-section"}>
        <button type="button" className="nav-head" aria-expanded={openSections.includes("Settings")} onClick={() => setOpenSections((list) => (list.includes("Settings") ? list.filter((x) => x !== "Settings") : [...list, "Settings"]))}>
          Settings
        </button>
        <div className="nav-items">
          <button type="button" className="tab" onClick={onPassword}>
            Password
          </button>
        </div>
      </div>
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

  if (tab === "conflicts") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Conflicts organisationId={organisation.id} role={role} userId={userId} entities={data.entities} />
        </div>
      </div>
    );
  }

  if (tab === "keyemployees" || tab === "keycontracts" || tab === "disputes") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          {tab === "keyemployees" ? (
            <Employees organisationId={organisation.id} role={role} group={data} canEdit={canEdit} sub={employeesSub} onSub={setEmployeesSub} />
          ) : tab === "keycontracts" ? (
            <KeyContracts organisationId={organisation.id} group={data} canEdit={canEdit} />
          ) : (
            <Disputes organisationId={organisation.id} group={data} canEdit={canEdit} />
          )}
        </div>
      </div>
    );
  }

  if (tab === "ip") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <IpRegister organisationId={organisation.id} role={role} userId={userId} group={data} />
        </div>
      </div>
    );
  }

  if (tab === "legalaudit") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <LegalAudit organisationId={organisation.id} role={role} group={data} />
        </div>
      </div>
    );
  }

  if (tab === "sanctions") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Sanctions organisationId={organisation.id} role={role} userId={userId} group={data} />
        </div>
      </div>
    );
  }

  if (tab === "insurance") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Insurance organisationId={organisation.id} organisationName={organisation.name} group={data} canEdit={canEdit} userId={userId} />
        </div>
      </div>
    );
  }

  const addEntityForm = (
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
  );

  // Take them to the Add an entity form at the top of Company Info
  const addEntityJump = () => {
    go("company");
    setTimeout(() => { const f = document.getElementById("entity-name"); f?.scrollIntoView({ block: "center" }); f?.focus(); }, 50);
  };

  if (tab === "authorities") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Authorities organisationId={organisation.id} entities={data.entities} group={data} canEdit={canEdit} />
        </div>
      </div>
    );
  }

  if (tab === "company" && !entityId) {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <CompanyInfo data={data} canEdit={canEdit} onOpen={openEntity} addSlot={canEdit ? addEntityForm : null} />
        </div>
      </div>
    );
  }

  if (tab === "calendar") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <ComplianceCalendar organisationId={organisation.id} organisationName={organisation.name} group={data} canEdit={canEdit} userId={userId} onOpen={(t) => go(t as Tab)} />
        </div>
      </div>
    );
  }

  if (tab === "confidential") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Confidential organisationId={organisation.id} organisationName={organisation.name} userId={userId} group={data} />
        </div>
      </div>
    );
  }

  if (tab === "employment" || tab === "consumer" || tab === "climate" || tab === "mergers") {
    const Page = tab === "employment" ? EmploymentLaw : tab === "consumer" ? ConsumerLaw : ClimateReporting;
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          {tab === "mergers" ? (
            <MergerControl organisationId={organisation.id} role={role} group={data} />
          ) : (
            <Page key={tab} organisationId={organisation.id} role={role} userId={userId} group={data} onOpen={(t) => go(t as Tab)} />
          )}
        </div>
      </div>
    );
  }

  if (tab === "abc") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <AntiBribery organisationId={organisation.id} role={role} userId={userId} onOpen={(t) => go(t as Tab)} />
        </div>
      </div>
    );
  }

  if (tab === "privacy") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Privacy organisationId={organisation.id} organisationName={organisation.name} role={role} userId={userId} group={data} />
        </div>
      </div>
    );
  }

  if (tab === "whs") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Whs organisationId={organisation.id} role={role} userId={userId} group={data} />
        </div>
      </div>
    );
  }

  if (tab === "companyregister") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <CompanyRegister organisationId={organisation.id} group={data} canEdit={canEdit} onChanged={reload} onAddEntity={addEntityJump} />
        </div>
      </div>
    );
  }

  if (tab === "ownership") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
          <Ownership organisationId={organisation.id} group={data} canEdit={canEdit} onChanged={reload} onAddEntity={addEntityJump} />
        </div>
      </div>
    );
  }

  if (tab === "people") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Members organisationId={organisation.id} role={role} organisationName={organisation.name} />
        </div>
      </div>
    );
  }

  if (tab === "oldregister") {
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
        <Parties organisationId={organisation.id} role={role} userId={userId} />
        </div>
      </div>
    );
  }

  if (tab === "policies") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Policies organisationId={organisation.id} organisationName={organisation.name} role={role} userId={userId} onOpenTraining={(id) => { go("training"); setTrainingModule(id); }} />
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

  if (tab === "foryou") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <ForYou items={inbox} organisationId={organisation.id} userId={userId} onOpen={(t) => go(t as Tab)} onChanged={() => void loadInbox(organisation.id, role, userId).then(setInbox, () => undefined)} />
        </div>
      </div>
    );
  }

  if (tab === "report") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Report organisationId={organisation.id} organisationName={organisation.name} />
        </div>
      </div>
    );
  }

  if (tab === "modernslavery") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <ModernSlavery organisationId={organisation.id} organisationName={organisation.name} role={role} entities={data?.entities ?? []} />
        </div>
      </div>
    );
  }

  if (tab === "register") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <RiskRegister organisationId={organisation.id} organisationName={organisation.name} role={role} userId={userId} />
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
        <Training key={trainingModule ?? "home"} organisationId={organisation.id} organisationName={organisation.name} role={role} userId={userId} initialModuleId={trainingModule} />
        </div>
      </div>
    );
  }

  if (tab === "declarations") {
    return (
      <div className="workspace">
        {nav}
        <div className="workspace-main">
        <Declarations organisationId={organisation.id} role={role} userId={userId} />
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
            canWrite={has(role, ...BOARD_WRITE_ROLES)}
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
          <dd>{roleLabels(role)}</dd>
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
          <h2>Insurance</h2>
          {!insurance || insurance.current + insurance.expired === 0 ? (
            <>
              <p className="status-unknown">Unknown</p>
              <p>No insurance policies are recorded, so cover cannot be confirmed.</p>
            </>
          ) : (
            <>
              <p className="status-unknown">{insurance.expired > 0 ? "Attention" : insurance.expiringSoon > 0 ? "Renewals due" : "Current"}</p>
              <p>
                {insurance.current} current {insurance.current === 1 ? "policy" : "policies"}
                {insurance.expired > 0 ? <> · <strong className="warning-text">{insurance.expired} expired</strong></> : ""}
                {insurance.expiringSoon > 0 ? ` · ${insurance.expiringSoon} expiring within 3 months` : ""}
                {insurance.withoutCertificate > 0 ? ` · ${insurance.withoutCertificate} without a certificate of currency` : ""}
                {insurance.nextExpiry ? ` · next expiry ${insurance.nextExpiry.policy_type}, ${insDay(insurance.nextExpiry.period_to)}` : ""}
              </p>
              <button type="button" className="link-dark" onClick={() => go("insurance")}>
                Open Insurance
              </button>
            </>
          )}
        </section>
        <section className="card">
          <h2>Risk review</h2>
          {!riskSummary || !riskSummary.review ? (
            <>
              <p className="status-unknown">Unknown</p>
              <p>No risk review has been run, so nothing is reported.</p>
            </>
          ) : (
            <>
              <p className="status-unknown">{riskSummary.review.status === "final" ? "Final" : "In progress"}</p>
              <p>
                {riskSummary.review.name}
                {riskSummary.review.status !== "final" && riskSummary.awaiting > 0 ? ` · ${riskSummary.awaiting} categories awaiting input` : ""} · {riskSummary.openActions} open actions ·{" "}
                {riskSummary.overdueActions > 0 ? <strong className="warning-text">{riskSummary.overdueActions} overdue</strong> : "none overdue"}
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
        {canEdit && data.entities.length === 0 && addEntityForm}
      </section>
      </div>
    </div>
  );
}
