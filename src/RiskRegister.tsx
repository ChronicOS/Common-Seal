import { addRiskFeed, loadRiskFeed, type FeedItem } from "./registers";
import { has, roleLabels } from "./roles";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, loadMembers, type Member } from "./board";
import {
  actionLink,
  addContact,
  addDays,
  cancelReview,
  commentItem,
  createReview,
  deleteItem,
  EMAIL_NAME,
  finaliseReview,
  FREQUENCY,
  liveActions,
  loadRisk,
  mailto,
  markPromptSent,
  markRequestSent,
  promptDue,
  removeContact,
  setReportRecipients,
  replaceContact,
  removeOwner,
  requestEmailDue,
  respondLink,
  REVIEW_STATUS,
  saveCategory,
  saveItem,
  setOwner,
  setRequestFinished,
  today,
  updateReview,
  type Category,
  type Contact,
  type Frequency,
  type Item,
  type Request,
  type RequestEmail,
  type Review,
  type RiskData,
} from "./risk";
import { blankRisk, RiskCard, RiskForm } from "./RiskParts";
import { downloadRiskReport } from "./riskReport";

type Props = { organisationId: string; organisationName: string; role: string; userId: string };
type View = { kind: "home" } | { kind: "confirm"; mode: "run" | "schedule" } | { kind: "review"; id: string };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];

