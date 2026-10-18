import { useCallback, useEffect, useState, type ReactNode } from "react";
import Attachments from "./Attachments";
import { today as todayIso } from "./authorities";
import { formatDay } from "./board";
import DropZone from "./DropZone";
import { attachFile } from "./files";
import { PrintView } from "./RegisterDocs";
import {
  acknowledge, addMember, closureNotice, confirmClosure, endedNotice, inviteText, KIND_LABELS, kickoffNotice, loadConfidential, mailto, OUTCOME_LABELS, personalLink,
  recordReply, removeMember, startProject, STATUS_LABELS, suggestName, updateProject,
  type ConfData, type Kind, type Member, type NdaRequest, type NoticeContext, type Project,
} from "./confidential";
import type { GroupData } from "./types";

type Props = { organisationId: string; organisationName: string; userId: string; group: GroupData | null };
const day = (iso: string | null | undefined) => (iso ? formatDay(`${iso.slice(0, 10)}T12:00:00`) : "");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function Field({ id, label, children, wide }: { id: string; label: string; children: ReactNode; wide?: boolean }) {
  return <span className={wide ? "field grow" : "field"}><label htmlFor={id}>{label}</label>{children}</span>;
}
const copy = (text: string) => void navigator.clipboard?.writeText(text);

// Remembered while moving between tabs
let openProject: string | null = null;

