import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDay } from "./board";
import {
  applyTemplate,
  assign,
  CATEGORIES,
  createEntry,
  entriesInScope,
  escalation,
  gaps,
  IMPACT,
  LEVEL_LABELS,
  LIKELIHOOD,
  loadRegister,
  localDate,
  origin,
  RACI_LABELS,
  rating,
  regions,
  SECTOR_LABELS,
  setEntityRegion,
  setTier,
  summarise,
  unassign,
  updateEntry,
  type Entry,
  type Kind,
  type Level,
  type Raci,
  type RegisterData,
  type Scope,
} from "./register";
import type { GroupData, Organisation } from "./types";

type Props = {
  organisation: Organisation;
  group: GroupData;
  role: string;
  reloadGroup: () => Promise<void>;
};

const LEVELS: Level[] = ["local", "regional", "global"];
const TIER_FOR: Record<Level, string[]> = {
  local: ["small", "medium", "large"],
  regional: ["medium", "large"],
  global: ["large"],
};
const NEEDED_TIER: Record<Level, string> = { local: "small", regional: "medium", global: "large" };
const RACI_ORDER: Raci[] = ["responsible", "accountable", "consulted", "informed"];

function statusChip(entry: Entry): string {
  if (entry.status === "proposed") return "Suggested";
  if (entry.status === "closed") return "Closed";
  const r = rating(entry);
  return r ? `${r.label} (${r.score})` : "Not rated";
}

function OwnerAdder({
  raci,
  people,
  busy,
  onAdd,
}: {
  raci: Raci;
  people: { id: string; full_name: string }[];
  busy: boolean;
  onAdd: (name: string, backup: boolean) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [backup, setBackup] = useState(false);
  const canBackup = raci === "responsible" || raci === "accountable";
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length < 2) return;
        void onAdd(name, backup).then((ok) => {
          if (ok) {
            setName("");
            setBackup(false);
          }
        });
      }}
    >
      <input
        className="grow"
        list="register-people"
        autoComplete="off"
        aria-label={`Name of the person ${raci}`}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <datalist id="register-people">
        {people.map((p) => (
          <option key={p.id} value={p.full_name} />
        ))}
      </datalist>
      {canBackup && (
        <label className="check">
          <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} /> Backup
        </label>
      )}
      <button type="submit" className="quiet" disabled={busy}>
        Add
      </button>
    </form>
  );
}

