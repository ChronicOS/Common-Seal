import type { MsFacts, Statement, SupplierReview } from "./modernslavery";
import type { Entity } from "./types";

/**
 * The report template. Parts 1 to 7 are the mandatory criteria and are needed for approval;
 * the others are optional. Everything is text: no images.
 */
export const REPORT_PARTS: { n: number; title: string; criterion: string | null; guide: string }[] = [
  { n: 0, title: "Our commitment", criterion: null, guide: "A short message from the CEO or Managing Director. Optional." },
  { n: 1, title: "About this statement", criterion: "Criterion 1", guide: "Identify the reporting entity, the period, and the entities covered." },
  { n: 2, title: "Our structure, operations and supply chains", criterion: "Criterion 2", guide: "How the group is organised, what it does, and who supplies it and from where." },
  { n: 3, title: "Modern slavery risks in our operations and supply chains", criterion: "Criterion 3", guide: "The risks in your own operations and in your supply chain, and how each third party was rated." },
  { n: 4, title: "Actions taken to assess and address the risks", criterion: "Criterion 4", guide: "Policies, due diligence, contract terms, training, reporting channels, audits and remediation." },
  { n: 5, title: "How we assess the effectiveness of our actions", criterion: "Criterion 5", guide: "The measures you track, this period's results, and the comparison with last year." },
  { n: 6, title: "Consultation", criterion: "Criterion 6", guide: "How the entities covered were consulted in preparing the statement." },
  { n: 7, title: "Other relevant information", criterion: "Criterion 7", guide: "Anything else that is relevant. If there is nothing, say so." },
  { n: 8, title: "Looking ahead", criterion: null, guide: "What you plan to do in the next period. Optional." },
  { n: 9, title: "Appendix: questionnaire results", criterion: null, guide: "Every question, with the number and share of respondents giving each answer. Built from the survey." },
];
export const MANDATORY = [1, 2, 3, 4, 5, 6, 7];

