// When each library of legal content was last checked against the law. Update the date whenever a library is reviewed.
export const LAW_LIBRARIES = {
  employment: { name: "Employment law checklist", asAt: "2026-10-18" },
  consumer: { name: "Consumer law checklist", asAt: "2026-10-18" },
  climate: { name: "Climate reporting groups and checklist", asAt: "2026-10-18" },
  whs: { name: "WHS notifiable incidents and officer due diligence", asAt: "2026-10-17" },
  privacy: { name: "Notifiable data breaches, ransomware reporting and automated decisions", asAt: "2026-10-17" },
  anti_bribery: { name: "Anti-bribery adequate procedures", asAt: "2026-10-17" },
  calendar: { name: "Compliance calendar library", asAt: "2026-10-17" },
  mergers: { name: "Merger notification thresholds", asAt: "2026-10-18" },
} as const;
export type LawLibrary = keyof typeof LAW_LIBRARIES;
const REVIEW_MONTHS = 6;

/** "Law as at" date and the compliance-aid line, shown on every page that states the law */
export default function LawNote({ library }: { library: LawLibrary }) {
  const l = LAW_LIBRARIES[library];
  const asAt = new Date(`${l.asAt}T12:00:00`);
  const due = new Date(asAt);
  due.setMonth(due.getMonth() + REVIEW_MONTHS);
  const stale = due < new Date();
  return (
    <p className={stale ? "small warning-text law-note" : "small muted law-note"}>
      Law as at {asAt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}.{stale ? " This content is due for review." : ""} A compliance aid, not legal advice: check anything you rely on with your lawyer.
    </p>
  );
}
