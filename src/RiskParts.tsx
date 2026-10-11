import { useState } from "react";
import type { RiskValues } from "./risk";

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const blankRisk = (): RiskValues => ({ title: "", action: "", due_on: "", actioner: "", actioner_email: "", is_closed: false, comment_resolved: false });

type FormProps = {
  /** Unique within the page, so labels point at the right fields */
  idPrefix: string;
  initial: RiskValues;
  /** The category's material risk examples, shown faintly in the Risk box until the person types */
  examples: string | null;
  /** The report owner's comment on this risk, if there is one */
  comment?: string | null;
  isSaved: boolean;
  busy: boolean;
  onSave: (v: RiskValues) => void;
  onCancel?: () => void;
  onDelete?: () => void;
};

/** One risk: Risk; Actions, Controls, Mitigations; Due date; optional actioner. Used on the personal link and inside Common Seal. */
export function RiskForm({ idPrefix, initial, examples, comment, isSaved, busy, onSave, onCancel, onDelete }: FormProps) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="form risk-form">
      <label htmlFor={`${idPrefix}-risk`}>Risk</label>
      <textarea id={`${idPrefix}-risk`} rows={4} placeholder={examples ? `For example: ${examples}` : "Describe the risk, incident or update"} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <label htmlFor={`${idPrefix}-action`}>Actions, Controls, Mitigations</label>
      <textarea id={`${idPrefix}-action`} rows={3} placeholder='What you are going to do about it. "Continue to monitor" is fine.' value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} />
      <div className="row">
        <span className="field">
          <label htmlFor={`${idPrefix}-due`}>Due Date</label>
          <input id={`${idPrefix}-due`} type="date" value={v.due_on} onChange={(e) => setV({ ...v, due_on: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor={`${idPrefix}-who`}>Actioner (optional)</label>
          <input id={`${idPrefix}-who`} placeholder="If not you" value={v.actioner} onChange={(e) => setV({ ...v, actioner: e.target.value })} />
        </span>
        <span className="field">
          <label htmlFor={`${idPrefix}-email`}>Actioner's email (optional)</label>
          <input id={`${idPrefix}-email`} type="email" value={v.actioner_email} onChange={(e) => setV({ ...v, actioner_email: e.target.value })} />
        </span>
      </div>
      {isSaved && (
        <label className="check">
          <input type="checkbox" checked={v.is_closed} onChange={(e) => setV({ ...v, is_closed: e.target.checked })} /> This risk is resolved and can be closed
        </label>
      )}
      {comment && (
        <div className="card warning">
          <strong>Comment from the report owner</strong>
          <p className="pre-wrap">{comment}</p>
          <label className="check">
            <input type="checkbox" checked={v.comment_resolved} onChange={(e) => setV({ ...v, comment_resolved: e.target.checked })} /> I have amended the risk or action to resolve this comment
          </label>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (v.title.trim().length < 3) return setError("Describe the risk.");
            if (v.action.trim().length < 2) return setError('Say what will be done about it. "Continue to monitor" is fine.');
            if (v.actioner_email.trim() !== "" && !/.+@.+\..+/.test(v.actioner_email)) return setError("The actioner's email does not look right.");
            setError(null);
            onSave(v);
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {onCancel && (
          <button type="button" className="quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
        {onDelete && (
          <button type="button" className="link-dark" disabled={busy} onClick={onDelete}>
            Remove this risk
          </button>
        )}
      </div>
    </div>
  );
}

type CardProps = {
  title: string;
  action: string;
  due_on: string | null;
  actioner: string | null;
  is_closed: boolean;
  carried: boolean;
  comment: string | null;
  commentResolved: boolean;
  resolution?: string | null;
  onEdit?: () => void;
};

/** A saved risk, as read. */
export function RiskCard({ title, action, due_on, actioner, is_closed, carried, comment, commentResolved, resolution, onEdit }: CardProps) {
  const overdue = !is_closed && due_on !== null && due_on < todayIso();
  return (
    <div className="risk-card">
      <div className="row spread">
        <span>
          <strong className="pre-wrap">{title}</strong>
          {carried && <span className="muted"> · from the last review</span>}
        </span>
        <span className="row">
          <span className={overdue ? "chip chip-alert" : "chip"}>{is_closed ? "Resolved" : overdue ? "Overdue" : "Open"}</span>
          {onEdit && (
            <button type="button" className="link-dark" onClick={onEdit}>
              Edit
            </button>
          )}
        </span>
      </div>
      <p className="pre-wrap">
        <strong>Actions, Controls, Mitigations:</strong> {action}
      </p>
      <p className={due_on ? "muted" : "warning-text"}>
        {due_on ? `Due ${day(due_on)}` : "No due date"}
        {actioner ? ` · ${actioner}` : ""}
      </p>
      {resolution && <p>Resolution: {resolution}</p>}
      {comment && (
        <p className={commentResolved ? "card" : "card warning"}>
          <strong>Comment from the report owner:</strong> <span className="pre-wrap">{comment}</span>
          <br />
          <span className={commentResolved ? "muted" : "warning-text"}>{commentResolved ? "☑ Amended to resolve this comment" : "☐ Not yet resolved"}</span>
        </p>
      )}
    </div>
  );
}
