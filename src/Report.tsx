import { useEffect, useState } from "react";
import { loadAttestations, tally, type AttestationItem, type Round, type RoundTally } from "./attestations";
import { formatDay, loadAssurance, type AssuranceSummary } from "./board";
import { loadMsSummary, MS_STATUS, type MsSummary } from "./modernslavery";
import { loadPartySummary, type PartySummary } from "./parties";
import { loadPolicySummary, type PolicySummary } from "./policies";
import { loadRegisterSummary, type RegisterSummary } from "./register";
import { loadSpeakUpSummary, type SpeakUpSummary } from "./speakup";
import { loadTrainingSummary, today, type TrainingSummary } from "./training";
import { loadWorkflowSummary, type WorkflowSummary } from "./workflows";

type Loaded = {
  assurance: AssuranceSummary | null;
  register: RegisterSummary | null;
  parties: PartySummary | null;
  training: TrainingSummary | null;
  workflows: WorkflowSummary | null;
  policies: PolicySummary | null;
  speakUp: SpeakUpSummary | null;
  ms: MsSummary | null;
  round: Round | null;
  tally: RoundTally | null;
  exceptions: AttestationItem[];
};

const quiet = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

/** One line of the report: the area, what the records show, and whether it needs the board's attention. */
function Line({ area, finding, status }: { area: string; finding: string; status: "ok" | "attention" | "unknown" }) {
  return (
    <tr>
      <th scope="row">{area}</th>
      <td>{finding}</td>
      <td>
        <span className={status === "attention" ? "chip chip-alert" : "chip"}>{status === "ok" ? "No concern recorded" : status === "attention" ? "Needs attention" : "Unknown"}</span>
      </td>
    </tr>
  );
}

