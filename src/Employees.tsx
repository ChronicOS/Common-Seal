import { useState } from "react";
import Disputes from "./Disputes";
import KeyEmployees from "./KeyEmployees";
import type { GroupData } from "./types";

type Props = { organisationId: string; group: GroupData | null; canEdit: boolean };

/** Company, Employees: key employees, and employee disputes (active and potential) */
export default function Employees({ organisationId, group, canEdit }: Props) {
  const [sub, setSub] = useState<"key" | "disputes">("key");
  return (
    <>
      <p className="eyebrow">Company</p>
      <h1>Employees</h1>
      <span className="segmented block-gap" role="group" aria-label="Employees sections">
        <button type="button" className={sub === "key" ? "on" : undefined} aria-pressed={sub === "key"} onClick={() => setSub("key")}>
          Key Employees
        </button>
        <button type="button" className={sub === "disputes" ? "on" : undefined} aria-pressed={sub === "disputes"} onClick={() => setSub("disputes")}>
          Employee Disputes
        </button>
      </span>
      {sub === "key" ? <KeyEmployees organisationId={organisationId} group={group} canEdit={canEdit} embedded /> : <Disputes organisationId={organisationId} group={group} canEdit={canEdit} employeeOnly />}
    </>
  );
}
