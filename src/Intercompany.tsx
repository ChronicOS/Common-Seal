import { useCallback, useEffect, useState, type FormEvent } from "react";
import { money } from "./authority";
import { formatDay } from "./board";
import {
  ARRANGEMENT_TYPES,
  CONTRACT_STATUS,
  fileArrangement,
  loadContracts,
  type Contract,
  type ContractsData,
} from "./contracts";
import { layoutGroup, NODE } from "./GroupChart";
import { setTier } from "./register";
import type { GroupData, Organisation } from "./types";

type Props = {
  organisation: Organisation;
  group: GroupData;
  role: string;
  onOpenContract: (contractId: string) => void;
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** What is wrong with an arrangement's paperwork, if anything. */
function gap(c: Contract, exceptions: number): string | null {
  const today = localToday();
  if (c.status === "signed" && c.ends_on && c.ends_on < today) return "Expired: the agreement has ended";
  if (c.status !== "signed" && c.starts_on && c.starts_on <= today) return "In effect without a signed agreement";
  if (exceptions > 0) return "Signed outside authority or before approval";
  return null;
}

function short(name: string, max = 24) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export default function Intercompany({ organisation, group, role, onOpenContract }: Props) {
  const canFile = ["owner", "admin", "secretary", "legal", "compliance"].includes(role);
  const isAdmin = role === "owner" || role === "admin";
  const allowed = organisation.tier === "large";

  const [data, setData] = useState<ContractsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const [providerId, setProviderId] = useState(group.entities[0]?.id ?? "");
  const [recipientId, setRecipientId] = useState(group.entities[1]?.id ?? "");
  const [kind, setKind] = useState(ARRANGEMENT_TYPES[0]);
  const [value, setValue] = useState("");
  const [pricing, setPricing] = useState("");
  const [rate, setRate] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reviewBy, setReviewBy] = useState("");

  const reload = useCallback(async () => {
    setData(await loadContracts(organisation.id));
  }, [organisation.id]);

  useEffect(() => {
    if (!allowed) return;
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load intercompany arrangements."));
  }, [reload, allowed]);

  if (!allowed) {
    return (
      <>
        <p className="eyebrow">Group arrangements</p>
        <h1>Intercompany</h1>
        <section className="card">
          <h2>Intercompany is part of the large tier</h2>
          <p>This organisation is on the {organisation.tier} tier.</p>
          {isAdmin && (
            <>
              <p className="muted">This is a test organisation, so you can change its tier here.</p>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setTier(organisation.id, "large").then(
                    () => window.location.reload(),
                    (e) => {
                      setBusy(false);
                      setError(e instanceof Error ? e.message : "Could not change the tier.");
                    },
                  );
                }}
              >
                Switch to the large tier
              </button>
            </>
          )}
        </section>
        {error && (
          <p className="error block" role="alert">
            {error}
          </p>
        )}
      </>
    );
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

  const name = (id: string | null | undefined) => group.entities.find((e) => e.id === id)?.name ?? "Unknown entity";
  const all = data.contracts.filter((c) => c.counterparty_entity_id);
  const shown = filter ? all.filter((c) => c.arrangement_type === filter) : all;
  const exceptionCount = (c: Contract) => data.exceptions.filter((x) => x.contract_id === c.id).length;
  const gaps = all.map((c) => ({ c, problem: gap(c, exceptionCount(c)) })).filter((g) => g.problem);
  const typesInUse = [...new Set(all.map((c) => c.arrangement_type).filter((t): t is string => Boolean(t)))];

  const layout = layoutGroup(group);
  const { W, H, PAD } = NODE;
  // Leave room to the right of the chart for flow lines between stacked entities
  const mapHeight = layout.height;
  const mapWidth = layout.width + 170;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!providerId || !recipientId) return setError("Choose both companies.");
    if (providerId === recipientId) return setError("Choose two different companies.");
    const amount = value.trim() === "" ? null : Number(value.replace(/[$,\s]/g, ""));
    if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) return setError("Enter the amount as a number, or leave it blank.");
    const interest = rate.trim() === "" ? null : Number(rate.replace(/[%\s]/g, ""));
    if (interest !== null && !(Number.isFinite(interest) && interest >= 0)) return setError("Enter the interest rate as a number.");
    setBusy(true);
    setError(null);
    try {
      const id = await fileArrangement(organisation.id, {
        providerId,
        recipientId,
        arrangementType: kind,
        title: `${kind}: ${short(name(providerId), 40)} to ${short(name(recipientId), 40)}`,
        value: amount,
        pricingBasis: pricing,
        interestRate: kind === "Loan" ? interest : null,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        reviewBy: reviewBy || null,
      });
      onOpenContract(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the arrangement.");
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Group arrangements</p>
      <h1>Intercompany</h1>

      {group.entities.length < 2 ? (
        <p className="card note">Add at least two entities on the Overview page; an arrangement runs between two group companies.</p>
      ) : (
        <>
          {gaps.length > 0 && (
            <section className="card warning">
              <h2>Gaps to fix</h2>
              <ul className="plain">
                {gaps.map(({ c, problem }) => (
                  <li key={c.id}>
                    <button type="button" className="link-dark" onClick={() => onOpenContract(c.id)}>
                      {c.title}
                    </button>
                    : {problem}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="block">
            <div className="row spread">
              <h2>Map</h2>
              {typesInUse.length > 1 && (
                <select aria-label="Show arrangements of type" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All types</option>
                  {typesInUse.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="chart-scroll">
              <svg
                className="chart"
                width={mapWidth}
                height={mapHeight}
                viewBox={`0 0 ${mapWidth} ${mapHeight}`}
                role="img"
                aria-label={`Intercompany map: ${shown.length} arrangement${shown.length === 1 ? "" : "s"} between group entities`}
              >
                <defs>
                  <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" className="flow-head" />
                  </marker>
                </defs>
                <g transform={`translate(${PAD} ${PAD})`}>
                  {layout.current.map((r) => {
                    const parent = layout.placed.get(r.parent_entity_id);
                    const child = layout.placed.get(r.child_entity_id);
                    if (!parent || !child) return null;
                    const midY = child.y - NODE.GAP_Y / 2;
                    return (
                      <path
                        key={r.id}
                        className="chart-link chart-link-faint"
                        d={`M${parent.x + W / 2} ${parent.y + H}V${midY}H${child.x + W / 2}V${child.y}`}
                      />
                    );
                  })}
                  {[...layout.placed.values()].map(({ entity, x, y }) => (
                    <g key={entity.id} transform={`translate(${x} ${y})`} className="map-node">
                      <rect width={W} height={H} rx="8" />
                      <text className="chart-name" x="12" y="30">
                        {short(entity.name)}
                      </text>
                    </g>
                  ))}
                  {shown.map((c, i) => {
                    const from = layout.placed.get(c.entity_id);
                    const to = layout.placed.get(c.counterparty_entity_id ?? "");
                    if (!from || !to) return null;
                    const problem = gap(c, exceptionCount(c));
                    // Each line leaves and arrives at a slightly different point so several between the same pair stay apart
                    const offset = ((i % 5) - 2) * 9;
                    const y1 = from.y + H / 2 + offset;
                    const y2 = to.y + H / 2 + offset;
                    // Same column: bow out to the right of both boxes. Otherwise run between the facing sides.
                    const stacked = Math.abs(from.x - to.x) < 1;
                    const right = to.x > from.x;
                    const x1 = stacked || right ? from.x + W : from.x;
                    const x2 = stacked || !right ? to.x + W : to.x;
                    const bow = 44 + (i % 3) * 16;
                    const c1 = stacked ? x1 + bow : (x1 + x2) / 2;
                    const c2 = stacked ? x2 + bow : (x1 + x2) / 2;
                    const tip = stacked || !right ? x2 + 2 : x2 - 2;
                    const labelX = stacked ? x1 + bow * 0.75 + 6 : (x1 + x2) / 2;
                    const labelY = (y1 + y2) / 2 + (stacked ? 4 : -6);
                    return (
                      <g key={c.id} className={problem ? "flow flow-gap" : "flow"}>
                        <path d={`M${x1} ${y1}C${c1} ${y1} ${c2} ${y2} ${tip} ${y2}`} markerEnd="url(#flow-arrow)" />
                        <text x={labelX} y={labelY} textAnchor={stacked ? "start" : "middle"}>
                          {c.arrangement_type ?? "Arrangement"}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
            <p className="muted">
              Arrows run from the company providing to the company receiving. A red dashed line marks a gap in the paperwork.
            </p>
          </section>

          <section className="block">
            <h2>Arrangements</h2>
            {shown.length === 0 ? (
              <p className="muted">None recorded yet.</p>
            ) : (
              <ul className="entity-list">
                {shown.map((c) => {
                  const problem = gap(c, exceptionCount(c));
                  return (
                    <li key={c.id}>
                      <button type="button" className="entity-row" onClick={() => onOpenContract(c.id)}>
                        <span>
                          <span className="entity-name">{c.arrangement_type ?? "Arrangement"}</span>
                          <span className="muted">
                            {" "}
                            · {name(c.entity_id)} to {name(c.counterparty_entity_id)}
                          </span>
                          <br />
                          <span className="muted">
                            {c.value_amount !== null ? money(c.value_amount) : "No amount"}
                            {c.pricing_basis ? ` · ${c.pricing_basis}` : ""}
                            {c.interest_rate != null ? ` · ${Number(c.interest_rate)}% a year` : ""}
                            {c.ends_on ? ` · ends ${formatDay(c.ends_on)}` : ""}
                          </span>
                          {problem && (
                            <>
                              <br />
                              <span className="warning-text">{problem}</span>
                            </>
                          )}
                        </span>
                        <span className={problem ? "chip chip-alert" : "chip"}>{CONTRACT_STATUS[c.status]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {canFile && (
            <form className="card form" onSubmit={submit}>
              <h2>Record an arrangement</h2>
              <div className="row">
                <span className="field">
                  <label htmlFor="ic-from">Provided by</label>
                  <select id="ic-from" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                    {group.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="field">
                  <label htmlFor="ic-to">Received by</label>
                  <select id="ic-to" value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
                    {group.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <label htmlFor="ic-kind">Type</label>
              <select id="ic-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {ARRANGEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="row">
                <span className="field">
                  <label htmlFor="ic-value">{kind === "Loan" ? "Principal" : "Annual value"} in Australian dollars</label>
                  <input id="ic-value" className="short-wide" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
                </span>
                {kind === "Loan" && (
                  <span className="field">
                    <label htmlFor="ic-rate">Interest rate, % a year</label>
                    <input id="ic-rate" className="short" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                  </span>
                )}
              </div>
              <label htmlFor="ic-pricing">Pricing basis (optional)</label>
              <input id="ic-pricing" placeholder="e.g. Cost plus 5%" value={pricing} onChange={(e) => setPricing(e.target.value)} />
              <div className="row">
                <span className="field">
                  <label htmlFor="ic-start">Starts</label>
                  <input id="ic-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                </span>
                <span className="field">
                  <label htmlFor="ic-end">Ends</label>
                  <input id="ic-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
                </span>
                <span className="field">
                  <label htmlFor="ic-review">Review by</label>
                  <input id="ic-review" type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} />
                </span>
              </div>
              <p className="muted">
                Each company approves under its own delegation rules for "Intercompany", and each signs. Transfer
                pricing analysis stays outside this record.
              </p>
              <button type="submit" disabled={busy}>
                {busy ? "Recording…" : "Record and send for approval"}
              </button>
            </form>
          )}
        </>
      )}
      {error && (
        <p className="error block" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