export default function Report({ organisationId, organisationName }: { organisationId: string; organisationName: string }) {
  const [d, setD] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [assurance, register, parties, training, workflows, policies, speakUp, ms, attest] = await Promise.all([
        quiet(loadAssurance(organisationId)),
        quiet(loadRegisterSummary(organisationId)),
        quiet(loadPartySummary(organisationId)),
        quiet(loadTrainingSummary(organisationId)),
        quiet(loadWorkflowSummary(organisationId, today())),
        quiet(loadPolicySummary(organisationId, today())),
        quiet(loadSpeakUpSummary(organisationId)),
        quiet(loadMsSummary(organisationId)),
        quiet(loadAttestations(organisationId)),
      ]);
      const round = attest?.rounds[0] ?? null;
      const items = round && attest ? attest.items.filter((i) => i.round_id === round.id) : [];
      if (live) setD({ assurance, register, parties, training, workflows, policies, speakUp, ms, round, tally: round ? tally(items) : null, exceptions: items.filter((i) => i.response !== "confirmed") });
    })();
    return () => {
      live = false;
    };
  }, [organisationId]);

  if (!d) return <p className="lead">Preparing the report…</p>;

  const { assurance: a, register: r, parties: p, training: t, workflows: w, policies: pol, speakUp: su, ms, round, tally: at } = d;
  const stmt = ms?.latest ?? null;

  return (
    <div className="report">
      <p className="eyebrow">Board assurance report</p>
      <h1>{organisationName}</h1>
      <p className="lead">
        Prepared {formatDay(today())} from the records held in Common Seal.{" "}
        <button type="button" className="quiet no-print" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </p>
      <p className="muted">
        "Unknown" means the records cannot support a statement either way. It is never shown as satisfactory. "No concern recorded"
        means nothing in the records points to a problem; it is not a guarantee.
      </p>

      <table className="report-table">
        <thead>
          <tr>
            <th scope="col">Area</th>
            <th scope="col">What the records show</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          <Line
            area="Board decisions and actions"
            finding={a ? `${a.decisions.length} decisions on record · ${a.openActions} open actions, ${a.overdueActions} overdue` : "Not available"}
            status={!a || a.decisions.length + a.openActions === 0 ? "unknown" : a.overdueActions > 0 ? "attention" : "ok"}
          />
          <Line
            area="Signing authority"
            finding={a ? `${a.exceptions} contracts signed outside authority or before approval` : "Not available"}
            status={!a ? "unknown" : a.exceptions > 0 ? "attention" : "ok"}
          />
          <Line
            area="Risks and obligations"
            finding={r && r.active > 0 ? `${r.active} confirmed · ${r.overdue} overdue for review · ${r.withGaps} with ownership gaps` : "Nothing is confirmed on the register"}
            status={!r || r.active === 0 ? "unknown" : r.overdue + r.withGaps > 0 ? "attention" : "ok"}
          />
          <Line
            area="Attestations"
            finding={
              round && at
                ? `${round.name} (${round.status}): ${at.confirmed} of ${at.total} confirmed · ${at.exceptions} exceptions · ${at.waiting} not answered · ${at.nobody} with nobody to ask`
                : "No attestation round has been run"
            }
            status={!round || !at ? "unknown" : at.exceptions + at.waiting + at.nobody > 0 ? "attention" : "ok"}
          />
          <Line
            area="Policies"
            finding={pol && pol.inForce + pol.draftOnly > 0 ? `${pol.inForce} in force · ${pol.overdue} overdue for review · ${pol.draftOnly} not yet approved` : "No policies are recorded"}
            status={!pol || pol.inForce + pol.draftOnly === 0 ? "unknown" : pol.overdue + pol.draftOnly > 0 ? "attention" : "ok"}
          />
          <Line
            area="Training"
            finding={t && t.assigned > 0 ? `${t.complete} of ${t.assigned} assignments complete · ${t.overdue} overdue` : "No training is assigned"}
            status={!t || t.assigned === 0 ? "unknown" : t.overdue > 0 ? "attention" : "ok"}
          />
          <Line
            area="Third parties"
            finding={p && p.total > 0 ? `${p.total} on record · ${p.highRisk} high risk · ${p.open} with due diligence open · ${p.rejected} rejected` : "No third parties are recorded"}
            status={!p || p.total === 0 ? "unknown" : p.open > 0 ? "attention" : "ok"}
          />
          <Line
            area="Modern slavery statement"
            finding={stmt ? `Period to ${formatDay(stmt.period_end)}: ${MS_STATUS[stmt.status].toLowerCase()} · due ${formatDay(stmt.due_on)}` : "No statement has been started"}
            status={!stmt ? "unknown" : stmt.status !== "lodged" && stmt.due_on < today() ? "attention" : stmt.status === "lodged" ? "ok" : "attention"}
          />
          <Line
            area="Speak-up"
            finding={
              !su
                ? "Not available to you"
                : su.recipients === 0
                  ? "Nobody is appointed to receive reports"
                  : `${su.open} open · ${su.open_over_90_days} open more than 90 days · ${su.received_12_months} received and ${su.substantiated_12_months} substantiated in 12 months`
            }
            status={!su || su.recipients === 0 ? "unknown" : su.open_over_90_days > 0 ? "attention" : "ok"}
          />
          <Line
            area="Compliance workflows"
            finding={w ? `${w.open} steps open · ${w.overdue} overdue` : "Not available"}
            status={!w ? "unknown" : w.overdue > 0 ? "attention" : "ok"}
          />
        </tbody>
      </table>

      {d.exceptions.length > 0 && round && (
        <section className="block">
          <h2>Not confirmed in {round.name}</h2>
          <ul className="plain rows">
            {d.exceptions.map((i) => (
              <li key={i.id}>
                <strong>{i.title}</strong>{" "}
                <span className="muted">
                  · {i.response === "exception" ? `exception raised by ${i.attester_name ?? "the accountable person"}` : i.attester_user_id ? `not answered by ${i.attester_name ?? "the accountable person"}` : "nobody to ask"}
                </span>
                {i.comment && (
                  <>
                    <br />
                    {i.comment}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {a && a.decisions.length > 0 && (
        <section className="block">
          <h2>Recent decisions</h2>
          <ul className="plain rows">
            {a.decisions.slice(0, 8).map((x) => (
              <li key={x.id}>
                {x.text} <span className="muted">· {x.outcome} · {x.meeting.title}, {formatDay(x.meeting.scheduled_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
