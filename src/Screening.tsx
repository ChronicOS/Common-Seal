import { useEffect, useState } from "react";
import { formatWhen } from "./board";
import { attachFile } from "./files";
import {
  OUTCOME_LABELS, reviewHit, reviewRest, screenCase, screenParty, screeningReport, screeningStatus, SOURCE_LABELS,
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

function Hit({ hit, s, canReview, busy, onReview, quick = false }: { hit: ScreeningHit; s: Screening; canReview: boolean; busy: boolean; onReview: (decision: "match" | "not_a_match" | "undo", note: string) => void; quick?: boolean }) {
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
            <button type="button" className="quiet" disabled={busy} onClick={() => (quick ? onReview("not_a_match", `Not the same ${person ? "person" : "organisation"}`) : setDeciding("not_a_match"))}>{quick ? "Not them" : `Not this ${person ? "person" : "organisation"}`}</button>
            <button type="button" className="quiet" disabled={busy} onClick={() => setDeciding("match")}>It is them</button>
          </div>
        )
      ) : (
        <p className="small muted">Waiting for Legal or Compliance to review.</p>
      )}
    </li>
  );
}

/** One subject's latest screening: who, the outcome, and its possible matches */
function SubjectResult({ s, older, canReview, busy, who, onReview, onBulk, quick = false }: {
  quick?: boolean;
  s: Screening;
  older: Screening[];
  canReview: boolean;
  busy: boolean;
  who: (uid: string | null) => string;
  onReview: (s: Screening, hit: ScreeningHit, d: "match" | "not_a_match" | "undo", note: string) => void;
  onBulk: (work: () => Promise<string>) => void;
}) {
  const [showOld, setShowOld] = useState(false);
  const person = s.subject_type === "individual";
  const toReview = s.hits.filter((h) => !s.reviews[h.id]).length;
  return (
    <div className="screen-subject">
      <p>
        <strong>{s.subject_name ?? "The third party"}</strong>
        {s.subject_role ? <span className="muted small"> · {s.subject_role}</span> : null}{" "}
        <span className={s.outcome === "match" ? "chip chip-alert" : s.outcome === "to_review" ? "chip warning-text" : "chip"}>{OUTCOME_LABELS[s.outcome]}</span>{" "}
        {s.declared_pep && <span className="chip chip-alert" title="The questionnaire says this person or body is, or is linked to, a government official">Government link declared</span>}
      </p>
      <p className="small muted">
        Screened {formatWhen(s.screened_at)} by {who(s.screened_by)} · {s.total_hits} possible match{s.total_hits === 1 ? "" : "es"}
        {s.outcome === "to_review" ? ` · ${toReview} to review` : ""}
        {s.query.dob ? ` · born ${s.query.dob}` : person ? " · no date of birth used" : ""}
        {s.query.fuzzy_search ? " · close spellings included" : " · exact spelling"}
      </p>
      {s.total_hits > s.hits.length && (
        <p className="card warning small">Showing the first {s.hits.length} of {s.total_hits} possible matches. {person ? "A date of birth would narrow the list." : "Use the full registered name to narrow the list."}</p>
      )}
      {s.hits.length > 0 && (
        <ul className="plain screen-hits">
          {s.hits.map((h) => <Hit key={h.id} hit={h} s={s} canReview={canReview} busy={busy} quick={quick} onReview={(d, note) => onReview(s, h, d, note)} />)}
        </ul>
      )}
      {canReview && <ReviewRest s={s} busy={busy} run={(w) => onBulk(w)} label="not a match" />}
      {older.length > 0 && (
        <p className="small">
          <button type="button" className="link-dark" onClick={() => setShowOld(!showOld)}>{showOld ? "Hide" : "Show"} earlier screenings ({older.length})</button>
        </p>
      )}
      {showOld && (
        <ul className="small">
          {older.map((x) => <li key={x.id}>{formatWhen(x.screened_at)}: {OUTCOME_LABELS[x.outcome]} ({x.total_hits} possible match{x.total_hits === 1 ? "" : "es"}), by {who(x.screened_by)}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Sanctions, PEP and watch-list screening for one third party, and everyone its questionnaire names */
export default function ScreeningPanel({ party, screenings, caseId, named, canScreen, canReview, who, onChanged, quick = false }: {
  /** Small tier: one-click "Not them" */
  quick?: boolean;
  party: Party;
  screenings: Screening[];
  caseId: string | null;
  /** Names from the returned questionnaire (owners, office holders, management); null when none has come back */
  named: string[] | null;
  canScreen: boolean;
  canReview: boolean;
  who: (uid: string | null) => string;
  onChanged: (notice: string) => Promise<void>;
}) {
  const status = useScreeningStatus();
  const [fuzzy, setFuzzy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const person = party.subject_type === "individual";
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
  // Latest screening per subject; the third party first
  const groups = new Map<string, Screening[]>();
  for (const x of screenings) groups.set(x.subject_key ?? "party", [...(groups.get(x.subject_key ?? "party") ?? []), x]);
  const rank = (k: string) => ["party", "owner", "officer", "manager"].indexOf(k.split(":")[0]) * 1000 + Number(k.split(":")[1] ?? 0);
  const subjects = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));
  const partyLatest = groups.get("party")?.[0];
  const caseScreened = named !== null && subjects.length > 1;
  const subjectCount = named ? 1 + named.length : 1;
  const review = (s: Screening, h: ScreeningHit, d: "match" | "not_a_match" | "undo", note: string) =>
    void run(async () => {
      const outcome = await reviewHit(s.id, h.id, d, note);
      return outcome === "cleared" ? "All possible matches for this one reviewed." : outcome === "match" ? "Recorded as a match. The matching check is now a concern." : "Saved.";
    });

  return (
    <section className="card block">
      <h2>Sanctions and watch-list screening</h2>
      <p className="small muted">
        Searches sanctions lists, politically exposed persons and criminal and other watch lists through Dilisense. Adverse media is searched separately, below.
      </p>
      {problem && <p className="error" role="alert">{problem}</p>}

      {canScreen && status?.configured && named !== null && caseId && (
        <div className={caseScreened ? "block-gap" : "card note block-gap"}>
          <p>
            <strong>{caseScreened ? "Run the external check again" : "The questionnaire is back: run the external check."}</strong>{" "}
            Screens {party.name}{named.length ? ` and the ${named.length} ${named.length === 1 ? "person or organisation" : "people and organisations"} the questionnaire names (${named.slice(0, 6).join(", ")}${named.length > 6 ? ", …" : ""})` : ""}, straight from the answers. Uses {subjectCount} search{subjectCount === 1 ? "" : "es"}.
          </p>
          <div className="row wrap">
            <button type="button" className={caseScreened ? "quiet" : undefined} disabled={busy} onClick={() => void run(async () => {
              const r = await screenCase(caseId, fuzzy);
              return `${r.subjects} screened: ${r.total_hits === 0 ? "no possible matches." : `${r.total_hits} possible match${r.total_hits === 1 ? "" : "es"} to review.`}${r.skipped ? ` ${r.skipped} more were not screened (limit 40); screen them separately.` : ""}`;
            })}>{busy ? "Screening…" : caseScreened ? "Run again" : "Run external check"}</button>
            <label className="check small"><input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} /> Include close spellings</label>
          </div>
        </div>
      )}

      {subjects.length === 0 && <p className="muted">Not screened yet.{named === null && !person ? " The external check is offered once the questionnaire comes back; you can also screen the organisation's name now." : ""}</p>}
      {subjects.map(([key, list]) => (
        <SubjectResult key={key} s={list[0]} older={list.slice(1)} canReview={canReview} busy={busy} who={who} onReview={review} onBulk={(w) => void run(w)} quick={quick} />
      ))}

      {canScreen && status?.configured && partyLatest && (
        <p className="small">
          <button type="button" className="link-dark" disabled={busy} onClick={() => void run(async () => {
            const file = await screeningReport(partyLatest, party.name);
            if (caseId) {
              await attachFile("dd_cases", caseId, file);
              return "The provider's PDF report is saved under Reports and evidence.";
            }
            const a = document.createElement("a");
            a.href = URL.createObjectURL(file);
            a.download = file.name;
            a.click();
            return "Report downloaded.";
          })}>{caseId ? `Save the provider's PDF report for ${person ? "this person" : "the organisation"} to this case` : "Download the provider's PDF report"}</button>
          <span className="muted"> (counts as one search)</span>
        </p>
      )}

      {canScreen && (
        status === undefined ? null : !status?.configured ? (
          <p className="small muted">Screening is not switched on for this organisation yet. An administrator needs to add the Dilisense key (Settings, Integrations).</p>
        ) : named === null || person ? (
          <div className="row wrap">
            <button type="button" className={partyLatest ? "quiet" : undefined} disabled={busy} onClick={() => void run(async () => {
              const r = await screenParty(party.id, fuzzy);
              return r.total_hits === 0 ? "Screened: no possible matches." : `Screened: ${r.total_hits} possible match${r.total_hits === 1 ? "" : "es"} to review.`;
            })}>{busy ? "Screening…" : partyLatest ? `Screen ${person ? "the person" : "the organisation"} again` : "Screen now"}</button>
            {named === null && <label className="check small"><input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} /> Include close spellings</label>}
            <span className="small muted">
              Sends {person ? "the name, and date of birth and gender if recorded," : "the name"} to Dilisense in Switzerland. Dilisense says it keeps no record of searches.
            </span>
          </div>
        ) : null
      )}
    </section>
  );
}

/** "Mark the rest not relevant": one reason for everything not yet reviewed */
export function ReviewRest({ s, busy, run, label }: { s: Screening; busy: boolean; run: (work: () => Promise<string>) => void; label: string }) {
  const left = s.hits.filter((h) => !s.reviews[h.id]).length;
  if (left < 2) return null;
  // One click: the reason is recorded for the record, so nobody has to type it
  const note = label === "not relevant" ? "Marked together: none of the remaining findings is relevant" : "Marked together: none of the remaining possible matches is this subject";
  return (
    <p className="small">
      <button type="button" className="link-dark" disabled={busy} onClick={() => run(async () => { await reviewRest(s.id, note); return `${left} marked ${label}.`; })}>
        Mark the remaining {left} {label}
      </button>
    </p>
  );
}