function ContactForm({ fixedRole, busy, initial, onAdd, onCancel }: { fixedRole: Contact["role"]; busy: boolean; initial?: Contact; onAdd: (k: { role: Contact["role"]; name: string; title: string; email: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  return (
    <div className="row review">
      <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input aria-label="Email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="button" className="quiet" disabled={busy || name.trim().length < 2 || !/.+@.+\..+/.test(email)} onClick={() => onAdd({ role: fixedRole, name, title, email })}>
        {initial ? "Save" : "Add"}
      </button>
      <button type="button" className="link-dark" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** Who the report is sent to: the report owner by default, with others added or removed. */
function SendTo({ initial, isDefault, busy, href, onSave }: { initial: string[]; isDefault: boolean; busy: boolean; href: (list: string[]) => string; onSave: (list: string[]) => void }) {
  const [list, setList] = useState(initial);
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(initial.join(","));
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  const add = () => {
    const e = email.trim().toLowerCase();
    if (valid && !list.includes(e)) setList([...list, e]);
    setEmail("");
  };
  return (
    <section className="card form">
      <h2>Send to</h2>
      <p className="muted">{isDefault ? "By default the report goes to the person responsible for it. " : ""}Add anyone else who should receive it.</p>
      {list.length === 0 && <p className="warning-text">Nobody is listed yet. Add at least one email address.</p>}
      <ul className="plain">
        {list.map((e) => (
          <li key={e} className="row">
            <span>{e}</span>
            <button type="button" className="link-dark small" aria-label={`Remove ${e}`} onClick={() => setList(list.filter((x) => x !== e))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input aria-label="Email address to add" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="quiet" disabled={!valid} onClick={add}>
          Add person
        </button>
      </div>
      <div className="row">
        <button type="button" className="quiet" disabled={busy || list.join(",") === saved} onClick={() => { onSave(list); setSaved(list.join(",")); }}>
          Save list
        </button>
        {list.length > 0 && (
          <a className="link-dark" href={href(list)}>
            Open email to {list.length === 1 ? "this person" : `these ${list.length} people`}
          </a>
        )}
      </div>
      <p className="muted">VeraPhius cannot attach the file for you yet: download the PowerPoint above and attach it to the email.</p>
    </section>
  );
}

/** The prompts and scope for a category. Its name is fixed once created. */
function CategorySettings({ c, busy, onSave }: { c: Category; busy: boolean; onSave: (patch: { covers: string; examples: string; is_active: boolean }) => void }) {
  const [covers, setCovers] = useState(c.covers ?? "");
  const [examples, setExamples] = useState(c.examples ?? "");
  const changed = covers !== (c.covers ?? "") || examples !== (c.examples ?? "");
  return (
    <details className="card category">
      <summary>
        <strong>{c.name}</strong>
        {!c.is_active && <span className="chip">Not used</span>}
      </summary>
      <div className="form">
        <label htmlFor={`rc-covers-${c.id}`}>Includes (optional)</label>
        <input id={`rc-covers-${c.id}`} value={covers} onChange={(e) => setCovers(e.target.value)} />
        <label htmlFor={`rc-ex-${c.id}`}>Material risk examples (shown faintly in the Risk box as a prompt)</label>
        <textarea id={`rc-ex-${c.id}`} rows={3} value={examples} onChange={(e) => setExamples(e.target.value)} />
        <div className="row">
          <button type="button" className="quiet" disabled={busy || !changed} onClick={() => onSave({ covers, examples, is_active: c.is_active })}>
            Save changes
          </button>
          <button type="button" className="link-dark" disabled={busy} onClick={() => onSave({ covers: c.covers ?? "", examples: c.examples ?? "", is_active: !c.is_active })}>
            {c.is_active ? "Stop using this category" : "Use this category"}
          </button>
        </div>
      </div>
    </details>
  );
}

function ModifyReview({ r, busy, onSave, onCancelReview }: { r: Review; busy: boolean; onSave: (patch: Parameters<typeof updateReview>[1]) => void; onCancelReview: () => void }) {
  const [v, setV] = useState({ name: r.name, forum: r.forum ?? "", frequency: r.frequency, forum_on: r.forum_on, start_on: r.start_on, respond_by: r.respond_by, reminder2_on: r.reminder2_on, escalate_on: r.escalate_on });
  const scheduled = r.status === "scheduled";
  const shift = (forumOn: string) => {
    const start = scheduled ? (addDays(forumOn, -31) < today() ? today() : addDays(forumOn, -31)) : v.start_on;
    setV(scheduled ? { ...v, forum_on: forumOn, start_on: start, respond_by: addDays(start, 14), reminder2_on: addDays(start, 19), escalate_on: addDays(start, 24) } : { ...v, forum_on: forumOn });
  };
  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...v, forum: v.forum || null });
      }}
    >
      <label htmlFor="mr-name">Name</label>
      <input id="mr-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <div className="row">
        <span className="field">
          <label htmlFor="mr-date">Forum date</label>
          <input id="mr-date" type="date" value={v.forum_on} onChange={(e) => shift(e.target.value)} />
        </span>
        <span className="field">
          <label htmlFor="mr-frequency">Repeat</label>
          <select id="mr-frequency" value={v.frequency} onChange={(e) => setV({ ...v, frequency: e.target.value as Frequency })}>
            {(Object.keys(FREQUENCY) as Frequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQUENCY[f]}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="row">
        <span className="field">
          <label htmlFor="mr-respond">Responses due</label>
          <input id="mr-respond" type="date" value={v.respond_by} onChange={(e) => setV({ ...v, respond_by: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="mr-r2">Second reminder</label>
          <input id="mr-r2" type="date" value={v.reminder2_on} onChange={(e) => setV({ ...v, reminder2_on: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="mr-esc">Escalation</label>
          <input id="mr-esc" type="date" value={v.escalate_on} onChange={(e) => setV({ ...v, escalate_on: e.target.value })} />
        </span>
      </div>
      <span className="muted">The dates must run in order: responses due, second reminder, escalation, forum.</span>
      <div className="row">
        <button type="submit" disabled={busy}>
          Save changes
        </button>
        <button
          type="button"
          className="link-dark"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Cancel this review? Links already sent will stop working.")) onCancelReview();
          }}
        >
          Cancel this review
        </button>
      </div>
    </form>
  );
}

function CommentBox({ item, busy, onSave, onCancel }: { item: Item; busy: boolean; onSave: (comment: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(item.owner_comment ?? "");
  return (
    <div className="form review">
      <label htmlFor={`rcm-${item.id}`}>Your comment or question on this risk</label>
      <textarea id={`rcm-${item.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      <span className="muted">It appears beside the risk on the risk owner's page, with a tick box for them to show they have amended it.</span>
      <div className="row">
        <button type="button" disabled={busy || text.trim().length < 3} onClick={() => onSave(text)}>
          Save comment
        </button>
        {item.owner_comment && (
          <button type="button" className="link-dark" disabled={busy} onClick={() => onSave("")}>
            Remove the comment
          </button>
        )}
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function RiskRegister({ organisationId, organisationName, role, userId }: Props) {
  const canManage = has(role, ...MANAGE_ROLES);
  // Whoever manages the register can name the report owner
  const isAdmin = has(role, ...MANAGE_ROLES);

  const [data, setData] = useState<RiskData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [forumOn, setForumOn] = useState(() => addDays(today(), 45));
  const [frequency, setFrequency] = useState<Frequency>("quarterly");
  const [bespoke, setBespoke] = useState("");
  // Which form is open: an item id, "new-<category id>", or none
  const [editing, setEditing] = useState<string | null>(null);
  const [commenting, setCommenting] = useState<string | null>(null);
  const [modifying, setModifying] = useState(false);
  const [ownerPick, setOwnerPick] = useState("");
  // Which "add a person" form is open: "<category id>:<role>"
  const [adding, setAdding] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [risk, people] = await Promise.all([loadRisk(organisationId), loadMembers(organisationId).catch(() => [])]);
    setData(risk);
    setMembers(people);
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the risk register."));
  }, [reload]);

  // What Key Employees, Key Contracts and Disputes say belongs in the open review
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedCategory, setFeedCategory] = useState<Record<string, string>>({});
  const feedReview = view.kind === "review" ? view.id : null;
  useEffect(() => {
    setFeed([]);
    if (!feedReview || !data || data.reviews.find((x) => x.id === feedReview)?.status !== "collecting") return;
    let live = true;
    loadRiskFeed(feedReview).then((f) => live && setFeed(f));
    return () => {
      live = false;
    };
  }, [feedReview, data]);

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
  const go = (next: View) => {
    setError(null);
    setNotice(null);
    setEditing(null);
    setCommenting(null);
    setModifying(false);
    setAdding(null);
    setView(next);
  };

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="lead">Loading…</p>
    );
  }

  const isOwner = isAdmin || data.owners.some((o) => o.user_id === userId);
  const canRun = canManage || isOwner;
  const memberName = (id: string) => members.find((m) => m.user_id === id)?.name ?? "A member";
  const owner = data.owners.find((o) => !o.is_backup);
  const ownerName = owner ? memberName(owner.user_id) : "";
  const ownerEmail = /.+@.+\..+/.test(ownerName) ? ownerName : null;
  const backups = data.owners.filter((o) => o.is_backup);
  const contactsOf = (categoryId: string) => data.contacts.filter((k) => k.category_id === categoryId);
  const active = data.categories.filter((c) => c.is_active);
  const ready = active.filter((c) => contactsOf(c.id).some((k) => k.role === "responsible"));
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
  const back = (to: View, label: string) => (
    <p>
      <button type="button" className="link-dark" onClick={() => go(to)}>
        ← {label}
      </button>
    </p>
  );
  const start = (mode: "run" | "schedule") => {
    if (!owner) return setError("Name the person responsible for the report first, under \"Who is responsible\".");
    if (ready.length === 0) return setError("Add a responsible person to at least one risk category first, under \"Who is responsible\".");
    go({ kind: "confirm", mode });
  };

  // ---- Name and dates ----
  if (view.kind === "confirm") {
    const runNow = view.mode === "run";
    const startOn = runNow ? today() : addDays(forumOn, -31) < today() ? today() : addDays(forumOn, -31);
    const forumDate = runNow ? addDays(today(), 31) : forumOn;
    return (
      <>
        {back({ kind: "home" }, "Back to the risk register")}
        <p className="eyebrow">{runNow ? "Run Risk Review" : "Schedule Risk Review"}</p>
        <h1>{runNow ? "Run it now" : "Set the date"}</h1>
        {messages}
        <form
          className="card form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (name.trim().length < 3) return setError("Name the review, for example Q4 2026 risk review.");
            if (!runNow && forumOn < today()) return setError("The forum date cannot be in the past.");
            let id = "";
            void run(async () => {
              id = await createReview(organisationId, { name, forum: "", forumOn: runNow ? null : forumOn, frequency: runNow ? "once" : frequency });
            }).then((ok) => ok && go({ kind: "review", id }));
          }}
        >
          <label htmlFor="rv-name">Name</label>
          <input id="rv-name" placeholder="e.g. Q4 2026 risk review" value={name} onChange={(e) => setName(e.target.value)} />
          {!runNow && (
            <div className="row">
              <span className="field">
                <label htmlFor="rv-date">Forum date</label>
                <input id="rv-date" type="date" min={today()} value={forumOn} onChange={(e) => setForumOn(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="rv-frequency">Repeat</label>
                <select id="rv-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                  {(Object.keys(FREQUENCY) as Frequency[]).map((f) => (
                    <option key={f} value={f}>
                      {f === "once" ? "On this date only" : FREQUENCY[f]}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          )}
          <div>
            <strong>Timeline</strong>
            <ul>
              <li>Requests go out: {formatDay(startOn)}</li>
              <li>Responses due, then first reminder: {formatDay(addDays(startOn, 14))} (two weeks)</li>
              <li>Second reminder: {formatDay(addDays(startOn, 19))} (five days later)</li>
              <li>Escalation to the manager: {formatDay(addDays(startOn, 24))} (five days later)</li>
              <li>The report owner reviews and finalises: one week</li>
              <li>
                Report due: {formatDay(forumDate)}
              </li>
            </ul>
            {!runNow && addDays(forumOn, -31) < today() && <p className="warning-text">That date is less than 31 days away, so requests go out today and the steps are squeezed to fit.</p>}
          </div>
          <p className="muted">
            {ready.length} of {active.length} categories have a responsible person and will be included.
          </p>
          <button type="submit" disabled={busy}>
            {runNow ? "Start the review" : "Schedule the review"}
          </button>
        </form>
      </>
    );
  }

  // ---- One review: the Risk Categories page ----
  if (view.kind === "review") {
    const r = data.reviews.find((x) => x.id === view.id);
    // Called as a plain function, not mounted as a component, so the forms inside keep their state between renders
    if (r) return reviewPage(r, data);
  }

  function reviewPage(r: Review, d: RiskData) {
    const requests = d.requests.filter((q) => q.review_id === r.id);
    const categories = d.categories.filter((c) => requests.some((q) => q.category_id === c.id));
    const collecting = r.status === "collecting";
    const due = requests.map((q) => ({ q, kind: requestEmailDue(r, q, today()) })).filter((x): x is { q: Request; kind: RequestEmail } => x.kind !== null);
    const answered = requests.filter((q) => q.submitted_at).length;
    const ownersReview = collecting && today() >= r.escalate_on;
    const canEdit = isOwner && collecting;

    const email = (q: Request, kind: RequestEmail) => {
      const c = d.categories.find((x) => x.id === q.category_id)!;
      const people = contactsOf(c.id);
      const responsible = people.filter((k) => k.role === "responsible");
      const managers = people.filter((k) => k.role === "manager");
      const link = respondLink(q.token);
      const where = `${r.forum ?? "the forum"} on ${formatDay(r.forum_on)}`;
      const greeting = `Dear ${(kind === "escalation" && managers.length ? managers : responsible).map((k) => k.name.split(" ")[0]).join(", ")},`;
      const bodies: Record<RequestEmail, string> = {
        request: `${greeting}\n\nWe are preparing the ${r.name} for ${where}. You are responsible for ${c.name} risk.\n\nPlease record each risk, what you are doing about it (actions, controls or mitigations) and a due date. You can save as you go and come back to edit. When you are done, press Finished. If there is nothing to report, please say so.\n\n${link}\n\nPlease respond by ${formatDay(r.respond_by)}.\n\nThank you,\n${organisationName}`,
        reminder1: `${greeting}\n\nThis is a reminder that your input on ${c.name} risk for the ${r.name} was due on ${formatDay(r.respond_by)} and has not yet been marked as finished.\n\n${link}\n\nPlease respond within five days.\n\nThank you,\n${organisationName}`,
        reminder2: `${greeting}\n\nThis is a second reminder. Your input on ${c.name} risk for the ${r.name} is still outstanding.\n\n${link}\n\nIf we do not receive it within five days, we will ask your manager to respond.\n\nThank you,\n${organisationName}`,
        escalation: `${greeting}\n\nInput on ${c.name} risk for the ${r.name} was due on ${formatDay(r.respond_by)}. After two reminders to ${responsible.map((k) => k.name).join(" and ")} it has not been received.\n\nThe report goes to ${where}. Please complete it, or arrange for it to be completed, as soon as you can:\n\n${link}\n\nThank you,\n${organisationName}`,
      };
      const subject = `${kind === "request" ? "" : kind === "escalation" ? "Escalation: " : "Reminder: "}${r.name}: ${c.name} risk input${kind === "request" ? ` due ${formatDay(r.respond_by)}` : " overdue"}`;
      const to = kind === "escalation" && managers.length ? managers : responsible;
      return { c, subject, body: bodies[kind], href: mailto(to.map((k) => k.email), subject, bodies[kind], kind === "escalation" ? responsible.map((k) => k.email) : []), noManager: kind === "escalation" && managers.length === 0 };
    };

    return (
      <>
        {back({ kind: "home" }, "Back to the risk register")}
        <p className="eyebrow">Risk review</p>
        <h1>{r.name}</h1>
        <p className="lead">
          <span className="chip">{REVIEW_STATUS[r.status]}</span> {r.forum ?? "Forum"} on {formatDay(r.forum_on)}
          {r.frequency !== "once" ? ` · repeats ${FREQUENCY[r.frequency].toLowerCase()}` : ""}
          {r.status !== "scheduled" ? ` · ${answered} of ${requests.length} categories finished` : ""}
        </p>
        {messages}

        {r.status === "scheduled" && <p className="card">Requests go out on {formatDay(r.start_on)}. The review starts the first time someone opens the risk register on or after that date.</p>}
        {ownersReview && (
          <p className="card warning">
            The response period has ended. {owner ? memberName(owner.user_id) : "The report owner"} now reviews the inputs and finalises the report before {formatDay(r.forum_on)}.
          </p>
        )}

        {canRun && (r.status === "scheduled" || collecting) && (
          <section className="block">
            <button type="button" className="quiet" onClick={() => setModifying(!modifying)}>
              {modifying ? "Close" : "Modify this review"}
            </button>
            {modifying && (
              <ModifyReview
                key={r.id}
                r={r}
                busy={busy}
                onSave={(patch) => void run(() => updateReview(r.id, patch), "Review updated.").then((ok) => ok && setModifying(false))}
                onCancelReview={() => void run(() => cancelReview(r.id), "Review cancelled.").then((ok) => ok && go({ kind: "home" }))}
              />
            )}
          </section>
        )}

        {canRun && due.length > 0 && (
          <section className="block">
            <h2>Emails to send</h2>
            <p className="muted">"Open email" opens the message in your own mail program, addressed and with the personal link. Send it, then mark it as sent.</p>
            <ul className="plain rows">
              {due.map(({ q, kind }) => {
                const m = email(q, kind);
                return (
                  <li key={q.id} className="row spread">
                    <span>
                      <strong>{m.c.name}</strong> <span className={kind === "request" ? "chip" : "chip chip-alert"}>{EMAIL_NAME[kind]}</span>
                      {m.noManager && <span className="warning-text"> No manager is set for this category, so this goes to the responsible users again.</span>}
                    </span>
                    <span className="row">
                      <a className="link-dark" href={m.href}>
                        Open email
                      </a>
                      <button type="button" className="link-dark" onClick={() => void navigator.clipboard.writeText(`Subject: ${m.subject}\n\n${m.body}`).then(() => setNotice("Email text copied."), () => setError("Could not copy."))}>
                        Copy
                      </button>
                      <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => markRequestSent(q.id, kind))}>
                        Mark as sent
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {canEdit && feed.length > 0 && (
          <section className="card feed-card">
            <div className="row spread">
              <h2>From Key Employees, Key Contracts and Disputes</h2>
              {feed.some((f) => f.category_id) && (
                <button type="button" className="quiet" disabled={busy} onClick={() => { let n = 0; void run(async () => { n = await addRiskFeed(r.id, null); }).then((ok) => ok && setNotice(`${n} added to the review. Edit any of them as you would any other risk.`)); }}>
                  Add all{feed.some((f) => !f.category_id) ? " with a category" : ""}
                </button>
              )}
            </div>
            <p className="muted">These registers show {feed.length} {feed.length === 1 ? "item" : "items"} not yet in this review. Each is added to its category with a suggested action you can change; it stays linked to its source and carries forward while open.</p>
            <ul className="plain rows">
              {feed.map((f) => {
                const [first, ...rest] = f.title.split("\n");
                return (
                  <li key={f.source_id} className="row spread">
                    <span>
                      <span className="chip">{f.register}</span> <strong>{first}</strong>
                      {rest.length > 0 && <span className="muted small"><br />{rest.join(" · ")}</span>}
                      <br />
                      <span className="muted small">Suggested action: {f.action}{f.due_on ? ` · by ${formatDay(f.due_on)}` : ""}</span>
                    </span>
                    <span className="row">
                      {f.category_id ? (
                        <span className="muted small">{f.category_name}</span>
                      ) : (
                        <select aria-label={`Category for ${first}`} value={feedCategory[f.source_id] ?? ""} onChange={(e) => setFeedCategory({ ...feedCategory, [f.source_id]: e.target.value })}>
                          <option value="">Choose a category</option>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                      <button
                        type="button"
                        className="quiet"
                        disabled={busy || (!f.category_id && !feedCategory[f.source_id])}
                        onClick={() => void run(() => addRiskFeed(r.id, f.source_id, f.category_id ? null : feedCategory[f.source_id]).then(() => undefined), "Added to the review.")}
                      >
                        Add
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {r.status !== "scheduled" && (
          <section className="block">
            <div className="row spread">
              <h2>Risk Categories</h2>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => void run(() => downloadRiskReport(organisationName, r, d.categories, d.contacts, d.requests, d.items), "The PowerPoint file has been downloaded.")}
              >
                Download as PowerPoint
              </button>
            </div>
            <p className="muted">
              One slide per category in 10 point Arial; a long category runs on to further slides.{r.status === "final" ? "" : " It is marked Draft until the report is finalised."}
              {canEdit ? " You can add and edit risks on a person's behalf, and comment on any risk." : ""}
            </p>
            {categories.map((c, n) => {
              const q = requests.find((x) => x.category_id === c.id)!;
              const items = d.items.filter((i) => i.review_id === r.id && i.category_id === c.id);
              const responsible = contactsOf(c.id).filter((k) => k.role === "responsible");
              const unresolved = items.filter((i) => i.owner_comment && !i.comment_resolved).length;
              return (
                <div key={c.id} className="card risk-slide">
                  <div className="row spread">
                    <h3>
                      {n + 1}. {c.name}
                    </h3>
                    <span className={q.submitted_at && unresolved === 0 ? "chip" : "chip chip-alert"}>
                      {unresolved > 0
                        ? `${unresolved} ${unresolved === 1 ? "comment" : "comments"} awaiting the risk owner`
                        : q.submitted_at
                          ? `Finished by ${q.submitted_by ?? "the responsible user"}, ${formatDay(q.submitted_at)}`
                          : items.length > 0
                            ? "In progress, not finished"
                            : q.escalated_at
                              ? "Escalated, no response"
                              : q.opened_at
                                ? "Opened, nothing saved"
                                : q.sent_at
                                  ? "Sent, no response"
                                  : "Not sent"}
                    </span>
                  </div>
                  <p className="muted">
                    {c.covers ? `Covers: ${c.covers}. ` : ""}Responsible: {responsible.map((k) => k.name).join(", ") || "nobody"}
                  </p>
                  {items.length === 0 && editing !== `new-${c.id}` && (
                    <p className={q.submitted_at ? "muted" : "warning-text"}>{q.submitted_at ? "Nothing to report this period." : "No risks saved yet. This is not the same as nothing to report."}</p>
                  )}
                  {items.map((i) => (
                    <div key={i.id} className="risk-entry">
                      {editing === i.id ? (
                        <RiskForm
                          idPrefix={`e-${i.id}`}
                          initial={{ title: i.title + (i.detail ? `\n${i.detail}` : ""), action: i.action, due_on: i.due_on ?? "", actioner: i.actioner ?? "", actioner_email: i.actioner_email ?? "", is_closed: i.is_closed, comment_resolved: i.comment_resolved }}
                          examples={c.examples}
                          comment={i.owner_comment}
                          isSaved
                          busy={busy}
                          onSave={(v) => void run(() => saveItem(organisationId, r.id, c.id, i.id, v, Boolean(i.owner_comment))).then((ok) => ok && setEditing(null))}
                          onCancel={() => setEditing(null)}
                          onDelete={() => void run(() => deleteItem(i.id)).then((ok) => ok && setEditing(null))}
                        />
                      ) : (
                        <RiskCard
                          title={i.title + (i.detail ? `\n${i.detail}` : "")}
                          action={i.action}
                          due_on={i.due_on}
                          actioner={i.actioner ?? (responsible.map((k) => k.name).join(", ") || null)}
                          is_closed={i.is_closed}
                          carried={Boolean(i.carried_from_id)}
                          comment={i.owner_comment}
                          commentResolved={i.comment_resolved}
                          resolution={i.resolution}
                          onEdit={canEdit ? () => setEditing(i.id) : undefined}
                        />
                      )}
                      {canEdit && editing !== i.id && commenting !== i.id && (
                        <div className="row">
                          <button type="button" className="link-dark" onClick={() => setCommenting(i.id)}>
                            {i.owner_comment ? "Change the comment" : "Comment on this risk"}
                          </button>
                          {i.owner_comment && !i.comment_resolved && responsible.length > 0 && (
                            <a
                              className="link-dark"
                              href={mailto(
                                responsible.map((k) => k.email),
                                `${r.name}: a comment on your ${c.name} risk`,
                                `Dear ${responsible.map((k) => k.name.split(" ")[0]).join(", ")},\n\nThank you for your input on ${c.name} risk. I have a comment on this risk before the report is finalised:\n\n"${i.title}"\n\n${i.owner_comment}\n\nPlease amend the risk or action and tick the box beside my comment:\n\n${respondLink(q.token)}\n\nThank you`,
                              )}
                            >
                              Email the risk owner
                            </a>
                          )}
                        </div>
                      )}
                      {commenting === i.id && (
                        <CommentBox
                          item={i}
                          busy={busy}
                          onSave={(text) => void run(() => commentItem(i.id, text), text ? "Comment saved. Use \"Email the risk owner\" to tell them from your own mailbox." : "Comment removed.").then((ok) => ok && setCommenting(null))}
                          onCancel={() => setCommenting(null)}
                        />
                      )}
                    </div>
                  ))}
                  {canEdit &&
                    (editing === `new-${c.id}` ? (
                      <RiskForm
                        key={items.length}
                        idPrefix={`n-${c.id}`}
                        initial={blankRisk()}
                        examples={c.examples}
                        isSaved={false}
                        busy={busy}
                        onSave={(v) => void run(() => saveItem(organisationId, r.id, c.id, null, v, false)).then((ok) => ok && setEditing(null))}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div className="row review">
                        <button type="button" className="quiet" onClick={() => setEditing(`new-${c.id}`)}>
                          {items.length === 0 ? "Add a Risk" : "Add another Risk"}
                        </button>
                        <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => setRequestFinished(q.id, !q.submitted_at))}>
                          {q.submitted_at ? "Reopen for the responsible user" : items.length === 0 ? "Record as nothing to report" : "Mark as finished on their behalf"}
                        </button>
                      </div>
                    ))}
                </div>
              );
            })}
          </section>
        )}

        {isOwner && collecting && (
          <section className="block">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const missing = requests.length - answered;
                const open = d.items.filter((i) => i.review_id === r.id && i.owner_comment && !i.comment_resolved).length;
                const warn = [missing > 0 ? `${missing} ${missing === 1 ? "category is" : "categories are"} not finished and will show as such` : "", open > 0 ? `${open} of your comments have not been resolved` : ""].filter(Boolean).join("; ");
                if (window.confirm(`Finalise the report?${warn ? ` ${warn}.` : ""} It can no longer be edited, and the links stop working.`)) {
                  void run(() => finaliseReview(r.id), r.frequency === "once" ? "Report finalised." : "Report finalised. The next review has been scheduled.");
                }
              }}
            >
              Finalise the report
            </button>
            <p className="muted">Finalise once you have reviewed the inputs. Then download the PowerPoint and send it using "Send to" below.</p>
          </section>
        )}
        {r.status !== "scheduled" && (canEdit || canManage) && (
          <SendTo
            key={r.id}
            initial={r.send_to ?? (ownerEmail ? [ownerEmail] : [])}
            isDefault={!r.send_to}
            busy={busy}
            href={(list) => mailto(list, `${r.name}: risk report${r.status === "final" ? "" : " (draft)"}`, `Please find attached the risk report for ${r.name}${r.status === "final" ? "" : ", in draft"}.\n\n[Attach the PowerPoint file downloaded from VeraPhius before sending.]\n`)}
            onSave={(list) => void run(() => setReportRecipients(r.id, list), "Saved who the report goes to.")}
          />
        )}
        {!isOwner && collecting && <p className="muted">Only {owner ? memberName(owner.user_id) : "the person responsible for the report"} and their backups can edit, comment and finalise.</p>}
      </>
    );
  }

  // ---- First page ----
  const current = data.reviews.filter((r) => r.status === "collecting");
  const scheduled = data.reviews.filter((r) => r.status === "scheduled").sort((a, b) => a.start_on.localeCompare(b.start_on));
  const past = data.reviews.filter((r) => r.status === "final");
  const actions = liveActions(data);
  const prompts = actions.map((i) => ({ i, kind: promptDue(i, today()) })).filter((x): x is { i: Item; kind: "week" | "due" } => x.kind !== null && Boolean(data.links[x.i.id]));
  const reviewRow = (r: Review) => {
    const qs = data.requests.filter((q) => q.review_id === r.id);
    return (
      <li key={r.id}>
        <button type="button" className="entity-row" onClick={() => go({ kind: "review", id: r.id })}>
          <span>
            <span className="entity-name">{r.name}</span>
            <br />
            <span className="muted">
              {r.forum ?? "Forum"} on {formatDay(r.forum_on)}
              {r.status === "scheduled" ? ` · requests go out ${formatDay(r.start_on)}` : ` · ${qs.filter((q) => q.submitted_at).length} of ${qs.length} finished`}
              {r.frequency !== "once" ? ` · ${FREQUENCY[r.frequency].toLowerCase()}` : ""}
            </span>
          </span>
          <span className="chip">{REVIEW_STATUS[r.status]}</span>
        </button>
      </li>
    );
  };
  const people = (c: Category, roleName: Contact["role"]) => {
    const list = contactsOf(c.id).filter((k) => k.role === roleName);
    const key = `${c.id}:${roleName}`;
    return (
      <td>
        {list.length === 0 && adding !== key && <span className={roleName === "responsible" ? "warning-text" : "muted"}>{roleName === "responsible" ? "Nobody yet" : "No manager"}</span>}
        {list.map((k) =>
          adding === `edit:${k.id}` ? (
            <ContactForm key={k.id} fixedRole={roleName} initial={k} busy={busy} onAdd={(v) => void run(() => replaceContact(organisationId, c.id, k.id, v)).then((ok) => ok && setAdding(null))} onCancel={() => setAdding(null)} />
          ) : (
          <span key={k.id} className="person">
            <span title={k.email}>
              {k.name}
              {k.title ? <span className="muted">, {k.title}</span> : null}
            </span>
            {canRun && (
              <>
                <button type="button" className="link-dark small" disabled={busy} aria-label={`Edit or replace ${k.name}`} onClick={() => setAdding(`edit:${k.id}`)}>
                  Edit or replace
                </button>
                <button type="button" className="link-dark small" disabled={busy} aria-label={`Remove ${k.name}`} onClick={() => void run(() => removeContact(k.id))}>
                  Remove
                </button>
              </>
            )}
          </span>
          ),
        )}
        {canRun &&
          (adding === key ? (
            <ContactForm fixedRole={roleName} busy={busy} onAdd={(k) => void run(() => addContact(organisationId, c.id, k)).then((ok) => ok && setAdding(null))} onCancel={() => setAdding(null)} />
          ) : (
            <button type="button" className="link-dark small" onClick={() => setAdding(key)}>
              {list.length === 0 ? "Add" : roleName === "responsible" ? "Add a backup" : "Add another"}
            </button>
          ))}
      </td>
    );
  };

  return (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>Risk Register</h1>
      {messages}

      {canRun && (
        <div className="choices">
          <button type="button" className="card choice" onClick={() => start("run")}>
            <strong>Run Risk Review</strong>
            <span className="muted">Start now. Requests go out today and the report is due in 31 days.</span>
          </button>
          <button type="button" className="card choice" onClick={() => start("schedule")}>
            <strong>Schedule Risk Review</strong>
            <span className="muted">Pick the forum date, or repeat monthly, quarterly, half yearly or annually.</span>
          </button>
        </div>
      )}

      {current.length + scheduled.length > 0 && (
        <section className="block">
          <h2>{canRun ? "Modify an existing risk review" : "Risk reviews"}</h2>
          <ul className="entity-list">{[...current, ...scheduled].map(reviewRow)}</ul>
        </section>
      )}

      <section className="block">
        <h2>Who is responsible</h2>
        <div className="card">
          <strong>The report</strong>
          <p className="muted">Reviews and edits the inputs, comments on risks and finalises the report. Backups can do the same.</p>
          {!owner && <p className="warning-text">Nobody is responsible for the report yet. A review cannot start without this.</p>}
          <ul className="plain">
            {owner && (
              <li className="row">
                <span>
                  {memberName(owner.user_id)} <span className="chip">Responsible</span>
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    className="link-dark small"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Remove the person responsible for the report? To replace them instead, choose a member below and press \"Make responsible instead\". Reviews in progress keep running, but nobody can finalise until someone is named.")) void run(() => removeOwner(organisationId, owner.user_id));
                    }}
                  >
                    Remove
                  </button>
                )}
              </li>
            )}
            {backups.map((b) => (
              <li key={b.user_id} className="row">
                <span>
                  {memberName(b.user_id)} <span className="chip">Backup</span>
                </span>
                {isAdmin && (
                  <button type="button" className="link-dark small" disabled={busy} onClick={() => void run(() => removeOwner(organisationId, b.user_id))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isAdmin ? (
            <div className="row">
              <label htmlFor="rk-owner" className="grow">Add the report owner or a backup</label>
              <select id="rk-owner" aria-label="Member" value={ownerPick} onChange={(e) => setOwnerPick(e.target.value)}>
                <option value="">Choose a member…</option>
                {members
                  .filter((m) => m.is_active)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              <button type="button" className="quiet" disabled={busy || !ownerPick} onClick={() => void run(() => setOwner(organisationId, ownerPick, false)).then(() => setOwnerPick(""))}>
                {owner ? "Make responsible instead" : "Make responsible"}
              </button>
              <button type="button" className="quiet" disabled={busy || !ownerPick || ownerPick === owner?.user_id} onClick={() => void run(() => setOwner(organisationId, ownerPick, true)).then(() => setOwnerPick(""))}>
                Add as backup
              </button>
            </div>
          ) : (
            !owner && <p className="muted">An owner, administrator, secretary, legal or compliance member names this person. Your role here is {roleLabels(role)}.</p>
          )}
        </div>

        <div className="table-scroll">
          <table className="report-table people-table">
            <thead>
              <tr>
                <th scope="col">Risk category</th>
                <th scope="col">Responsible</th>
                <th scope="col">Escalates to (manager)</th>
              </tr>
            </thead>
            <tbody>
              {active.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    {c.name}
                  </th>
                  {canRun || data.contacts.length > 0 ? (
                    <>
                      {people(c, "responsible")}
                      {people(c, "manager")}
                    </>
                  ) : (
                    <td colSpan={2} className="muted">
                      Visible to the people who run the review
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canRun && (
        <details className="block">
          <summary>
            <strong>Manage risk categories and their prompts</strong>
          </summary>
          <p className="muted">The material risk examples appear faintly in the Risk box, and disappear when the person starts typing.</p>
          {data.categories.map((c) => (
            <CategorySettings key={c.id} c={c} busy={busy} onSave={(patch) => void run(() => saveCategory(organisationId, { id: c.id, name: c.name, position: c.position, ...patch }))} />
          ))}
          <div className="card form">
            <label htmlFor="rc-bespoke">Add a bespoke risk category</label>
            <div className="row">
              <input id="rc-bespoke" className="grow" placeholder="For example patient safety, ingredient or medical" value={bespoke} onChange={(e) => setBespoke(e.target.value)} />
              <button
                type="button"
                className="quiet"
                disabled={busy || bespoke.trim().length < 2}
                onClick={() =>
                  void run(() => saveCategory(organisationId, { name: bespoke, covers: "", examples: "", is_active: true, position: Math.max(0, ...data.categories.map((x) => x.position)) + 1 })).then(
                    (ok) => ok && setBespoke(""),
                  )
                }
              >
                Add category
              </button>
            </div>
          </div>
        </details>
      )}

      {canRun && prompts.length > 0 && (
        <section className="block">
          <h2>Action prompts to send</h2>
          <p className="muted">A week before the due date, and on it, the actioner is asked whether the risk is resolved, how, and whether there is anything to add.</p>
          <ul className="plain rows">
            {prompts.map(({ i, kind }) => {
              const link = actionLink(data.links[i.id]);
              const responsible = contactsOf(i.category_id).filter((k) => k.role === "responsible");
              // With no actioner named, the responsible user is the actioner
              const to = i.actioner_email ? [i.actioner_email] : responsible.map((k) => k.email);
              const who = i.actioner ?? responsible.map((k) => k.name).join(", ");
              const subject = `${kind === "week" ? "Due in a week" : "Due today"}: ${i.title.split("\n")[0].slice(0, 80)}`;
              const body = `Dear ${who.split(/[ ,]/)[0] || "colleague"},\n\nYou are down to action the following from our risk review${i.due_on ? `, due ${formatDay(i.due_on)}` : ""}:\n\n${i.title}\n\nActions, controls, mitigations: ${i.action}\n\nPlease tell us whether it is resolved, what the resolution was, and anything else we should know:\n\n${link}\n\nThank you,\n${organisationName}`;
              return (
                <li key={i.id} className="row spread">
                  <span>
                    <strong>{i.title.split("\n")[0]}</strong> <span className={kind === "due" ? "chip chip-alert" : "chip"}>{kind === "week" ? "Due in a week" : "Due now"}</span>
                    <br />
                    <span className={to.length ? "muted" : "warning-text"}>
                      {to.length ? `${who} · due ${formatDay(i.due_on!)}` : "Nobody to send this to: the category has no responsible person"}
                    </span>
                  </span>
                  <span className="row">
                    {to.length > 0 && (
                      <a className="link-dark" href={mailto(to, subject, body)}>
                        Open email
                      </a>
                    )}
                    <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => markPromptSent(i.id, kind))}>
                      Mark as sent
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {actions.length > 0 && (
        <section className="block">
          <h2>Open risks and actions</h2>
          <ul className="plain rows">
            {actions.map((i) => {
              const last = data.updates.filter((u) => u.item_id === i.id).slice(-1)[0];
              return (
                <li key={i.id} className="row spread">
                  <span>
                    <strong>{i.title.split("\n")[0]}</strong> <span className="muted">· {data.categories.find((c) => c.id === i.category_id)?.name}</span>
                    <br />
                    {i.action}
                    <br />
                    <span className={i.due_on ? "muted" : "warning-text"}>
                      {i.actioner ?? (contactsOf(i.category_id).filter((k) => k.role === "responsible").map((k) => k.name).join(", ") || "No actioner")} · {i.due_on ? `due ${formatDay(i.due_on)}` : "no due date"}
                    </span>
                    {last && (
                      <>
                        <br />
                        <span className="muted">
                          Latest update from {last.by_name}, {formatDay(last.created_at)}: {last.note}
                        </span>
                      </>
                    )}
                  </span>
                  <span className={i.due_on && i.due_on < today() ? "chip chip-alert" : "chip"}>{i.due_on && i.due_on < today() ? "Overdue" : "Open"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <section className="block">
          <h2>Final reports</h2>
          <ul className="entity-list">{past.map(reviewRow)}</ul>
        </section>
      )}
    </>
  );
}