/** Confidential projects: the register, and each project's list, terms and notices */
export default function Confidential({ organisationId, organisationName, userId, group }: Props) {
  const [data, setData] = useState<ConfData | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenIdState] = useState<string | null>(openProject);
  const [starting, setStarting] = useState(false);
  const setOpenId = (id: string | null) => {
    openProject = id;
    setOpenIdState(id);
  };
  const t = todayIso();
  const reload = useCallback(async () => {
    try {
      setData(await loadConfidential(organisationId));
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
      <p className="eyebrow">Confidential projects</p>
      <h1>{openId && data?.projects.find((p) => p.id === openId) ? `Project ${data.projects.find((p) => p.id === openId)!.code_name}` : "Confidential projects"}</h1>
      {problem && <p className="error" role="alert">{problem}</p>}
      {notice && <p className="card note" role="status">{notice}</p>}
    </>
  );
  if (!data) return <>{header}<p className="muted">Loading…</p></>;
  if (!data.ready) return <>{header}<p className="card warning">Not set up yet: run migration 0054 in Supabase.</p></>;

  const project = openId ? data.projects.find((p) => p.id === openId) : undefined;
  if (project) {
    return <>{header}<ProjectPage project={project} data={data} organisationId={organisationId} organisationName={organisationName} userId={userId} group={group} busy={busy} today={t} run={run} onBack={() => setOpenId(null)} /></>;
  }
  if (starting) {
    return <>{header}<StartForm organisationId={organisationId} busy={busy} onCancel={() => setStarting(false)}
      onStart={async (name, kind, close, reason) => { let id = ""; if (await run(async () => { id = await startProject(organisationId, name, kind, close, reason); }, `Project ${name} started. Add the team, then issue the confidentiality notice.`)) { setStarting(false); setOpenId(id); } }} /></>;
  }
  const mine = data.members.filter((m) => m.user_id === userId && !m.removed_at);
  const toAck = mine.filter((m) => { const p = data.projects.find((x) => x.id === m.project_id); return p?.kickoff_issued_at && !m.acknowledged_at; });
  return (
    <>
      {header}
      <p className="lead">For projects involving someone else's confidential information: a code name, a list of who is inside, a notice everyone acknowledges, the NDA's key terms, and a clean close. The person who starts a project runs it; the legal contact (General Counsel, then CEO, then the directors) is the escalation point.</p>
      {toAck.length > 0 && (
        <section className="card warning block">
          <p><strong>You have {toAck.length} confidentiality notice{toAck.length === 1 ? "" : "s"} to acknowledge.</strong></p>
          <ul className="plain">{toAck.map((m) => { const p = data.projects.find((x) => x.id === m.project_id)!; return <li key={m.id}><button type="button" className="link-dark" onClick={() => setOpenId(p.id)}>Project {p.code_name}</button></li>; })}</ul>
        </section>
      )}
      <p><button type="button" onClick={() => setStarting(true)}>Start a confidential project</button></p>
      {data.register.length === 0 ? <p className="muted">No confidential projects you can see.</p> : (
        <div className="table-scroll">
          <table className="report-table wide">
            <thead><tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Lead and legal contact</th><th scope="col">Dates</th><th scope="col">Protocol</th></tr></thead>
            <tbody>
              {data.register.map((r) => {
                const issues = [
                  r.not_acknowledged && r.status !== "closed" ? `${r.not_acknowledged} not acknowledged` : null,
                  r.dl_out_of_date ? "DL to update" : null,
                  r.overdue ? "past expected close" : null,
                  r.closure_outstanding ? `${r.closure_outstanding} deletion confirmations outstanding` : null,
                ].filter(Boolean);
                return (
                  <tr key={r.id} className={r.status === "closed" ? "muted" : undefined}>
                    <th scope="row">{r.can_read ? <button type="button" className="link-dark" onClick={() => setOpenId(r.id)}>Project {r.code_name}</button> : <>Project {r.code_name}<span className="muted small"><br />Details restricted to the project team</span></>}</th>
                    <td>{STATUS_LABELS[r.status]}</td>
                    <td className="small">{r.lead_name}<br /><span className="muted">{r.legal_name}</span></td>
                    <td className="small">Started {day(r.started_on)}{r.closed_on ? <><br />Closed {day(r.closed_on)}</> : r.expected_close_on ? <><br />Expected close {day(r.expected_close_on)}</> : null}{r.conf_ends_on ? <><br />Confidential until {day(r.conf_ends_on)}</> : null}</td>
                    <td className={issues.length ? "warning-text small" : "small"}>{r.on_list} on the list{issues.length ? <><br />{issues.join(" · ")}</> : <><br /><span className="ok-text">On track</span></>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted block">Owners and administrators see this register but not the details. Only the people on a project's list, its lead and its legal contact can open it.</p>
    </>
  );
}

function StartForm({ organisationId, busy, onStart, onCancel }: { organisationId: string; busy: boolean; onStart: (name: string, kind: Kind, close: string | null, reason: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("acquisition");
  const [close, setClose] = useState("");
  const [reason, setReason] = useState("Project lead");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card form block">
      <h2>Start a confidential project</h2>
      <p className="small muted">Use a code name that says nothing about the other party, its industry or location. Code names are never reused.</p>
      <div className="row wrap">
        <Field id="cp-name" label="Code name"><input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kestrel" /></Field>
        <button type="button" className="quiet" disabled={busy} onClick={async () => { setMsg(null); try { setName(await suggestName(organisationId)); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not suggest one."); } }}>Suggest one</button>
      </div>
      <div className="row wrap">
        <Field id="cp-kind" label="Kind of project"><select id="cp-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field id="cp-close" label="Expected close"><input id="cp-close" type="date" value={close} onChange={(e) => setClose(e.target.value)} /></Field>
        <Field id="cp-reason" label="Your role" wide><input id="cp-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      {msg && <p className="error">{msg}</p>}
      <p className="small">You will be the project lead: you keep the list, issue the notices and close the project.</p>
      <div className="row">
        <button type="button" disabled={busy || name.trim().length < 2} onClick={() => onStart(name.trim(), kind, close || null, reason)}>Start</button>
        <button type="button" className="quiet" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

type Sub = "team" | "terms" | "notices";
function ProjectPage({ project: p, data, organisationId, organisationName, userId, group, busy, today: t, run, onBack }: {
  project: Project; data: ConfData; organisationId: string; organisationName: string; userId: string; group: GroupData | null; busy: boolean; today: string;
  run: (work: () => Promise<unknown>, done: string) => Promise<boolean>; onBack: () => void;
}) {
  const reg = data.register.find((r) => r.id === p.id);
  const manage = reg?.can_manage ?? false;
  const members = data.members.filter((m) => m.project_id === p.id);
  const active = members.filter((m) => !m.removed_at);
  const me = active.find((m) => m.user_id === userId);
  const nameOf = (uid: string | null) => (uid ? data.people.find((x) => x.user_id === uid)?.full_name ?? "" : "");
  const lead = nameOf(p.lead_user_id) || reg?.lead_name || "the project lead";
  const legal = p.legal_user_id ? nameOf(p.legal_user_id) || reg?.legal_name || "Legal" : "the directors";
  const ctx: NoticeContext = { project: p, organisation: organisationName, lead, legal, members };
  const [sub, setSub] = useState<Sub>("team");
  const [myName, setMyName] = useState("");
  const closed = p.status === "closed";

  return (
    <>
      <p><button type="button" className="back" onClick={onBack}>← All confidential projects</button></p>
      <section className={closed ? "card block" : "card block"}>
        <dl className="detail-list compact">
          <div><dt>Status</dt><dd>{STATUS_LABELS[p.status]}{p.outcome ? ` (${OUTCOME_LABELS[p.outcome].toLowerCase()})` : ""}</dd></div>
          <div><dt>Kind</dt><dd>{KIND_LABELS[p.kind]}</dd></div>
          <div><dt>Lead</dt><dd>{lead}</dd></div>
          <div><dt>Legal contact</dt><dd>{p.legal_user_id ? legal : "The directors (no General Counsel or CEO set up under Authorities)"}</dd></div>
          <div><dt>Dates</dt><dd>Started {day(p.started_on)}{p.closed_on ? `; closed ${day(p.closed_on)}` : p.expected_close_on ? `; expected close ${day(p.expected_close_on)}` : ""}{p.conf_ends_on ? `; confidential until ${day(p.conf_ends_on)}` : ""}</dd></div>
        </dl>
      </section>

      {me && p.kickoff_issued_at && !me.acknowledged_at && (
        <section className="card warning block">
          <h2>Please acknowledge the confidentiality notice</h2>
          <pre className="policy-wording">{p.kickoff_text}</pre>
          <div className="row wrap">
            <Field id="me-name" label="Type your name to confirm you have read it and will follow it"><input id="me-name" value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
            <button type="button" disabled={busy || myName.trim().length < 2} onClick={() => run(() => acknowledge(me.id, myName), "Thank you. Your acknowledgement is recorded.")}>I acknowledge</button>
          </div>
        </section>
      )}
      {me && p.closure_issued_at && p.closure_needs_deletion && me.acknowledged_at && !me.closure_confirmed_at && (
        <section className="card warning block">
          <h2>The project has closed: please confirm you have deleted the material</h2>
          <pre className="policy-wording">{p.closure_text}</pre>
          <div className="row wrap">
            <Field id="me-close" label="Type your name to confirm"><input id="me-close" value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
            <button type="button" disabled={busy || myName.trim().length < 2} onClick={() => run(() => confirmClosure(me.id, myName), "Thank you. Your confirmation is recorded.")}>I have deleted it</button>
          </div>
        </section>
      )}

      <span className="segmented block-gap" role="group" aria-label="Project sections">
        {(["team", "terms", "notices"] as Sub[]).map((s) => (
          <button key={s} type="button" className={sub === s ? "on" : undefined} aria-pressed={sub === s} onClick={() => setSub(s)}>
            {s === "team" ? `The list (${active.length})` : s === "terms" ? "Project and NDA terms" : closed ? "Notices and close" : "Notices"}
          </button>
        ))}
      </span>
      {sub === "team" && <Team key={`${p.dl_address}-${p.dl_synced_at}`} p={p} members={members} data={data} manage={manage && !closed} organisationId={organisationId} busy={busy} run={run} ctx={ctx} />}
      {sub === "terms" && <Terms key={JSON.stringify(p)} p={p} manage={manage} group={group} busy={busy} today={t} run={run} />}
      {sub === "notices" && <Notices p={p} members={members} ctx={ctx} manage={manage} busy={busy} today={t} run={run} />}
    </>
  );
}

function Team({ p, members, data, manage, organisationId, busy, run, ctx }: { p: Project; members: Member[]; data: ConfData; manage: boolean; organisationId: string; busy: boolean; run: (w: () => Promise<unknown>, d: string) => Promise<boolean>; ctx: NoticeContext }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState<Partial<Member>>({});
  const [printing, setPrinting] = useState(false);
  const [dl, setDl] = useState(p.dl_address ?? "");
  const active = members.filter((m) => !m.removed_at);
  const since = p.dl_synced_at ?? "";
  const toAdd = active.filter((m) => !p.dl_synced_at || m.added_at > since);
  const toRemove = members.filter((m) => m.removed_at && (!p.dl_synced_at || m.removed_at > since));
  const candidates = data.people.filter((x) => x.user_id && !active.some((m) => m.user_id === x.user_id));
  return (
    <>
      <section className="card block">
        <div className="table-scroll">
          <table className="report-table wide">
            <thead><tr><th scope="col">Name</th><th scope="col">Why they are on the list</th><th scope="col">Access</th><th scope="col">Acknowledged</th>{p.closure_issued_at && p.closure_needs_deletion && <th scope="col">Deletion confirmed</th>}{manage && <th scope="col"><span className="visually-hidden">Actions</span></th>}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.removed_at ? "muted" : undefined}>
                  <th scope="row">{m.full_name}<span className="muted small">{m.title || m.function || m.organisation_name ? <><br />{[m.title, m.function, m.organisation_name].filter(Boolean).join(", ")}</> : null}{m.email ? <><br />{m.email}</> : null}</span></th>
                  <td className="small">{m.reason}</td>
                  <td className="small">From {when(m.added_at)}{m.removed_at ? <><br />Until {when(m.removed_at)}</> : null}</td>
                  <td className={!m.acknowledged_at && !m.removed_at && p.kickoff_issued_at ? "warning-text small" : "small"}>{m.acknowledged_at ? <>{day(m.acknowledged_at)}<span className="muted"><br />{m.ack_method === "in_app" ? "in VeraPhius" : m.ack_method === "link" ? "by link" : "reply recorded"}</span></> : p.kickoff_issued_at ? "Not yet" : <span className="muted">Notice not issued</span>}</td>
                  {p.closure_issued_at && p.closure_needs_deletion && <td className={!m.closure_confirmed_at && m.acknowledged_at ? "warning-text small" : "small"}>{m.closure_confirmed_at ? day(m.closure_confirmed_at) : m.acknowledged_at ? "Not yet" : ""}</td>}
                  {manage && (
                    <td className="small">
                      {!m.removed_at && (
                        <span className="row wrap">
                          {p.kickoff_issued_at && !m.acknowledged_at && <button type="button" className="quiet" disabled={busy} onClick={() => run(() => recordReply(m.id, "ack"), `${m.full_name}'s reply recorded.`)}>Record reply</button>}
                          {(p.kickoff_issued_at || p.closure_issued_at) && <button type="button" className="quiet" onClick={() => copy(personalLink(m.token))}>Copy their link</button>}
                          {m.user_id !== p.lead_user_id && <button type="button" className="quiet" disabled={busy} onClick={() => run(() => removeMember(m.id), `${m.full_name} removed. Update the DL.`)}>Remove</button>}
                        </span>
                      )}
                      {m.removed_at && p.closure_issued_at && p.closure_needs_deletion && m.acknowledged_at && !m.closure_confirmed_at && <button type="button" className="quiet" disabled={busy} onClick={() => run(() => recordReply(m.id, "closure"), "Recorded.")}>Record reply</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row wrap block">
          {manage && <button type="button" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add someone"}</button>}
          <button type="button" className="quiet" onClick={() => setPrinting(true)}>Print the list</button>
        </div>
        {adding && manage && (
          <div className="form block">
            <p className="small muted">Keep the team as small as possible. Each person needs a reason to be inside.</p>
            <div className="row wrap">
              <Field id="m-pick" label="A VeraPhius user"><select id="m-pick" value={v.user_id ?? ""} onChange={(e) => { const x = data.people.find((y) => y.user_id === e.target.value); setV({ ...v, user_id: e.target.value || null, full_name: x?.full_name ?? v.full_name, email: x?.email ?? v.email }); }}><option value="">Someone else (adviser or not on VeraPhius)</option>{candidates.map((x) => <option key={x.user_id!} value={x.user_id!}>{x.full_name}</option>)}</select></Field>
              <Field id="m-name" label="Full name"><input id="m-name" value={v.full_name ?? ""} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
              <Field id="m-email" label="Email"><input id="m-email" type="email" value={v.email ?? ""} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            </div>
            <div className="row wrap">
              <Field id="m-title" label="Title"><input id="m-title" value={v.title ?? ""} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
              <Field id="m-fn" label="Function"><input id="m-fn" value={v.function ?? ""} onChange={(e) => setV({ ...v, function: e.target.value })} /></Field>
              {!v.user_id && <Field id="m-org" label="Firm (advisers)"><input id="m-org" value={v.organisation_name ?? ""} onChange={(e) => setV({ ...v, organisation_name: e.target.value })} /></Field>}
            </div>
            <Field id="m-reason" label="Why they need to be on the list" wide><input id="m-reason" value={v.reason ?? ""} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Finance lead for the valuation" /></Field>
            <button type="button" disabled={busy || (v.full_name ?? "").trim().length < 2 || (v.reason ?? "").trim().length < 3}
              onClick={async () => { if (await run(() => addMember(organisationId, p.id, v), `${v.full_name} added.${p.kickoff_issued_at ? " Send them the confidentiality notice, and update the DL." : ""}`)) { setV({}); setAdding(false); } }}>Add to the list</button>
          </div>
        )}
      </section>

      <section className={p.status !== "closed" && (toAdd.length || toRemove.length) && p.dl_address ? "card warning block" : "card block"}>
        <h2>Distribution list</h2>
        <p className="small muted">Create a DL in Outlook or Google for the project, named after the code name, and email the team only through it. Automatic creation will come with the Microsoft and Google integration.</p>
        <div className="row wrap">
          <Field id="dl" label="DL address"><input id="dl" type="email" disabled={!manage} value={dl} onChange={(e) => setDl(e.target.value)} placeholder={`project.${p.code_name.toLowerCase().replace(/[^a-z0-9]+/g, "")}@your-domain`} /></Field>
          {manage && dl !== (p.dl_address ?? "") && <button type="button" disabled={busy} onClick={() => run(() => updateProject(p.id, { dl_address: dl, dl_synced_at: new Date().toISOString() }), "DL saved.")}>Save</button>}
        </div>
        {p.dl_address && (toAdd.length > 0 || toRemove.length > 0) ? (
          <>
            <p className="small"><strong>Changes since the DL was last updated{p.dl_synced_at ? ` (${when(p.dl_synced_at)})` : ""}:</strong></p>
            <ul className="small">
              {toAdd.map((m) => <li key={m.id}>Add {m.full_name}{m.email ? ` (${m.email})` : " (no email recorded)"}</li>)}
              {toRemove.map((m) => <li key={m.id}>Remove {m.full_name}{m.email ? ` (${m.email})` : ""}</li>)}
            </ul>
            {manage && <button type="button" disabled={busy} onClick={() => run(() => updateProject(p.id, { dl_synced_at: new Date().toISOString() }), "DL marked as up to date.")}>The DL is up to date</button>}
          </>
        ) : p.dl_address ? <p className="small ok-text">The DL matches the list.</p> : null}
        <p className="small"><button type="button" className="link-dark" onClick={() => copy(active.map((m) => m.email).filter(Boolean).join("; "))}>Copy everyone's email address</button></p>
      </section>

      {printing && (
        <PrintView title={`Project ${p.code_name}: confidential list`} onClose={() => setPrinting(false)}>
          <p className="small">This list changes as people join and leave. Created {when(p.created_at)}; printed {when(new Date().toISOString())}.</p>
          <table className="report-table">
            <thead><tr><th>Full name</th><th>Title</th><th>Function</th><th>Reason for being on the list</th><th>Obtained access</th><th>Ceased access</th></tr></thead>
            <tbody>{members.map((m) => <tr key={m.id}><td>{m.full_name}</td><td>{[m.title, m.organisation_name].filter(Boolean).join(", ")}</td><td>{m.function}</td><td>{m.reason}</td><td>{when(m.added_at)}</td><td>{when(m.removed_at)}</td></tr>)}</tbody>
          </table>
          <p className="small">These people have access to confidential information about Project {p.code_name}. Lead: {ctx.lead}. Legal contact: {ctx.legal}.</p>
        </PrintView>
      )}
    </>
  );
}

function Terms({ p, manage, group, busy, today: t, run }: { p: Project; manage: boolean; group: GroupData | null; busy: boolean; today: string; run: (w: () => Promise<unknown>, d: string) => Promise<boolean> }) {
  const [v, setV] = useState<Project>(p);
  const [nda, setNda] = useState<NdaRequest>(p.nda_request ?? {});
  const [fileKey, setFileKey] = useState(0);
  const set = (x: Partial<Project>) => setV({ ...v, ...x });
  const dis = !manage;
  return (
    <>
      <section className="card form block">
        <h2>The project</h2>
        <Field id="t-purpose" label="Purpose: what the information may be used for" wide><input id="t-purpose" disabled={dis} value={v.purpose ?? ""} onChange={(e) => set({ purpose: e.target.value })} placeholder="evaluate and negotiate a possible acquisition of the target" /></Field>
        <div className="row wrap">
          <Field id="t-cp" label="Other party" wide><input id="t-cp" disabled={dis} value={v.counterparty ?? ""} onChange={(e) => set({ counterparty: e.target.value })} /></Field>
          <Field id="t-kind" label="Kind"><select id="t-kind" disabled={dis} value={v.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {(group?.entities.length ?? 0) > 1 && <Field id="t-ent" label="Our company"><select id="t-ent" disabled={dis} value={v.entity_id ?? ""} onChange={(e) => set({ entity_id: e.target.value || null })}><option value="">Not chosen</option>{group!.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>}
          <Field id="t-close" label="Expected close"><input id="t-close" type="date" disabled={dis || p.status === "closed"} value={v.expected_close_on ?? ""} onChange={(e) => set({ expected_close_on: e.target.value || null })} /></Field>
        </div>
        <div className="row wrap">
          <label className="check"><input type="checkbox" disabled={dis} checked={v.counterparty_listed} onChange={(e) => set({ counterparty_listed: e.target.checked })} /> The other party is listed</label>
          <label className="check"><input type="checkbox" disabled={dis} checked={v.counterparty_competitor} onChange={(e) => set({ counterparty_competitor: e.target.checked })} /> The other party is a competitor</label>
        </div>
        <Field id="t-rel" label="Related internal project, if any (its team must not see this information)" wide><input id="t-rel" disabled={dis} value={v.related_project ?? ""} onChange={(e) => set({ related_project: e.target.value })} /></Field>

        <h3>NDA terms</h3>
        <div className="row wrap">
          <Field id="t-nda" label="NDA"><select id="t-nda" disabled={dis} value={v.nda_status} onChange={(e) => set({ nda_status: e.target.value as Project["nda_status"] })}><option value="pending">Not yet signed</option><option value="signed">Signed</option><option value="not_needed">Not needed</option></select></Field>
          {v.nda_status === "signed" && <Field id="t-signed" label="Signed on"><input id="t-signed" type="date" max={t} disabled={dis} value={v.nda_signed_on ?? ""} onChange={(e) => set({ nda_signed_on: e.target.value || null })} /></Field>}
        </div>
        {v.nda_status !== "not_needed" && (
          <>
            <div className="row wrap">
              <Field id="t-term" label="Confidentiality term (months)"><input id="t-term" type="number" min={1} disabled={dis} value={v.conf_term_months ?? ""} onChange={(e) => set({ conf_term_months: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field id="t-ends" label="Confidential until"><input id="t-ends" type="date" disabled={dis || (v.conf_term_months !== null && !!v.nda_signed_on)} value={v.conf_ends_on ?? ""} onChange={(e) => set({ conf_ends_on: e.target.value || null })} /></Field>
            </div>
            {v.conf_term_months !== null && v.nda_signed_on && <p className="small muted">Worked out from the signing date and the term. If the NDA counts from another date, clear the term and enter the end date.</p>}
            <label className="check"><input type="checkbox" disabled={dis} checked={v.trade_secret_split} onChange={(e) => set({ trade_secret_split: e.target.checked })} /> The NDA has a separate term for trade secrets</label>
            {v.trade_secret_split && (
              <div className="row wrap">
                <Field id="t-ts" label="Trade secrets confidential until (leave blank if for as long as they remain trade secrets)"><input id="t-ts" type="date" disabled={dis} value={v.trade_secret_ends_on ?? ""} onChange={(e) => set({ trade_secret_ends_on: e.target.value || null })} /></Field>
              </div>
            )}
            <div className="row wrap">
              <Field id="t-ns" label="No approaching their employees until"><input id="t-ns" type="date" disabled={dis} value={v.non_solicit_ends_on ?? ""} onChange={(e) => set({ non_solicit_ends_on: e.target.value || null })} /></Field>
              <Field id="t-ss" label="Standstill until"><input id="t-ss" type="date" disabled={dis} value={v.standstill_ends_on ?? ""} onChange={(e) => set({ standstill_ends_on: e.target.value || null })} /></Field>
            </div>
            <div className="row wrap">
              <Field id="t-rd" label="Return or destroy the information"><select id="t-rd" disabled={dis} value={v.return_destroy ?? ""} onChange={(e) => set({ return_destroy: (e.target.value || null) as Project["return_destroy"] })}><option value="">Not recorded</option><option value="on_request">When the other party asks</option><option value="on_close">When the project ends</option><option value="none">No obligation</option></select></Field>
              <Field id="t-cert" label="Certify within (days)"><input id="t-cert" type="number" min={1} disabled={dis} value={v.certify_within_days ?? ""} onChange={(e) => set({ certify_within_days: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            </div>
            <Field id="t-notes" label="Other key terms" wide><textarea id="t-notes" rows={2} disabled={dis} value={v.nda_notes ?? ""} onChange={(e) => set({ nda_notes: e.target.value })} placeholder="Permitted disclosees, exceptions, governing law" /></Field>
          </>
        )}
        {manage && <button type="button" disabled={busy} onClick={() => run(() => updateProject(p.id, {
          purpose: v.purpose, counterparty: v.counterparty, kind: v.kind, entity_id: v.entity_id, expected_close_on: v.expected_close_on, counterparty_listed: v.counterparty_listed, counterparty_competitor: v.counterparty_competitor,
          related_project: v.related_project, nda_status: v.nda_status, nda_signed_on: v.nda_status === "signed" ? v.nda_signed_on : null, conf_term_months: v.conf_term_months, conf_ends_on: v.conf_ends_on,
          trade_secret_split: v.trade_secret_split, trade_secret_ends_on: v.trade_secret_ends_on, non_solicit_ends_on: v.non_solicit_ends_on, standstill_ends_on: v.standstill_ends_on,
          return_destroy: v.return_destroy, certify_within_days: v.certify_within_days, nda_notes: v.nda_notes,
        }), "Saved.")}>Save</button>}
      </section>

      <section className="card block">
        <h2>Signed NDA</h2>
        <p className="small muted">Drop the fully signed NDA here. Only the project team and its legal contact can open it.</p>
        {manage && <DropZone label="Signed NDA" accept=".pdf,.doc,.docx" busy={busy} onFile={(f) => void run(() => attachFile("conf_projects", p.id, f), `${f.name} attached.`).then(() => setFileKey(fileKey + 1))} />}
        <Attachments key={fileKey} subjectTable="conf_projects" subjectId={p.id} canAttach={false} label="Attached" />
      </section>

      <section className="card form block">
        <h2>Our NDA, sent for signature</h2>
        <p className="small muted">Fill in the details now. Once our NDA template is loaded, VeraPhius will fill it in from this form and send it to the other party to sign; the signed copy will be attached above automatically.</p>
        <div className="row wrap">
          <Field id="n-legal" label="Other party's legal name" wide><input id="n-legal" disabled={dis} value={nda.counterparty_legal_name ?? ""} onChange={(e) => setNda({ ...nda, counterparty_legal_name: e.target.value })} /></Field>
          <Field id="n-abn" label="ABN or ACN"><input id="n-abn" disabled={dis} value={nda.counterparty_abn ?? ""} onChange={(e) => setNda({ ...nda, counterparty_abn: e.target.value })} /></Field>
        </div>
        <Field id="n-addr" label="Address" wide><input id="n-addr" disabled={dis} value={nda.counterparty_address ?? ""} onChange={(e) => setNda({ ...nda, counterparty_address: e.target.value })} /></Field>
        <div className="row wrap">
          <Field id="n-sig" label="Their signatory"><input id="n-sig" disabled={dis} value={nda.signatory_name ?? ""} onChange={(e) => setNda({ ...nda, signatory_name: e.target.value })} /></Field>
          <Field id="n-sigt" label="Title"><input id="n-sigt" disabled={dis} value={nda.signatory_title ?? ""} onChange={(e) => setNda({ ...nda, signatory_title: e.target.value })} /></Field>
          <Field id="n-sige" label="Email"><input id="n-sige" type="email" disabled={dis} value={nda.signatory_email ?? ""} onChange={(e) => setNda({ ...nda, signatory_email: e.target.value })} /></Field>
        </div>
        <div className="row wrap">
          <Field id="n-way" label="Who discloses"><select id="n-way" disabled={dis} value={nda.mutual ?? "mutual"} onChange={(e) => setNda({ ...nda, mutual: e.target.value as NdaRequest["mutual"] })}><option value="mutual">Both (mutual)</option><option value="they_disclose">They disclose to us</option><option value="we_disclose">We disclose to them</option></select></Field>
          <Field id="n-term" label="Term (years)"><input id="n-term" type="number" min={1} disabled={dis} value={nda.term_years ?? ""} onChange={(e) => setNda({ ...nda, term_years: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
          <Field id="n-ts" label="Trade secrets"><select id="n-ts" disabled={dis} value={nda.trade_secret_term ?? "same"} onChange={(e) => setNda({ ...nda, trade_secret_term: e.target.value })}><option value="same">Same term</option><option value="indefinite">For as long as they remain trade secrets</option></select></Field>
          <Field id="n-ours" label="Our signatory"><input id="n-ours" disabled={dis} value={nda.our_signatory ?? ""} onChange={(e) => setNda({ ...nda, our_signatory: e.target.value })} /></Field>
        </div>
        <div className="row">
          {manage && <button type="button" className="quiet" disabled={busy} onClick={() => run(() => updateProject(p.id, { nda_request: nda }), "NDA details saved.")}>Save the details</button>}
          <button type="button" disabled title="Coming once the NDA template is loaded">Send for signature (coming)</button>
        </div>
      </section>
    </>
  );
}

function Notices({ p, members, ctx, manage, busy, today: t, run }: { p: Project; members: Member[]; ctx: NoticeContext; manage: boolean; busy: boolean; today: string; run: (w: () => Promise<unknown>, d: string) => Promise<boolean> }) {
  const [variant, setVariant] = useState<"full" | "core">("full");
  const k = kickoffNotice(ctx, variant);
  const [kickBody, setKickBody] = useState(k.body);
  useEffect(() => setKickBody(kickoffNotice(ctx, variant).body), [variant, p.purpose, p.counterparty_listed, p.counterparty_competitor, p.related_project, p.dl_address]);
  const [outcome, setOutcome] = useState<NonNullable<Project["outcome"]>>("not_proceeding");
  const [note, setNote] = useState("");
  const [deletion, setDeletion] = useState(true);
  const byDate = addDays(t, p.certify_within_days ?? 14);
  const c = closureNotice(ctx, { outcome, note, deletion, byDate });
  const [closeBody, setCloseBody] = useState(c.body);
  useEffect(() => setCloseBody(closureNotice(ctx, { outcome, note, deletion, byDate }).body), [outcome, note, deletion]);
  useEffect(() => setDeletion(outcome !== "completed"), [outcome]);
  const ended = endedNotice(ctx);
  const send = (subject: string, body: string) => { window.location.href = mailto(p.dl_address, subject, body); };
  const unacked = members.filter((m) => !m.removed_at && !m.acknowledged_at);
  return (
    <>
      <section className="card block">
        <h2>Meeting invitation</h2>
        <p className="small muted">Paste this into the invitation for the kick-off meeting.</p>
        <pre className="policy-wording">{inviteText(ctx)}</pre>
        <button type="button" className="quiet" onClick={() => copy(inviteText(ctx))}>Copy</button>
      </section>

      <section className={p.status !== "closed" && !p.kickoff_issued_at ? "card warning block" : "card block"}>
        <h2>Confidentiality notice</h2>
        {p.kickoff_issued_at ? (
          <p className="small">Issued {when(p.kickoff_issued_at)}. {unacked.length ? <span className="warning-text">{unacked.length} not yet acknowledged.</span> : <span className="ok-text">Everyone on the list has acknowledged it.</span>} People added later: send them the same notice, or their personal link from the list.</p>
        ) : (
          <p className="small">Issue this when the team is set up. Everyone on the list must acknowledge it: in VeraPhius, by their personal link, or by replying (you record the reply on the list).</p>
        )}
        {manage && p.status !== "closed" && (
          <>
            <span className="segmented" role="group" aria-label="Notice">
              <button type="button" className={variant === "full" ? "on" : undefined} aria-pressed={variant === "full"} onClick={() => setVariant("full")}>Full notice</button>
              <button type="button" className={variant === "core" ? "on" : undefined} aria-pressed={variant === "core"} onClick={() => setVariant("core")}>Reminder for a standing core team</button>
            </span>
            <textarea aria-label="Notice text" rows={14} value={kickBody} onChange={(e) => setKickBody(e.target.value)} className="block" />
            <div className="row wrap">
              <button type="button" disabled={busy} onClick={async () => { if (await run(() => updateProject(p.id, { kickoff_text: kickBody, kickoff_issued_at: p.kickoff_issued_at ?? new Date().toISOString() }), "Notice issued. Your email program will open with the email to the DL.")) send(k.subject, kickBody); }}>{p.kickoff_issued_at ? "Send again" : "Issue and email the team"}</button>
              <button type="button" className="quiet" onClick={() => copy(`${k.subject}\n\n${kickBody}`)}>Copy</button>
            </div>
            {!p.dl_address && <p className="small warning-text">No DL recorded: the email will open with no recipient. Add the DL on the list tab.</p>}
          </>
        )}
        {p.kickoff_issued_at && !manage && <pre className="policy-wording">{p.kickoff_text}</pre>}
      </section>

      {manage && p.status !== "closed" && (
        <section className="card form block">
          <h2>Pause or close the project</h2>
          {p.status === "paused" ? (
            <button type="button" className="quiet" disabled={busy} onClick={() => run(() => updateProject(p.id, { status: "open" }), "Resumed.")}>Resume the project</button>
          ) : (
            <p><button type="button" className="quiet" disabled={busy} onClick={() => run(() => updateProject(p.id, { status: "paused" }), "Paused. The list and obligations stay in place.")}>Pause the project</button></p>
          )}
          <div className="row wrap">
            <Field id="c-out" label="Outcome"><select id="c-out" value={outcome} onChange={(e) => setOutcome(e.target.value as NonNullable<Project["outcome"]>)}>{Object.entries(OUTCOME_LABELS).map(([k2, l]) => <option key={k2} value={k2}>{l}</option>)}</select></Field>
            <label className="check"><input type="checkbox" checked={deletion} onChange={(e) => setDeletion(e.target.checked)} /> Ask everyone to delete the material and confirm</label>
          </div>
          <Field id="c-note" label="A line on the outcome (optional)" wide><input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <textarea aria-label="Closure notice" rows={14} value={closeBody} onChange={(e) => setCloseBody(e.target.value)} className="block" />
          <div className="row wrap">
            <button type="button" disabled={busy} onClick={async () => { if (await run(() => updateProject(p.id, { status: "closed", outcome, outcome_note: note || null, closure_text: closeBody, closure_needs_deletion: deletion, closure_issued_at: new Date().toISOString() }), "Project closed. Your email program will open with the closure notice to the DL.")) send(c.subject, closeBody); }}>Close and email the team</button>
            <button type="button" className="quiet" onClick={() => copy(`${c.subject}\n\n${closeBody}`)}>Copy</button>
          </div>
          <p className="small muted">After closing, confirmations are tracked on the list. Everyone gets one more notice when the confidentiality period ends; there are no other reminders.</p>
        </section>
      )}

      {p.status === "closed" && (
        <section className={p.conf_ends_on && p.conf_ends_on <= t && !p.ended_notice_at ? "card warning block" : "card block"}>
          <h2>When confidentiality ends</h2>
          {p.closure_issued_at && <p className="small">Closure notice issued {when(p.closure_issued_at)}.</p>}
          {!p.conf_ends_on ? <p className="small warning-text">No confidentiality end date recorded. Add it on the terms tab so the team is told when it ends.</p>
            : p.ended_notice_at ? <p className="small">The team was told on {day(p.ended_notice_at)} that confidentiality ended on {day(p.conf_ends_on)}.</p>
            : p.conf_ends_on > t ? <p className="small">Confidentiality ends on {day(p.conf_ends_on)}. You will be prompted under For you to tell the team then.</p>
            : manage && (
              <>
                <pre className="policy-wording">{ended.body}</pre>
                <button type="button" disabled={busy} onClick={async () => { if (await run(() => updateProject(p.id, { ended_notice_at: new Date().toISOString() }), "Recorded. Your email program will open.")) send(ended.subject, ended.body); }}>Email the team</button>
              </>
            )}
        </section>
      )}
    </>
  );
}
