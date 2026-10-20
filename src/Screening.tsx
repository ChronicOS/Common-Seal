import { useEffect, useState } from "react";
import { formatWhen } from "./board";
import { attachFile } from "./files";
import {
  OUTCOME_LABELS, reviewHit, screenParty, screeningReport, screeningStatus, SOURCE_LABELS,
  type Party, type Screening, type ScreeningHit, type ScreeningStatus,
} from "./parties";

const list = (v: string[] | string | undefined, n = 3) => (Array.isArray(v) ? v.slice(0, n).join("; ") : v ?? "");

// Status is the same for the whole session: ask once
let statusOnce: Promise<ScreeningStatus | null> | null = null;
export function useScreeningStatus() {
  const [status, setStatus] = useState<ScreeningStatus | null | undefined>(undefined);
  useEffect(() => {
    statusOnce ??= screeningStatus();
    void statusOnce.then(setStatus);
  }, []);
  return status;
}

function Hit({ hit, s, canReview, busy, onReview }: { hit: ScreeningHit; s: Screening; canReview: boolean; busy: boolean; onReview: (decision: "match" | "not_a_match" | "undo", note: string) => void }) {
  const review = s.reviews[hit.id];
  const [deciding, setDeciding] = useState<"match" | "not_a_match" | null>(null);
  const [note, setNote] = useState("");
  const person = s.subject_type === "individual";
  return (
    <li className={review?.decision === "match" ? "card warning screen-hit" : "card screen-hit"}>
      <p>
        <strong>{hit.name ?? "Unnamed record"}</strong>{" "}
        <span className={hit.source_type === "SANCTION" ? "chip chip-alert" : "chip"}>{SOURCE_LABELS[hit.source_type ?? ""] ?? hit.source_type ?? "List"}</span>
        {hit.pep_type ? <span className="muted small"> · {hit.pep_type.replace(/_/g, " ").toLowerCase()}</span> : null}
      </p>
      <dl className="detail-list compact">
        {hit.source_id && <div><dt>List</dt><dd>{hit.source_id.replace(/_/g, " ")}</dd></div>}
        {hit.date_of_birth?.length ? <div><dt>Date of birth</dt><dd>{list(hit.date_of_birth)}</dd></div> : null}
        {hit.citizenship?.length ? <div><dt>Citizenship</dt><dd>{list(hit.citizenship)}</dd></div> : null}
        {hit.jurisdiction ? <div><dt>Jurisdiction</dt><dd>{list(hit.jurisdiction)}</dd></div> : null}
        {hit.company_number ? <div><dt>Company number</dt><dd>{list(hit.company_number)}</dd></div> : null}
        {hit.positions?.length ? <div><dt>Positions</dt><dd>{list(hit.positions)}</dd></div> : null}
        {hit.sanction_details?.length ? <div><dt>Sanction</dt><dd>{list(hit.sanction_details)}</dd></div> : null}
        {hit.alias_names?.length ? <div><dt>Also known as</dt><dd>{list(hit.alias_names, 5)}</dd></div> : null}
        {hit.address?.length ? <div><dt>Address</dt><dd>{list(hit.address, 2)}</dd></div> : null}
        {hit.description?.length ? <div><dt>Notes</dt><dd>{list(hit.description, 2)}</dd></div> : null}
      </dl>
      {review ? (
        <p className="small">
          <strong className={review.decision === "match" ? "warning-text" : "ok-text"}>{review.decision === "match" ? `Confirmed: this is the ${person ? "person" : "organisation"}` : `Not this ${person ? "person" : "organisation"}`}</strong>
          {" "}· {review.note} · {review.by_name ?? "someone"}, {formatWhen(review.at)}
          {canReview && (
            <>
              {" "}
              <button type="button" className="link-dark" disabled={busy} onClick={() => onReview("undo", "")}>Undo</button>
            </>
          )}
        </p>
      ) : canReview ? (
        deciding ? (
          <div className="form">
            <label htmlFor={`hit-${s.id}-${hit.id}`}>{deciding === "match" ? "Why is it a match?" : `Why is it not this ${person ? "person" : "organisation"}?`}</label>
            <input id={`hit-${s.id}-${hit.id}`} value={note} placeholder={deciding === "match" ? "Same date of birth and country" : "Different date of birth (1952) and country"} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button type="button" disabled={busy || note.trim().length < 5} onClick={() => onReview(deciding, note)}>Save</button>
              <button type="button" className="link-dark" onClick={() => setDeciding(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="quiet" disabled={busy} onClick={() => setDeciding("not_a_match")}>Not this {person ? "person" : "organisation"}</button>
            <button type="button" className="quiet" disabled={busy} onClick={() => setDeciding("match")}>It is them</button>
          </div>
        )
      ) : (
        <p className="small muted">Waiting for Legal or Compliance to review.</p>
      )}
    </li>
  );
}

/** Sanctions, PEP and watch-list screening for one third party */
export default function ScreeningPanel({ party, screenings, caseId, canScreen, canReview, who, onChanged }: {
  party: Party;
  screenings: Screening[];
  caseId: string | null;
  canScreen: boolean;
  canReview: boolean;
  who: (uid: string | null) => string;
  onChanged: (notice: string) => Promise<void>;
}) {
  const status = useScreeningStatus();
  const [fuzzy, setFuzzy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);
  const person = party.subject_type === "individual";
  const latest = screenings[0];
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setProblem(null);
    try {
      await onChanged(await work());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Screening failed.");
    } finally {
      setBusy(false);
    }
  };
  const toReview = latest ? latest.hits.filter((h) => !latest.reviews[h.id]).length : 0;

  return (
    <section className="card block">
      <h2>Sanctions and watch-list screening</h2>
      <p className="small muted">
        Searches sanctions lists, politically exposed persons and criminal and other watch lists through Dilisense. Adverse media is not covered: check it separately.
      </p>
      {problem && <p className="error" role="alert">{problem}</p>}

      {latest ? (
        <>
          <p>
            <span className={latest.outcome === "match" ? "chip chip-alert" : latest.outcome === "to_review" ? "chip warning-text" : "chip"}>{OUTCOME_LABELS[latest.outcome]}</span>{" "}
            <span className="small muted">
              Screened {formatWhen(latest.screened_at)} by {who(latest.screened_by)} · {latest.total_hits} possible match{latest.total_hits === 1 ? "" : "es"}
              {latest.outcome === "to_review" ? ` · ${toReview} to review` : ""}
              {latest.query.dob ? ` · born ${latest.query.dob}` : person ? " · no date of birth used" : ""}
              {latest.query.fuzzy_search ? " · close spellings included" : " · exact spelling"}
            </span>
          </p>
          {latest.total_hits > latest.hits.length && (
            <p className="card warning small">Showing the first {latest.hits.length} of {latest.total_hits} possible matches. {person ? "Add a date of birth and screen again to narrow the list." : "Use the full registered name and screen again."}</p>
          )}
          {latest.hits.length > 0 && (
            <ul className="plain screen-hits">
              {latest.hits.map((h) => (
                <Hit key={h.id} hit={h} s={latest} canReview={canReview} busy={busy}
                  onReview={(d, note) => void run(async () => {
                    const outcome = await reviewHit(latest.id, h.id, d, note);
                    return outcome === "cleared" ? "All possible matches reviewed. The screening checks are marked clear."
                      : outcome === "match" ? "Recorded as a match. The matching check is now a concern."
                      : "Saved.";
                  })} />
              ))}
            </ul>
          )}
          {canScreen && status?.configured && (
            <p className="small">
              <button type="button" className="link-dark" disabled={busy} onClick={() => void run(async () => {
                const file = await screeningReport(latest, party.name);
                if (caseId) {
                  await attachFile("dd_cases", caseId, file);
                  return "The provider's PDF report is saved under Reports and evidence.";
                }
                const a = document.createElement("a");
                a.href = URL.createObjectURL(file);
                a.download = file.name;
                a.click();
                return "Report downloaded.";
              })}>{caseId ? "Save the provider's PDF report to this case" : "Download the provider's PDF report"}</button>
              <span className="muted"> (counts as one search)</span>
            </p>
          )}
        </>
      ) : (
        <p className="muted">Not screened yet.</p>
      )}

      {canScreen && (
        status === undefined ? null : !status?.configured ? (
          <p className="small muted">Screening is not switched on for this organisation yet. An administrator needs to add the Dilisense key (Settings, Integrations).</p>
        ) : (
          <div className="row wrap">
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              const r = await screenParty(party.id, fuzzy);
              return r.total_hits === 0 ? "Screened: no possible matches." : `Screened: ${r.total_hits} possible match${r.total_hits === 1 ? "" : "es"} to review.`;
            })}>{busy ? "Screening…" : latest ? "Screen again" : "Screen now"}</button>
            <label className="check small"><input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} /> Include close spellings</label>
            <span className="small muted">
              Sends the {person ? "name, and date of birth and gender if recorded," : "name"} to Dilisense in Switzerland. Dilisense says it keeps no record of searches.
            </span>
          </div>
        )
      )}

      {screenings.length > 1 && (
        <p className="small">
          <button type="button" className="link-dark" onClick={() => setShowOld(!showOld)}>{showOld ? "Hide" : "Show"} earlier screenings ({screenings.length - 1})</button>
        </p>
      )}
      {showOld && (
        <ul className="small">
          {screenings.slice(1).map((x) => (
            <li key={x.id}>{formatWhen(x.screened_at)}: {OUTCOME_LABELS[x.outcome]} ({x.total_hits} possible match{x.total_hits === 1 ? "" : "es"}), by {who(x.screened_by)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
