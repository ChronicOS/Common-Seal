import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay, loadMembers, type Member } from "./board";
import {
  actionLink,
  addContact,
  addDays,
  cancelReview,
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
  removeOwner,
  requestEmailDue,
  respondLink,
  REVIEW_STATUS,
  saveCategory,
  saveItem,
  sendBack,
  setOwner,
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
import { downloadRiskReport } from "./riskReport";

type Props = { organisationId: string; organisationName: string; role: string; userId: string };
type View = { kind: "home" } | { kind: "setup"; mode: "run" | "schedule" } | { kind: "confirm"; mode: "run" | "schedule" } | { kind: "review"; id: string };

const MANAGE_ROLES = ["owner", "admin", "secretary", "legal", "compliance"];

function ContactForm({ busy, onAdd }: { busy: boolean; onAdd: (k: { role: Contact["role"]; name: string; title: string; email: string }) => void }) {
  const [role, setRole] = useState<Contact["role"]>("responsible");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  return (
    <div className="row review">
      <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Contact["role"])}>
        <option value="responsible">Responsible user</option>
        <option value="manager">Manager (escalation)</option>
      </select>
      <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input aria-label="Email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button
        type="button"
        className="quiet"
        disabled={busy || name.trim().length < 2 || !/.+@.+\..+/.test(email)}
        onClick={() => {
          onAdd({ role, name, title, email });
          setName("");
          setTitle("");
          setEmail("");
        }}
      >
        Add
      </button>
    </div>
  );
}

