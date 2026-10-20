import { useState } from "react";
import { formatWhen } from "./board";
import {
  loadCaseTargets, MEDIA_CATEGORY_LABELS, mediaSearch, OUTCOME_LABELS, reviewHit,
  type MediaFinding, type Party, type Screening,
} from "./parties";
import { ReviewRest, useScreeningStatus } from "./Screening";

const MEDIA_OUTCOME: Record<Screening["outcome"], string> = {
  no_matches: "Nothing found",
  to_review: "Findings to review",
  cleared: "Reviewed: none relevant",
  match: "Relevant adverse media",
};

function FindingRow({ f, s, canReview, busy, onReview, quick = false }: { f: MediaFinding; s: Screening; canReview: boolean; busy: boolean; onReview: (d: "match" | "not_a_match" | "undo", note: string) => void; quick?: boolean }) {
  const review = s.reviews[f.id];
  const [deciding, setDeciding] = useState<"match" | "not_a_match" | null>(null);
  const [note, setNote] = useState("");
  return (
    <li className={review?.decision === "match" ? "card warning screen-hit" : "card screen-hit"}>
      <p>
        <a className="link-dark" href={f.url} target="_blank" rel="noopener noreferrer"><strong>{f.headline || f.url}</strong></a>{" "}
        <span className="chip">{MEDIA_CATEGORY_LABELS[f.category] ?? f.category.replace(/_/g, " ")}</span>{" "}
        <span className="chip">{f.source === "claude" ? "Claude news search" : "Dilisense"}</span>
      </p>
      <p className="small muted">
        {[f.publisher, f.published, f.language && f.language !== "en" ? `in ${f.language}` : "", f.same_subject === "likely" ? "likely the same subject" : f.same_subject === "possible" ? "possibly the same subject" : ""].filter(Boolean).join(" · ")}
      </p>
      {f.summary && <p className="small">{f.summary}</p>}
      {review ? (
        <p className="small">
          <strong className={review.decision === "match" ? "warning-text" : "ok-text"}>{review.decision === "match" ? "Relevant" : "Not relevant"}</strong>
          {" "}· {review.note} · {review.by_name ?? "someone"}, {formatWhen(review.at)}
          {canReview && <> <button type="button" className="link-dark" disabled={busy} onClick={() => onReview("undo", "")}>Undo</button></>}
        </p>
      ) : canReview ? (
        deciding ? (
          <div className="form">
            <label htmlFor={`mf-${s.id}-${f.id}`}>{deciding === "match" ? "Why is it relevant?" : "Why is it not relevant?"}</label>
            <input id={`mf-${s.id}-${f.id}`} value={note} placeholder={deciding === "match" ? "About this company; investigation still open" : "Different person; resolved in 2019 with no finding"} onChange={(e) => setNote(e.target.value)} />
            <div className="row">
              <button type="button" disabled={busy || note.trim().length < 5} onClick={() => onReview(deciding, note)}>Save</button>
              <button type="button" className="link-dark" onClick={() => setDeciding(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="quiet" disabled={busy} onClick={() => (quick ? onReview("not_a_match", "Not about them, or not a concern") : setDeciding("not_a_match"))}>Not relevant</button>
            <button type="button" className="quiet" disabled={busy} onClick={() => setDeciding("match")}>Relevant</button>
          </div>
        )
      ) : (
        <p className="small muted">Waiting for Legal or Compliance to review.</p>
      )}
      <p className="small muted">Open the link and read the article before deciding. Summaries can be wrong.</p>
    </li>
  );
}

function SubjectMedia({ s, older, canReview, busy, who, run, quick = false }: {
  quick?: boolean; s: Screening; older: Screening[]; canReview: boolean; busy: boolean; who: (uid: string | null) => string; run: (work: () => Promise<string>) => void }) {
  const [showOld, setShowOld] = useState(false);
  const q = s.query as unknown as { provider?: string; dilisense_counts?: Record<string, number> | null; dilisense_total?: number | null; dilisense_error?: string | null; claude_conclusion?: string | null; claude_queries?: string[] | null; claude_error?: string | null; claude_dropped?: number | null };
  const findings = s.hits as unknown as MediaFinding[];
  const counts = Object.entries(q.dilisense_counts ?? {}).filter(([, n]) => n > 0);
  return (
    <div className="screen-subject">
      <p>
        <strong>{s.subject_name ?? "The third party"}</strong>
        {s.subject_role ? <span className="muted small"> · {s.subject_role}</span> : null}{" "}
        <span className={s.outcome === "match" ? "chip chip-alert" : s.outcome === "to_review" ? "chip warning-text" : "chip"}>{MEDIA_OUTCOME[s.outcome]}</span>
      </p>
      <p className="small muted">
        Searched {formatWhen(s.screened_at)} by {who(s.screened_by)} · {(q.provider ?? "").split("+").map((x) => (x === "claude" ? "Claude news search" : "Dilisense")).join(" and ")} · last ten years
      </p>
      {q.claude_conclusion && <p className="small"><strong>Claude:</strong> {q.claude_conclusion}</p>}
      {q.claude_queries?.length ? <p className="small muted">Searched for: {q.claude_queries.join("; ")}</p> : null}
      {q.dilisense_counts && (
        <p className="small">
          <strong>Dilisense:</strong> {counts.length === 0 ? "no adverse articles in any category." : `articles mentioning this name: ${counts.map(([c, n]) => `${n} on ${(MEDIA_CATEGORY_LABELS[c] ?? c).toLowerCase()}`).join(", ")}. Up to 5 recent ones per category are shown.`}
          {counts.length > 0 && <span className="muted"> Counts include anyone with the same name.</span>}
        </p>
      )}
      {(q.dilisense_error || q.claude_error) && <p className="small warning-text">Not all sources ran: {[q.dilisense_error, q.claude_error].filter(Boolean).join(" ")}</p>}
      {(q.claude_dropped ?? 0) > 0 && <p className="small muted">{q.claude_dropped === 1 ? "1 suggested link was left out because it did not come from the search results." : `${q.claude_dropped} suggested links were left out because they did not come from the search results.`}</p>}
      {findings.length > 0 && (
        <ul className="plain screen-hits">
          {findings.map((f) => (
            <FindingRow key={f.id} f={f} s={s} canReview={canReview} busy={busy} quick={quick}
              onReview={(d, note) => run(async () => {
                const outcome = await reviewHit(s.id, f.id, d, note);
                return outcome === "match" ? "Marked relevant. The adverse media check is now a concern." : outcome === "cleared" ? "All findings for this one reviewed." : "Saved.";
              })} />
          ))}
        </ul>
      )}
      {canReview && <ReviewRest s={s} busy={busy} run={run} label="not relevant" />}
      {older.length > 0 && (
        <p className="small"><button type="button" className="link-dark" onClick={() => setShowOld(!showOld)}>{showOld ? "Hide" : "Show"} earlier searches ({older.length})</button></p>
      )}
      {showOld && <ul className="small">{older.map((x) => <li key={x.id}>{formatWhen(x.screened_at)}: {OUTCOME_LABELS[x.outcome]} ({x.hits.length} finding{x.hits.length === 1 ? "" : "s"}), by {who(x.screened_by)}</li>)}</ul>}
    </div>
  );
}

/** Adverse media for one third party, and everyone its questionnaire names */
export default function AdverseMediaPanel({ party, searches, caseId, canSearch, canReview, who, onChanged, quick = false }: {
  quick?: boolean;
  party: Party;
  searches: Screening[];
  caseId: string | null;
  canSearch: boolean;
  canReview: boolean;
  who: (uid: string | null) => string;
  onChanged: (notice: string) => Promise<void>;
}) {
  const status = useScreeningStatus();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = Boolean(status?.configured || status?.claude);
  const run = (work: () => Promise<string>) => {
    setBusy(true);
    setProblem(null);
    void work().then(
      (n) => onChanged(n),
      (e: unknown) => setProblem(e instanceof Error ? e.message : "The search failed."),
    ).finally(() => {
      setBusy(false);
      setProgress(null);
    });
  };
  const groups = new Map<string, Screening[]>();
  for (const x of searches) groups.set(x.subject_key ?? "party", [...(groups.get(x.subject_key ?? "party") ?? []), x]);
  const rank = (k: string) => ["party", "owner", "officer", "manager"].indexOf(k.split(":")[0]) * 1000 + Number(k.split(":")[1] ?? 0);
  const subjects = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));

  const searchAll = () => run(async () => {
    const targets = caseId ? await loadCaseTargets(caseId) : [{ key: "party", name: party.name }];
    let found = 0;
    const warnings = new Set<string>();
    const failed: string[] = [];
    for (const [i, t] of targets.entries()) {
      setProgress(`Searching ${i + 1} of ${targets.length}: ${t.name}…`);
      try {
        const r = await mediaSearch(party.id, caseId, t.key);
        found += r.findings;
        r.warnings.forEach((w) => warnings.add(w));
      } catch (e) {
        failed.push(`${t.name} (${e instanceof Error ? e.message : "failed"})`);
      }
    }
    if (failed.length === targets.length) throw new Error(`The search did not run: ${failed[0]}`);
    return `Adverse media searched for ${targets.length - failed.length} of ${targets.length}: ${found === 0 ? "nothing found." : `${found} finding${found === 1 ? "" : "s"} to review.`}${failed.length ? ` Not searched: ${failed.join("; ")}.` : ""}${warnings.size ? ` ${[...warnings].join(" ")}` : ""}`;
  });

  return (
    <section className="card block">
      <h2>Adverse media</h2>
      <p className="small muted">
        News about bribery, fraud, financial crime, sanctions, regulatory action, litigation, insolvency, and human rights or environmental issues, over the last ten years.
        {status?.claude ? " Claude news search uses AI to search and summarise; every finding links to its source, and someone must read it before deciding." : ""}
      </p>
      {problem && <p className="error" role="alert">{problem}</p>}
      {subjects.length === 0 && <p className="muted">Not searched yet.</p>}
      {subjects.map(([key, list]) => <SubjectMedia key={key} s={list[0]} older={list.slice(1)} canReview={canReview} busy={busy} who={who} run={run} quick={quick} />)}
      {canSearch && (
        status === undefined ? null : !ready ? (
          <p className="small muted">Adverse media search is not switched on yet. Whoever runs your Supabase project adds the keys (Settings, Integrations).</p>
        ) : (
          <div className="row wrap">
            <button type="button" className={subjects.length ? "quiet" : undefined} disabled={busy} onClick={searchAll}>{busy ? (progress ?? "Searching…") : subjects.length ? "Search again" : "Search adverse media"}</button>
            <span className="small muted">
              {caseId ? "Covers the third party and everyone its returned questionnaire names. " : ""}
              Sends names (and for people, role and birth year) to {[status?.configured ? "Dilisense (Switzerland)" : "", status?.claude ? "Anthropic's Claude API (outside Australia)" : ""].filter(Boolean).join(" and ")}. Each person or organisation takes up to a minute.
            </span>
          </div>
        )
      )}
    </section>
  );
}