const pct = (n: number, of: number) => (of === 0 ? "0%" : `${Math.round((n / of) * 100)}%`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

/**
 * First-draft wording for one part, built from what the platform holds. Text in square brackets is for the writer.
 * Lines starting "# " are sub-headings, "- " are bullets, and lines with " | " are table rows.
 */
export function draftPart(n: number, s: Statement, entities: Entity[], reviews: SupplierReview[], supplierName: (id: string) => string, facts: MsFacts | null): string {
  const entity = entities.find((e) => e.id === s.reporting_entity_id);
  const name = entity?.name ?? "the reporting entity";
  const covered = s.is_joint ? entities.filter((e) => s.covered_entity_ids.includes(e.id)) : [];
  const v = facts?.survey ?? null;
  const yesShare = (code: string) => {
    const r = v?.results.find((x) => x.code === code);
    return r && r.total > 0 ? pct(r.yes, r.total) : null;
  };
  const share = (code: string) => {
    const r = v?.results.find((x) => x.code === code);
    return r ? pct(r.favourable, r.total) : null;
  };

  switch (n) {
    case 0:
      return `[A short statement from the CEO or Managing Director: why this matters to ${name}, and the commitment to identifying and addressing modern slavery in its operations and supply chains.]`;

    case 1:
      return [
        `This statement is made by ${name}${entity?.acn ? ` (ACN ${entity.acn})` : ""} under the Modern Slavery Act 2018 (Cth) for the reporting period ${day(s.period_start)} to ${day(s.period_end)}.`,
        covered.length
          ? `It is a joint statement and covers ${name} and the following ${covered.length === 1 ? "entity" : "entities"} it owns or controls: ${covered.map((e) => e.name).join(", ")}. In this statement "we" and "the Group" mean all of them.`
          : "It is a single-entity statement.",
      ].join("\n\n");

    case 2:
      return [
        "# Structure",
        covered.length
          ? `${name} is the reporting entity. The Group comprises ${name} and ${covered.map((e) => e.name).join(", ")}. [Describe the ownership structure and where the Group is headquartered.]`
          : `[Describe ${name}: its legal form, ownership and where it is based.]`,
        "# Operations",
        "[Describe what the Group does, the countries it operates in, and how many people it employs and where.]",
        "# Supply chains",
        v
          ? `[Describe the main categories of goods and services the Group buys.] In this period we surveyed ${plural(v.sent, "third party", "third parties")}. Those that responded told us their manufacturing facilities are located in: ${v.countries.join(", ") || "[none stated]"}${v.workers ? `, and that together they have about ${v.workers.toLocaleString("en-AU")} workers` : ""}.`
          : "[Describe the main categories of goods and services the Group buys, and the countries they come from.]",
      ].join("\n\n");

    case 3: {
      const out = ["# Our operations", "[Describe the risk in your own workforce and why you assess it as you do, for example written contracts, compliance with workplace laws, a code of conduct and a confidential reporting channel.]", "# Our supply chains"];
      if (v && v.answered > 0) {
        out.push(
          `We assess each third party we survey and calculate a modern slavery risk rating from two factors: (a) a rating based on our annual spend with the third party, and (b) a country risk rating for the countries where it manufactures${v.countrySource ? `, derived from ${v.countrySource}` : ""}.`,
          `Of the ${plural(v.answered, "third party", "third parties")} that responded, ${v.high} rated high risk, ${v.medium} medium and ${v.low} low${v.unrated ? `, and ${v.unrated} could not yet be rated` : ""}.${v.highCountries.length ? ` Countries rated high risk in which respondents manufacture: ${v.highCountries.join(", ")}.` : ""} Third parties rated high risk are monitored more closely.`,
        );
        const signals = [
          share("under_18") ? `${share("under_18")} stated that they do not employ anyone under the age of 18` : "",
          v.migrant ? `${pct(v.migrant.yes, v.migrant.total)} employ migrant workers` : "",
          yesShare("labour_hire") ? `${yesShare("labour_hire")} use labour hire companies or recruitment agents` : "",
          share("worker_debts") ? `${share("worker_debts")} reported no worker debts or withheld wages` : "",
          share("free_movement") ? `${share("free_movement")} confirmed workers are free to leave the workplace and their accommodation` : "",
          share("young_hazardous") ? `${share("young_hazardous")} have no workers under 18 doing hazardous work` : "",
          share("retain_documents") ? `${share("retain_documents")} do not retain workers' identity documents` : "",
          share("recruitment_fees") ? `${share("recruitment_fees")} do not charge workers to secure a job` : "",
        ].filter(Boolean);
        if (signals.length) out.push(`Risk indicators from the questionnaire: ${signals.join("; ")}.`);
        out.push(`${plural(v.concerns, "answer", "answers")} raised a concern that was escalated to Legal for review.`);
      } else if (reviews.length) {
        const c = (r: SupplierReview["risk"]) => reviews.filter((x) => x.risk === r).length;
        out.push(`We reviewed ${plural(reviews.length, "supplier", "suppliers")} in the period: ${c("high")} rated high risk, ${c("medium")} medium and ${c("low")} low.`);
      } else {
        out.push("[No supplier survey or review is recorded for this period. Describe the risks in your supply chain and how you identified them.]");
      }
      return out.join("\n\n");
    }

    case 4: {
      const out = [
        "# Policies and Supplier Code of Conduct",
        `${facts && facts.policies.length ? `The following policies were in force during the period: ${facts.policies.join(", ")}.` : "[List the policies that set your standards, such as a Supplier Code of Conduct.]"}${share("policy") ? ` ${share("policy")} of respondents have a published policy of their own covering these topics.` : ""}`,
        "# Supplier due diligence",
        v
          ? `We sent our modern slavery questionnaire to ${plural(v.sent, "third party", "third parties")} and ${v.answered} (${pct(v.answered, v.sent)}) responded. The questionnaire covers what the third party supplies, recruitment and freedom of movement, children and young workers, pay, working hours, fair treatment, policies and training, and the respondent's own supply chain.${facts && facts.ddCases > 0 ? ` We also opened ${plural(facts.ddCases, "due diligence case", "due diligence cases")} on third parties.` : ""}`
          : `${facts && facts.ddCases > 0 ? `We opened ${plural(facts.ddCases, "due diligence case", "due diligence cases")} on third parties in the period.` : "[Describe your due diligence on new and existing suppliers.]"}`,
        "# Contract terms",
        `[Describe the modern slavery obligations and audit rights in your supplier contracts.]${share("supplier_terms") ? ` ${share("supplier_terms")} of respondents impose modern slavery obligations on their own suppliers by contract.` : ""}`,
        "# Training",
        `${facts && facts.trainingDone > 0 ? `${plural(facts.trainingDone, "person", "people")} completed our modern slavery training in the period.` : "[Describe the training given to staff who deal with suppliers.]"}${share("training") ? ` ${share("training")} of respondents train their own workers on their policies at least annually.` : ""}`,
        "# Raising concerns",
        `[Describe how staff and suppliers can report concerns, including anonymously.]${share("grievance") ? ` ${share("grievance")} of respondents have a grievance mechanism for their workers.` : ""}`,
        "# Audits",
        `${v && v.audits != null ? `We carried out ${plural(v.audits, "third-party audit", "third-party audits")} in the period${v.priorAudits != null ? `, compared with ${v.priorAudits} in the prior period` : ""}.` : "[State how many third-party audits were carried out, and compare with the prior period.]"}${share("audits_suppliers") ? ` ${share("audits_suppliers")} of respondents audit their own suppliers for modern slavery risk.` : ""}`,
        "# Remediation",
        v
          ? v.concerns > 0
            ? `${plural(v.concerns, "concern was", "concerns were")} escalated to Legal, of which ${v.resolved} ${v.resolved === 1 ? "has" : "have"} been decided. [Summarise the corrective actions agreed, without naming suppliers.]`
            : "No response raised a concern requiring remediation in the period."
          : "[Describe any remediation in the period, or state that none was required.]",
      ];
      const actions = reviews.filter((r) => r.actions).map((r) => `- ${supplierName(r.counterparty_id)}: ${r.actions}`);
      if (actions.length) out.push("Actions agreed with suppliers:", actions.join("\n"));
      return out.join("\n\n");
    }

    case 5: {
      if (!v) return "[Describe how you check that your actions are working, the measures you track, and this period's results against the last.]";
      const rows = [
        "Measure | This period | Prior period",
        `Third parties surveyed | ${v.sent} | ${v.prior ? v.prior.sent : "Not available"}`,
        `Response rate | ${pct(v.answered, v.sent)} | ${v.prior ? pct(v.prior.answered, v.prior.sent) : "Not available"}`,
        `Rated high risk | ${v.high} | ${v.prior ? v.prior.high : "Not available"}`,
        `Concerns escalated to Legal | ${v.concerns} | ${v.prior ? v.prior.concerns : "Not available"}`,
        `Third-party audits carried out | ${v.audits ?? "Not recorded"} | ${v.priorAudits ?? "Not available"}`,
      ];
      const headline = [
        ["under_18", "do not employ anyone under the age of 18"],
        ["voluntary", "confirmed all workers are working voluntarily and are free to leave after reasonable notice"],
        ["minimum_wage", "pay at least the minimum wage required by local law"],
        ["retain_documents", "do not retain workers' identity documents"],
        ["free_movement", "confirmed workers are free to leave the workplace and their accommodation"],
        ["worker_debts", "reported no worker debts or withheld wages"],
        ["grievance", "have a grievance mechanism for workers"],
        ["response_process", "have a process for responding to suspected modern slavery"],
      ]
        .map(([code, text]) => (share(code) ? `- ${share(code)} of respondents ${text}` : ""))
        .filter(Boolean);
      return ["We assess effectiveness each period against the following measures.", rows.join("\n"), "Key results from the questionnaire:", headline.join("\n"), "The full results are in the appendix. [Describe how these results are reported to the board.]"].join("\n\n");
    }

    case 6:
      return covered.length
        ? `This is a joint statement. ${name} prepared it in consultation with ${covered.map((e) => e.name).join(", ")}. [Describe how: for example shared policies and suppliers, common directors or management, and review of this statement in draft by each entity.]`
        : `${name} does not own or control any other entity, so no consultation with owned or controlled entities was required.`;

    case 7:
      return "There is no other relevant information.";

    case 8:
      return ["In the next reporting period we will:", "- [continue the annual questionnaire and follow up those who did not respond]", "- [review third parties rated high risk and agree corrective actions]", "- [carry out further audits]"].join("\n");

    default:
      if (!v || v.results.length === 0) return "[No questionnaire results are available. Link a supplier survey to this statement.]";
      return [
        `Responses from ${plural(v.answered, "third party", "third parties")} of ${v.sent} surveyed (${pct(v.answered, v.sent)}).`,
        ...v.sections.map((section) =>
          [`# ${section}`, "Question | Yes | No", ...v.results.filter((r) => r.section === section).map((r) => `${r.prompt} | ${r.yes} (${pct(r.yes, r.total)}) | ${r.no} (${pct(r.no, r.total)})`)].join("\n"),
        ),
      ].join("\n\n");
  }
}

export type Block = { kind: "heading"; text: string } | { kind: "paragraph"; text: string } | { kind: "list"; items: string[] } | { kind: "table"; rows: string[][] };

/** Reads report text into headings, paragraphs, bullet lists and tables. */
export function parseReport(content: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const last = blocks[blocks.length - 1];
    if (line.startsWith("# ")) blocks.push({ kind: "heading", text: line.slice(2) });
    else if (line.startsWith("- ")) {
      if (last?.kind === "list") last.items.push(line.slice(2));
      else blocks.push({ kind: "list", items: [line.slice(2)] });
    } else if (line.includes(" | ")) {
      const cells = line.split(" | ").map((c) => c.trim());
      if (last?.kind === "table" && last.rows[0].length === cells.length) last.rows.push(cells);
      else blocks.push({ kind: "table", rows: [cells] });
    } else blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}
