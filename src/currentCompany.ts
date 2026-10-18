// The company chosen in one tab is the company shown in the next. Remembered in this browser between visits.
const KEY = "veraphius-company";
let current: string | null = null;
try {
  current = localStorage.getItem(KEY);
} catch {
  current = null;
}
export const companyChoice = {
  get id(): string | null {
    return current;
  },
  set id(value: string | null) {
    current = value;
    try {
      if (value) localStorage.setItem(KEY, value);
    } catch {
      // Private browsing: remembered for this visit only
    }
  },
};
/** The remembered company if it is one of these, otherwise the first */
export function pickCompany(ids: string[]): string {
  return current && ids.includes(current) ? current : ids[0] ?? "";
}
