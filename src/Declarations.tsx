import { useCallback, useEffect, useState, type FormEvent } from "react";
import { money } from "./authority";
import { formatDay } from "./board";
import {
  CONFLICT_STATUS,
  decideGift,
  declareConflict,
  declareGift,
  GIFT_STATUS,
  loadDeclarations,
  reviewConflict,
  type Conflict,
  type Gift,
} from "./declarations";

type Props = { organisationId: string; role: string };

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function ConflictReview({ conflict, busy, onSave }: { conflict: Conflict; busy: boolean; onSave: (status: Conflict["status"], plan: string) => void }) {
  const [plan, setPlan] = useState(conflict.management_plan ?? "");
  return (
    <div className="form review">
      <label htmlFor={`plan-${conflict.id}`}>How it is being managed</label>
      <input id={`plan-${conflict.id}`} placeholder="e.g. Recused from decisions about the supplier" value={plan} onChange={(e) => setPlan(e.target.value)} />
      <div className="row">
        <button type="button" className="quiet" disabled={busy} onClick={() => onSave("managed", plan)}>
          Mark as managed
        </button>
        <button type="button" className="link-dark" disabled={busy} onClick={() => onSave("closed", plan)}>
          Close
        </button>
      </div>
    </div>
  );
}

export default function Declarations({ organisationId, role }: Props) {
  const canDecide = ["owner", "admin", "secretary", "legal", "compliance"].includes(role);
  const canDeclare = role !== "auditor";

  const [data, setData] = useState<{ gifts: Gift[]; conflicts: Conflict[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [staff, setStaff] = useState("");
  const [direction, setDirection] = useState<Gift["direction"]>("received");
  const [other, setOther] = useState("");
  const [what, setWhat] = useState("");
  const [value, setValue] = useState("");
  const [when, setWhen] = useState(localToday);
  const [official, setOfficial] = useState(false);
  const [note, setNote] = useState("");

  const [person, setPerson] = useState("");
  const [interest, setInterest] = useState("");
  const [related, setRelated] = useState("");

  const reload = useCallback(async () => {
    setData(await loadDeclarations(organisationId));
  }, [organisationId]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load declarations."));
  }, [reload]);

  async function run(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
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

  async function submitGift(event: FormEvent) {
    event.preventDefault();
    const amount = Number(value.replace(/[$,\s]/g, ""));
    if (value.trim() === "" || !Number.isFinite(amount) || amount < 0) return setError("Enter the value as a number. An estimate is fine.");
    if (staff.trim().length < 2 || other.trim().length < 2 || what.trim().length < 2) return setError("Say who it involved and what it was.");
    const ok = await run(async () => {
      const status = await declareGift(organisationId, {
        staff_name: staff.trim(),
        direction,
        other_party: other.trim(),
        description: what.trim(),
        value_amount: amount,
        occurred_on: when,
        public_official: official,
      });
      setNotice(
        status === "pending"
          ? "Declared. It needs a decision because of its value or because a public official is involved."
          : "Declared and recorded. No approval is needed.",
      );
    });
    if (ok) {
      setOther("");
      setWhat("");
      setValue("");
      setOfficial(false);
    }
  }

  async function submitConflict(event: FormEvent) {
    event.preventDefault();
    if (person.trim().length < 2 || interest.trim().length < 5) return setError("Say whose interest it is and describe it.");
    const ok = await run(async () => {
      await declareConflict(organisationId, person, interest, related);
      setNotice("Conflict declared.");
    });
    if (ok) {
      setInterest("");
      setRelated("");
    }
  }

  return (
    <>
      <p className="eyebrow">Anti-bribery and corruption</p>
      <h1>Declarations</h1>
      {!canDecide && <p className="muted">You see your own declarations. Compliance sees everyone's.</p>}
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
        <h2>Gifts and hospitality</h2>
        {data.gifts.length === 0 ? (
          <p className="muted">Nothing declared.</p>
        ) : (
          <ul className="plain rows">
            {data.gifts.map((g) => (
              <li key={g.id}>
                <span className="row spread">
                  <span>
                    <strong>{g.description}</strong> · {money(g.value_amount)}
                    <br />
                    <span className="muted">
                      {g.staff_name} {g.direction === "given" ? "gave to" : "received from"} {g.other_party} ·{" "}
                      {formatDay(g.occurred_on)}
                      {g.public_official ? " · public official involved" : ""}
                    </span>
                    {g.decision_note && (
                      <>
                        <br />
                        <span className="muted">Note: {g.decision_note}</span>
                      </>
                    )}
                  </span>
                  <span className={g.status === "pending" ? "chip chip-alert" : "chip"}>{GIFT_STATUS[g.status]}</span>
                </span>
                {g.status === "pending" && canDecide && (
                  <div className="row review">
                    <input className="grow" aria-label={`Decision note for ${g.description}`} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => decideGift(g.id, "approved", note)).then((ok) => ok && setNote(""))}>
                      Approve
                    </button>
                    <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => decideGift(g.id, "declined", note)).then((ok) => ok && setNote(""))}>
                      Decline
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canDeclare && (
          <form className="card form" onSubmit={submitGift}>
            <h3>Declare a gift or hospitality</h3>
            <div className="row">
              <span className="field">
                <label htmlFor="g-staff">Our person</label>
                <input id="g-staff" value={staff} onChange={(e) => setStaff(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="g-direction">They</label>
                <select id="g-direction" value={direction} onChange={(e) => setDirection(e.target.value as Gift["direction"])}>
                  <option value="received">Received it</option>
                  <option value="given">Gave it</option>
                </select>
              </span>
              <span className="field">
                <label htmlFor="g-other">Other party</label>
                <input id="g-other" value={other} onChange={(e) => setOther(e.target.value)} />
              </span>
            </div>
            <label htmlFor="g-what">What it was</label>
            <input id="g-what" placeholder="e.g. Dinner after the supplier review" value={what} onChange={(e) => setWhat(e.target.value)} />
            <div className="row">
              <span className="field">
                <label htmlFor="g-value">Value in Australian dollars</label>
                <input id="g-value" className="short-wide" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
              </span>
              <span className="field">
                <label htmlFor="g-when">Date</label>
                <input id="g-when" type="date" max={localToday()} value={when} onChange={(e) => setWhen(e.target.value)} />
              </span>
            </div>
            <label className="check">
              <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} /> A public official
              is involved
            </label>
            <button type="submit" disabled={busy}>
              Declare
            </button>
          </form>
        )}
      </section>

      <section className="block">
        <h2>Conflicts of interest</h2>
        {data.conflicts.length === 0 ? (
          <p className="muted">Nothing declared.</p>
        ) : (
          <ul className="plain rows">
            {data.conflicts.map((c) => (
              <li key={c.id}>
                <span className="row spread">
                  <span>
                    <strong>{c.person_name}</strong> · {c.description}
                    <br />
                    <span className="muted">
                      {c.related_party ? `${c.related_party} · ` : ""}declared {formatDay(c.declared_on)}
                    </span>
                    {c.management_plan && (
                      <>
                        <br />
                        Managed by: {c.management_plan}
                      </>
                    )}
                  </span>
                  <span className={c.status === "open" ? "chip chip-alert" : "chip"}>{CONFLICT_STATUS[c.status]}</span>
                </span>
                {c.status !== "closed" && canDecide && (
                  <ConflictReview key={`${c.id}-${c.status}`} conflict={c} busy={busy} onSave={(status, plan) => void run(() => reviewConflict(c.id, status, plan))} />
                )}
              </li>
            ))}
          </ul>
        )}
        {canDeclare && (
          <form className="card form" onSubmit={submitConflict}>
            <h3>Declare a conflict</h3>
            <label htmlFor="c-person">Whose interest</label>
            <input id="c-person" value={person} onChange={(e) => setPerson(e.target.value)} />
            <label htmlFor="c-interest">The interest</label>
            <input id="c-interest" placeholder="e.g. Spouse is a partner at a supplier" value={interest} onChange={(e) => setInterest(e.target.value)} />
            <label htmlFor="c-related">Related party (optional)</label>
            <input id="c-related" value={related} onChange={(e) => setRelated(e.target.value)} />
            <button type="submit" disabled={busy}>
              Declare
            </button>
          </form>
        )}
      </section>
    </>
  );
}
