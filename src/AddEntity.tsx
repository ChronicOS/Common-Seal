import { useState } from "react";
import { createEntity } from "./data";
import type { Entity } from "./types";

/** A small "Add entity" control: a button that opens a name field. Calls onAdded with the new company. */
export default function AddEntity({ organisationId, onAdded, label = "Add entity", initialName = "" }: {
  organisationId: string; onAdded: (e: Entity) => void; label?: string; initialName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="quiet" onClick={() => { setOpen(true); setProblem(null); }}>
        + {label}
      </button>
    );
  }
  return (
    <span className="row wrap add-entity">
      <input aria-label="New entity name" placeholder="Company name, e.g. HoldCo Pty Ltd" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <button
        type="button"
        disabled={busy || name.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setProblem(null);
          try {
            const e = await createEntity(organisationId, name);
            setOpen(false);
            setName("");
            onAdded(e);
          } catch (err) {
            setProblem(err instanceof Error ? err.message : "Could not add it.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Add
      </button>
      <button type="button" className="link-dark small" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {problem && <span className="error small">{problem}</span>}
    </span>
  );
}
