// A person can hold several roles in an organisation. Screens receive them as
// one comma-separated string (for example "legal,compliance") and ask these
// helpers rather than comparing the string themselves.

export const ROLES: { value: string; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "secretary", label: "Company secretary" },
  { value: "director", label: "Director" },
  { value: "legal", label: "Legal" },
  { value: "compliance", label: "Compliance" },
  { value: "member", label: "Member" },
  { value: "auditor", label: "Auditor (read only)" },
];

export const roleList = (role: string) => role.split(",").filter(Boolean);
export const joinRoles = (first: string, extra: string[] | null | undefined) => [first, ...(extra ?? [])].filter((r, n, all) => r && all.indexOf(r) === n).join(",");
/** Holds at least one of the named roles */
export const has = (role: string, ...names: (string | null)[]) => roleList(role).some((r) => names.includes(r));
/** Holds no role other than the one named (for example, only a read-only auditor) */
export const only = (role: string, name: string) => roleList(role).every((r) => r === name);
export const roleLabel = (role: string) => ROLES.find((r) => r.value === role)?.label ?? role;
export const roleLabels = (role: string) => roleList(role).map(roleLabel).join(", ");
