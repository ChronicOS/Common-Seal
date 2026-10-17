import { has } from "./roles";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Attachments from "./Attachments";
import { formatDay, loadMembers, type Member } from "./board";
import {
  approvePolicyDraft,
  checkWording,
  confirmPolicyReview,
  createPolicy,
  loadPolicies,
  POLICY_CATEGORIES,
  POLICY_STARTERS,
  loadOwnTemplates,
  removeOwnTemplate,
  saveOwnTemplate,
  savePolicyDraft,
  recordUploadedPolicy,
  type OwnTemplate,
  type PolicyFile,
  STANDARD_SECTIONS,
  updatePolicy,
  type Policy,
  type PolicyData,
  type PolicyVersion,
} from "./policies";
import { createModule, moduleForPolicy, today } from "./training";
import { fillTemplate, TEMPLATES, type Audience, type Kind } from "./policyTemplates";
import { readPolicyFile } from "./policyDoc";
import { attachFile, downloadFile } from "./files";

type Props = { organisationId: string; organisationName: string; role: string; userId: string; onOpenTraining?: (moduleId: string) => void };

/** A blank external policy: the standard sections, worded for people outside the company */
const EXTERNAL_BLANK = [
  "# Purpose\nWhy [Company Name] has this policy and what it expects, in one or two sentences.",
  "# Who this applies to\n[The suppliers, partners, customers or members of the public it covers.]",
  "# The rules\nState each requirement as a short sentence saying who must do what.",
  "# Roles and responsibilities\nWho at [Company Name] communicates this policy and checks it is followed, and what the other party must do.",
  "# Raising concerns\nConcerns can be raised with your [Company Name] contact, or confidentially through [the external speak-up channel].",
  "# Breaches\n[Company Name] may ask for corrective action, audit, suspend or end the relationship, depending on the breach.",
  "# Review\nThe owner reviews this policy at least once in each review cycle.",
].join("\n\n");

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];

/** Shows policy wording. A line starting with "# " is a section heading. */
function Wording({ content }: { content: string }) {
  return (
    <div className="reading">
      {content
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l, i) => (l.startsWith("# ") ? <h3 key={i}>{l.slice(2)}</h3> : <p key={i}>{l}</p>))}
    </div>
  );
}

