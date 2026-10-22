import { useCallback, useEffect, useState } from "react";
import Attachments from "./Attachments";
import { formatDay } from "./board";
import {
  addRule,
  addTools,
  CATEGORIES,
  DATA_ALLOWED,
  deleteProject,
  deleteRule,
  deleteTool,
  guessTool,
  loadAi,
  PROJECT_STATUS,
  RISK_LEVEL,
  saveProject,
  saveTool,
  SUGGESTED_RULES,
  TOOL_STATUS,
  type AiData,
  type AiProject,
  type AiRule,
  type AiTool,
} from "./aiRegister";

type Props = { organisationId: string; canEdit: boolean; tier: string; entities: { id: string; name: string }[] };

const today = () => new Date().toLocaleDateString("en-CA");

/** AI register: which AI tools may be used and how, and the AI the business is building */
export default function AiRegister({ organisationId, canEdit, tier, entities }: Props) {
  const [data, setData] = useState<AiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState("");
  const [newStatus, setNewStatus] = useState("approved");
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [project, setProject] = useState<Partial<AiProject> | null>(null);
  const projectsOn = tier !== "small";

  const reload = useCallback(async () => setData(await loadAi(organisationId)), [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the AI register."));
  }, [reload]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="lead">Loading…</p>;

  const rulesFor = (toolId: string | null, kind: "approved" | "prohibited") => data.rules.filter((r) => r.tool_id === toolId && r.kind === kind);
  const dueReview = (t: { review_on: string | null; status: string }) => t.review_on && t.review_on <= today() && t.status !== "retired" && t.status !== "prohibited";
  const general = { approved: rulesFor(null, "approved"), prohibited: rulesFor(null, "prohibited") };
  const suggestions = SUGGESTED_RULES.filter((s) => !data.rules.some((r) => r.tool_id === null && r.text.toLowerCase() === s.text.toLowerCase()));

  async function addLinks() {
    const parts = [...new Set(links.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
    const guessed = parts.map((p) => [p, guessTool(p)] as const);
    const bad = guessed.filter(([, g]) => !g).map(([p]) => p);
    if (!parts.length) return setError("Paste at least one link.");
    if (bad.length) return setError(`These are not web addresses: ${bad.join(", ")}`);
    const fresh = guessed.map(([, g]) => g!).filter((g) => !data!.tools.some((t) => t.name.toLowerCase() === g.name.toLowerCase()));
    if (!fresh.length) return setError("Those tools are already in the register.");
    if (await run(() => addTools(organisationId, fresh, newStatus))) setLinks("");
  }

  return (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>AI register</h1>
      <p className="lead">Which AI tools people may use, for what, and what is off limits. Plus the AI the business is building itself.</p>

      <div className="stat-row">
        <span className="stat"><strong>{data.tools.filter((t) => t.status === "approved" || t.status === "limited").length}</strong> approved tools</span>
        <span className="stat"><strong>{data.tools.filter((t) => t.status === "prohibited").length}</strong> not allowed</span>
        <span className="stat"><strong>{data.tools.filter(dueReview).length}</strong> due for review</span>
        {projectsOn && <span className="stat"><strong>{data.projects.filter((p) => p.status !== "retired").length}</strong> AI projects</span>}
      </div>

      <section className="block">
        <h2>Rules for every AI tool</h2>
        <div className="two-col">
          <RuleList title="Approved uses" kind="approved" rules={general.approved} canEdit={canEdit} busy={busy}
            onAdd={(t) => void run(() => addRule(organisationId, null, "approved", t, general.approved.length))}
            onDelete={(id) => void run(() => deleteRule(id))} />
          <RuleList title="Prohibited uses" kind="prohibited" rules={general.prohibited} canEdit={canEdit} busy={busy}
            onAdd={(t) => void run(() => addRule(organisationId, null, "prohibited", t, general.prohibited.length))}
            onDelete={(id) => void run(() => deleteRule(id))} />
        </div>
        {canEdit && suggestions.length > 0 && (
          <div className="suggest">
            <p className="muted small">Suggested starting points (click to add):</p>
            <div className="chip-row">
              {suggestions.map((s) => (
                <button key={s.text} type="button" className={`chip-button rule-${s.kind}`} disabled={busy}
                  onClick={() => void run(() => addRule(organisationId, null, s.kind, s.text, rulesFor(null, s.kind).length))}>
                  {s.kind === "approved" ? "✓" : "✕"} {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="block">
        <h2>AI tools</h2>
        {canEdit && (
          <div className="card form">
            <label htmlFor="ai-links">Drop in links to AI tools (one per line)</label>
            <textarea id="ai-links" rows={3} placeholder={"https://chatgpt.com\nhttps://claude.ai"} value={links} onChange={(e) => setLinks(e.target.value)} />
            <div className="row wrap">
              <span className="field">
                <label htmlFor="ai-status">Add them as</label>
                <select id="ai-status" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                  {Object.entries(TOOL_STATUS).filter(([k]) => k !== "retired").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </span>
            </div>
            <button type="button" disabled={busy} onClick={() => void addLinks()}>Add to the register</button>
          </div>
        )}
        {data.tools.length === 0 ? (
          <p className="muted">No AI tools recorded yet.</p>
        ) : (
          <ul className="plain ai-tools">
            {data.tools.map((t) => (
              <li key={t.id} className="card ai-tool">
                <div className="ai-tool-head">
                  <span>
                    <strong>{t.name}</strong>{" "}
                    <span className={`chip tool-${t.status}`}>{TOOL_STATUS[t.status]}</span>{" "}
                    {dueReview(t) && <span className="chip verdict-check">Review due</span>}
                    <br />
                    <span className="muted small">
                      {[t.vendor, CATEGORIES[t.category], t.data_allowed && DATA_ALLOWED[t.data_allowed], t.company_account ? "company account" : null, t.review_on && `review by ${formatDay(t.review_on)}`]
                        .filter(Boolean).join(" · ")}
                    </span>
                    {t.url && <><br /><a className="small" href={t.url} target="_blank" rel="noopener noreferrer">{t.url}</a></>}
                  </span>
                  <button type="button" className="quiet" onClick={() => setOpenTool(openTool === t.id ? null : t.id)} aria-expanded={openTool === t.id}>
                    {openTool === t.id ? "Close" : canEdit ? "Uses and details" : "Uses"}
                  </button>
                </div>
                {(rulesFor(t.id, "approved").length > 0 || rulesFor(t.id, "prohibited").length > 0) && openTool !== t.id && (
                  <p className="small muted">{rulesFor(t.id, "approved").length} approved and {rulesFor(t.id, "prohibited").length} prohibited uses for this tool, on top of the rules for every tool.</p>
                )}
                {openTool === t.id && (
                  <ToolDetail tool={t} canEdit={canEdit} busy={busy} approved={rulesFor(t.id, "approved")} prohibited={rulesFor(t.id, "prohibited")}
                    onSave={(patch) => void run(() => saveTool(t.id, patch))}
                    onAddRule={(kind, text) => void run(() => addRule(organisationId, t.id, kind, text, rulesFor(t.id, kind).length))}
                    onDeleteRule={(id) => void run(() => deleteRule(id))}
                    onDelete={() => { if (window.confirm(`Remove ${t.name} from the register?`)) void run(() => deleteTool(t.id)); }} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block">
        <h2>AI projects</h2>
        {!projectsOn ? (
          <p className="muted">Recording AI the business builds itself (purpose, risk, oversight and approval) comes with the Medium tier.</p>
        ) : (
          <>
            <p className="muted small">AI being built for the business: chatbots, automations, models. Record the risk, who checks it and who approved it.</p>
            {data.projects.length === 0 && !project && <p className="muted">No AI projects recorded yet.</p>}
            <ul className="entity-list">
              {data.projects.map((p) => (
                <li key={p.id}>
                  <button type="button" className="entity-row" onClick={() => setProject(p)}>
                    <span>
                      <span className="entity-name">{p.name}</span>
                      <br />
                      <span className="muted">
                        {[p.owner_name, p.models, p.personal_info ? "personal information" : null, p.decisions_about_people ? "decisions about people" : null, p.review_on && `review by ${formatDay(p.review_on)}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="row-chips">
                      {p.risk_level && <span className={`chip risk-${p.risk_level}`}>{RISK_LEVEL[p.risk_level].split(" (")[0]} risk</span>}
                      <span className="chip">{PROJECT_STATUS[p.status]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {project ? (
              <ProjectForm key={project.id ?? "new"} project={project} tools={data.tools} entities={entities} canEdit={canEdit} busy={busy}
                onCancel={() => setProject(null)}
                onSave={async (p) => { if (await run(() => saveProject(organisationId, p))) setProject(null); }}
                onDelete={project.id ? async () => { if (window.confirm("Delete this AI project?") && (await run(() => deleteProject(project.id!)))) setProject(null); } : undefined} />
            ) : (
              canEdit && <button type="button" onClick={() => setProject({ status: "idea" })}>Add an AI project</button>
            )}
          </>
        )}
      </section>
      {error && <p className="error block" role="alert">{error}</p>}
    </>
  );
}

function RuleList({ title, kind, rules, canEdit, busy, onAdd, onDelete }: {
  title: string; kind: "approved" | "prohibited"; rules: AiRule[]; canEdit: boolean; busy: boolean; onAdd: (text: string) => void; onDelete: (id: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className={`rule-list rule-${kind}`}>
      <h3>{title}</h3>
      {rules.length === 0 ? <p className="muted small">None recorded.</p> : (
        <ul className="plain">
          {rules.map((r) => (
            <li key={r.id}>
              <span aria-hidden="true">{kind === "approved" ? "✓" : "✕"}</span> {r.text}
              {canEdit && <button type="button" className="link-dark small" disabled={busy} aria-label={`Remove: ${r.text}`} onClick={() => onDelete(r.id)}> remove</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) { onAdd(text); setText(""); } }}>
          <input aria-label={`Add to ${title.toLowerCase()}`} placeholder={kind === "approved" ? "e.g. Summarising meeting notes" : "e.g. Uploading contracts"} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="quiet" disabled={busy || text.trim().length < 3}>Add</button>
        </form>
      )}
    </div>
  );
}

function ToolDetail({ tool, canEdit, busy, approved, prohibited, onSave, onAddRule, onDeleteRule, onDelete }: {
  tool: AiTool; canEdit: boolean; busy: boolean; approved: AiRule[]; prohibited: AiRule[];
  onSave: (p: Partial<AiTool>) => void; onAddRule: (kind: "approved" | "prohibited", text: string) => void; onDeleteRule: (id: string) => void; onDelete: () => void;
}) {
  const [f, setF] = useState({ ...tool });
  const set = (k: keyof AiTool) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || null });
  const id = (k: string) => `t-${tool.id}-${k}`;
  return (
    <div className="ai-tool-detail">
      <div className="two-col">
        <RuleList title="Approved uses (this tool)" kind="approved" rules={approved} canEdit={canEdit} busy={busy} onAdd={(t) => onAddRule("approved", t)} onDelete={onDeleteRule} />
        <RuleList title="Prohibited uses (this tool)" kind="prohibited" rules={prohibited} canEdit={canEdit} busy={busy} onAdd={(t) => onAddRule("prohibited", t)} onDelete={onDeleteRule} />
      </div>
      {canEdit && (
        <div className="form">
          <div className="row wrap">
            <span className="field"><label htmlFor={id("name")}>Name</label><input id={id("name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></span>
            <span className="field"><label htmlFor={id("vendor")}>Provider</label><input id={id("vendor")} value={f.vendor ?? ""} onChange={set("vendor")} /></span>
          </div>
          <label htmlFor={id("url")}>Link</label>
          <input id={id("url")} value={f.url ?? ""} onChange={set("url")} />
          <div className="row wrap">
            <span className="field"><label htmlFor={id("status")}>Status</label>
              <select id={id("status")} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {Object.entries(TOOL_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></span>
            <span className="field"><label htmlFor={id("cat")}>Kind</label>
              <select id={id("cat")} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></span>
            <span className="field"><label htmlFor={id("data")}>Most sensitive information allowed</label>
              <select id={id("data")} value={f.data_allowed ?? ""} onChange={set("data_allowed")}>
                <option value="">Not set</option>
                {Object.entries(DATA_ALLOWED).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></span>
          </div>
          <label className="check"><input type="checkbox" checked={f.company_account} onChange={(e) => setF({ ...f, company_account: e.target.checked })} /> Used through a company account (not personal sign-ups)</label>
          <div className="row wrap">
            <span className="field"><label htmlFor={id("owner")}>Owner</label><input id={id("owner")} value={f.owner_name ?? ""} onChange={set("owner_name")} /></span>
            <span className="field"><label htmlFor={id("by")}>Approved by</label><input id={id("by")} value={f.approved_by ?? ""} onChange={set("approved_by")} /></span>
            <span className="field"><label htmlFor={id("on")}>Approved on</label><input id={id("on")} type="date" value={f.approved_on ?? ""} onChange={set("approved_on")} /></span>
            <span className="field"><label htmlFor={id("rev")}>Review by</label><input id={id("rev")} type="date" value={f.review_on ?? ""} onChange={set("review_on")} /></span>
          </div>
          <label htmlFor={id("notes")}>Notes</label>
          <textarea id={id("notes")} rows={2} value={f.notes ?? ""} onChange={set("notes")} />
          <div className="row">
            <button type="button" disabled={busy || f.name.trim().length < 2} onClick={() => onSave({
              name: f.name.trim(), vendor: f.vendor, url: f.url, status: f.status, category: f.category, data_allowed: f.data_allowed, company_account: f.company_account,
              owner_name: f.owner_name, approved_by: f.approved_by, approved_on: f.approved_on, review_on: f.review_on, notes: f.notes,
            })}>Save</button>
            <button type="button" className="quiet" disabled={busy} onClick={onDelete}>Remove tool</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectForm({ project, tools, entities, canEdit, busy, onSave, onCancel, onDelete }: {
  project: Partial<AiProject>; tools: AiTool[]; entities: { id: string; name: string }[]; canEdit: boolean; busy: boolean;
  onSave: (p: Partial<AiProject>) => void; onCancel: () => void; onDelete?: () => void;
}) {
  const [f, setF] = useState<Partial<AiProject>>({ status: "idea", personal_info: false, decisions_about_people: false, customer_facing: false, ...project });
  const set = (k: keyof AiProject) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || null });
  const flag = (k: "personal_info" | "decisions_about_people" | "customer_facing") => (e: { target: { checked: boolean } }) => setF({ ...f, [k]: e.target.checked });
  const high = f.decisions_about_people || (f.personal_info && f.customer_facing);
  return (
    <div className="card form block">
      <h3>{project.id ? project.name : "New AI project"}</h3>
      <fieldset disabled={!canEdit} className="plain-fieldset">
        <label htmlFor="ap-name">Name</label>
        <input id="ap-name" value={f.name ?? ""} onChange={set("name")} />
        <label htmlFor="ap-purpose">What it does and why</label>
        <textarea id="ap-purpose" rows={2} value={f.purpose ?? ""} onChange={set("purpose")} />
        <div className="row wrap">
          <span className="field"><label htmlFor="ap-owner">Business owner</label><input id="ap-owner" value={f.owner_name ?? ""} onChange={set("owner_name")} /></span>
          <span className="field"><label htmlFor="ap-status">Status</label>
            <select id="ap-status" value={f.status} onChange={set("status")}>{Object.entries(PROJECT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span>
          {entities.length > 1 && (
            <span className="field"><label htmlFor="ap-ent">Company</label>
              <select id="ap-ent" value={f.entity_id ?? ""} onChange={set("entity_id")}><option value="">Whole group</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></span>
          )}
        </div>
        <label className="check"><input type="checkbox" checked={!!f.personal_info} onChange={flag("personal_info")} /> Uses personal information</label>
        <label className="check"><input type="checkbox" checked={!!f.decisions_about_people} onChange={flag("decisions_about_people")} /> Makes or shapes decisions about people</label>
        <label className="check"><input type="checkbox" checked={!!f.customer_facing} onChange={flag("customer_facing")} /> Customers or the public interact with it</label>
        <div className="row wrap">
          <span className="field"><label htmlFor="ap-risk">Risk level</label>
            <select id="ap-risk" value={f.risk_level ?? ""} onChange={set("risk_level")}><option value="">Not assessed</option>{Object.entries(RISK_LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span>
          <span className="field"><label htmlFor="ap-models">Models or services used</label><input id="ap-models" placeholder="e.g. Claude through Amazon Bedrock" value={f.models ?? ""} onChange={set("models")} /></span>
          <span className="field"><label htmlFor="ap-loc">Where data is processed</label><input id="ap-loc" placeholder="e.g. Australia" value={f.data_location ?? ""} onChange={set("data_location")} /></span>
        </div>
        {high && !f.risk_level && <p className="small warning-text">This looks higher risk (personal information or decisions about people): assess it before it goes live.</p>}
        {tools.length > 0 && (
          <>
            <label htmlFor="ap-tool">Built on a tool in the register (optional)</label>
            <select id="ap-tool" value={f.tool_id ?? ""} onChange={set("tool_id")}><option value="">None</option>{tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </>
        )}
        <label htmlFor="ap-human">Human oversight (who checks its output, and how)</label>
        <textarea id="ap-human" rows={2} value={f.human_oversight ?? ""} onChange={set("human_oversight")} />
        <label htmlFor="ap-test">Testing (accuracy, bias, security)</label>
        <textarea id="ap-test" rows={2} value={f.testing ?? ""} onChange={set("testing")} />
        <div className="row wrap">
          <span className="field"><label htmlFor="ap-by">Approved by</label><input id="ap-by" value={f.approved_by ?? ""} onChange={set("approved_by")} /></span>
          <span className="field"><label htmlFor="ap-on">Approved on</label><input id="ap-on" type="date" value={f.approved_on ?? ""} onChange={set("approved_on")} /></span>
          <span className="field"><label htmlFor="ap-live">Live from</label><input id="ap-live" type="date" value={f.go_live_on ?? ""} onChange={set("go_live_on")} /></span>
          <span className="field"><label htmlFor="ap-rev">Review by</label><input id="ap-rev" type="date" value={f.review_on ?? ""} onChange={set("review_on")} /></span>
        </div>
      </fieldset>
      {f.status === "live" && !f.approved_on && <p className="small warning-text">Live without a recorded approval.</p>}
      {project.id && <Attachments subjectTable="ai_projects" subjectId={project.id} canAttach={canEdit} label="Assessments and documents" />}
      <div className="row">
        {canEdit && <button type="button" disabled={busy || (f.name ?? "").trim().length < 2} onClick={() => onSave({
          id: project.id, name: (f.name ?? "").trim(), purpose: f.purpose ?? null, owner_name: f.owner_name ?? null, status: f.status ?? "idea", entity_id: f.entity_id ?? null,
          personal_info: !!f.personal_info, decisions_about_people: !!f.decisions_about_people, customer_facing: !!f.customer_facing, risk_level: f.risk_level ?? null,
          models: f.models ?? null, data_location: f.data_location ?? null, tool_id: f.tool_id ?? null, human_oversight: f.human_oversight ?? null, testing: f.testing ?? null,
          approved_by: f.approved_by ?? null, approved_on: f.approved_on ?? null, go_live_on: f.go_live_on ?? null, review_on: f.review_on ?? null,
        })}>Save</button>}
        <button type="button" className="quiet" onClick={onCancel}>{canEdit ? "Cancel" : "Close"}</button>
        {canEdit && onDelete && <button type="button" className="quiet" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
