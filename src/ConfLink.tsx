import { useEffect, useState } from "react";
import { confirmLink, openLink, type LinkView } from "./confidential";
import { Brand } from "./Seal";

/** The personal link for someone on a confidential project's list: acknowledge the notice, or confirm deletion after close */
export default function ConfLink({ token }: { token: string }) {
  const [view, setView] = useState<LinkView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    openLink(token).then(setView, (e) => setError(e instanceof Error ? e.message : "This link cannot be opened."));
  }, [token]);
  const closure = view?.stage === "closure";
  const already = closure ? view?.closure_confirmed_at : view?.acknowledged_at;
  return (
    <div className="page">
      <header className="masthead"><Brand /></header>
      <main className="content">
        {error || view === null ? (
          <>
            <h1>This link cannot be opened</h1>
            <p>{error ?? "It may have been replaced. Ask the project lead for a new one."}</p>
          </>
        ) : view === undefined ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <p className="eyebrow">{view.organisation} · Confidential</p>
            <h1>Project {view.code_name}</h1>
            <p>For {view.full_name}</p>
            {view.notice && <pre className="policy-wording">{view.notice}</pre>}
            {done || already ? (
              <p className="card note" role="status">{closure ? "Thank you. Your confirmation is recorded." : "Thank you. Your acknowledgement is recorded."}</p>
            ) : closure && !view.needs_deletion ? (
              <p className="muted">Nothing to confirm on this project.</p>
            ) : view.removed && !closure ? (
              <p className="muted">You are no longer on this project's list.</p>
            ) : (
              <div className="card form">
                <span className="field"><label htmlFor="cl-name">Type your name</label><input id="cl-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></span>
                <button type="button" disabled={busy || name.trim().length < 2} onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try { await confirmLink(token, name); setDone(true); } catch (e) { setError(e instanceof Error ? e.message : "That did not save."); } finally { setBusy(false); }
                }}>{closure ? "I have deleted the material" : "I have read this notice and will follow it"}</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
