import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { openAction, openRequest, submitRequest, updateAction, type PublicAction, type PublicItem, type PublicRequest } from "./risk";

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
const blank = (): PublicItem => ({ id: null, title: "", detail: "", action: "", actioner: "", actioner_email: "", due_on: "", is_closed: false, carried: false });

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Common Seal</span>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}

/** The page a responsible user sees from the link in their risk review email. No account needed. */
export function RiskRespond({ token }: { token: string }) {
  const [q, setQ] = useState<PublicRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState<PublicItem[]>([]);
  const [nothing, setNothing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    openRequest(token).then(
      (data) => {
        setQ(data);
        setItems(data.items.map((i) => ({ ...i, detail: i.detail ?? "", actioner: i.actioner ?? "", actioner_email: i.actioner_email ?? "", due_on: i.due_on ?? "" })));
      },
      (e) => setError(e instanceof Error ? e.message : "This link could not be opened."),
    );
  }, [token]);

  if (!q) {
    return (
      <Shell>
        {error ? (
          <>
            <h1>This link cannot be opened</h1>
            <p className="lead">{error}. Please check you have the whole link, or ask the person who sent it to send it again.</p>
          </>
        ) : (
          <p className="lead">Opening…</p>
        )}
      </Shell>
    );
  }
  if (done || q.submitted_at) {
    return (
      <Shell>
        <p className="eyebrow">{q.organisation} · {q.review}</p>
        <h1>Thank you</h1>
        <p className="lead">
          Your input on {q.category} risk has been received{q.submitted_at && !done ? ` (submitted ${day(q.submitted_at)})` : ""}. If you need to change it, reply to the email you were sent.
        </p>
      </Shell>
    );
  }
  if (!q.open) {
    return (
      <Shell>
        <p className="eyebrow">{q.organisation} · {q.review}</p>
        <h1>This review has closed</h1>
        <p className="lead">Please contact the person who sent it to you.</p>
      </Shell>
    );
  }

  const set = (i: number, patch: Partial<PublicItem>) => setItems(items.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Please choose or enter who is completing this.");
    if (items.length === 0 && !nothing) return setError("Add at least one incident or update, or tick that there is nothing to report.");
    const bad = items.findIndex((x) => x.title.trim().length < 3 || x.action.trim().length < 2);
    if (bad >= 0) return setError(`Item ${bad + 1} needs both a description and an action, control or mitigation. "Continue to monitor" is fine.`);
    const badEmail = items.findIndex((x) => x.actioner_email.trim() !== "" && !/.+@.+\..+/.test(x.actioner_email));
    if (badEmail >= 0) return setError(`Item ${badEmail + 1}: the actioner's email does not look right.`);
    setBusy(true);
    setError(null);
    try {
      await submitRequest(token, name, nothing, items);
      setDone(true);
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your input could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <p className="eyebrow">{q.organisation} · {q.review}</p>
      <h1>{q.category} risk</h1>
      <p className="lead">
        Please respond by {day(q.respond_by)}. Your input goes into the risk report{q.forum ? ` for the ${q.forum}` : ""} on {day(q.forum_on)}.
      </p>
      {q.query && (
        <p className="card warning">
          <strong>A question for you:</strong> {q.query}
        </p>
      )}
      <section className="card">
        {q.covers && <p>This category covers: {q.covers}.</p>}
        {q.examples && (
          <>
            <strong>Examples of what would be material</strong>
            <p className="muted">{q.examples}</p>
            <p className="muted">These are prompts only. Report anything you think the forum should know.</p>
          </>
        )}
      </section>

      <form className="form block" onSubmit={submit} noValidate>
        <label htmlFor="rr-name">Who is completing this?</label>
        <input id="rr-name" list="rr-people" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id="rr-people">
          {q.people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>

        {items.some((x) => x.carried) && <p className="muted">Items marked "from the last review" were still open. Please update each one, or mark it resolved.</p>}
        {items.map((x, i) => (
          <fieldset key={i} className="card plain-fieldset question">
            <legend>
              Item {i + 1}
              {x.carried ? " · from the last review" : ""}
            </legend>
            <label htmlFor={`ri-title-${i}`}>Incident or update</label>
            <input id={`ri-title-${i}`} value={x.title} onChange={(e) => set(i, { title: e.target.value })} />
            <label htmlFor={`ri-detail-${i}`}>Details (optional)</label>
            <textarea id={`ri-detail-${i}`} rows={3} value={x.detail} onChange={(e) => set(i, { detail: e.target.value })} />
            <label htmlFor={`ri-action-${i}`}>Action, control or mitigation</label>
            <textarea id={`ri-action-${i}`} rows={2} placeholder='For example "Continue to monitor"' value={x.action} onChange={(e) => set(i, { action: e.target.value })} />
            <div className="row">
              <span className="field">
                <label htmlFor={`ri-who-${i}`}>Who will action it</label>
                <input id={`ri-who-${i}`} value={x.actioner} onChange={(e) => set(i, { actioner: e.target.value })} />
              </span>
              <span className="field">
                <label htmlFor={`ri-email-${i}`}>Their email</label>
                <input id={`ri-email-${i}`} type="email" value={x.actioner_email} onChange={(e) => set(i, { actioner_email: e.target.value })} />
              </span>
              <span className="field">
                <label htmlFor={`ri-due-${i}`}>Due date</label>
                <input id={`ri-due-${i}`} type="date" value={x.due_on} onChange={(e) => set(i, { due_on: e.target.value })} />
              </span>
            </div>
            <span className="muted">With an email and due date, the actioner is reminded a week before and on the day.</span>
            <label className="check">
              <input type="checkbox" checked={x.is_closed} onChange={(e) => set(i, { is_closed: e.target.checked })} /> This is resolved and can be closed
            </label>
            {!x.carried && (
              <button type="button" className="link-dark" onClick={() => setItems(items.filter((_, n) => n !== i))}>
                Remove this item
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setItems([...items, blank()]);
            setNothing(false);
          }}
        >
          Add an incident or update
        </button>
        {items.length === 0 && (
          <label className="check">
            <input type="checkbox" checked={nothing} onChange={(e) => setNothing(e.target.checked)} /> There is nothing to report for {q.category} this period
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Submit"}
        </button>
      </form>
    </Shell>
  );
}

/** The page an actioner sees from a prompt about one open action. No account needed. */
export function RiskAction({ token }: { token: string }) {
  const [a, setA] = useState<PublicAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [resolved, setResolved] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    openAction(token).then(
      (data) => {
        setA(data);
        setName(data.actioner ?? "");
      },
      (e) => setError(e instanceof Error ? e.message : "This link could not be opened."),
    );
  }, [token]);

  if (!a) {
    return (
      <Shell>
        {error ? (
          <>
            <h1>This link cannot be opened</h1>
            <p className="lead">{error}.</p>
          </>
        ) : (
          <p className="lead">Opening…</p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="eyebrow">{a.organisation} · {a.category} risk</p>
      <h1>{a.title}</h1>
      <section className="card">
        {a.detail && <p>{a.detail}</p>}
        <p>
          <strong>Action:</strong> {a.action}
        </p>
        <p className="muted">
          {a.actioner ? `Assigned to ${a.actioner}` : "Not assigned"}
          {a.due_on ? ` · due ${day(a.due_on)}` : ""}
        </p>
      </section>
      {a.updates.length > 0 && (
        <section className="block">
          <h2>Updates so far</h2>
          <ul className="plain rows">
            {a.updates.map((u, i) => (
              <li key={i}>
                <strong>{u.by_name}</strong> <span className="muted">· {day(u.created_at)}{u.resolved ? " · resolved" : ""}</span>
                <br />
                {u.note}
              </li>
            ))}
          </ul>
        </section>
      )}
      {done || a.is_closed ? (
        <p className="card note" role="status">
          {a.is_closed && !done ? "This item is resolved." : resolved ? "Thank you. This item is now recorded as resolved." : "Thank you. Your update has been recorded."}
        </p>
      ) : a.superseded ? (
        <p className="card warning">This item has moved to a newer review. Please use the link in the most recent message you received.</p>
      ) : (
        <form
          className="card form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (name.trim().length < 2) return setError("Please enter your name.");
            if (note.trim().length < 3) return setError(resolved ? "Please say how it was resolved." : "Please give an update.");
            setBusy(true);
            setError(null);
            updateAction(token, name, resolved, note)
              .then(() => setDone(true))
              .catch((x) => setError(x instanceof Error ? x.message : "Your update could not be sent."))
              .finally(() => setBusy(false));
          }}
        >
          <h2>Your update</h2>
          <label htmlFor="ra-name">Your name</label>
          <input id="ra-name" value={name} onChange={(e) => setName(e.target.value)} />
          <fieldset className="plain-fieldset question">
            <legend>Is this resolved?</legend>
            <label className="check">
              <input type="radio" name="ra-resolved" checked={resolved} onChange={() => setResolved(true)} /> Yes, it is resolved
            </label>
            <label className="check">
              <input type="radio" name="ra-resolved" checked={!resolved} onChange={() => setResolved(false)} /> Not yet
            </label>
          </fieldset>
          <label htmlFor="ra-note">{resolved ? "What was the resolution?" : "Where is it up to, and is there anything else we should know?"}</label>
          <textarea id="ra-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send update"}
          </button>
        </form>
      )}
    </Shell>
  );
}