function CategoryEditor({ c, contacts, busy, onSave, onAddContact, onRemoveContact }: {
  c: Category;
  contacts: Contact[];
  busy: boolean;
  onSave: (patch: { name: string; covers: string; examples: string; is_active: boolean }) => void;
  onAddContact: (k: { role: Contact["role"]; name: string; title: string; email: string }) => void;
  onRemoveContact: (id: string) => void;
}) {
  const [name, setName] = useState(c.name);
  const [covers, setCovers] = useState(c.covers ?? "");
  const [examples, setExamples] = useState(c.examples ?? "");
  const changed = name !== c.name || covers !== (c.covers ?? "") || examples !== (c.examples ?? "");
  const responsible = contacts.filter((k) => k.role === "responsible");
  const managers = contacts.filter((k) => k.role === "manager");
  return (
    <details className="card category">
      <summary>
        <strong>{c.name}</strong>
        {!c.is_active ? (
          <span className="chip">Not used</span>
        ) : responsible.length === 0 ? (
          <span className="chip chip-alert">No responsible user</span>
        ) : managers.length === 0 ? (
          <span className="chip chip-alert">No manager for escalation</span>
        ) : (
          <span className="muted">
            {responsible.map((k) => k.name).join(", ")} · escalates to {managers.map((k) => k.name).join(", ")}
          </span>
        )}
      </summary>
      <div className="form">
        <label htmlFor={`rc-name-${c.id}`}>Category</label>
        <input id={`rc-name-${c.id}`} value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor={`rc-covers-${c.id}`}>Includes (optional)</label>
        <input id={`rc-covers-${c.id}`} value={covers} onChange={(e) => setCovers(e.target.value)} />
        <label htmlFor={`rc-ex-${c.id}`}>Material risk examples (prompts shown to the responsible user)</label>
        <textarea id={`rc-ex-${c.id}`} rows={3} value={examples} onChange={(e) => setExamples(e.target.value)} />
        <div className="row">
          <button type="button" className="quiet" disabled={busy || !changed || name.trim().length < 2} onClick={() => onSave({ name, covers, examples, is_active: c.is_active })}>
            Save changes
          </button>
          <button type="button" className="link-dark" disabled={busy} onClick={() => onSave({ name: c.name, covers: c.covers ?? "", examples: c.examples ?? "", is_active: !c.is_active })}>
            {c.is_active ? "Stop using this category" : "Use this category"}
          </button>
        </div>
        <strong>People</strong>
        {contacts.length === 0 && <span className="muted">Nobody assigned. A category with no responsible user is left out of a review.</span>}
        <ul className="plain">
          {contacts.map((k) => (
            <li key={k.id} className="row">
              <span>
                {k.name}
                {k.title ? `, ${k.title}` : ""} · {k.email} <span className="chip">{k.role === "responsible" ? "Responsible" : "Manager"}</span>
              </span>
              <button type="button" className="link-dark" disabled={busy} onClick={() => onRemoveContact(k.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <ContactForm busy={busy} onAdd={onAddContact} />
        <span className="muted">Add more than one responsible user to give a backup. They share one link.</span>
      </div>
    </details>
  );
}

function ItemEditor({ item, busy, onSave, onDelete, onCancel }: { item: Partial<Item>; busy: boolean; onSave: (i: Partial<Item> & { title: string; action: string }) => void; onDelete?: () => void; onCancel: () => void }) {
  const [v, setV] = useState({ title: item.title ?? "", detail: item.detail ?? "", action: item.action ?? "", actioner: item.actioner ?? "", actioner_email: item.actioner_email ?? "", due_on: item.due_on ?? "", is_closed: item.is_closed ?? false });
  const key = item.id ?? "new";
  return (
    <div className="form review">
      <label htmlFor={`ie-title-${key}`}>Incident or update</label>
      <input id={`ie-title-${key}`} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <label htmlFor={`ie-detail-${key}`}>Details</label>
      <textarea id={`ie-detail-${key}`} rows={3} value={v.detail} onChange={(e) => setV({ ...v, detail: e.target.value })} />
      <label htmlFor={`ie-action-${key}`}>Action, control or mitigation</label>
      <textarea id={`ie-action-${key}`} rows={2} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} />
      <div className="row">
        <span className="field">
          <label htmlFor={`ie-who-${key}`}>Actioner</label>
          <input id={`ie-who-${key}`} value={v.actioner} onChange={(e) => setV({ ...v, actioner: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor={`ie-email-${key}`}>Actioner's email</label>
          <input id={`ie-email-${key}`} type="email" value={v.actioner_email} onChange={(e) => setV({ ...v, actioner_email: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor={`ie-due-${key}`}>Due</label>
          <input id={`ie-due-${key}`} type="date" value={v.due_on} onChange={(e) => setV({ ...v, due_on: e.target.value })} />
        </span>
      </div>
      <label className="check">
        <input type="checkbox" checked={v.is_closed} onChange={(e) => setV({ ...v, is_closed: e.target.checked })} /> Resolved
      </label>
      <div className="row">
        <button type="button" disabled={busy || v.title.trim().length < 3 || v.action.trim().length < 2} onClick={() => onSave({ ...item, ...v })}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="link-dark" disabled={busy} onClick={onDelete}>
            Delete item
          </button>
        )}
      </div>
    </div>
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
      <label htmlFor="mr-forum">Where the report goes</label>
      <input id="mr-forum" value={v.forum} onChange={(e) => setV({ ...v, forum: e.target.value })} />
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

export default function RiskRegister({ organisationId, organisationName, role, userId }: Props) {
  const canManage = MANAGE_ROLES.includes(role);
  const isAdmin = role === "owner" || role === "admin";

  const [data, setData] = useState<RiskData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [forum, setForum] = useState("Risk and Compliance forum");
  const [forumOn, setForumOn] = useState(() => addDays(today(), 45));
  const [frequency, setFrequency] = useState<Frequency>("quarterly");
  const [bespoke, setBespoke] = useState("");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [queryFor, setQueryFor] = useState<string | null>(null);
  const [queryText, setQueryText] = useState("");
  const [modifying, setModifying] = useState(false);
  const [ownerPick, setOwnerPick] = useState("");

  const reload = useCallback(async () => {
    const [risk, people] = await Promise.all([loadRisk(organisationId), loadMembers(organisationId).catch(() => [])]);
    setData(risk);
    setMembers(people);
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the risk register."));
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
  const go = (next: View) => {
    setError(null);
    setNotice(null);
    setEditingItem(null);
    setQueryFor(null);
    setModifying(false);
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

  // ---- Step 2: categories and people ----
  if (view.kind === "setup") {
    return (
      <>
        {back({ kind: "home" }, "Back to the risk register")}
        <p className="eyebrow">{view.mode === "run" ? "Run a risk review" : "Schedule a risk review"} · step 1 of 2</p>
        <h1>Risk categories</h1>
        <p className="lead">Check the categories, their prompts and who answers for each. Changes apply to every future review.</p>
        {messages}

        <section className="card form">
          <h2>Who is responsible for the report</h2>
          <p className="muted">This person reviews and edits the inputs, sends back questions and finalises the report. Backups can do the same.</p>
          <ul className="plain">
            {owner && (
              <li className="row">
                <span>
                  {memberName(owner.user_id)} <span className="chip">Responsible</span>
                </span>
              </li>
            )}
            {backups.map((b) => (
              <li key={b.user_id} className="row">
                <span>
                  {memberName(b.user_id)} <span className="chip">Backup</span>
                </span>
                {isAdmin && (
                  <button type="button" className="link-dark" disabled={busy} onClick={() => void run(() => removeOwner(organisationId, b.user_id))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!owner && <p className="warning-text">Nobody is named yet. A review cannot start without this.</p>}
          {isAdmin ? (
            <div className="row">
              <select aria-label="Member" value={ownerPick} onChange={(e) => setOwnerPick(e.target.value)}>
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
                Make responsible
              </button>
              <button type="button" className="quiet" disabled={busy || !ownerPick || ownerPick === owner?.user_id} onClick={() => void run(() => setOwner(organisationId, ownerPick, true)).then(() => setOwnerPick(""))}>
                Add as backup
              </button>
            </div>
          ) : (
            <p className="muted">An owner or administrator of the organisation names these people. They must be members of Common Seal.</p>
          )}
        </section>

        <section className="block">
          {data.categories.map((c) => (
            <CategoryEditor
              key={c.id}
              c={c}
              contacts={contactsOf(c.id)}
              busy={busy}
              onSave={(patch) => void run(() => saveCategory(organisationId, { id: c.id, position: c.position, ...patch }))}
              onAddContact={(k) => void run(() => addContact(organisationId, c.id, k))}
              onRemoveContact={(id) => void run(() => removeContact(id))}
            />
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
        </section>

        <p className="muted">
          {ready.length} of {active.length} categories in use have a responsible user and will be included.
        </p>
        <button type="button" disabled={ready.length === 0 || !owner} onClick={() => go({ kind: "confirm", mode: view.mode })}>
          Continue
        </button>
      </>
    );
  }

  // ---- Step 3: name and dates ----
  if (view.kind === "confirm") {
    const runNow = view.mode === "run";
    const start = runNow ? today() : addDays(forumOn, -31) < today() ? today() : addDays(forumOn, -31);
    const forumDate = runNow ? addDays(today(), 31) : forumOn;
    return (
      <>
        {back({ kind: "setup", mode: view.mode }, "Back to categories")}
        <p className="eyebrow">{runNow ? "Run a risk review" : "Schedule a risk review"} · step 2 of 2</p>
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
              id = await createReview(organisationId, { name, forum, forumOn: runNow ? null : forumOn, frequency: runNow ? "once" : frequency });
            }).then((ok) => ok && go({ kind: "review", id }));
          }}
        >
          <label htmlFor="rv-name">Name</label>
          <input id="rv-name" placeholder="e.g. Q4 2026 risk review" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="rv-forum">Where the report goes</label>
          <input id="rv-forum" placeholder="e.g. Risk and Compliance forum, or the board" value={forum} onChange={(e) => setForum(e.target.value)} />
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
              <li>Requests go out: {formatDay(start)}</li>
              <li>Responses due, then first reminder: {formatDay(addDays(start, 14))} (two weeks)</li>
              <li>Second reminder: {formatDay(addDays(start, 19))} (five days later)</li>
              <li>Escalation to the manager: {formatDay(addDays(start, 24))} (five days later)</li>
              <li>The report owner reviews and finalises: one week</li>
              <li>
                {forum || "Forum"}: {formatDay(forumDate)}
              </li>
            </ul>
            {!runNow && addDays(forumOn, -31) < today() && <p className="warning-text">That date is less than 31 days away, so requests go out today and the steps are squeezed to fit.</p>}
          </div>
          <button type="submit" disabled={busy}>
            {runNow ? "Start the review" : "Schedule the review"}
          </button>
        </form>
      </>
    );
  }

  // ---- One review ----
  if (view.kind === "review") {
    const r = data.reviews.find((x) => x.id === view.id);
    // Called as a plain function, not mounted as a component, so the editors inside keep their state between renders
    if (r) return ReviewPage({ r });
  }

  function ReviewPage({ r }: { r: Review }) {
    const requests = data!.requests.filter((q) => q.review_id === r.id);
    const categories = data!.categories.filter((c) => requests.some((q) => q.category_id === c.id));
    const collecting = r.status === "collecting";
    const due = requests.map((q) => ({ q, kind: requestEmailDue(r, q, today()) })).filter((x): x is { q: Request; kind: RequestEmail } => x.kind !== null);
    const answered = requests.filter((q) => q.submitted_at).length;
    const ownersReview = collecting && today() >= r.escalate_on;

    const email = (q: Request, kind: RequestEmail) => {
      const c = data!.categories.find((x) => x.id === q.category_id)!;
      const people = contactsOf(c.id);
      const responsible = people.filter((k) => k.role === "responsible");
      const managers = people.filter((k) => k.role === "manager");
      const link = respondLink(q.token);
      const where = `${r.forum ?? "the forum"} on ${formatDay(r.forum_on)}`;
      const greeting = `Dear ${(kind === "escalation" && managers.length ? managers : responsible).map((k) => k.name.split(" ")[0]).join(", ")},`;
      const bodies: Record<RequestEmail, string> = {
        request: `${greeting}\n\nWe are preparing the ${r.name} for ${where}. You are responsible for ${c.name} risk.\n\nPlease tell us about any incidents or updates since the last review, and for each one the action, control or mitigation, who will action it and by when. If there is nothing to report, please say so.\n\n${link}\n\nPlease respond by ${formatDay(r.respond_by)}.\n\nThank you,\n${organisationName}`,
        reminder1: `${greeting}\n\nThis is a reminder that your input on ${c.name} risk for the ${r.name} was due on ${formatDay(r.respond_by)} and has not yet been received.\n\n${link}\n\nPlease respond within five days.\n\nThank you,\n${organisationName}`,
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
          {r.status !== "scheduled" ? ` · ${answered} of ${requests.length} categories answered` : ""}
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

        {r.status !== "scheduled" && (
          <section className="block">
            <div className="row spread">
              <h2>The report</h2>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => void run(() => downloadRiskReport(organisationName, r, data!.categories, data!.contacts, data!.requests, data!.items), "The PowerPoint file has been downloaded.")}
              >
                Download as PowerPoint
              </button>
            </div>
            <p className="muted">One slide per category in 10 point Arial; a long category runs on to further slides. {r.status === "final" ? "" : "It is marked Draft until the report is finalised."}</p>
            {categories.map((c, n) => {
              const q = requests.find((x) => x.category_id === c.id)!;
              const items = data!.items.filter((i) => i.review_id === r.id && i.category_id === c.id);
              const people = contactsOf(c.id);
              const responsible = people.filter((k) => k.role === "responsible");
              return (
                <div key={c.id} className="card risk-slide">
                  <div className="row spread">
                    <h3>
                      {n + 1}. {c.name}
                    </h3>
                    <span className={q.submitted_at ? "chip" : "chip chip-alert"}>
                      {q.submitted_at ? `Answered by ${q.submitted_by ?? "the responsible user"}, ${formatDay(q.submitted_at)}` : q.query ? "Sent back with a question" : q.escalated_at ? "Escalated, no response" : q.opened_at ? "Opened, not submitted" : q.sent_at ? "Sent, no response" : "Not sent"}
                    </span>
                  </div>
                  {canRun && <p className="muted">Responsible: {responsible.map((k) => k.name).join(", ") || "nobody"}</p>}
                  {items.length === 0 ? (
                    <p className={q.submitted_at ? "muted" : "warning-text"}>{q.submitted_at ? "Nothing to report this period." : "No input yet. This is not the same as nothing to report."}</p>
                  ) : (
                    <ul className="plain rows">
                      {items.map((i) => (
                        <li key={i.id}>
                          {editingItem === i.id ? (
                            <ItemEditor
                              item={i}
                              busy={busy}
                              onSave={(x) => void run(() => saveItem(organisationId, r.id, c.id, x)).then((ok) => ok && setEditingItem(null))}
                              onDelete={() => void run(() => deleteItem(i.id)).then((ok) => ok && setEditingItem(null))}
                              onCancel={() => setEditingItem(null)}
                            />
                          ) : (
                            <span className="row spread">
                              <span>
                                <strong>{i.title}</strong>
                                {i.carried_from_id && <span className="muted"> · carried forward</span>}
                                {i.detail && (
                                  <>
                                    <br />
                                    <span className="pre-wrap">{i.detail}</span>
                                  </>
                                )}
                                <br />
                                <span>
                                  <strong>Action:</strong> {i.action}
                                </span>
                                <br />
                                <span className={i.actioner && i.due_on ? "muted" : "warning-text"}>
                                  {i.actioner ?? "No actioner"} · {i.due_on ? `due ${formatDay(i.due_on)}` : "no due date"}
                                </span>
                                {i.resolution && (
                                  <>
                                    <br />
                                    Resolution: {i.resolution}
                                  </>
                                )}
                              </span>
                              <span className="row">
                                <span className={!i.is_closed && i.due_on && i.due_on < today() ? "chip chip-alert" : "chip"}>{i.is_closed ? "Resolved" : i.due_on && i.due_on < today() ? "Overdue" : "Open"}</span>
                                {isOwner && collecting && (
                                  <button type="button" className="link-dark" onClick={() => setEditingItem(i.id)}>
                                    Edit
                                  </button>
                                )}
                              </span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isOwner && collecting && (
                    <div className="row review">
                      {editingItem === `new-${c.id}` ? (
                        <ItemEditor item={{}} busy={busy} onSave={(x) => void run(() => saveItem(organisationId, r.id, c.id, x)).then((ok) => ok && setEditingItem(null))} onCancel={() => setEditingItem(null)} />
                      ) : (
                        <button type="button" className="link-dark" onClick={() => setEditingItem(`new-${c.id}`)}>
                          Add an item
                        </button>
                      )}
                      {q.submitted_at && queryFor !== q.id && (
                        <button
                          type="button"
                          className="link-dark"
                          onClick={() => {
                            setQueryFor(q.id);
                            setQueryText("");
                          }}
                        >
                          Send back with a question
                        </button>
                      )}
                    </div>
                  )}
                  {queryFor === q.id && (
                    <div className="form review">
                      <label htmlFor={`rq-${q.id}`}>Your question or comment for {responsible.map((k) => k.name).join(", ")}</label>
                      <textarea id={`rq-${q.id}`} rows={3} value={queryText} onChange={(e) => setQueryText(e.target.value)} />
                      <span className="muted">This reopens their link with your question shown, and opens an email from your own mailbox for you to send.</span>
                      <div className="row">
                        <button
                          type="button"
                          disabled={busy || queryText.trim().length < 3}
                          onClick={() => {
                            const subject = `${r.name}: a question on your ${c.name} risk input`;
                            const body = `Dear ${responsible.map((k) => k.name.split(" ")[0]).join(", ")},\n\nThank you for your input on ${c.name} risk. I have a question before the report is finalised:\n\n${queryText.trim()}\n\nPlease update your input here:\n\n${respondLink(q.token)}\n\nThank you`;
                            void run(() => sendBack(q.id, queryText)).then((ok) => {
                              if (!ok) return;
                              window.location.href = mailto(responsible.map((k) => k.email), subject, body);
                              setQueryFor(null);
                            });
                          }}
                        >
                          Reopen and email
                        </button>
                        <button type="button" className="quiet" onClick={() => setQueryFor(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
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
                if (window.confirm(`Finalise the report?${missing > 0 ? ` ${missing} ${missing === 1 ? "category has" : "categories have"} no response and will show as such.` : ""} It can no longer be edited, and unanswered links stop working.`)) {
                  void run(() => finaliseReview(r.id), r.frequency === "once" ? "Report finalised." : "Report finalised. The next review has been scheduled.");
                }
              }}
            >
              Finalise the report
            </button>
            <p className="muted">Finalise once you have reviewed the inputs. Then download the PowerPoint and send it to {r.forum ?? "the forum"}.</p>
          </section>
        )}
        {!isOwner && collecting && <p className="muted">Only {owner ? memberName(owner.user_id) : "the person responsible for the report"} and their backups can edit and finalise the report.</p>}
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
              {r.status === "scheduled" ? ` · requests go out ${formatDay(r.start_on)}` : ` · ${qs.filter((q) => q.submitted_at).length} of ${qs.length} answered`}
              {r.frequency !== "once" ? ` · ${FREQUENCY[r.frequency].toLowerCase()}` : ""}
            </span>
          </span>
          <span className="chip">{REVIEW_STATUS[r.status]}</span>
        </button>
      </li>
    );
  };

  return (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>Risk Register</h1>
      {messages}

      {canRun && (
        <div className="choices">
          <button type="button" className="card choice" onClick={() => go({ kind: "setup", mode: "run" })}>
            <strong>Run Risk Review</strong>
            <span className="muted">Start now. Requests go out today and the report is due in 31 days.</span>
          </button>
          <button type="button" className="card choice" onClick={() => go({ kind: "setup", mode: "schedule" })}>
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
      {data.reviews.length === 0 && <p className="muted">No risk review has been run yet.</p>}

      {canRun && prompts.length > 0 && (
        <section className="block">
          <h2>Action prompts to send</h2>
          <p className="muted">Each actioner is asked a week before the due date, and on it, whether the item is resolved, how, and whether there is anything to add.</p>
          <ul className="plain rows">
            {prompts.map(({ i, kind }) => {
              const link = actionLink(data.links[i.id]);
              const subject = `${kind === "week" ? "Due in a week" : "Due today"}: ${i.title}`;
              const body = `Dear ${(i.actioner ?? "").split(" ")[0] || "colleague"},\n\nYou are down to action the following item from our risk review${i.due_on ? `, due ${formatDay(i.due_on)}` : ""}:\n\n${i.title}\nAction: ${i.action}\n\nPlease tell us whether it is resolved, what the resolution was, and anything else we should know:\n\n${link}\n\nThank you,\n${organisationName}`;
              return (
                <li key={i.id} className="row spread">
                  <span>
                    <strong>{i.title}</strong> <span className={kind === "due" ? "chip chip-alert" : "chip"}>{kind === "week" ? "Due in a week" : "Due now"}</span>
                    <br />
                    <span className="muted">
                      {i.actioner} · {i.actioner_email} · due {formatDay(i.due_on!)}
                    </span>
                  </span>
                  <span className="row">
                    <a className="link-dark" href={mailto([i.actioner_email!], subject, body)}>
                      Open email
                    </a>
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
          <h2>Open actions</h2>
          <ul className="plain rows">
            {actions.map((i) => {
              const last = data.updates.filter((u) => u.item_id === i.id).slice(-1)[0];
              return (
                <li key={i.id} className="row spread">
                  <span>
                    <strong>{i.title}</strong> <span className="muted">· {data.categories.find((c) => c.id === i.category_id)?.name}</span>
                    <br />
                    {i.action}
                    <br />
                    <span className={i.actioner && i.due_on ? "muted" : "warning-text"}>
                      {i.actioner ?? "No actioner"} · {i.due_on ? `due ${formatDay(i.due_on)}` : "no due date"}
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