/** The writing tool: the draft, section shortcuts and a plain-English check. */
function Writer({
  initial,
  hasApproved,
  busy,
  onSave,
}: {
  initial: PolicyVersion | undefined;
  hasApproved: string | undefined;
  busy: boolean;
  onSave: (content: string, note: string) => void;
}) {
  const [content, setContent] = useState(initial?.content ?? hasApproved ?? "");
  const [note, setNote] = useState(initial?.change_note ?? "");
  const report = checkWording(content);
  return (
    <div className="form">
      <label htmlFor="pol-content">Draft wording</label>
      <textarea id="pol-content" rows={18} value={content} onChange={(e) => setContent(e.target.value)} />
      <p className="muted">Start a line with "# " to make it a section heading.</p>
      {report.missing.length > 0 && (
        <div className="row">
          <span className="muted">Add a section:</span>
          {report.missing.map((s) => (
            <button key={s} type="button" className="link-dark" onClick={() => setContent(`${content.trimEnd()}\n\n# ${s}\n`)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="card" role="status" aria-label="Wording check">
        <strong>Wording check</strong>
        <p>
          {report.words} words · about {report.minutes} {report.minutes === 1 ? "minute" : "minutes"} to read ·{" "}
          {STANDARD_SECTIONS.length - report.missing.length} of {STANDARD_SECTIONS.length} standard sections
        </p>
        {report.placeholders.length > 0 && (
          <div className="warning-text">
            {report.placeholders.length} {report.placeholders.length === 1 ? "placeholder or drafting note" : "placeholders or drafting notes"} in [square brackets] to resolve:
            <ul>
              {report.placeholders.slice(0, 8).map((x) => (
                <li key={x}>{x.length > 120 ? `${x.slice(0, 117)}…]` : x}</li>
              ))}
            </ul>
          </div>
        )}
        {report.longSentences.length === 0 ? (
          <p className="muted">No sentences over 30 words.</p>
        ) : (
          <>
            <p className="warning-text">
              {report.longSentences.length} {report.longSentences.length === 1 ? "sentence is" : "sentences are"} over 30 words. Shorter
              sentences are easier to follow and to enforce.
            </p>
            <ul>
              {report.longSentences.slice(0, 5).map((s, i) => (
                <li key={i}>{s.length > 140 ? `${s.slice(0, 140)}…` : s}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <label htmlFor="pol-note">What changed (optional)</label>
      <input id="pol-note" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" disabled={busy} onClick={() => onSave(content, note)}>
        Save draft
      </button>
    </div>
  );
}

export default function Policies({ organisationId, organisationName, role, userId, onOpenTraining }: Props) {
  const canManage = has(role, ...MANAGE_ROLES);

  const [data, setData] = useState<PolicyData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showVersion, setShowVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [ownerId, setOwnerId] = useState("");
  const [months, setMonths] = useState("12");
  const [audience, setAudience] = useState<Audience>("internal");
  const [kind, setKind] = useState<Kind>("policy");
  const [appliesTo, setAppliesTo] = useState("");
  const [startContent, setStartContent] = useState<string | null>(null);
  const [startName, setStartName] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [ownTemplates, setOwnTemplates] = useState<OwnTemplate[]>([]);
  const [upload, setUpload] = useState<{ file: File; text: string; titleFound: boolean; dateFound: boolean } | null>(null);
  const [upTitle, setUpTitle] = useState("");
  const [upFrom, setUpFrom] = useState("");
  const [upTarget, setUpTarget] = useState("");
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(async () => {
    const [policies, people, own] = await Promise.all([loadPolicies(organisationId), loadMembers(organisationId).catch(() => []), loadOwnTemplates(organisationId).catch(() => [])]);
    setData(policies);
    setMembers(people);
    setOwnTemplates(own);
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load policies."));
  }, [reload]);

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

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const active = members.filter((m) => m.is_active);
  const nameOf = (id: string | null) => members.find((m) => m.user_id === id)?.name ?? "Unknown";
  const versionsOf = (id: string) => data.versions.filter((v) => v.policy_id === id);
  const inForce = (id: string) => versionsOf(id).find((v) => v.status === "approved");
  const overdue = (p: Policy) => Boolean(p.next_review_on && p.next_review_on < today());
  const statusOf = (p: Policy) => {
    if (p.is_retired) return "Retired";
    const v = inForce(p.id);
    if (!v) return "Draft, not yet approved";
    return overdue(p) ? "Review overdue" : `In force · version ${v.version_no}`;
  };
  const fileOfPage0 = (policyId: string): PolicyFile | null => {
    const v = inForce(policyId);
    return v?.document_id ? data.files.find((x) => x.document_id === v.document_id) ?? null : null;
  };
  const downloadDoc = (f: PolicyFile) => void downloadFile(f.storage_path, f.file_name).catch((e) => setError(e instanceof Error ? e.message : "Could not download."));
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

  const policy = data.policies.find((p) => p.id === openId);
  if (policy) {
    const versions = versionsOf(policy.id);
    const approved = inForce(policy.id);
    const draft = versions.find((v) => v.status === "draft");
    const canWrite = !policy.is_retired && (canManage || policy.owner_user_id === userId);
    const shown = versions.find((v) => v.id === showVersion);
    const fileOfPage = fileOfPage0(policy.id);
    const download = downloadDoc;
    return (
      <>
        <p>
          <button
            type="button"
            className="link-dark"
            onClick={() => {
              setOpenId(null);
              setShowVersion(null);
              setError(null);
              setNotice(null);
            }}
          >
            ← Back to policies
          </button>
        </p>
        <p className="eyebrow">
          {(policy.audience ?? "internal") === "external" ? "External" : "Internal"} {policy.kind === "code" ? "code of conduct" : "policy"} · {policy.category}
          {policy.applies_to ? ` · for ${policy.applies_to}` : ""}
        </p>
        <h1>{policy.title}</h1>
        <p className="lead">
          <span className={overdue(policy) && !policy.is_retired ? "chip chip-alert" : "chip"}>{statusOf(policy)}</span> Owner: {nameOf(policy.owner_user_id)}
          {policy.next_review_on ? ` · review due ${formatDay(policy.next_review_on)}` : ""}
        </p>
        {messages}

        {approved ? (
          <section className="card">
            <p className="muted">
              Version {approved.version_no}, in force from {formatDay(approved.effective_on ?? approved.approved_at!)}, {approved.source === "uploaded" ? "uploaded" : "approved"} by {nameOf(approved.approved_by)}
            </p>
            {fileOfPage && (
              <p>
                <button type="button" className="quiet" onClick={() => download(fileOfPage)}>
                  ⤓ Download the policy document ({fileOfPage.file_name})
                </button>
              </p>
            )}
            <Wording content={approved.content} />
            <Attachments subjectTable="policies" subjectId={policy.id} canAttach={canWrite} label="Supporting documents" />
          </section>
        ) : (
          <p className="card warning">No version of this policy has been approved yet, so it is not in force.</p>
        )}

        {canWrite && (
          <section className="block">
            <h2>{draft ? `Draft of version ${draft.version_no}` : approved ? "Write a new version" : "Write the policy"}</h2>
            <Writer
              key={draft?.id ?? "new"}
              initial={draft}
              hasApproved={approved?.content}
              busy={busy}
              onSave={(content, note) => void run(() => savePolicyDraft(policy.id, content, note), "Draft saved.")}
            />
            {draft && canManage && (
              <div className="row review">
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    const left = checkWording(draft.content).placeholders;
                    if (left.length && !window.confirm(`The draft still has ${left.length} placeholder${left.length === 1 ? "" : "s"} or drafting note${left.length === 1 ? "" : "s"} in [square brackets], such as ${left[0]}. Approve anyway?`)) return;
                    if (window.confirm("Approve the saved draft? It becomes the version in force and replaces the current one.")) {
                      void run(() => approvePolicyDraft(policy.id), "Approved. This version is now in force.");
                    }
                  }}
                >
                  Approve the saved draft
                </button>
                <span className="muted">Save first. Approval applies to the draft as last saved.</span>
              </div>
            )}
            {draft && !canManage && <p className="muted">Legal, compliance or the company secretary approves the draft.</p>}
          </section>
        )}

        {approved && canWrite && (
          <section className="block">
            <h2>Review</h2>
            <p>
              {policy.last_reviewed_on ? `Last reviewed ${formatDay(policy.last_reviewed_on)}. ` : ""}
              If you have reviewed the policy and nothing needs to change, record that here. Otherwise write a new version.
            </p>
            <div className="row">
              <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => confirmPolicyReview(policy.id), "Review recorded.")}>
                Reviewed, no change needed
              </button>
              {canManage && (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    let id: string | null = null;
                    void run(async () => {
                      id = await moduleForPolicy(policy.id);
                      if (!id)
                        id = await createModule(organisationId, {
                          title: `${policy.title}: read and acknowledge`,
                          summary: `Version ${approved.version_no} of the policy.`,
                          content: approved.content.replace(/^# /gm, "").trim().length >= 20 ? `Read version ${approved.version_no} of the ${policy.title} below.` : `Read the ${policy.title} in full.`,
                          passMark: 0,
                          refreshMonths: 12,
                          questions: [],
                          policyId: policy.id,
                        });
                    }).then((ok) => {
                      if (ok && id && onOpenTraining) onOpenTraining(id);
                    });
                  }}
                >
                  Assign Training
                </button>
              )}
            </div>
          </section>
        )}

        {canManage && !policy.is_retired && (
          <section className="block form">
            <h2>Ownership</h2>
            <label htmlFor="pol-owner">Owner</label>
            <select
              id="pol-owner"
              value={policy.owner_user_id}
              disabled={busy}
              onChange={(e) => void run(() => updatePolicy(policy.id, { owner_user_id: e.target.value }), "Owner changed.")}
            >
              {active.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </select>
            <fieldset className="plain-fieldset">
              <legend>Who it is for</legend>
              <label className="check">
                <input type="radio" name="pol-audience" checked={(policy.audience ?? "internal") === "internal"} disabled={busy} onChange={() => void run(() => updatePolicy(policy.id, { audience: "internal" }))} /> Internal policy
              </label>
              <label className="check">
                <input type="radio" name="pol-audience" checked={policy.audience === "external"} disabled={busy} onChange={() => void run(() => updatePolicy(policy.id, { audience: "external" }))} /> External policy
              </label>
              <label className="check">
                <input type="checkbox" checked={policy.kind === "code"} disabled={busy} onChange={(e) => void run(() => updatePolicy(policy.id, { kind: e.target.checked ? "code" : "policy" }))} /> This is a code of conduct
              </label>
            </fieldset>
            <div className="row">
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  const content = (draft ?? approved)?.content ?? "";
                  const name = window.prompt("Name for the template (it can be reused for other policies or companies)", policy.title);
                  if (name && name.trim().length >= 3)
                    void run(() => saveOwnTemplate(organisationId, { name: name.trim(), category: policy.category, audience: policy.audience ?? "internal", kind: policy.kind ?? "policy", summary: `Saved from ${policy.title}`, content: content.split(organisationName).join("[Company Name]") }), "Saved to your templates. It now appears under Use Policy Templates.");
                }}
              >
                Save as a template
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Retire this policy? It stays on record but is no longer in force.")) void run(() => updatePolicy(policy.id, { is_retired: true }));
                }}
              >
                Retire this policy
              </button>
            </div>
          </section>
        )}

        <section className="block">
          <h2>History</h2>
          <ul className="plain rows">
            {versions.map((v) => (
              <li key={v.id}>
                <span className="row spread">
                  <span>
                    <strong>Version {v.version_no}</strong>
                    <span className="muted">
                      {" "}
                      · {v.status === "draft" ? "draft" : v.status === "approved" ? "in force" : "replaced"}
                      {v.approved_at ? ` · approved ${formatDay(v.approved_at)} by ${nameOf(v.approved_by)}` : ""}
                      {v.change_note ? ` · ${v.change_note}` : ""}
                    </span>
                  </span>
                  {v.status === "superseded" && (
                    <button type="button" className="link-dark" onClick={() => setShowVersion(showVersion === v.id ? null : v.id)}>
                      {showVersion === v.id ? "Hide" : "Read"}
                    </button>
                  )}
                </span>
                {shown?.id === v.id && (
                  <div className="card">
                    <Wording content={v.content} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const n = Number(months);
    if (title.trim().length < 3) return setError("Give the policy a title.");
    if (!ownerId) return setError("Choose the owner. Every policy has a named owner.");
    if (!Number.isInteger(n) || n < 1 || n > 60) return setError("Review every 1 to 60 months.");
    let id = "";
    const content = startContent ?? (audience === "external" ? EXTERNAL_BLANK : POLICY_STARTERS[0].content);
    const ok = await run(async () => {
      id = await createPolicy(organisationId, { title, category, ownerId, reviewMonths: n, content: fillTemplate(content, organisationName), audience, kind, appliesTo });
    });
    if (ok) {
      setTitle("");
      setStartContent(null);
      setStartName(null);
      setAppliesTo("");
      setKind("policy");
      setOpenId(id);
    }
  }

  const useTemplate = (t: { name: string; category: string; audience: Audience; kind: Kind; appliesTo?: string; content: string }) => {
    setTitle(t.name.replace(/ \(published\)$/, ""));
    setCategory(POLICY_CATEGORIES.includes(t.category) ? t.category : "General");
    setAudience(t.audience);
    setKind(t.kind);
    setAppliesTo(t.appliesTo ?? "");
    setStartContent(t.content);
    setStartName(t.name);
    setShowLibrary(false);
    setNotice(`"${t.name}" is ready below. Choose the owner, then add it and start writing.`);
    window.setTimeout(() => document.getElementById("pn-title")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const current = data.policies.filter((p) => !p.is_retired);
  const retired = data.policies.filter((p) => p.is_retired);
  /** The stored document behind the version in force, if it was uploaded */
  const fileOf = (policyId: string): (PolicyFile & { effective_on: string | null }) | null => {
    const v = inForce(policyId);
    const f = v?.document_id ? data.files.find((x) => x.document_id === v.document_id) : undefined;
    return f && v ? { ...f, effective_on: v.effective_on } : null;
  };
  const download = (f: PolicyFile) => void downloadFile(f.storage_path, f.file_name).catch((e) => setError(e instanceof Error ? e.message : "Could not download."));

  async function readUpload(file: File) {
    setError(null);
    setNotice(null);
    if (file.size > 10 * 1024 * 1024) return setError("Files can be up to 10 MB.");
    if (!/\.(docx|pdf)$/i.test(file.name)) return setError("Upload a Word document (.docx) or a PDF. Older .doc files: save as .docx first.");
    setReading(true);
    const d = await readPolicyFile(file);
    setReading(false);
    const title = (d.title ?? "").slice(0, 150);
    setUpTitle(title);
    setUpFrom(d.effectiveOn ?? "");
    // Same name as a policy already here: offer it as the new version
    const match = current.find((p) => title && p.title.toLowerCase() === title.toLowerCase());
    setUpTarget(match?.id ?? "");
    setUpload({ file, text: d.text, titleFound: Boolean(d.title), dateFound: Boolean(d.effectiveOn) });
  }

  async function saveUpload() {
    if (!upload) return;
    const target = upTarget;
    if (!target) {
      if (upTitle.trim().length < 3) return setError("Give the policy a name.");
      if (!ownerId) return setError("Choose the owner. Every policy has a named owner.");
    }
    const n = Number(months);
    if (!target && (!Number.isInteger(n) || n < 1 || n > 60)) return setError("Review every 1 to 60 months.");
    const content = upload.text.trim().length >= 20 ? upload.text : `This policy is held as the uploaded document "${upload.file.name}". Download it to read it.`;
    let id = target;
    const ok = await run(async () => {
      if (!id) id = await createPolicy(organisationId, { title: upTitle.trim(), category, ownerId, reviewMonths: n, content, audience, kind, appliesTo });
      const doc = await attachFile("policies", id, upload.file);
      await recordUploadedPolicy(id, doc, content, upFrom || null);
    }, target ? "Uploaded as the new version in force." : "Policy added from the uploaded document, and in force.");
    if (ok) {
      setUpload(null);
      setAppliesTo("");
      setKind("policy");
    }
  }
  const internal = current.filter((p) => (p.audience ?? "internal") === "internal");
  const external = current.filter((p) => p.audience === "external");
  const row = (p: Policy) => {
    const f = fileOf(p.id);
    return (
    <li key={p.id} className="policy-row">
      {f && (
        <button type="button" className="doc-icon" title={`Download ${f.file_name}`} aria-label={`Download ${p.title} (${f.file_name})`} onClick={() => download(f)}>
          <span aria-hidden="true">{/\.pdf$/i.test(f.file_name) ? "PDF" : "DOC"}</span>
        </button>
      )}
      <button type="button" className="entity-row" onClick={() => setOpenId(p.id)}>
        <span>
          <span className="entity-name">{p.title}</span>
          {p.kind === "code" && <span className="chip chip-inline">Code of conduct</span>}
          <br />
          <span className="muted">
            {p.category} · owner {nameOf(p.owner_user_id)}
            {p.applies_to ? ` · for ${p.applies_to}` : ""}
            {p.next_review_on && !p.is_retired ? ` · review due ${formatDay(p.next_review_on)}` : ""}
          </span>
          {f && (
            <>
              <br />
              <span className="muted small">
                Uploaded {formatDay(f.uploaded_at)}
                {f.effective_on ? ` · current from ${formatDay(f.effective_on)}` : ""}
              </span>
            </>
          )}
        </span>
        <span className={overdue(p) && !p.is_retired ? "chip chip-alert" : "chip"}>{statusOf(p)}</span>
      </button>
    </li>
    );
  };
  const inUse = (name: string) => current.some((p) => p.title.toLowerCase() === name.replace(/ \(published\)$/, "").toLowerCase());
  const templateEntry = (t: { key: string; name: string; summary: string | null; whyNeeded?: string; appliesTo?: string; kind: Kind; content: string; own?: string }, use: () => void) => (
    <details key={t.key} className="card template">
      <summary>
        <strong>{t.name}</strong>
        {t.kind === "code" && <span className="chip">Code of conduct</span>}
        {t.own && <span className="chip">Your template</span>}
        {inUse(t.name) && <span className="chip">Already in your policies</span>}
        <br />
        <span className="muted">{t.summary}</span>
      </summary>
      {t.whyNeeded && (
        <p>
          <strong>Why you may need it: </strong>
          {t.whyNeeded}
        </p>
      )}
      {t.appliesTo && <p className="muted">For: {t.appliesTo}</p>}
      <div className="template-preview">
        <Wording content={fillTemplate(t.content, organisationName)} />
      </div>
      <div className="row">
        <button type="button" onClick={use}>
          Use this template
        </button>
        {t.own && (
          <button type="button" className="link-dark" disabled={busy} onClick={() => { if (window.confirm(`Remove your template "${t.name}"?`)) void run(() => removeOwnTemplate(t.own!), "Template removed."); }}>
            Remove this template
          </button>
        )}
      </div>
    </details>
  );

  if (showLibrary) {
    const group = (aud: Audience) => (
      <>
        {ownTemplates.filter((t) => t.audience === aud).map((t) => templateEntry({ key: t.id, name: t.name, summary: t.summary, kind: t.kind, content: t.content, own: t.id }, () => useTemplate({ ...t, appliesTo: undefined })))}
        {TEMPLATES.filter((t) => t.audience === aud).map((t) => templateEntry({ key: t.id, name: t.name, summary: t.summary, whyNeeded: t.whyNeeded, appliesTo: t.appliesTo, kind: t.kind, content: t.content }, () => useTemplate(t)))}
      </>
    );
    return (
      <>
        <p>
          <button type="button" className="link-dark" onClick={() => setShowLibrary(false)}>
            ← Back to policies
          </button>
        </p>
        <p className="eyebrow">Policy repository</p>
        <h1>Policy templates</h1>
        <p className="lead">Starting points for common policies, written for Australian companies. Open one to read it, then use it to start a draft.</p>
        <p className="muted">
          {organisationName} is filled in for you. Anything else in [square brackets] is a placeholder or a drafting note; the draft flags them until each one is resolved. Templates are general and are not legal advice: tailor them to the business and check them against current law.
        </p>
        {messages}
        <section className="block">
          <h2>Internal policies</h2>
          <p className="muted">For people who work for the company: directors, employees and contractors.</p>
          {group("internal")}
        </section>
        <section className="block">
          <h2>External policies</h2>
          <p className="muted">For people outside the company: suppliers, partners, customers and the public.</p>
          {group("external")}
        </section>
        <p className="muted">To add your own, open any policy and choose "Save as a template".</p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Policy repository</p>
      <h1>Policies</h1>
      {messages}
      {canManage && (
        <p>
          <button type="button" className="quiet" onClick={() => { setShowLibrary(true); setNotice(null); setError(null); }}>
            Use Policy Templates
          </button>
        </p>
      )}
      {canManage && !upload && (
        <div
          className={dragging ? "dropzone on block" : "dropzone block"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void readUpload(f);
          }}
        >
          <p>
            <strong>{reading ? "Reading the document…" : "Drop an existing policy here"}</strong>
          </p>
          <p className="muted">Word (.docx) or PDF. The policy name and the date it is current from are read from the document for you to check. The document is kept as the version in force, ready to download.</p>
          <label className="quiet-button">
            <input id="policy-file" type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="visually-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readUpload(f); e.target.value = ""; }} />
            Choose a file
          </label>
        </div>
      )}
      {canManage && upload && (
        <section className="card form block">
          <h2>Add the uploaded policy: {upload.file.name}</h2>
          <p className={upload.titleFound ? "card note" : "card warning"} role="status">
            {upload.titleFound ? "The name below was read from the document." : "No title was found in the document, so the file name is used."}{" "}
            {upload.dateFound ? "So was the date it is current from." : "No effective or approval date was found: enter it, or leave it blank to use today."}{" "}
            {upload.text.trim().length < 20 ? "The text could not be read (it may be a scan), so the policy will be the document only." : "Its text is kept so it can be read in VeraPhius."}
          </p>
          <label htmlFor="up-target">This is</label>
          <select id="up-target" value={upTarget} onChange={(e) => setUpTarget(e.target.value)}>
            <option value="">A policy not yet in VeraPhius</option>
            {current.map((p) => (
              <option key={p.id} value={p.id}>
                A new version of: {p.title}
              </option>
            ))}
          </select>
          {!upTarget && (
            <>
              <label htmlFor="up-title">Policy name</label>
              <input id="up-title" className={upload.titleFound ? "from-certificate" : undefined} value={upTitle} onChange={(e) => setUpTitle(e.target.value)} />
              <fieldset className="plain-fieldset">
                <legend>Who is it for?</legend>
                <label className="check option-help">
                  <input type="radio" name="up-audience" checked={audience === "internal"} onChange={() => setAudience("internal")} /> <strong>Internal policy</strong>
                  <span className="muted"> · for people who work for the company</span>
                </label>
                <label className="check option-help">
                  <input type="radio" name="up-audience" checked={audience === "external"} onChange={() => setAudience("external")} /> <strong>External policy</strong>
                  <span className="muted"> · for suppliers, partners, customers or the public</span>
                </label>
              </fieldset>
              <label className="check">
                <input type="checkbox" checked={kind === "code"} onChange={(e) => setKind(e.target.checked ? "code" : "policy")} /> This is a code of conduct
              </label>
              {audience === "external" && (
                <>
                  <label htmlFor="up-applies">Who it applies to</label>
                  <input id="up-applies" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} />
                </>
              )}
              <div className="row">
                <span className="field">
                  <label htmlFor="up-category">Category</label>
                  <select id="up-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {POLICY_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </span>
                <span className="field">
                  <label htmlFor="up-owner">Owner</label>
                  <select id="up-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">Choose…</option>
                    {active.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="field">
                  <label htmlFor="up-months">Review every (months)</label>
                  <input id="up-months" className="short" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
                </span>
              </div>
            </>
          )}
          <label htmlFor="up-from">Current from</label>
          <input id="up-from" type="date" className={upload.dateFound ? "from-certificate" : undefined} value={upFrom} onChange={(e) => setUpFrom(e.target.value)} />
          <p className="muted">Uploading records the document as approved and in force from this date (today if blank). The next review is due one review cycle after it.</p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void saveUpload()}>
              {busy ? "Saving…" : "Save the policy"}
            </button>
            <button type="button" className="quiet" onClick={() => setUpload(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
      <section className="block">
        <h2>Internal policies</h2>
        {internal.length === 0 ? (
          <p className="muted">{canManage ? "None yet. Add one below, or start from a template." : "None have been added."}</p>
        ) : (
          <ul className="entity-list">{internal.map(row)}</ul>
        )}
      </section>
      <section className="block">
        <h2>External policies</h2>
        {external.length === 0 ? <p className="muted">None yet. External policies are for suppliers, partners, customers and the public, such as a Supplier Code of Conduct.</p> : <ul className="entity-list">{external.map(row)}</ul>}
      </section>
      {retired.length > 0 && (
        <section className="block">
          <h2>Retired</h2>
          <ul className="entity-list">{retired.map(row)}</ul>
        </section>
      )}

      {canManage && (
        <form className="card form" onSubmit={submit}>
          <h2>Add a policy</h2>
          <fieldset className="plain-fieldset">
            <legend>Who is it for?</legend>
            <label className="check option-help">
              <input type="radio" name="pn-audience" checked={audience === "internal"} onChange={() => setAudience("internal")} /> <strong>Internal policy</strong>
              <span className="muted"> · for people who work for the company, e.g. the Employee Code of Conduct</span>
            </label>
            <label className="check option-help">
              <input type="radio" name="pn-audience" checked={audience === "external"} onChange={() => setAudience("external")} /> <strong>External policy</strong>
              <span className="muted"> · for people outside the company, e.g. the Supplier Code of Conduct or the published privacy policy</span>
            </label>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={kind === "code"} onChange={(e) => setKind(e.target.checked ? "code" : "policy")} /> This is a code of conduct
          </label>
          {audience === "external" && (
            <>
              <label htmlFor="pn-applies">Who it applies to</label>
              <input id="pn-applies" placeholder="e.g. Suppliers, contract manufacturers and their subcontractors" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} />
            </>
          )}
          <label htmlFor="pn-title">Title</label>
          <input id="pn-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="row">
            <span className="field">
              <label htmlFor="pn-category">Category</label>
              <select id="pn-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {POLICY_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </span>
            <span className="field">
              <label htmlFor="pn-owner">Owner</label>
              <select id="pn-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Choose…</option>
                {active.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </span>
            <span className="field">
              <label htmlFor="pn-months">Review every (months)</label>
              <input id="pn-months" className="short" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} />
            </span>
          </div>
          <p className="muted">
            Starting from: <strong>{startName ?? (audience === "external" ? "a blank external policy with the standard sections" : "a blank policy with the standard sections")}</strong>.{" "}
            {startName ? (
              <button type="button" className="link-dark" onClick={() => { setStartContent(null); setStartName(null); }}>
                Start blank instead
              </button>
            ) : (
              <button type="button" className="link-dark" onClick={() => setShowLibrary(true)}>
                Choose a template
              </button>
            )}
          </p>
          <button type="submit" disabled={busy}>
            Add and start writing
          </button>
        </form>
      )}
    </>
  );
}
