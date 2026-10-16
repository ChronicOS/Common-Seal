import { has, only } from "./roles";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { money } from "./authority";
import { formatDay, loadMembers, type Member } from "./board";
import {
  decideGift,
  declareGift,
  GIFT_STATUS,
  loadDeclarations,
  loadGiftSetup,
  addGiftType,
  setGiftResponsible,
  updateGiftType,
  type Gift,
  type GiftSetup,
} from "./declarations";

type Props = { organisationId: string; role: string; userId: string };

/** Saves a limit when the field is left */
function LimitInput({ value, label, disabled, onSave }: { value: number; label: string; disabled: boolean; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <input
      aria-label={label}
      className="short-wide"
      inputMode="decimal"
      disabled={disabled}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v.replace(/[$,\s]/g, ""));
        if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n);
        else setV(String(value));
      }}
    />
  );
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};


export default function Declarations({ organisationId, role, userId }: Props) {
  const isRecords = has(role, ...["owner", "admin", "secretary", "legal", "compliance"]);
  const [setup, setSetup] = useState<GiftSetup | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const isOfficer = Boolean(setup?.responsible_user_id && setup.responsible_user_id === userId);
  const canDecide = isRecords || isOfficer;
  const [typeId, setTypeId] = useState("");
  const [newType, setNewType] = useState({ name: "", kind: "gift" as "gift" | "hospitality", limit: "25" });
  const canDeclare = !only(role, "auditor");

  const [data, setData] = useState<{ gifts: Gift[] } | null>(null);
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


  const reload = useCallback(async () => {
    const [d, g, m] = await Promise.all([loadDeclarations(organisationId), loadGiftSetup(organisationId).catch(() => null), loadMembers(organisationId).catch(() => [])]);
    setData(d);
    setSetup(g);
    setMembers(m);
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

  const memberName = (id: string) => members.find((m) => m.user_id === id)?.name ?? "the responsible person";

  async function submitGift(event: FormEvent) {
    event.preventDefault();
    const amount = Number(value.replace(/[$,\s]/g, ""));
    if (value.trim() === "" || !Number.isFinite(amount) || amount < 0) return setError("Enter the value as a number. An estimate is fine.");
    if (staff.trim().length < 2 || other.trim().length < 2 || what.trim().length < 2) return setError("Say who it involved and what it was.");
    if (setup && setup.types.some((t) => t.is_active) && !typeId) return setError("Choose the type, so the right limit applies.");
    const ok = await run(async () => {
      const status = await declareGift(organisationId, {
        staff_name: staff.trim(),
        direction,
        other_party: other.trim(),
        description: what.trim(),
        value_amount: amount,
        occurred_on: when,
        public_official: official,
        ...(typeId ? { type_id: typeId } : {}),
      });
      setNotice(
        status === "pending"
          ? `Declared. It is above the notifiable limit for its type, or involves a public official, so it needs a decision${setup?.responsible_user_id ? ` by ${memberName(setup.responsible_user_id)}` : ""}.`
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



  return (
    <>
      <p className="eyebrow">Conduct</p>
      <h1>Gifts and hospitality</h1>
      {!canDecide && <p className="muted">You see your own declarations. The responsible person and Compliance see everyone's.</p>}
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
        <h2>Declared</h2>
        {data.gifts.length === 0 ? (
          <p className="muted">Nothing declared.</p>
        ) : (
          <ul className="plain rows">
            {data.gifts.map((g) => (
              <li key={g.id}>
                <span className="row spread">
                  <span>
                    <strong>{g.description}</strong> · {money(g.value_amount)}
                    {g.type_id && setup ? <span className="muted"> · {setup.types.find((t) => t.id === g.type_id)?.name ?? ""}</span> : null}
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
            {setup && setup.types.some((t) => t.is_active) && (
              <>
                <label htmlFor="g-type">Type</label>
                <select id="g-type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  <option value="">Choose…</option>
                  {setup.types
                    .filter((t) => t.is_active)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (needs a decision above {money(t.notifiable_from)})
                      </option>
                    ))}
                </select>
              </>
            )}
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

      {setup && (
        <section className="card form block">
          <h2>Responsible person and notifiable limits</h2>
          <label htmlFor="g-officer">Responsible person</label>
          {isRecords ? (
            <select id="g-officer" value={setup.responsible_user_id ?? ""} disabled={busy} onChange={(e) => void run(() => setGiftResponsible(organisationId, e.target.value || null))}>
              <option value="">Not nominated (Legal, Compliance or the company secretary decide)</option>
              {members
                .filter((m) => m.is_active)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
            </select>
          ) : (
            <p id="g-officer">{setup.responsible_user_id ? memberName(setup.responsible_user_id) : "Not nominated"}</p>
          )}
          <p className="muted">
            The responsible person sees every declaration, decides those above the limit for their type or involving a public official, and sets the limits below. A declaration at or under the limit is recorded without a decision.
          </p>
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Gift or hospitality</th>
                  <th scope="col">Needs a decision above (AUD)</th>
                  <th scope="col">In use</th>
                </tr>
              </thead>
              <tbody>
                {setup.types.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">{t.name}</th>
                    <td>{t.kind === "gift" ? "Gift" : "Hospitality"}</td>
                    <td>
                      {canDecide ? <LimitInput value={t.notifiable_from} label={`Limit for ${t.name}`} disabled={busy} onSave={(n) => void run(() => updateGiftType(t.id, { notifiable_from: n }))} /> : money(t.notifiable_from)}
                    </td>
                    <td>
                      {canDecide ? (
                        <label className="check">
                          <input type="checkbox" checked={t.is_active} disabled={busy} onChange={(e) => void run(() => updateGiftType(t.id, { is_active: e.target.checked }))} /> {t.is_active ? "Yes" : "No"}
                        </label>
                      ) : t.is_active ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canDecide && (
            <div className="row">
              <input aria-label="New type" placeholder="e.g. Event tickets, Travel and accommodation" value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} />
              <select aria-label="Gift or hospitality" value={newType.kind} onChange={(e) => setNewType({ ...newType, kind: e.target.value as "gift" | "hospitality", limit: e.target.value === "gift" ? "25" : "100" })}>
                <option value="gift">Gift</option>
                <option value="hospitality">Hospitality</option>
              </select>
              <input aria-label="Limit for the new type" className="short-wide" inputMode="decimal" value={newType.limit} onChange={(e) => setNewType({ ...newType, limit: e.target.value })} />
              <button
                type="button"
                className="quiet"
                disabled={busy || newType.name.trim().length < 2 || !(Number(newType.limit) >= 0)}
                onClick={() => void run(() => addGiftType(organisationId, { name: newType.name, kind: newType.kind, notifiable_from: Number(newType.limit), position: setup.types.length + 1 })).then((ok) => ok && setNewType({ name: "", kind: "gift", limit: "25" }))}
              >
                Add type
              </button>
            </div>
          )}
        </section>
      )}

      <p className="card note block">Conflicts of interest now have their own register: Conduct, Conflicts of interest. Declarations made here before are kept there.</p>
    </>
  );
}
