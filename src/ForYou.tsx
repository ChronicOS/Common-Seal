import { formatDay } from "./board";
import type { InboxItem } from "./inbox";

/** Everything waiting on the signed-in person, across the platform. */
export default function ForYou({ items, onOpen }: { items: InboxItem[] | null; onOpen: (tab: string) => void }) {
  return (
    <>
      <p className="eyebrow">Waiting on you</p>
      <h1>For you</h1>
      {items === null ? (
        <p className="lead">Loading…</p>
      ) : items.length === 0 ? (
        <p className="lead">Nothing is waiting on you.</p>
      ) : (
        <ul className="entity-list">
          {items.map((i) => (
            <li key={i.key}>
              <button type="button" className="entity-row" onClick={() => onOpen(i.tab)}>
                <span>
                  <span className="entity-name">{i.title}</span>
                  <br />
                  <span className="muted">
                    {i.kind}
                    {i.due ? ` · due ${formatDay(i.due)}` : ""}
                  </span>
                </span>
                {i.overdue && <span className="chip chip-alert">Overdue</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Email reminders are not switched on yet, so this page is where to check what is due.</p>
    </>
  );
}
