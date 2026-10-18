// What each tier includes. A proposal until pricing and billing are settled; the Account settings page shows it.
export type Tier = "small" | "medium" | "large";
export const TIERS: { id: Tier; name: string; suits: string; price: string; adds: { group: string; items: string[] }[] }[] = [
  {
    id: "small",
    name: "Small",
    suits: "Startups and private companies: one or a few companies, up to about 50 staff.",
    price: "Pricing to come",
    adds: [
      { group: "Company and board", items: ["Company Info, finance details and the group chart", "Ownership and the share register (with startup mode)", "Company register and ASIC filings", "Meetings, minutes and the board report", "Appointments and Authorities (signing and delegations)"] },
      { group: "Risk and compliance", items: ["Compliance calendar", "Risk Register (local)", "Policies and Training", "Employment law", "Privacy and cyber", "Work health and safety", "Confidential projects"] },
      { group: "Conduct", items: ["Gifts and hospitality", "Conflicts of interest"] },
    ],
  },
  {
    id: "medium",
    name: "Medium",
    suits: "Growing groups: several companies, 50 to 500 staff, contracts and third parties to manage.",
    price: "Pricing to come",
    adds: [
      { group: "Contracts and third parties", items: ["Contract Management and Key Contracts", "Due Diligence (with the third-party questionnaire)", "Sanctions", "Disputes"] },
      { group: "Risk and compliance", items: ["Regional risk registers", "Anti-bribery", "Consumer law", "Legal Audit", "Workflows"] },
      { group: "Company and people", items: ["Insurance", "IP Register", "Employees, key people and investigations", "Speak up", "Expenses"] },
    ],
  },
  {
    id: "large",
    name: "Large",
    suits: "Listed, large proprietary and multinational groups: modern slavery and climate reporting entities, intercompany arrangements, regional and global oversight.",
    price: "Pricing to come",
    adds: [
      { group: "Reporting", items: ["Modern slavery (survey, report, board approval)", "Climate reporting"] },
      { group: "Group", items: ["Intercompany arrangements", "Global risk register", "Horizon scanning"] },
      { group: "Coming", items: ["Finance connections (an add-on)"] },
    ],
  },
];
export const tierName = (t: string) => TIERS.find((x) => x.id === t)?.name ?? t;
