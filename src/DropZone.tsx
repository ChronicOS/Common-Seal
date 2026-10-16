import { useState } from "react";

/** Drop a file here, or choose one */
export default function DropZone({ label, accept, busy, onFile }: { label: string; accept?: string; busy?: boolean; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={over ? "drop-zone over" : "drop-zone"}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) onFile(f);
      }}
    >
      <strong>{label}</strong>
      <span className="muted small"> Drop a file here, or click to choose. Up to 10 MB.</span>
      <input
        type="file"
        hidden
        accept={accept}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
