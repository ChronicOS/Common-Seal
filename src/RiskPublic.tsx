import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { deleteItemByLink, finishByLink, openAction, openRequest, saveItemByLink, updateAction, type PublicAction, type PublicRequest } from "./risk";
import { blankRisk, RiskCard, RiskForm } from "./RiskParts";

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

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

/** The page a responsible user sees from the link in their risk review email. No account needed, and they can come back to it. */
export function RiskRespond({ token }: { token: string }) {
  const [q, setQ] = useState<PublicRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(() => {
    try {
      return sessionStorage.getItem("cs-risk-name") ?? "";
    } catch {
      return "";
    }
  });
  // Which form is open: a saved risk's id, "new", or none
  const [editing, setEditing] = useState<string | null>(null);
  const [nothing, setNothing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () =>
    openRequest(token).then((data) => {
      setQ(data);
      return data;
    });

  useEffect(() => {
    openRequest(token).then(
      (data) => {
        setQ(data);
        if (data.items.length === 0 && data.open) setEditing("new");
        setName((n) => n || data.submitted_by || (data.people.length === 1 ? data.people[0] : ""));
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
  if (!q.open) {
    return (
      <Shell>
        <p className="eyebrow">{q.organisation} · {q.review}</p>
        <h1>This review has closed</h1>
        <p className="lead">Please contact the person who sent it to you.</p>
      </Shell>
    );
  }

  async function act(work: () => Promise<void>, done?: string) {
    if (name.trim().length < 2) {
      setError("Please choose or enter who is completing this, at the top of the page.");
      document.getElementById("rr-name")?.focus();
      return false;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      sessionStorage.setItem("cs-risk-name", name.trim());
    } catch {
      // Remembering the name is a convenience only
    }
    try {
      await work();
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unanswered = q.items.filter((i) => i.owner_comment && !i.comment_resolved).length;

  return (
    <Shell>
      <p className="eyebrow">{q.organisation} · {q.review}</p>
      <h1>{q.category}</h1>
      <p className="lead">
        Please respond by {day(q.respond_by)}. Your input goes into the risk report{q.forum ? ` for the ${q.forum}` : ""} on {day(q.forum_on)}.
      </p>
      {q.covers && <p className="muted">This category covers: {q.covers}.</p>}
      {unanswered > 0 && (
        <p className="card warning">
          The report owner has commented on {unanswered} of your risks. Open each one, amend it, and tick the box to show the comment is resolved.
        </p>
      )}

      <div className="form">
        <label htmlFor="rr-name">Who is completing this?</label>
        <input id="rr-name" list="rr-people" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id="rr-people">
          {q.people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>

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

      <section className="block">
        {q.items.map((i, n) =>
          editing === i.id ? (
            <div key={i.id} className="card">
              <RiskForm
                idPrefix={`r${n}`}
                initial={{ title: i.title, action: i.action, due_on: i.due_on ?? "", actioner: i.actioner ?? "", actioner_email: i.actioner_email ?? "", is_closed: i.is_closed, comment_resolved: i.comment_resolved }}
                examples={q.examples}
                comment={i.owner_comment}
                isSaved
                busy={busy}
                onSave={(v) => void act(() => saveItemByLink(token, name, i.id, v), "Saved.").then((ok) => ok && setEditing(null))}
                onCancel={() => setEditing(null)}
                onDelete={i.carried ? undefined : () => void act(() => deleteItemByLink(token, i.id), "Removed.").then((ok) => ok && setEditing(null))}
              />
            </div>
          ) : (
            <div key={i.id} className="card">
              <RiskCard title={i.title} action={i.action} due_on={i.due_on} actioner={i.actioner} is_closed={i.is_closed} carried={i.carried} comment={i.owner_comment} commentResolved={i.comment_resolved} onEdit={() => setEditing(i.id)} />
            </div>
          ),
        )}

        {editing === "new" ? (
          <div className="card">
            <RiskForm
              key={q.items.length}
              idPrefix="rnew"
              initial={blankRisk()}
              examples={q.examples}
              isSaved={false}
              busy={busy}
              onSave={(v) => void act(() => saveItemByLink(token, name, null, v), "Saved. You can come back to this page and edit it until the review closes.").then((ok) => ok && setEditing(null))}
              onCancel={q.items.length > 0 ? () => setEditing(null) : undefined}
            />
          </div>
        ) : (
          <button type="button" className="quiet" onClick={() => setEditing("new")}>
            {q.items.length === 0 ? "Add a Risk" : "Add another Risk"}
          </button>
        )}
      </section>

      <section className="card form">
        <h2>When you have finished</h2>
        {q.submitted_at ? (
          <p>
            Marked as finished on {day(q.submitted_at)}
            {q.submitted_by ? ` by ${q.submitted_by}` : ""}. You can still add and edit risks until the review closes.
          </p>
        ) : (
          <>
            <p className="muted">Reminders continue until you tell us you have finished.</p>
            {q.items.length === 0 && (
              <label className="check">
                <input type="checkbox" checked={nothing} onChange={(e) => setNothing(e.target.checked)} /> There is nothing to report for {q.category} this period
              </label>
            )}
            <button type="button" disabled={busy || (q.items.length === 0 && !nothing) || editing !== null} onClick={() => void act(() => finishByLink(token, name, q.items.length === 0), "Thank you. Your input has been sent to the report owner.")}>
              Finished
            </button>
            {editing !== null && <span className="muted">Save or cancel the risk you are editing first.</span>}
          </>
        )}
      </section>
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
