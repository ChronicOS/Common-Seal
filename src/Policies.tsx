import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, loadMembers, type Member } from "./board";
import {
  approvePolicyDraft,
  checkWording,
  confirmPolicyReview,
  createPolicy,
  loadPolicies,
  POLICY_CATEGORIES,
  POLICY_STARTERS,
  savePolicyDraft,
  STANDARD_SECTIONS,
  updatePolicy,
  type Policy,
  type PolicyData,
  type PolicyVersion,
} from "./policies";
import { createModule, today } from "./training";

type Props = { organisationId: string; role: string; userId: string };

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

export default function Policies({ organisationId, role, userId }: Props) {
  const canManage = MANAGE_ROLES.includes(role);

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
  const [starter, setStarter] = useState(0);

  const reload = useCallback(async () => {
    const [policies, people] = await Promise.all([loadPolicies(organisationId), loadMembers(organisationId).catch(() => [])]);
    setData(policies);
    setMembers(people);
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
        <p className="eyebrow">{policy.category}</p>
        <h1>{policy.title}</h1>
        <p className="lead">
          <span className={overdue(policy) && !policy.is_retired ? "chip chip-alert" : "chip"}>{statusOf(policy)}</span> Owner: {nameOf(policy.owner_user_id)}
          {policy.next_review_on ? ` · review due ${formatDay(policy.next_review_on)}` : ""}
        </p>
        {messages}

        {approved ? (
          <section className="card">
            <p className="muted">
              Version {approved.version_no}, in force from {formatDay(approved.effective_on ?? approved.approved_at!)}, approved by {nameOf(approved.approved_by)}
            </p>
            <Wording content={approved.content} />
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
                  onClick={() =>
                    void run(async () => {
                      await createModule(organisationId, {
                        title: `${policy.title}: read and acknowledge`,
                        summary: `Version ${approved.version_no} of the policy.`,
                        content: approved.content.replace(/^# /gm, ""),
                        passMark: 80,
                        refreshMonths: policy.review_every_months,
                        questions: [],
                      });
                    }, "A draft training module was created. Publish and assign it under Training.")
                  }
                >
                  Create read-and-acknowledge training
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
    const ok = await run(async () => {
      id = await createPolicy(organisationId, { title, category, ownerId, reviewMonths: n, content: POLICY_STARTERS[starter].content });
    });
    if (ok) {
      setTitle("");
      setOpenId(id);
    }
  }

  const current = data.policies.filter((p) => !p.is_retired);
  const retired = data.policies.filter((p) => p.is_retired);
  const row = (p: Policy) => (
    <li key={p.id}>
      <button type="button" className="entity-row" onClick={() => setOpenId(p.id)}>
        <span>
          <span className="entity-name">{p.title}</span>
          <br />
          <span className="muted">
            {p.category} · owner {nameOf(p.owner_user_id)}
            {p.next_review_on && !p.is_retired ? ` · review due ${formatDay(p.next_review_on)}` : ""}
          </span>
        </span>
        <span className={overdue(p) && !p.is_retired ? "chip chip-alert" : "chip"}>{statusOf(p)}</span>
      </button>
    </li>
  );

  return (
    <>
      <p className="eyebrow">Policy repository</p>
      <h1>Policies</h1>
      {messages}
      <section className="block">
        {current.length === 0 ? (
          <p className="muted">{canManage ? "No policies yet. Add the first one below." : "No policies have been added."}</p>
        ) : (
          <ul className="entity-list">{current.map(row)}</ul>
        )}
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
          <label htmlFor="pn-starter">Start from</label>
          <select
            id="pn-starter"
            value={starter}
            onChange={(e) => {
              const i = Number(e.target.value);
              setStarter(i);
              if (i > 0) setCategory(POLICY_STARTERS[i].category);
            }}
          >
            {POLICY_STARTERS.map((s, i) => (
              <option key={s.name} value={i}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="muted">Starters are skeletons with the standard sections and a few example rules. You rewrite them before approval.</p>
          <button type="submit" disabled={busy}>
            Add and start writing
          </button>
        </form>
      )}
    </>
  );
}
