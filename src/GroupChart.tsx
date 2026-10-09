import type { KeyboardEvent } from "react";
import { progress } from "./checks";
import type { Entity, GroupData, Relationship } from "./types";

const W = 208;
const H = 68;
const GAP_X = 24;
const GAP_Y = 60;
const PAD = 12;

type Placed = { entity: Entity; x: number; y: number };

function wrapName(name: string): string[] {
  const words = name.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > 23 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 2) return [lines[0], `${lines[1].slice(0, 20)}…`];
  return lines.map((l) => (l.length > 24 ? `${l.slice(0, 22)}…` : l));
}

const pctLabel = (r: Relationship) => (r.ownership_pct === null ? "" : `${Number(r.ownership_pct)}%`);

export default function GroupChart({ data, onOpen }: { data: GroupData; onOpen: (id: string) => void }) {
  const current = data.relationships.filter((r) => !r.ends_on);
  const byId = new Map(data.entities.map((e) => [e.id, e]));

  // Each entity hangs under its largest owner; any other owners are drawn as dashed links.
  const primary = new Map<string, Relationship>();
  for (const r of current) {
    if (!byId.has(r.parent_entity_id) || !byId.has(r.child_entity_id)) continue;
    const held = primary.get(r.child_entity_id);
    if (!held || (r.ownership_pct ?? 0) > (held.ownership_pct ?? 0)) primary.set(r.child_entity_id, r);
  }
  const children = new Map<string, Entity[]>();
  for (const [childId, r] of primary) {
    const list = children.get(r.parent_entity_id) ?? [];
    list.push(byId.get(childId)!);
    children.set(r.parent_entity_id, list);
  }
  const roots = data.entities.filter((e) => !primary.has(e.id));

  const placed = new Map<string, Placed>();
  let nextLeaf = 0;
  let maxDepth = 0;
  const place = (entity: Entity, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const kids = children.get(entity.id) ?? [];
    const x = kids.length
      ? kids.map((k) => place(k, depth + 1)).reduce((a, b) => a + b, 0) / kids.length
      : nextLeaf++ * (W + GAP_X);
    placed.set(entity.id, { entity, x, y: depth * (H + GAP_Y) });
    return x;
  };
  roots.forEach((root) => place(root, 0));

  const width = Math.max(nextLeaf, 1) * (W + GAP_X) - GAP_X + PAD * 2;
  const height = (maxDepth + 1) * (H + GAP_Y) - GAP_Y + PAD * 2;

  const keyOpen = (id: string) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(id);
    }
  };

  return (
    <div className="chart-scroll">
      <svg
        className="chart"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="Group structure chart"
      >
        <g transform={`translate(${PAD} ${PAD})`}>
          {current.map((r) => {
            const parent = placed.get(r.parent_entity_id);
            const child = placed.get(r.child_entity_id);
            if (!parent || !child) return null;
            const isPrimary = primary.get(r.child_entity_id)?.id === r.id;
            const x1 = parent.x + W / 2;
            const y1 = parent.y + H;
            const x2 = child.x + W / 2;
            const y2 = child.y;
            const midY = y2 - GAP_Y / 2;
            return (
              <g key={r.id}>
                <path
                  className={isPrimary ? "chart-link" : "chart-link chart-link-minor"}
                  d={`M${x1} ${y1}V${midY}H${x2}V${y2}`}
                />
                {pctLabel(r) && (
                  // A second owner's share sits beside its own dashed line, clear of the main owner's label.
                  <text className="chart-pct" x={isPrimary ? x2 + 8 : x1 + 8} y={isPrimary ? y2 - 8 : y1 + 18}>
                    {pctLabel(r)}
                  </text>
                )}
              </g>
            );
          })}
          {[...placed.values()].map(({ entity, x, y }) => {
            const lines = wrapName(entity.name);
            const { queue } = progress(data, entity);
            const note = queue.length === 0 ? "Details complete" : `${queue.length} to complete`;
            return (
              <g
                key={entity.id}
                className="chart-node"
                transform={`translate(${x} ${y})`}
                role="button"
                tabIndex={0}
                aria-label={`${entity.name}, ${note}. Open details.`}
                onClick={() => onOpen(entity.id)}
                onKeyDown={keyOpen(entity.id)}
              >
                <title>{entity.name}</title>
                <rect width={W} height={H} rx="8" />
                {lines.map((line, i) => (
                  <text key={i} className="chart-name" x="12" y={lines.length === 1 ? 28 : 22 + i * 17}>
                    {line}
                  </text>
                ))}
                <text className={queue.length ? "chart-note chart-note-open" : "chart-note"} x="12" y={H - 10}>
                  {note}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
