import { hasModule, hasPolicy, n, yes, type Answers, type Item, type Question } from "./regulatory";

// The item libraries. Kept in the app so they can change with the law without a migration.
// Plain statements of what the law requires; each item says where it comes from.

const small = (a: Answers) => {
  const e = n(a, "employees");
  return e === null ? null : e < 15;
};

// ---------------------------------------------------------------------
// Employment law (per employer company)
// ---------------------------------------------------------------------
export const EMPLOYMENT_QUESTIONS: Question[] = [
  { key: "employees", label: "Number of employees (include associated entities)", hint: "Under 15 is a small business employer under the Fair Work Act.", kind: "number" },
  { key: "award", label: "Are any employees covered by a modern award?", kind: "choice", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unsure", label: "Not sure" }] },
  { key: "agreement", label: "Is there an enterprise agreement?", kind: "yesno" },
  { key: "casuals", label: "Do you employ casuals?", kind: "yesno" },
  { key: "fixed_term", label: "Do you use fixed-term contracts?", kind: "yesno" },
  { key: "labour_hire", label: "Do you use labour hire workers as a host?", kind: "yesno" },
  { key: "restraints", label: "Do employment contracts include non-competes or non-solicitation clauses?", kind: "yesno" },
];
export const EMPLOYMENT_ITEMS: Item[] = [
  { key: "contracts", label: "Written employment contracts for every employee, signed and stored", hint: "With the role, pay, hours and the award or agreement that applies.", law: "Good practice; evidence for every other item" },
  { key: "fwis", label: "Fair Work Information Statement given to every new employee", hint: "Before or as soon as possible after they start.", law: "Fair Work Act s 125" },
  { key: "casual_statement", label: "Casuals: information statement and the path to permanent work", hint: "Give the Casual Employment Information Statement at the start, and (unless a small business) again after 6 and 12 months. Casuals can notify a change to permanent after 6 months (12 months for a small business).", law: "Fair Work Act s 125A and the employee choice pathway (from 26 Aug 2024; small business from 26 Feb 2025)", applies: (a) => yes(a, "casuals") },
  { key: "fixed_term", label: "Fixed-term contracts within the limits", hint: "No more than two years including extensions, and no more than two consecutive contracts for the same work, unless an exception applies. Give the Fixed Term Contract Information Statement.", law: "Fair Work Act ss 333E–333L, 125B (from 6 Dec 2023)", applies: (a) => yes(a, "fixed_term") },
  { key: "awards", label: "Award coverage and classification checked for every role", hint: "Rates updated from the first pay period on or after 1 July each year (Annual Wage Review). Penalty rates, overtime and allowances paid.", law: "Fair Work Act Part 2-3; modern awards", applies: (a) => (a.award === "no" ? false : a.award ? true : null) },
  { key: "agreement", label: "Enterprise agreement applied correctly and its expiry tracked", hint: "Pay at least the award (better off overall test at approval); nominal expiry date and bargaining planned.", law: "Fair Work Act Part 2-4", applies: (a) => yes(a, "agreement") },
  { key: "payroll_audit", label: "Payroll audited against the award, agreement and NES, and underpayments fixed", hint: "Intentionally underpaying an employee is a criminal offence from 1 January 2025. Back-pay with interest and keep a record of the fix.", law: "Fair Work Act s 327A (wage theft offence)" },
  { key: "records_payslips", label: "Time and wage records kept for 7 years; payslips within one working day of payday", hint: "Records must show hours, rates, leave and super.", law: "Fair Work Act ss 535, 536; Fair Work Regulations" },
  { key: "pay_secrecy", label: "No pay secrecy terms in contracts or policies", hint: "Employees may disclose, or not disclose, their pay. Remove any term that says otherwise.", law: "Fair Work Act ss 333B–333D (from 7 Dec 2022; penalties from 7 Jun 2023)",
    auto: (s) => (hasPolicy(s, /pay secrecy|remuneration confidential/i).length ? { level: "warn", text: "A policy title mentions pay confidentiality: check it does not restrict employees.", tab: "policies" } : null) },
  { key: "right_to_disconnect", label: "Right to disconnect respected", hint: "Employees can refuse out-of-hours contact unless refusing is unreasonable. Set expectations for after-hours contact, especially for managers.", law: "Fair Work Act s 333M (from 26 Aug 2024; small business from 26 Aug 2025)",
    auto: (s) => (hasPolicy(s, /disconnect|after.hours|out of hours/i).length ? { level: "ok", text: "A right to disconnect or after-hours policy is in Policies.", tab: "policies" } : { level: "warn", text: "No right to disconnect or after-hours contact policy in Policies.", tab: "policies" }) },
  { key: "flexible_work", label: "Flexible work requests answered in writing within 21 days, with reasons", hint: "A refusal must be on reasonable business grounds after discussing it with the employee.", law: "Fair Work Act ss 65, 65A (from 6 Jun 2023)" },
  { key: "fdv_leave", label: "10 days' paid family and domestic violence leave, kept off payslips", hint: "Available to full-time, part-time and casual employees.", law: "Fair Work Act ss 106A–106K; Fair Work Regulations (payslips)" },
  { key: "sexual_harassment", label: "Positive duty to prevent sexual harassment", hint: "Assess the risks, have a policy and training, a way to report, and act on reports. The Australian Human Rights Commission can investigate and enforce.", law: "Sex Discrimination Act s 47C (from 12 Dec 2022)",
    auto: (s) => {
      const p = hasPolicy(s, /harass|respect/i).length;
      const m = hasModule(s, /harass|respect/i).length;
      return p && m ? { level: "ok", text: "Policy and training on sexual harassment are in place.", tab: "training" } : { level: "warn", text: `${p ? "Policy found" : "No harassment policy found"}; ${m ? "training found" : "no harassment training module found"}.`, tab: p ? "training" : "policies" };
    } },
  { key: "psychosocial", label: "Psychosocial hazards identified and controlled", hint: "Workload, bullying, harassment, poor support. Managed in the WHS hazard register.", law: "WHS Regulations (psychosocial risks)",
    auto: (s) => (s.psychosocial ? { level: "ok", text: `${s.psychosocial} psychosocial hazard${s.psychosocial === 1 ? "" : "s"} in the WHS register.`, tab: "whs" } : { level: "warn", text: "No psychosocial hazards recorded in the WHS register.", tab: "whs" }) },
  { key: "payday_super", label: "Payday super: super paid with every pay run", hint: "From 1 July 2026 super must reach the fund within 7 days of payday.", law: "Superannuation Guarantee (payday super, from 1 Jul 2026)",
    auto: (s) => (s.obligations.some((k) => k.startsWith("payday_super")) ? { level: "ok", text: "Payday super is in the compliance calendar.", tab: "calendar" } : { level: "warn", text: "Payday super is not in the compliance calendar.", tab: "calendar" }) },
  { key: "labour_hire", label: "Labour hire: same job, same pay orders checked", hint: "Where the Fair Work Commission has made an order, labour hire workers must be paid at least what the host's own employees get. Hosts with fewer than 15 employees are not covered.", law: "Fair Work Act Part 2-7A (from 1 Nov 2024)",
    applies: (a) => { const l = yes(a, "labour_hire"); const s = small(a); return l === false ? false : l === null || s === null ? null : !s; } },
  { key: "dismissal", label: "Dismissals follow a fair process", hint: "Valid reason, a chance to respond, and records. Small businesses can follow the Small Business Fair Dismissal Code.", law: "Fair Work Act Part 3-2" },
  { key: "restraints", label: "Non-competes and non-solicitation clauses reviewed for the proposed ban", hint: "An exposure draft (September 2026) would ban post-employment non-competes for employees at or below the high income threshold (currently $190,100) and co-worker non-solicits for all employees, for arrangements made or varied after it starts. Not yet law.", law: "Competition and Fair Work Legislation Amendment (Banning Unfair Non-Competes) Bill 2026, exposure draft", coming: true,
    applies: (a) => yes(a, "restraints") },
];

// ---------------------------------------------------------------------
// Consumer law (for the group)
// ---------------------------------------------------------------------
export const CONSUMER_QUESTIONS: Question[] = [
  { key: "consumers", label: "Do you supply goods or services to consumers?", hint: "Including to businesses buying goods or services normally used for personal or household purposes, or costing up to $100,000.", kind: "yesno" },
  { key: "goods", label: "Do you make, import or supply goods?", kind: "yesno" },
  { key: "small_business", label: "Do you use standard form contracts with small businesses?", hint: "A business with fewer than 100 employees or turnover under $10 million.", kind: "yesno" },
  { key: "online", label: "Do you sell online or by subscription?", kind: "yesno" },
  { key: "green_claims", label: "Do you make environmental or sustainability claims?", kind: "yesno" },
];
export const CONSUMER_ITEMS: Item[] = [
  { key: "guarantees", label: "Consumer guarantees are not excluded or misrepresented", hint: "No \"no refunds\" signs, and terms, websites and staff scripts describe repair, replacement and refund rights correctly.", law: "ACL ss 54–64A, 29(1)(m)", applies: (a) => yes(a, "consumers") },
  { key: "warranty_text", label: "Warranties against defects include the mandatory wording", hint: "\"Our goods come with guarantees that cannot be excluded under the Australian Consumer Law...\"", law: "ACL s 102; Competition and Consumer Regulations reg 90", applies: (a) => { const c = yes(a, "consumers"); const g = yes(a, "goods"); return c === false || g === false ? false : c && g ? true : null; } },
  { key: "uct", label: "Standard form contracts reviewed for unfair terms", hint: "Unfair terms in standard form consumer and small business contracts are void, and since 9 November 2023 proposing or relying on one can attract a penalty.", law: "ACL ss 23–28 (penalties from 9 Nov 2023)",
    applies: (a) => { const c = yes(a, "consumers"); const s = yes(a, "small_business"); return c === false && s === false ? false : c || s ? true : null; },
    auto: (s) => {
      const list = s.contracts.filter((c) => c.status === "current" && c.used_with !== "neither");
      if (!list.length) return { level: "gap", text: "No standard form contracts recorded below." };
      const risky = list.filter((c) => Object.values(c.findings).includes("risk")).length;
      const unreviewed = list.filter((c) => !c.last_reviewed_on).length;
      return risky || unreviewed ? { level: "warn", text: `${list.length} standard form contracts: ${risky} with terms to fix, ${unreviewed} not yet reviewed.` } : { level: "ok", text: `All ${list.length} standard form contracts reviewed with no terms outstanding.` };
    } },
  { key: "pricing", label: "Prices shown as a single total price", hint: "Include all compulsory fees and charges that can be worked out (the single price rule).", law: "ACL s 48", applies: (a) => yes(a, "consumers") },
  { key: "claims", label: "Advertising and product claims are accurate and can be backed up", hint: "No misleading or deceptive conduct or false representations; keep the evidence behind each claim.", law: "ACL ss 18, 29" },
  { key: "green_claims", label: "Environmental claims are clear, specific and substantiated", hint: "Follow the ACCC's guidance for businesses on environmental and sustainability claims.", law: "ACL ss 18, 29; ACCC guidance (Dec 2023)", applies: (a) => yes(a, "green_claims") },
  { key: "online_selling", label: "Online and subscription selling is clear and easy to cancel", hint: "Total price before checkout, renewal reminders, and cancellation as easy as sign-up. Avoid subscription traps and other designs that mislead.", law: "ACL ss 18, 29; ACCC enforcement priorities", applies: (a) => yes(a, "online") },
  { key: "product_safety", label: "Product safety: recalls and mandatory reporting", hint: "Report to the ACCC within 2 days of becoming aware that a product you supplied caused or may have caused a death, serious injury or illness. Keep a recall plan.", law: "ACL ss 131, 132; product safety standards", applies: (a) => yes(a, "goods") },
  { key: "complaints", label: "Complaints and refunds are handled and recorded", hint: "Track themes; they show where terms or practices need fixing.", law: "Good practice; evidence for the other items", applies: (a) => yes(a, "consumers") },
];

// ---------------------------------------------------------------------
// Climate reporting (per reporting company)
// ---------------------------------------------------------------------
export const CLIMATE_QUESTIONS: Question[] = [
  { key: "ch2m", label: "Does the company prepare annual financial reports under Chapter 2M of the Corporations Act?", hint: "For example public companies and large proprietary companies.", kind: "yesno" },
  { key: "revenue", label: "Consolidated revenue for the year (A$ millions)", kind: "money" },
  { key: "assets", label: "Consolidated gross assets at year end (A$ millions)", kind: "money" },
  { key: "employees", label: "Employees at year end (including the companies it controls)", kind: "number" },
  { key: "nger", label: "Is it a registered corporation under the NGER Act?", kind: "choice", options: [{ value: "above", label: "Yes, above the publication threshold" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
  { key: "asset_owner_aum", label: "If a registrable superannuation entity or registered scheme: assets under management (A$ millions)", kind: "money" },
  { key: "fy_start", label: "Financial year starts on", kind: "choice", options: [{ value: "07-01", label: "1 July" }, { value: "01-01", label: "1 January" }, { value: "04-01", label: "1 April" }, { value: "10-01", label: "1 October" }] },
];
export type ClimateGroup = { group: 1 | 2 | 3 | null; why: string; firstYear: string | null; known: boolean };
/** Which group under Chapter 2M, and the first financial year it must report for */
export function climateGroup(a: Answers): ClimateGroup {
  const ch2m = yes(a, "ch2m");
  if (ch2m === false) return { group: null, why: "Companies that do not report under Chapter 2M are not covered.", firstYear: null, known: true };
  const rev = n(a, "revenue");
  const ass = n(a, "assets");
  const emp = n(a, "employees");
  const nger = a.nger as string | null | undefined;
  const aum = n(a, "asset_owner_aum");
  const twoOf = (r: number, s: number, e: number) => [rev !== null && rev >= r, ass !== null && ass >= s, emp !== null && emp >= e].filter(Boolean).length >= 2;
  const unknown = rev === null || ass === null || emp === null || !nger || ch2m === null;
  const start = (from: string) => {
    const md = (a.fy_start as string | null) ?? "07-01";
    const y = Number(from.slice(0, 4));
    const candidate = `${y}-${md}`;
    return candidate >= from ? candidate : `${y + 1}-${md}`;
  };
  if (twoOf(500, 1000, 500) || nger === "above") return { group: 1, why: nger === "above" ? "An NGER reporter above the publication threshold." : "Meets two of: revenue $500m, gross assets $1b, 500 employees.", firstYear: start("2025-01-01"), known: true };
  if (twoOf(200, 500, 250) || nger === "yes" || (aum !== null && aum >= 5000)) return { group: 2, why: nger === "yes" ? "A registered NGER reporter." : aum !== null && aum >= 5000 ? "An asset owner with $5b or more under management." : "Meets two of: revenue $200m, gross assets $500m, 250 employees.", firstYear: start("2026-07-01"), known: true };
  if (twoOf(50, 25, 100)) return { group: 3, why: "Meets two of: revenue $50m, gross assets $25m, 100 employees. If it has no material climate risks or opportunities it can say so instead of reporting in full.", firstYear: start("2027-07-01"), known: true };
  if (unknown) return { group: null, why: "Answer the questions to work out the group.", firstYear: null, known: false };
  return { group: null, why: "Below the Group 3 thresholds on these figures. Check again each year.", firstYear: null, known: true };
}
export const CLIMATE_ITEMS: Item[] = [
  { key: "board_oversight", label: "Board oversight of climate risks and opportunities", hint: "Which committee, how often, the skills on the board, and how climate feeds into strategy and pay.", law: "AASB S2 (governance)" },
  { key: "management_role", label: "Management's role and controls", hint: "Who is responsible, and the controls over climate data.", law: "AASB S2 (governance)" },
  { key: "risks_opps", label: "Climate risks and opportunities identified, short, medium and long term", hint: "Physical and transition risks; effects on the business model, value chain and financial position.", law: "AASB S2 (strategy)" },
  { key: "scenarios", label: "Scenario analysis", hint: "At least two scenarios: one consistent with 1.5°C and one well above 2°C (2.5°C or more).", law: "Corporations Act Ch 2M; AASB S2" },
  { key: "transition_plan", label: "Transition plan, if there is one", hint: "Targets, actions and how they will be resourced.", law: "AASB S2 (strategy)" },
  { key: "risk_process", label: "Climate risk integrated into risk management", hint: "How climate risks are identified, assessed, prioritised and monitored, and linked to the Risk Register.", law: "AASB S2 (risk management)" },
  { key: "scope_12", label: "Scope 1 and 2 emissions measured", hint: "From the first reporting year, under the NGER methods where they apply.", law: "AASB S2 (metrics)" },
  { key: "scope_3", label: "Scope 3 emissions measured", hint: "From the second reporting year. Statements about scope 3 and scenario analysis have limited liability protection for the first three years.", law: "AASB S2; Corporations Act (modified liability for the first three years)" },
  { key: "targets", label: "Targets and progress", hint: "Any climate targets, including those required by law, and progress against them.", law: "AASB S2 (metrics and targets)" },
  { key: "assurance", label: "Ready for assurance", hint: "Limited assurance over parts of the report from the first year, building to reasonable assurance over the whole report for years starting from 1 July 2030.", law: "Corporations Act Ch 2M; ASSA 5010 (AUASB)" },
  { key: "directors_declaration", label: "Directors' declaration on the sustainability report", hint: "Directors declare that the report complies; for the first three years, that the company has taken reasonable steps.", law: "Corporations Act Ch 2M (directors' declaration)" },
];
