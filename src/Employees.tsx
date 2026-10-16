import Disputes from "./Disputes";
import KeyEmployees from "./KeyEmployees";
import SpeakUp from "./SpeakUp";
import type { GroupData } from "./types";

export type EmployeesSub = "key" | "disputes" | "investigations";
type Props = { organisationId: string; role: string; group: GroupData | null; canEdit: boolean; sub: EmployeesSub; onSub: (s: EmployeesSub) => void };
const SUBS: { id: EmployeesSub; label: string }[] = [
  { id: "key", label: "Key Employees" },
  { id: "disputes", label: "Employee Disputes" },
  { id: "investigations", label: "Investigations" },
];

/** Company, Employees: key employees, employee disputes (active and potential), and investigations */
export default function Employees({ organisationId, role, group, canEdit, sub, onSub }: Props) {
  return (
    <>
      <p className="eyebrow">{sub === "investigations" ? "Company · Confidential" : "Company"}</p>
      <h1>Employees</h1>
      <span className="segmented block-gap" role="group" aria-label="Employees sections">
        {SUBS.map((x) => (
          <button key={x.id} type="button" className={sub === x.id ? "on" : undefined} aria-pressed={sub === x.id} onClick={() => onSub(x.id)}>
            {x.label}
          </button>
        ))}
      </span>
      {sub === "key" && <KeyEmployees organisationId={organisationId} group={group} canEdit={canEdit} embedded />}
      {sub === "disputes" && <Disputes organisationId={organisationId} group={group} canEdit={canEdit} employeeOnly />}
      {sub === "investigations" && <SpeakUp organisationId={organisationId} role={role} embedded />}
    </>
  );
}