export default function Register({ organisation, group, role, reloadGroup }: Props) {
  const canEdit = ["owner", "admin", "secretary", "legal", "compliance"].includes(role);
  const isAdmin = role === "owner" || role === "admin";

  const [data, setData] = useState<RegisterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<Level>("local");
  const [entityId, setEntityId] = useState(group.entities[0]?.id ?? "");
  const [region, setRegion] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Forms
  const [regionDraft, setRegionDraft] = useState<string | null>(null);
  const [newRegion, setNewRegion] = useState("");
  const [kind, setKind] = useState<Kind>("risk");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<{ description: string; controls: string; review: string } | null>(null);

  const reload = useCallback(async () => {
    setData(await loadRegister(organisation.id));
  }, [organisation.id]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the register."));
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

  // ---------- One entry ----------
  const open = openId ? data.entries.find((e) => e.id === openId) : undefined;
  if (open) {
    const mine = data.assignments.filter((a) => a.entry_id === open.id);
    const missing = gaps(open, data.assignments);
    const overdue = escalation(open);
    const r = rating(open);
    const form = draft ?? {
      description: open.description ?? "",
      controls: open.controls ?? "",
      review: open.review_on ?? "",
    };
    const readyToConfirm = !missing.includes("No one is accountable") && !missing.includes("No one is responsible");

    return (
      <>
        <button
          type="button"
          className="back"
          onClick={() => {
            setOpenId(null);
            setDraft(null);
          }}
        >
          ← Back to register
        </button>
        <p className="eyebrow">
          {LEVEL_LABELS[open.level]} · {origin(open, group.entities)} · {open.category}
        </p>
        <h1>{open.title}</h1>
        <p className="lead">
          <span className="chip">{open.kind === "risk" ? "Risk" : "Obligation"}</span>{" "}
          <span className="chip">{statusChip(open)}</span>
        </p>

        {overdue && (
          <p className="card warning" role="alert">
            <strong>Review overdue by {overdue.days} day{overdue.days === 1 ? "" : "s"}.</strong> This has escalated to{" "}
            {overdue.to}.
          </p>
        )}
        {open.status === "proposed" && (
          <p className="card note">
            {open.source === "template"
              ? "This entry was suggested by a template. It does not count toward the board's view until it is confirmed."
              : "This entry does not count toward the board's view until it is confirmed."}
          </p>
        )}
        {error && (
          <p className="error block" role="alert">
            {error}
          </p>
        )}

        <section className="card form block">
          <h2>Details</h2>
          <label htmlFor="e-desc">Description</label>
          <textarea
            id="e-desc"
            rows={3}
            disabled={!canEdit}
            value={form.description}
            onChange={(e) => setDraft({ ...form, description: e.target.value })}
          />
          <label htmlFor="e-controls">Controls and mitigations</label>
          <textarea
            id="e-controls"
            rows={3}
            disabled={!canEdit}
            value={form.controls}
            onChange={(e) => setDraft({ ...form, controls: e.target.value })}
          />
          <div className="row">
            <span className="field">
              <label htmlFor="e-like">Likelihood</label>
              <select
                id="e-like"
                disabled={!canEdit || busy}
                value={open.likelihood ?? ""}
                onChange={(e) => void run(() => updateEntry(open.id, { likelihood: Number(e.target.value) || null }))}
              >
                <option value="">Not rated</option>
                {LIKELIHOOD.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {i + 1}. {label}
                  </option>
                ))}
              </select>
            </span>
            <span className="field">
              <label htmlFor="e-impact">Impact</label>
              <select
                id="e-impact"
                disabled={!canEdit || busy}
                value={open.impact ?? ""}
                onChange={(e) => void run(() => updateEntry(open.id, { impact: Number(e.target.value) || null }))}
              >
                <option value="">Not rated</option>
                {IMPACT.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {i + 1}. {label}
                  </option>
                ))}
              </select>
            </span>
            <span className="field">
              <span className="label">Rating</span>
              <strong>{r ? `${r.label} (${r.score} of 25)` : "Not rated"}</strong>
            </span>
          </div>
          <div className="row">
            <span className="field">
              <label htmlFor="e-review">Next review</label>
              <input
                id="e-review"
                type="date"
                disabled={!canEdit}
                value={form.review}
                onChange={(e) => setDraft({ ...form, review: e.target.value })}
              />
            </span>
            <span className="muted">
              {open.last_reviewed_on ? `Last reviewed ${formatDay(open.last_reviewed_on)}` : "Not yet reviewed"} · every{" "}
              {open.review_every_months} months
            </span>
          </div>
          {canEdit && (
            <div className="row">
              <button
                type="button"
                disabled={busy || !draft}
                onClick={() =>
                  void run(() =>
                    updateEntry(open.id, {
                      description: form.description.trim() || null,
                      controls: form.controls.trim() || null,
                      review_on: form.review || null,
                    }),
                  ).then((ok) => ok && setDraft(null))
                }
              >
                Save details
              </button>
              {open.status === "active" && (
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void run(() => {
                      const next = new Date();
                      next.setMonth(next.getMonth() + open.review_every_months);
                      return updateEntry(open.id, { last_reviewed_on: localDate(), review_on: localDate(0, next) });
                    }).then((ok) => ok && setDraft(null))
                  }
                >
                  Mark reviewed today
                </button>
              )}
            </div>
          )}
        </section>

        <section className="block">
          <h2>Who owns this</h2>
          {missing.length > 0 && (
            <ul className="plain">
              {missing.map((m) => (
                <li key={m} className="warning-text">
                  {m}
                </li>
              ))}
            </ul>
          )}
          <div className="raci">
            {RACI_ORDER.map((raci) => (
              <div key={raci} className="card">
                <h3>{RACI_LABELS[raci].name}</h3>
                <p className="muted">{RACI_LABELS[raci].meaning}</p>
                <ul className="plain">
                  {mine
                    .filter((a) => a.raci === raci)
                    .map((a) => (
                      <li key={a.id} className="row spread">
                        <span>
                          {a.person.full_name}
                          {a.is_backup && <span className="muted"> · backup</span>}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            className="link-dark"
                            aria-label={`Remove ${a.person.full_name} as ${raci}`}
                            disabled={busy}
                            onClick={() => void run(() => unassign(a.id))}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
                {canEdit && (
                  <OwnerAdder
                    raci={raci}
                    people={data.people}
                    busy={busy}
                    onAdd={(name, backup) => run(() => assign(organisation.id, data, open.id, raci, name, backup))}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        {canEdit && (
          <div className="row block">
            {open.status === "proposed" && (
              <button type="button" disabled={busy || !readyToConfirm} onClick={() => void run(() => updateEntry(open.id, { status: "active" }))}>
                Confirm this entry
              </button>
            )}
            {open.status === "proposed" && !readyToConfirm && (
              <span className="muted">Name who is accountable and who is responsible first.</span>
            )}
            {open.status !== "closed" && (
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Close this entry? It stays on record but stops counting.")) void run(() => updateEntry(open.id, { status: "closed" }));
                }}
              >
                {open.status === "proposed" ? "Not relevant to us" : "Close entry"}
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  // ---------- Register at a level ----------
  const allRegions = regions(data, group.entities);
  const currentRegion = region || allRegions[0] || "";
  const entity = group.entities.find((e) => e.id === entityId) ?? group.entities[0];
  const scope: Scope = { level, entityId: entity?.id, region: currentRegion };
  const allowed = TIER_FOR[level].includes(organisation.tier);
  const scopeReady = level === "global" || (level === "local" ? Boolean(entity) : Boolean(currentRegion));
  const inScope = scopeReady ? entriesInScope(data, group.entities, scope) : [];
  const live = inScope.filter((e) => e.status !== "closed");
  const ownLevel = inScope.filter((e) => e.level === level);
  const summary = summarise(inScope, data.assignments);
  const categories = [...new Set([...CATEGORIES, ...live.map((e) => e.category)])].filter((c) => live.some((e) => e.category === c));

  async function add(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length < 2) return setError("Give the entry a title.");
    let id = "";
    const ok = await run(async () => {
      id = await createEntry(organisation.id, scope, kind, category, title);
    });
    if (ok) {
      setTitle("");
      setOpenId(id);
    }
  }

  return (
    <>
      <p className="eyebrow">Risk and compliance</p>
      <h1>Register</h1>

      <div className="row block-tight">
        <span className="segmented" role="group" aria-label="Register level">
          {LEVELS.map((l) => (
            <button key={l} type="button" className={level === l ? "on" : undefined} aria-pressed={level === l} onClick={() => setLevel(l)}>
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </span>
        {level === "local" && group.entities.length > 1 && (
          <select aria-label="Company" value={entity?.id ?? ""} onChange={(e) => { setEntityId(e.target.value); setRegionDraft(null); }}>
            {group.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
        {level === "regional" && allRegions.length > 0 && (
          <select aria-label="Region" value={currentRegion} onChange={(e) => setRegion(e.target.value)}>
            {allRegions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </div>

      {!allowed ? (
        <section className="card">
          <h2>{LEVEL_LABELS[level]} registers are part of the {NEEDED_TIER[level]} tier</h2>
          <p>This organisation is on the {organisation.tier} tier.</p>
          {isAdmin && (
            <>
              <p className="muted">This is a test organisation, so you can change its tier here.</p>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() =>
                  void run(() => setTier(organisation.id, NEEDED_TIER[level])).then((ok) => ok && window.location.reload())
                }
              >
                Switch to the {NEEDED_TIER[level]} tier
              </button>
            </>
          )}
        </section>
      ) : level === "local" && !entity ? (
        <p className="card note">Add an entity on the Overview page first; a local register belongs to a company.</p>
      ) : (
        <>
          {level === "local" && entity && canEdit && (
            <form
              className="row block-tight"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await setEntityRegion(entity.id, regionDraft ?? entity.region ?? "");
                  await reloadGroup();
                }).then((ok) => ok && setRegionDraft(null));
              }}
            >
              <label htmlFor="entity-region">Reports into region</label>
              <input
                id="entity-region"
                list="region-names"
                autoComplete="off"
                placeholder="e.g. ANZ"
                value={regionDraft ?? entity.region ?? ""}
                onChange={(e) => setRegionDraft(e.target.value)}
              />
              <datalist id="region-names">
                {allRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <button type="submit" className="quiet" disabled={busy || regionDraft === null}>
                Save
              </button>
            </form>
          )}

          {level === "regional" && canEdit && (
            <form
              className="row block-tight"
              onSubmit={(e) => {
                e.preventDefault();
                if (newRegion.trim().length < 2) return;
                setRegion(newRegion.trim());
                setNewRegion("");
              }}
            >
              <input aria-label="New region name" placeholder="New region, e.g. APAC" value={newRegion} onChange={(e) => setNewRegion(e.target.value)} />
              <button type="submit" className="quiet">
                Open region
              </button>
              <span className="muted">Companies join a region from their local register.</span>
            </form>
          )}

          {level === "regional" && !currentRegion ? (
            <p className="card note">No regions yet. Name one above, or set a company's region on its local register.</p>
          ) : (
            <>
              <p className="lead">
                {summary.active} confirmed · {summary.proposed} suggested ·{" "}
                <span className={summary.overdue ? "warning-text" : undefined}>{summary.overdue} overdue</span> ·{" "}
                <span className={summary.withGaps ? "warning-text" : undefined}>{summary.withGaps} with ownership gaps</span>
              </p>
              {level !== "local" && (
                <p className="muted">
                  Includes entries rolled up from {level === "global" ? "every region and company" : "the companies in this region"}.
                </p>
              )}
              {notice && (
                <p className="card note" role="status">
                  {notice}
                </p>
              )}

              {categories.map((c) => (
                <section key={c} className="block">
                  <h2>{c}</h2>
                  <ul className="entity-list">
                    {live
                      .filter((e) => e.category === c)
                      .map((e) => {
                        const flags = e.status === "active" ? gaps(e, data.assignments) : [];
                        const late = escalation(e);
                        return (
                          <li key={e.id}>
                            <button type="button" className="entity-row" onClick={() => { setOpenId(e.id); setDraft(null); setError(null); }}>
                              <span>
                                <span className="entity-name">{e.title}</span>
                                <br />
                                <span className="muted">
                                  {e.kind === "risk" ? "Risk" : "Obligation"}
                                  {e.level !== level ? ` · ${LEVEL_LABELS[e.level]}: ${origin(e, group.entities)}` : ""}
                                  {e.status === "active" && e.review_on ? ` · review ${formatDay(e.review_on)}` : ""}
                                </span>
                                {(late || flags.length > 0) && (
                                  <>
                                    <br />
                                    <span className="warning-text">
                                      {[late ? `Review overdue, escalated to ${late.to}` : null, ...flags].filter(Boolean).join(" · ")}
                                    </span>
                                  </>
                                )}
                              </span>
                              <span className="chip">{statusChip(e)}</span>
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              ))}

              {canEdit && ownLevel.length === 0 && data.sectors.length > 0 && (
                <section className="card block">
                  <h2>Start from a template</h2>
                  <p>
                    Suggested risks and obligations for your type of business. Each one stays a suggestion until a named
                    owner confirms it.
                  </p>
                  <div className="row">
                    {data.sectors.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const added = await applyTemplate(organisation.id, s, scope);
                            setNotice(`${added} suggested entries added. Open each one to name its owners and confirm it.`);
                          })
                        }
                      >
                        {SECTOR_LABELS[s] ?? s}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {canEdit && (
                <form className="card form block" onSubmit={add}>
                  <h2>Add an entry</h2>
                  <div className="row">
                    <span className="field">
                      <label htmlFor="n-kind">Kind</label>
                      <select id="n-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                        <option value="risk">Risk</option>
                        <option value="obligation">Obligation</option>
                      </select>
                    </span>
                    <span className="field">
                      <label htmlFor="n-cat">Area</label>
                      <input id="n-cat" list="register-categories" autoComplete="off" value={category} onChange={(e) => setCategory(e.target.value)} />
                      <datalist id="register-categories">
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </span>
                  </div>
                  <label htmlFor="n-title">Title</label>
                  <input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <button type="submit" disabled={busy}>
                    Add to the {LEVEL_LABELS[level].toLowerCase()} register
                  </button>
                </form>
              )}
            </>
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
