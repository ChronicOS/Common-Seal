import { useCallback, useEffect, useRef, useState } from "react";
import { formatDay, formatWhen } from "./board";
import { attachFile, downloadFile, listFiles, type LinkedFile } from "./files";
import {
  blankAsset,
  FIELDS,
  KINDS,
  kindLabel,
  LIVE,
  loadIp,
  NICE,
  removePassword,
  revealPassword,
  saveAsset,
  setUpVault,
  STATUS_LABELS,
  storePassword,
  unlockVault,
  type AssetValues,
  type IpData,
  type Kind,
  type Status,
} from "./ip";
import { has } from "./roles";
import type { GroupData } from "./types";

type Props = { organisationId: string; role: string; userId: string; group: GroupData | null };
const RECORDS = ["owner", "admin", "secretary", "legal", "compliance"];
const today = () => new Date().toLocaleDateString("en-CA");
const daysTo = (iso: string) => Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86_400_000);

function AssetForm({ initial, group, people, busy, onSave, onCancel }: {
  initial: AssetValues; group: GroupData | null; people: IpData["people"]; busy: boolean; onSave: (v: AssetValues) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = (p: Partial<AssetValues>) => setV({ ...v, ...p });
  const f = FIELDS[v.kind];
  const text = (key: keyof AssetValues, label: string, opts: { placeholder?: string; type?: string; wide?: boolean } = {}) => (
    <span className={opts.wide ? "field grow" : "field"}>
      <label htmlFor={`ip-${String(key)}`}>{label}</label>
      <input id={`ip-${String(key)}`} type={opts.type ?? "text"} placeholder={opts.placeholder} value={(v[key] as string | null) ?? ""} onChange={(e) => set({ [key]: e.target.value || null } as Partial<AssetValues>)} />
    </span>
  );
  return (
    <div className="card form">
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ip-kind">Type</label>
          <select
            id="ip-kind"
            value={v.kind}
            onChange={(e) => {
              const k = e.target.value as Kind;
              const fresh = blankAsset(k);
              const was = blankAsset(v.kind);
              // Switch the defaults that came with the old type, keep anything typed
              set({ kind: k, jurisdiction: v.jurisdiction === was.jurisdiction ? fresh.jurisdiction : v.jurisdiction, status: v.status === was.status ? fresh.status : v.status, classes: FIELDS[k].classes ? v.classes : [] });
            }}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </span>
        <span className="field grow">
          <label htmlFor="ip-name">{v.kind === "trade_mark" ? "The mark" : v.kind === "domain" ? "Domain name" : v.kind === "social_media" ? "Platform and account" : "Name or title"}</label>
          <input id="ip-name" value={v.name} placeholder={v.kind === "domain" ? "example.com.au" : v.kind === "social_media" ? "Instagram: @brand" : ""} onChange={(e) => set({ name: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor="ip-status">Status</label>
          <select id="ip-status" value={v.status} onChange={(e) => set({ status: e.target.value as Status })}>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ip-owner">Owner</label>
          <select id="ip-owner" value={v.owner_entity_id ?? ""} onChange={(e) => set({ owner_entity_id: e.target.value || null })}>
            <option value="">Not recorded</option>
            {group?.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </span>
        {!f.account && text("jurisdiction", "Jurisdiction", { placeholder: "Australia, EU, WIPO (Madrid)" })}
        {text("application_number", "Application number")}
        {text("registration_number", f.number)}
      </div>
      {f.classes && (
        <fieldset className="plain-fieldset">
          <legend>Classes {v.classes.length ? `(${v.classes.join(", ")})` : ""}</legend>
          <div className="class-grid">
            {NICE.slice(1).map((label, i) => {
              const n = i + 1;
              return (
                <label key={n} className="check small" title={label}>
                  <input type="checkbox" checked={v.classes.includes(n)} onChange={(e) => set({ classes: e.target.checked ? [...v.classes, n] : v.classes.filter((x) => x !== n) })} /> {n}
                  <span className="muted"> {label}</span>
                </label>
              );
            })}
          </div>
          <label htmlFor="ip-goods">Goods and services (specification)</label>
          <textarea id="ip-goods" rows={2} value={v.goods_services ?? ""} onChange={(e) => set({ goods_services: e.target.value || null })} />
        </fieldset>
      )}
      <div className="row wrap">
        {text("filed_on", "Filed or applied", { type: "date" })}
        {text("registered_on", f.date, { type: "date" })}
        {text("expires_on", f.expiry, { type: "date" })}
        {text("agent", f.agent)}
      </div>
      {(f.url || f.account) && (
        <div className="row wrap">
          {f.url && text("url", "Web address", { placeholder: "https://", wide: true })}
          {v.kind === "social_media" && text("handle", "Handle", { placeholder: "@brand" })}
        </div>
      )}
      {f.account && (
        <div className="row wrap">
          {text("login_identifier", "Sign-in name or email", { wide: true })}
          {text("two_factor", "Two-factor authentication", { placeholder: "Authenticator on Sam's work phone", wide: true })}
        </div>
      )}
      <div className="row wrap">
        <span className="field">
          <label htmlFor="ip-resp">Responsible</label>
          <select id="ip-resp" value={v.responsible_user_id ?? ""} onChange={(e) => set({ responsible_user_id: e.target.value || null })}>
            <option value="">Not assigned</option>
            {people.filter((p) => p.user_id).map((p) => (
              <option key={p.user_id!} value={p.user_id!}>
                {p.full_name}
              </option>
            ))}
          </select>
        </span>
        <span className="field grow">
          <label htmlFor="ip-notes">Notes</label>
          <input id="ip-notes" value={v.notes ?? ""} onChange={(e) => set({ notes: e.target.value || null })} />
        </span>
      </div>
      {f.account && <p className="muted small">Passwords are added after saving, in the password section. They are encrypted before they leave your browser.</p>}
      <div className="row">
        <button type="button" disabled={busy || v.name.trim().length < 1} onClick={() => onSave(v)}>
          Save
        </button>
        <button type="button" className="link-dark" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function IpRegister({ organisationId, role, userId, group }: Props) {
  const canEdit = has(role, ...RECORDS);
  const [data, setData] = useState<IpData | null>(null);
  const [files, setFiles] = useState<LinkedFile[]>([]);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [pass, setPass] = useState({ a: "", b: "" });
  const [newPassword, setNewPassword] = useState("");
  const [shown, setShown] = useState<{ id: string; value: string } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    const d = await loadIp(organisationId);
    setData(d);
    setFiles(await listFiles("ip_assets", d.assets.map((a) => a.id)));
  }, [organisationId]);
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load the IP register."));
    return () => window.clearTimeout(hideTimer.current);
  }, [reload]);

  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="lead">Loading…</p>;
  if (!data.ready) return <p className="card warning">Run migration 0041 to turn on the IP Register.</p>;
  const who = (uid: string | null) => data.people.find((p) => p.user_id === uid)?.full_name ?? "a member";
  const entityName = (id: string | null) => (id ? group?.entities.find((e) => e.id === id)?.name ?? "" : "");
  const messages = (
    <>
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
    </>
  );
  const live = data.assets.filter((a) => LIVE.includes(a.status));
  const dueSoon = live.filter((a) => a.expires_on && daysTo(a.expires_on) <= 183).sort((a, b) => a.expires_on!.localeCompare(b.expires_on!));

  const vaultPanel = (
    <section className="card vault block">
      {!data.vault ? (
        canEdit ? (
          <div className="form">
            <h2>Set up the password vault</h2>
            <p className="muted small">Passwords for domains and accounts are encrypted in your browser with this passphrase before they are saved. Common Seal never sees the passphrase. Share it only with the people who need it, outside Common Seal (for example in a password manager). If it is lost, the stored passwords cannot be recovered.</p>
            <div className="row wrap">
              <input type="password" aria-label="Vault passphrase" placeholder="Passphrase (at least 12 characters)" autoComplete="new-password" value={pass.a} onChange={(e) => setPass({ ...pass, a: e.target.value })} />
              <input type="password" aria-label="Repeat the passphrase" placeholder="Repeat it" autoComplete="new-password" value={pass.b} onChange={(e) => setPass({ ...pass, b: e.target.value })} />
              <button
                type="button"
                disabled={busy || pass.a.length < 12 || pass.a !== pass.b}
                onClick={() => {
                  let k: CryptoKey | null = null;
                  void run(async () => {
                    k = await setUpVault(organisationId, pass.a);
                  }, "Vault set up and unlocked for this session.").then((ok) => {
                    if (ok) {
                      setKey(k);
                      setPass({ a: "", b: "" });
                    }
                  });
                }}
              >
                Set up
              </button>
            </div>
            {pass.b && pass.a !== pass.b && <p className="warning-text small">The two passphrases do not match.</p>}
          </div>
        ) : (
          <p className="muted small">The password vault has not been set up yet. Legal or compliance sets it up.</p>
        )
      ) : key ? (
        <p className="row spread small">
          <span>🔓 Passwords unlocked in this window. They lock when you leave or refresh.</span>
          <button type="button" className="link-dark small" onClick={() => { setKey(null); setShown(null); }}>
            Lock now
          </button>
        </p>
      ) : (
        <div className="row wrap">
          <span className="small">🔒 Passwords are locked.</span>
          <input type="password" aria-label="Vault passphrase" placeholder="Vault passphrase" autoComplete="current-password" value={pass.a} onChange={(e) => setPass({ ...pass, a: e.target.value })} />
          <button
            type="button"
            className="quiet"
            disabled={busy || !pass.a}
            onClick={() => {
              setBusy(true);
              setError(null);
              unlockVault(pass.a, data.vault!).then(
                (k) => { setKey(k); setPass({ a: "", b: "" }); setBusy(false); },
                (e) => { setError(e.message); setBusy(false); },
              );
            }}
          >
            Unlock
          </button>
        </div>
      )}
    </section>
  );

  // ---- One asset ----
  const asset = openId ? data.assets.find((a) => a.id === openId) : undefined;
  if (editing === "new" || (asset && editing === "edit")) {
    return (
      <>
        <button type="button" className="back" onClick={() => setEditing(null)}>
          ← Back
        </button>
        <p className="eyebrow">IP Register</p>
        <h1>{asset && editing === "edit" ? `Edit: ${asset.name}` : "Add to the IP register"}</h1>
        {messages}
        <AssetForm
          initial={asset && editing === "edit" ? asset : blankAsset(kind === "all" ? "trade_mark" : kind)}
          group={group}
          people={data.people}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(v) => {
            let id = "";
            void run(async () => {
              id = await saveAsset(organisationId, asset && editing === "edit" ? asset.id : null, v);
            }, "Saved.").then((ok) => {
              if (ok) {
                setEditing(null);
                setOpenId(id);
              }
            });
          }}
        />
      </>
    );
  }
  if (asset) {
    const f = FIELDS[asset.kind];
    const mayEdit = canEdit || asset.responsible_user_id === userId;
    const attached = files.filter((x) => x.subject_id === asset.id);
    const hasPassword = Boolean(data.withPassword[asset.id]);
    const log = data.views.filter((v) => v.asset_id === asset.id);
    const row = (label: string, value: string | null | undefined) => (value ? (<div><dt>{label}</dt><dd>{value}</dd></div>) : null);
    return (
      <>
        <button type="button" className="back" onClick={() => { setOpenId(null); setShown(null); setNotice(null); setError(null); }}>
          ← Back to the IP register
        </button>
        <p className="eyebrow">
          {kindLabel(asset.kind)}
          {asset.jurisdiction ? ` · ${asset.jurisdiction}` : ""}
        </p>
        <h1>{asset.name}</h1>
        <p className="lead">
          <span className={LIVE.includes(asset.status) ? "chip" : "chip chip-warn"}>{STATUS_LABELS[asset.status]}</span>
          {asset.expires_on && (
            <span className={LIVE.includes(asset.status) && daysTo(asset.expires_on) <= 90 ? "warning-text" : undefined}>
              {" "}
              {f.expiry} {formatDay(asset.expires_on)}
              {LIVE.includes(asset.status) && daysTo(asset.expires_on) <= 183 ? ` (${daysTo(asset.expires_on) < 0 ? `${-daysTo(asset.expires_on)} days overdue` : `${daysTo(asset.expires_on)} days`})` : ""}
            </span>
          )}
        </p>
        {messages}
        <dl className="detail-list compact key-facts">
          {row("Owner", entityName(asset.owner_entity_id) || null)}
          {row("Application number", asset.application_number)}
          {row(f.number, asset.registration_number)}
          {row("Classes", asset.classes.length ? asset.classes.map((c) => `${c} (${NICE[c]})`).join(", ") : null)}
          {row("Filed", asset.filed_on ? formatDay(asset.filed_on) : null)}
          {row(f.date, asset.registered_on ? formatDay(asset.registered_on) : null)}
          {row(f.agent, asset.agent)}
          {row("Handle", asset.handle)}
          {row("Sign-in", asset.login_identifier)}
          {row("Two-factor", asset.two_factor)}
          {row("Responsible", asset.responsible_user_id ? who(asset.responsible_user_id) : null)}
        </dl>
        {asset.url && (
          <p>
            <a className="link-dark" href={asset.url} target="_blank" rel="noreferrer">
              {asset.url}
            </a>
          </p>
        )}
        {asset.goods_services && <p className="small">Goods and services: {asset.goods_services}</p>}
        {asset.notes && <p className="small">{asset.notes}</p>}
        {mayEdit && (
          <p>
            <button type="button" className="quiet" onClick={() => setEditing("edit")}>
              Edit
            </button>
          </p>
        )}

        {(f.account || hasPassword) && mayEdit && (
          <section className="block">
            <h2>Password</h2>
            {vaultPanel}
            {hasPassword ? <p className="small">A password is stored{data.withPassword[asset.id] ? `, last changed ${formatWhen(data.withPassword[asset.id])}` : ""}.</p> : <p className="muted small">No password stored.</p>}
            {key && (
              <div className="row wrap">
                {hasPassword && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      revealPassword(key, asset.id).then(
                        (value) => {
                          setShown({ id: asset.id, value });
                          setBusy(false);
                          window.clearTimeout(hideTimer.current);
                          hideTimer.current = window.setTimeout(() => setShown(null), 30_000);
                          void reload();
                        },
                        (e) => { setError(e.message); setBusy(false); },
                      );
                    }}
                  >
                    Show (recorded)
                  </button>
                )}
                {shown?.id === asset.id && (
                  <>
                    <code className="secret">{shown.value}</code>
                    <button type="button" className="link-dark small" onClick={() => void navigator.clipboard.writeText(shown.value).then(() => setNotice("Copied. Clear your clipboard when done."), () => setError("Could not copy."))}>
                      Copy
                    </button>
                    <button type="button" className="link-dark small" onClick={() => setShown(null)}>
                      Hide
                    </button>
                  </>
                )}
              </div>
            )}
            {key && (
              <div className="row wrap">
                <input type="password" aria-label="New password" placeholder={hasPassword ? "Replace with a new password" : "Password"} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <button type="button" className="quiet" disabled={busy || !newPassword} onClick={() => void run(() => storePassword(key, asset.id, newPassword), "Password saved, encrypted.").then((ok) => ok && setNewPassword(""))}>
                  {hasPassword ? "Replace" : "Save password"}
                </button>
                {hasPassword && (
                  <button type="button" className="link-dark small" disabled={busy} onClick={() => { if (window.confirm("Remove the stored password?")) void run(() => removePassword(asset.id), "Password removed."); }}>
                    Remove
                  </button>
                )}
              </div>
            )}
            {canEdit && log.length > 0 && (
              <details className="small">
                <summary>Password access log ({log.length})</summary>
                <ul className="plain">
                  {log.map((l, i) => (
                    <li key={i}>
                      {formatWhen(l.at)}: {l.action} by {who(l.user_id)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        <section className="block">
          <h2>Certificates and documents</h2>
          {attached.length === 0 ? (
            <p className="muted">None attached.</p>
          ) : (
            <ul className="plain rows">
              {attached.map((x) => (
                <li key={x.storage_path}>
                  <button type="button" className="quiet" onClick={() => void downloadFile(x.storage_path, x.file_name).catch((e) => setError(e.message))}>
                    ⤓ {x.file_name}
                  </button>{" "}
                  <span className="muted small">{formatDay(x.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {mayEdit && (
            <label className="quiet file-button">
              Attach a certificate or document
              <input type="file" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void run(() => attachFile("ip_assets", asset.id, file).then(() => undefined), "Attached."); e.target.value = ""; }} />
            </label>
          )}
        </section>
      </>
    );
  }

  // ---- List ----
  const shownAssets = data.assets.filter((a) => kind === "all" || a.kind === kind);
  return (
    <>
      <p className="eyebrow">Company</p>
      <h1>IP Register</h1>
      <p className="lead">Trade marks, patents, designs, copyright, domains, social media accounts and business names: who owns them, the numbers and classes, the dates, and the renewals. Anything due within 90 days goes into the next risk review.</p>
      {messages}
      <dl className="facts">
        <div>
          <dt>Live</dt>
          <dd>{live.length}</dd>
        </div>
        <div>
          <dt>Due in 90 days</dt>
          <dd className={live.some((a) => a.expires_on && daysTo(a.expires_on) >= 0 && daysTo(a.expires_on) <= 90) ? "warning-text" : undefined}>{live.filter((a) => a.expires_on && daysTo(a.expires_on) >= 0 && daysTo(a.expires_on) <= 90).length}</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd className={live.some((a) => a.expires_on && daysTo(a.expires_on) < 0) ? "warning-text" : undefined}>{live.filter((a) => a.expires_on && daysTo(a.expires_on) < 0).length}</dd>
        </div>
        <div>
          <dt>No owner company</dt>
          <dd className={live.some((a) => !a.owner_entity_id) ? "warning-text" : undefined}>{live.filter((a) => !a.owner_entity_id).length}</dd>
        </div>
      </dl>
      {dueSoon.length > 0 && (
        <section className="card warning block">
          <h2>Renewals in the next six months</h2>
          <ul className="plain rows">
            {dueSoon.map((a) => (
              <li key={a.id} className="row spread">
                <span>
                  <strong>{a.name}</strong> <span className="muted small">· {kindLabel(a.kind)}{a.jurisdiction ? ` · ${a.jurisdiction}` : ""}</span>
                </span>
                <button type="button" className={daysTo(a.expires_on!) <= 90 ? "chip chip-alert" : "chip"} onClick={() => setOpenId(a.id)}>
                  {formatDay(a.expires_on!)}
                  {daysTo(a.expires_on!) < 0 ? " · overdue" : ` · ${daysTo(a.expires_on!)} days`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <span className="segmented block-gap" role="group" aria-label="Type">
        <button type="button" className={kind === "all" ? "on" : undefined} aria-pressed={kind === "all"} onClick={() => setKind("all")}>
          All ({data.assets.length})
        </button>
        {KINDS.map((k) => {
          const n = data.assets.filter((a) => a.kind === k.id).length;
          return (
            <button key={k.id} type="button" className={kind === k.id ? "on" : undefined} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.plural}
              {n ? ` (${n})` : ""}
            </button>
          );
        })}
      </span>
      {shownAssets.length === 0 ? (
        <p className="muted">Nothing recorded{kind === "all" ? "" : ` under ${KINDS.find((k) => k.id === kind)?.plural.toLowerCase()}`} yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Owner</th>
                <th scope="col">Number</th>
                <th scope="col">Classes</th>
                <th scope="col">Registered or created</th>
                <th scope="col">Expiry or renewal</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {shownAssets.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => setOpenId(a.id)}>
                  <th scope="row">
                    <button type="button" className="link-dark" onClick={() => setOpenId(a.id)}>
                      {a.name}
                    </button>
                    {data.withPassword[a.id] && <span className="muted small"> 🔒</span>}
                  </th>
                  <td>{kindLabel(a.kind)}{a.jurisdiction ? <span className="muted small"><br />{a.jurisdiction}</span> : null}</td>
                  <td>{entityName(a.owner_entity_id) || <span className="warning-text">Not recorded</span>}</td>
                  <td>{a.registration_number ?? a.application_number ?? a.handle ?? ""}</td>
                  <td>{a.classes.join(", ")}</td>
                  <td>{a.registered_on ? formatDay(a.registered_on) : ""}</td>
                  <td className={a.expires_on && LIVE.includes(a.status) && daysTo(a.expires_on) <= 90 ? "warning-text" : undefined}>{a.expires_on ? formatDay(a.expires_on) : ""}</td>
                  <td>{STATUS_LABELS[a.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <p className="block">
          <button type="button" onClick={() => setEditing("new")}>
            Add {kind === "all" ? "to the register" : `a ${kindLabel(kind).toLowerCase()}`}
          </button>
        </p>
      )}
      {(canEdit || data.vault) && data.assets.some((a) => FIELDS[a.kind].account) && vaultPanel}
    </>
  );
}
