// Built-in policy templates. Original wording for Australian companies, laid out
// in VeraPhius's standard sections. They are starting points: anything in
// [square brackets] is a placeholder or a drafting note to resolve before
// approval. [Company Name] is filled in automatically.

export type Audience = "internal" | "external";
export type Kind = "policy" | "code";
export type Template = {
  id: string;
  name: string;
  category: string;
  audience: Audience;
  kind: Kind;
  /** Who an external policy is for */
  appliesTo?: string;
  summary: string;
  /** Why a company typically needs it, including any legal requirement */
  whyNeeded: string;
  content: string;
};

type Parts = {
  purpose: string;
  who: string;
  definitions?: string[];
  rules: string[];
  roles: string;
  concerns?: string;
  breaches?: string;
  review?: string;
  related?: string[];
};

const INTERNAL_CONCERNS =
  "If you see or suspect a breach, tell your manager, Legal or Compliance, or use the speak-up channel in VeraPhius, which can be anonymous. Nobody will be treated badly for raising a concern in good faith.";
const INTERNAL_BREACHES = "Breaches may lead to disciplinary action, up to and including dismissal, and may be reported to the authorities where the law requires it.";
const EXTERNAL_CONCERNS =
  "Concerns about [Company Name] or its people can be raised with your [Company Name] contact, or confidentially through [the external speak-up channel or email address]. [Company Name] will not take action against anyone for raising a concern in good faith.";
const EXTERNAL_BREACHES =
  "[Company Name] may ask for a corrective action plan, carry out an audit, suspend orders or end the relationship, depending on how serious the breach is and how it is handled. Where the law requires it, [Company Name] will report the matter to the authorities.";
const REVIEW = "The owner reviews this policy at least once in each review cycle, and sooner if the law, the business or the risks change. Changes are approved before they take effect.";

function build(p: Parts) {
  return [
    `# Purpose\n${p.purpose}`,
    `# Who this applies to\n${p.who}`,
    p.definitions?.length ? `# Definitions\n${p.definitions.join("\n")}` : "",
    `# The rules\n${p.rules.map((r, n) => `${n + 1}. ${r}`).join("\n")}`,
    `# Roles and responsibilities\n${p.roles}`,
    `# Raising concerns\n${p.concerns ?? INTERNAL_CONCERNS}`,
    `# Breaches\n${p.breaches ?? INTERNAL_BREACHES}`,
    `# Review\n${p.review ?? REVIEW}`,
    p.related?.length ? `# Related policies\n${p.related.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const TEMPLATES: Template[] = [
  // ---------------- Internal ----------------
  {
    id: "code-of-conduct",
    name: "Employee Code of Conduct",
    category: "Conduct",
    audience: "internal",
    kind: "code",
    summary: "The standards of behaviour expected of everyone who works for the company. The other conduct policies sit under it.",
    whyNeeded: "Expected by boards, auditors and customers as the top-level statement of how people behave. Listed entities are expected to have one under the ASX Corporate Governance Principles (Recommendation 3.2).",
    content: build({
      purpose: "This Code sets out how everyone at [Company Name] is expected to behave. It explains our values in practice and points to the policies that give more detail.",
      who: "Everyone who works for or represents [Company Name] or its subsidiaries: directors, employees, contractors, temporary staff and anyone acting on our behalf.",
      rules: [
        "Act honestly and with integrity, and treat others with respect.",
        "Follow the law, and the policies that apply to your work. If the law and this Code differ, follow the stricter.",
        "Treat everyone fairly. Discrimination, harassment, bullying and victimisation are not tolerated.",
        "Keep people safe. Follow safety rules and report hazards and incidents straight away.",
        "Never offer, give or accept a bribe. Declare gifts, hospitality and conflicts of interest.",
        "Protect the company's information, property and money, and use them only for company business.",
        "Respect privacy. Handle personal information only as the privacy policy allows.",
        "Compete fairly. Do not agree prices, divide markets or share competitively sensitive information with competitors.",
        "Be accurate. Records, reports and claims must be complete and truthful.",
        "Speak for the company only if you are authorised to. Take care on social media.",
        "Respect human rights in our operations and supply chain, including freedom from modern slavery.",
        "If you are unsure, ask before you act.",
      ],
      roles: "The board approves this Code. Managers lead by example and make sure their teams understand it. Everyone completes the related training and confirms each year that they have read and will follow it.",
      related: ["Anti-bribery and corruption", "Gifts, hospitality and conflicts of interest", "Whistleblower (speak-up)", "Workplace behaviour", "Privacy", "Information security and acceptable use"],
    }),
  },
  {
    id: "abc",
    name: "Anti-bribery and corruption",
    category: "Anti-bribery and corruption",
    audience: "internal",
    kind: "policy",
    summary: "Prohibits bribery and facilitation payments, and sets the controls that make up the company's adequate procedures.",
    whyNeeded: "Bribing a foreign public official is a crime under the Criminal Code (Cth). A company can also be liable for failing to prevent foreign bribery by its associates unless it has adequate procedures in place; this policy is a core part of those procedures.",
    content: build({
      purpose: "[Company Name] does not tolerate bribery or corruption in any form. This policy sets out the rules and the controls that prevent it.",
      who: "Directors, employees and contractors of [Company Name] and its subsidiaries, and anyone who acts for us, such as agents, distributors, consultants and joint venture partners.",
      definitions: [
        "Bribe: anything of value offered, given, asked for or accepted to influence someone improperly, or to reward improper conduct.",
        "Public official: anyone working for or on behalf of a government, government agency, state-owned business or public international organisation, including doctors and pharmacists in public hospitals.",
        "Facilitation payment: a small payment to a public official to speed up a routine government action.",
      ],
      rules: [
        "Never offer, promise, give, ask for or accept a bribe, directly or through someone else.",
        "Never make a facilitation payment, even where it is customary. The only exception is a payment needed to protect someone's safety; report it to Legal straight away.",
        "Get approval from [Legal or Compliance] before giving anything of value to a public official.",
        "Gifts and hospitality must be modest, infrequent and declared under the gifts, hospitality and conflicts policy.",
        "Carry out risk-based due diligence before appointing an agent, distributor, consultant or other third party who will act for us, and include anti-bribery terms in the contract.",
        "Political donations on behalf of the company need board approval. Charitable donations and sponsorships need [approver] approval and must not be linked to a business decision.",
        "Record every payment accurately. No off-book accounts or false invoices.",
        "Complete anti-bribery training when you join and [every year or every two years].",
      ],
      roles: "The board oversees this policy. [The General Counsel or Head of Compliance] owns it, keeps the risk assessment current and reports to the board [at least annually]. Managers make sure their teams and third parties follow it.",
      related: ["Gifts, hospitality and conflicts of interest", "Supplier Code of Conduct", "Third-party anti-bribery requirements"],
    }),
  },
  {
    id: "gifts",
    name: "Gifts, hospitality and conflicts of interest",
    category: "Conduct",
    audience: "internal",
    kind: "policy",
    summary: "When gifts and hospitality can be given or accepted, how they are declared, and how conflicts of interest are managed.",
    whyNeeded: "Supports the anti-bribery policy and directors' duties to avoid conflicts. The declarations it requires feed the Declarations register in VeraPhius.",
    content: build({
      purpose: "Gifts, hospitality and personal interests can influence, or look as if they influence, business decisions. This policy says what is acceptable and how to declare it.",
      who: "Directors, employees and contractors of [Company Name] and its subsidiaries.",
      rules: [
        "Gifts and hospitality must be modest, occasional, and never given or accepted to win or keep business.",
        "Declare every gift or hospitality given or received in connection with work, in VeraPhius, within [5] working days.",
        "Get approval first for anything valued above [AUD 200], or anything involving a public official.",
        "Never give or accept cash, gift cards or other cash equivalents.",
        "Do not give or accept gifts or hospitality during a tender or negotiation with that party.",
        "Declare any personal, financial or family interest that could conflict with your duties, as soon as you become aware of it.",
        "Where you have a conflict, do not take part in the decision unless you have been cleared to.",
        "Directors declare material personal interests to the board as the Corporations Act requires.",
      ],
      roles: "[Compliance] reviews declarations and decides requests for approval. Managers make sure declared conflicts are managed. The register is reported to [the board or audit and risk committee] [annually].",
      related: ["Anti-bribery and corruption", "Employee Code of Conduct"],
    }),
  },
  {
    id: "whistleblower",
    name: "Whistleblower (speak-up)",
    category: "Conduct",
    audience: "internal",
    kind: "policy",
    summary: "How to report suspected misconduct, how reports are handled, and the protections for people who report.",
    whyNeeded:
      "Public companies, large proprietary companies and trustees of registrable superannuation entities must have a whistleblower policy under the Corporations Act (s1317AI), covering the matters ASIC sets out in Regulatory Guide 270. It must be made available to officers and employees. [Drafting note: consider publishing it on your website so suppliers and former employees, who are also eligible whistleblowers, can see it.]",
    content: build({
      purpose: "[Company Name] wants to hear about misconduct so it can be dealt with. This policy explains how to speak up, what happens next, and how people who speak up are protected.",
      who: "Current and former directors, officers, employees, contractors, suppliers and their employees, associates, and relatives or dependants of any of them.",
      definitions: [
        "Disclosable matter: information about misconduct or an improper state of affairs relating to [Company Name], including a breach of the law, a danger to the public or the financial system, or a breach of tax law.",
        "Personal work-related grievance: a matter about your own employment that does not have wider significance. These generally go through the grievance process, not this policy.",
      ],
      rules: [
        "You can report to any eligible recipient: [the people appointed in VeraPhius to receive reports], a director, the company secretary, an auditor, or [external service].",
        "You can report anonymously, and stay anonymous throughout. VeraPhius's speak-up channel gives you a code to follow up without revealing who you are.",
        "Your identity, and information likely to identify you, will not be shared without your consent, except as the law allows.",
        "Nobody may cause or threaten detriment to anyone because they made, or might make, a report. Doing so is a breach of this policy and may be an offence.",
        "Reports are assessed promptly, investigated where appropriate by someone independent of the matter, and you will be kept informed as far as possible.",
        "People named in a report are treated fairly and given a chance to respond.",
        "You may also report to ASIC, APRA, the ATO or another prescribed body, or in limited cases make a public interest or emergency disclosure. [Drafting note: describe the conditions for public interest and emergency disclosures.]",
      ],
      roles: "The board oversees this policy and receives de-identified reporting on reports and outcomes. [The whistleblower protection officer] protects reporters. [The whistleblower investigation officer] runs investigations.",
      concerns: "This policy is itself the channel for raising concerns. If you are unsure whether something is covered, report it and it will be assessed.",
      breaches: "Breaching confidentiality or causing detriment to a reporter may lead to disciplinary action, up to and including dismissal, and may be an offence.",
      related: ["Employee Code of Conduct", "Workplace behaviour"],
    }),
  },
  {
    id: "workplace-behaviour",
    name: "Workplace behaviour (discrimination, harassment and bullying)",
    category: "People",
    audience: "internal",
    kind: "policy",
    summary: "Prohibits discrimination, sexual harassment, bullying and victimisation, and sets out how the company meets its positive duty.",
    whyNeeded: "Employers have a positive duty under the Sex Discrimination Act (s47C) to take reasonable and proportionate measures to eliminate sexual harassment and related conduct, and duties under WHS laws to manage psychosocial hazards.",
    content: build({
      purpose: "Everyone at [Company Name] has the right to work free from discrimination, harassment, bullying and victimisation. This policy sets the standard and how it is upheld.",
      who: "Everyone who works for [Company Name], at work and at work-related events, travel and online, including in dealings with customers, suppliers and visitors.",
      rules: [
        "Do not discriminate against anyone because of a protected attribute such as sex, race, age, disability, sexual orientation, gender identity, religion, pregnancy or family responsibilities.",
        "Sexual harassment, sex-based harassment and a hostile workplace environment on the ground of sex are prohibited.",
        "Bullying, meaning repeated unreasonable behaviour that creates a risk to health and safety, is prohibited.",
        "Do not victimise anyone for making or supporting a complaint.",
        "Managers must act on behaviour they see or are told about, even without a formal complaint.",
        "[Company Name] assesses the risk of harassment and other psychosocial hazards and puts controls in place. [Drafting note: describe the measures taken to meet the positive duty.]",
        "Complaints are dealt with promptly, fairly and confidentially, and can be made informally or formally.",
      ],
      roles: "The board and senior leaders are accountable for meeting the positive duty. [People and Culture] owns this policy, provides training and reports trends to [the board].",
      related: ["Employee Code of Conduct", "Work health and safety", "Whistleblower (speak-up)"],
    }),
  },
  {
    id: "whs",
    name: "Work health and safety",
    category: "Health and safety",
    audience: "internal",
    kind: "policy",
    summary: "The company's commitment to health and safety, and what each person must do.",
    whyNeeded: "WHS laws require a business to ensure, so far as reasonably practicable, the health and safety of workers and others. Officers, including directors, have a personal duty of due diligence.",
    content: build({
      purpose: "[Company Name] is committed to providing a safe and healthy workplace, physically and psychologically, for everyone affected by its work.",
      who: "Everyone who works for [Company Name], and visitors to our sites.",
      rules: [
        "Identify hazards, assess the risks, and eliminate them or reduce them so far as is reasonably practicable.",
        "Follow safe work procedures and use the protective equipment provided.",
        "Report hazards, incidents and near misses straight away through [the incident system].",
        "Stop work that is unsafe. Nobody will be penalised for doing so in good faith.",
        "Consult workers and health and safety representatives on matters that affect their safety.",
        "Notify the regulator of notifiable incidents as the law requires.",
        "Manage psychosocial hazards, such as excessive workload, poor support and harassment, like any other hazard.",
      ],
      roles: "Officers, including directors, exercise due diligence: they keep up to date with WHS matters, understand the risks, and make sure resources and processes are in place and working. Managers implement this policy. Workers take reasonable care for their own and others' safety.",
      related: ["Workplace behaviour", "Employee Code of Conduct"],
    }),
  },
  {
    id: "ai",
    name: "Use of AI tools",
    category: "Technology and AI",
    audience: "internal",
    kind: "policy",
    summary: "Responsible use of AI tools: approved tools, what information can go into them, human oversight, disclosure, and governance.",
    whyNeeded: "No AI-specific law applies to most companies yet, but privacy, consumer, anti-discrimination, copyright and confidentiality obligations all apply to AI use. A policy sets clear limits before staff adopt tools on their own.",
    content: build({
      purpose: "AI tools can make our work better and faster. This policy makes sure [Company Name] uses them responsibly, lawfully and safely, and that people stay accountable for the results.",
      who: "Everyone who works for [Company Name] and uses an AI tool for work, on company or personal devices, including tools built into other software.",
      definitions: [
        "AI tool: software that generates content, makes predictions or recommendations, or makes decisions, including chatbots, writing and coding assistants, and image tools.",
        "Approved tool: an AI tool listed in [the approved tools register], for the uses and the information shown there.",
      ],
      rules: [
        "Use only approved AI tools for work. Ask [the AI Officer] before using a new tool or a new use of an approved one.",
        "Information tiers: Tier 1 (highly sensitive, such as personal information, trade secrets, privileged legal advice, unreleased financial results) goes only into tools approved for Tier 1. Tier 2 (internal, such as project details or customer names) goes only into approved tools. Tier 3 (public information) may go into any approved tool. [Drafting note: set the tiers and the tools approved for each.]",
        "Check AI output before relying on it. You remain responsible for your work, including its accuracy and whether it infringes anyone's rights.",
        "AI must support, not replace, human judgement for decisions that significantly affect people, such as hiring, performance, credit or access to services.",
        "Tell people when AI has materially shaped something they rely on, such as advice to a customer, a published document, or a decision about them. [Drafting note: list the situations where disclosure is required.]",
        "Watch for bias and unfair outcomes, and report them.",
        "New AI suppliers go through the third-party approval process, including a privacy and security review, before use.",
        "Complete the AI training before using AI tools for work.",
      ],
      roles: "[The AI Officer] owns this policy, keeps the approved tools register, and reports to [the AI governance group, executive team or board] [quarterly]. [The AI governance group, made up of Legal, Technology, Privacy and the business,] approves new tools and higher-risk uses.",
      concerns: "Report incidents, such as confidential information entered into an unapproved tool or harmful output, to [the AI Officer] straight away, or use the speak-up channel.",
      related: ["Information security and acceptable use", "Privacy", "Employee Code of Conduct"],
    }),
  },
  {
    id: "infosec",
    name: "Information security and acceptable use",
    category: "Technology and AI",
    audience: "internal",
    kind: "policy",
    summary: "Protecting company systems and information: passwords, devices, email, data handling and reporting incidents.",
    whyNeeded: "Directors are expected to oversee cyber risk. A policy is the baseline control behind customer security questionnaires, cyber insurance and the Notifiable Data Breaches scheme.",
    content: build({
      purpose: "This policy protects [Company Name]'s systems and information, and the personal information we hold, from loss, misuse and attack.",
      who: "Everyone with access to [Company Name] systems or information, on any device.",
      rules: [
        "Use multi-factor authentication and a unique, strong password for every work account. Never share credentials.",
        "Keep devices locked, updated and protected. Report a lost or stolen device straight away.",
        "Use company systems mainly for work. Reasonable personal use is allowed if it does not affect your work or the company's security.",
        "Store company information only in approved systems. Do not forward it to personal accounts.",
        "Be alert to phishing. Check unexpected requests to pay money or change bank details by calling a known number.",
        "Give access only to people who need it, and remove it when they no longer do.",
        "Report suspected security incidents and data breaches straight away to [the IT security contact].",
      ],
      roles: "[The Head of Technology] owns this policy and reports cyber risk to [the board or audit and risk committee]. Managers approve access for their teams.",
      related: ["Use of AI tools", "Privacy", "Record keeping and retention"],
    }),
  },
  {
    id: "expenses",
    name: "Expenses and corporate cards",
    category: "Finance",
    audience: "internal",
    kind: "policy",
    summary: "What can be claimed, receipts, approvals, and corporate card use.",
    whyNeeded: "A basic financial control. Approval limits come from the Financial Approval Matrix under Authorities.",
    content: build({
      purpose: "This policy makes sure business expenses are reasonable, approved and properly recorded.",
      who: "Everyone who incurs expenses for [Company Name] or holds a corporate card.",
      rules: [
        "Claim only reasonable costs incurred for company business.",
        "Keep a valid tax invoice for every expense over [AUD 82.50 including GST] and attach it to the claim.",
        "Nobody approves their own claim, or a claim by someone they report to. Approval limits follow the Financial Approval Matrix.",
        "Entertainment, gifts and hospitality are also declared under the gifts, hospitality and conflicts policy.",
        "Submit claims within [30] days of the expense.",
        "Corporate cards are for business use only. Personal spending on a card must be repaid straight away and reported.",
      ],
      roles: "Approvers check claims against this policy before approving. Finance reviews claims and card spending and reports exceptions to [the CFO].",
      related: ["Gifts, hospitality and conflicts of interest", "Financial Approval Matrix (Authorities)"],
    }),
  },
  {
    id: "delegations",
    name: "Delegations of authority",
    category: "Governance",
    audience: "internal",
    kind: "policy",
    summary: "The principles behind the Financial Approval Matrix and Signing Delegation, and how they are changed.",
    whyNeeded: "The board delegates authority to management; this policy records the rules for using those delegations. The detail lives under Board, Authorities.",
    content: build({
      purpose: "This policy sets the rules for using the authority the board delegates to management, so decisions are made at the right level.",
      who: "Directors and everyone who approves spending or signs documents for [Company Name] or its subsidiaries.",
      rules: [
        "Approve spending only within the limits in the Financial Approval Matrix for your position and function.",
        "Sign documents only as the Signing Delegation allows for that company and that type of document.",
        "Authority to approve is separate from authority to sign. Get approval before signing.",
        "Do not split a transaction to bring it under a limit.",
        "Matters reserved to the board, and any transaction above the top limit, go to the board.",
        "Authority belongs to the position. An acting appointment carries it only if recorded.",
        "Changes to the Financial Approval Matrix or Signing Delegation take effect only once the board has approved or ratified them.",
      ],
      roles: "The board approves the delegations. [The CFO and Company Secretary] maintain them in VeraPhius. Everyone with an authority is responsible for using it properly.",
      related: ["Expenses and corporate cards", "Financial Approval Matrix and Signing Delegation (Authorities)"],
    }),
  },
  {
    id: "records",
    name: "Record keeping and retention",
    category: "Governance",
    audience: "internal",
    kind: "policy",
    summary: "How long records are kept, how they are stored, and when they may be destroyed, including legal holds.",
    whyNeeded: "Companies must keep financial records for 7 years (Corporations Act s286) and tax records for 5 years. Records under a legal hold must not be destroyed.",
    content: build({
      purpose: "This policy makes sure [Company Name] keeps the records it needs, for as long as it needs them, and disposes of them safely.",
      who: "Everyone who creates or handles company records, in any format.",
      rules: [
        "Keep records in approved systems, so they can be found and are protected.",
        "Keep each type of record for at least the period in the retention schedule. [Drafting note: attach the retention schedule.]",
        "Never destroy records that are under a legal hold, or that may be relevant to an actual or likely dispute or investigation.",
        "Destroy records securely at the end of their retention period, and record the destruction.",
        "Personal information is kept only as long as needed and then destroyed or de-identified.",
      ],
      roles: "[The Company Secretary or General Counsel] owns this policy and the retention schedule, and issues legal holds.",
      related: ["Privacy", "Information security and acceptable use"],
    }),
  },
  {
    id: "competition",
    name: "Competition and consumer law",
    category: "Governance",
    audience: "internal",
    kind: "policy",
    summary: "Dealing with competitors, customers and suppliers lawfully: cartels, misuse of market power, and consumer guarantees.",
    whyNeeded: "Cartel conduct is a criminal offence under the Competition and Consumer Act 2010, and penalties for competition and consumer law breaches are substantial.",
    content: build({
      purpose: "[Company Name] competes vigorously and fairly. This policy helps you avoid conduct that breaches competition and consumer law.",
      who: "Directors and employees, especially those in sales, marketing, pricing, procurement and industry associations.",
      rules: [
        "Never agree or discuss with a competitor prices, discounts, bids, output, customers, territories or suppliers.",
        "Do not share or receive competitively sensitive information with competitors, including through industry associations.",
        "Leave any meeting where competitors start discussing these topics, and tell Legal.",
        "Do not tell resellers what price they must sell at.",
        "Get Legal's advice before exclusive dealing arrangements, or conduct that could be seen as using market power to harm competitors.",
        "Marketing must be accurate. Do not make misleading claims, and honour consumer guarantees.",
      ],
      roles: "[Legal] owns this policy and provides training to higher-risk roles [annually].",
      related: ["Employee Code of Conduct"],
    }),
  },
  {
    id: "securities-trading",
    name: "Securities trading",
    category: "Governance",
    audience: "internal",
    kind: "policy",
    summary: "When directors and employees may trade in the company's securities, and the approvals needed. For listed entities.",
    whyNeeded: "Listed entities must have a trading policy that meets ASX Listing Rules 12.9 to 12.12. Insider trading is an offence under the Corporations Act.",
    content: build({
      purpose: "This policy sets out when directors and employees may deal in [Company Name] securities, to prevent insider trading and the appearance of it.",
      who: "Directors, key management personnel and [other designated employees], and their close family members and controlled entities.",
      rules: [
        "Never deal in [Company Name] securities, or anyone else's, while you hold inside information.",
        "Do not deal during blackout periods: [from the end of each half year until the day after results are released].",
        "Designated persons need written clearance from [the Chair or Company Secretary] before dealing, and must deal within [5] trading days of clearance.",
        "Directors notify the Company Secretary of dealings within [2] business days so the ASX can be notified.",
        "Hedging unvested securities and short-term trading are prohibited.",
        "Exceptional circumstances, such as severe financial hardship, may allow clearance during a blackout.",
      ],
      roles: "[The Company Secretary] administers clearances and notifications. The board approves this policy.",
      related: ["Continuous disclosure"],
    }),
  },
  {
    id: "disclosure",
    name: "Continuous disclosure",
    category: "Governance",
    audience: "internal",
    kind: "policy",
    summary: "How price-sensitive information is identified, escalated and announced. For listed entities.",
    whyNeeded: "Listed entities must immediately disclose information that a reasonable person would expect to have a material effect on the price of their securities (ASX Listing Rule 3.1 and Corporations Act s674).",
    content: build({
      purpose: "This policy makes sure [Company Name] tells the market promptly about information that could materially affect its share price.",
      who: "Directors and employees, especially senior managers who may learn of material information.",
      rules: [
        "Tell [the Disclosure Officer] straight away about anything that might be material, even if you are unsure.",
        "The Disclosure Committee decides whether information must be disclosed, and announcements are released to the ASX before anyone else.",
        "Keep material information confidential until it is announced.",
        "Only authorised spokespeople speak to analysts, investors and the media.",
        "If the market is trading on rumour or a false market may exist, the Disclosure Committee considers an announcement or a trading halt.",
      ],
      roles: "[The Disclosure Officer, usually the Company Secretary] administers this policy. The board approves significant announcements.",
      related: ["Securities trading"],
    }),
  },
  {
    id: "risk",
    name: "Risk management",
    category: "Governance",
    audience: "internal",
    kind: "policy",
    summary: "How the company identifies, assesses, manages and reports risk. Ties to the Risk Register.",
    whyNeeded: "Directors must oversee risk. Listed entities are expected to have a risk management framework reviewed at least annually (ASX Recommendation 7.2).",
    content: build({
      purpose: "This policy sets out how [Company Name] manages the risks to its objectives, so the board and management can make informed decisions.",
      who: "Directors, managers and employees of [Company Name] and its subsidiaries.",
      rules: [
        "Risks are identified, assessed and recorded in the risk register by the people responsible for each risk category.",
        "Each material risk has an owner, controls, and actions with due dates.",
        "Risk reviews are run [quarterly] and reported to [the audit and risk committee or the board].",
        "The board sets the company's risk appetite, and risks outside it are escalated.",
        "New material risks and incidents are escalated straight away, without waiting for the next review.",
      ],
      roles: "The board sets risk appetite and oversees the framework. [The risk owner or CFO] runs the risk review process. Each risk category's responsible person keeps their risks current.",
      related: ["Risk Register in VeraPhius", "Work health and safety", "Information security and acceptable use"],
    }),
  },
  {
    id: "modern-slavery-internal",
    name: "Modern slavery and human rights",
    category: "Governance",
    audience: "internal",
    kind: "policy",
    summary: "How the company identifies and addresses modern slavery risks in its operations and supply chain.",
    whyNeeded: "Entities with annual consolidated revenue of at least AUD 100 million must report under the Modern Slavery Act 2018 (Cth). This policy describes the actions reported in the statement.",
    content: build({
      purpose: "[Company Name] does not tolerate modern slavery in its operations or supply chain. This policy sets out how we identify, address and report the risks.",
      who: "Directors, employees and contractors, especially those who select and manage suppliers.",
      rules: [
        "Assess modern slavery risk when selecting suppliers, using the supplier questionnaire, and before renewing higher-risk suppliers.",
        "Include the Supplier Code of Conduct and modern slavery terms in supplier contracts.",
        "Escalate any indicator of forced labour, child labour, debt bondage or withheld documents to Legal straight away.",
        "Where harm is found, work with the supplier on remediation focused on the people affected, before considering exit.",
        "Train procurement and other higher-risk roles.",
        "Review how effective our actions are each year and report them in the modern slavery statement.",
      ],
      roles: "The board approves the modern slavery statement. [Legal or Procurement] owns this policy and runs the supplier survey in VeraPhius.",
      related: ["Supplier Code of Conduct", "Employee Code of Conduct"],
    }),
  },
  {
    id: "diversity",
    name: "Diversity and inclusion",
    category: "People",
    audience: "internal",
    kind: "policy",
    summary: "The company's commitment to diversity and inclusion, and any measurable objectives.",
    whyNeeded: "Listed entities are expected to have a diversity policy with measurable objectives (ASX Recommendation 1.5). Employers with 100 or more employees report to the Workplace Gender Equality Agency.",
    content: build({
      purpose: "[Company Name] values a diverse workforce and an inclusive culture. This policy sets out our commitments and how progress is measured.",
      who: "Directors and everyone who works for [Company Name].",
      rules: [
        "Recruit, develop, pay and promote on merit, free from bias.",
        "Offer flexible working where the role allows.",
        "Set measurable objectives for diversity, including gender balance at board and senior levels. [Drafting note: set the objectives.]",
        "Review pay equity [annually] and act on unexplained gaps.",
        "Report progress against objectives to the board [annually].",
      ],
      roles: "The board approves the objectives and reviews progress. [People and Culture] owns this policy.",
      related: ["Workplace behaviour", "Employee Code of Conduct"],
    }),
  },

  // ---------------- External ----------------
  {
    id: "supplier-code",
    name: "Supplier Code of Conduct",
    category: "Conduct",
    audience: "external",
    kind: "code",
    appliesTo: "Suppliers, contract manufacturers, service providers and their subcontractors",
    summary: "The standards [Company Name] expects of its suppliers: ethics, labour and human rights, safety, environment and information.",
    whyNeeded: "The main way to pass your standards down the supply chain. Referred to in supplier contracts and in the modern slavery statement, and checked through the supplier questionnaire.",
    content: build({
      purpose: "This Code sets out the standards [Company Name] expects of the businesses that supply it. We choose suppliers who share these standards and work with them to meet them.",
      who: "Every supplier of goods or services to [Company Name] or its subsidiaries, and their employees, agents and subcontractors. Suppliers must make sure their own suppliers meet equivalent standards.",
      rules: [
        "Comply with all laws that apply to your business, including anti-bribery, competition, privacy, sanctions and export control laws.",
        "Never offer or give a bribe, facilitation payment or improper gift to anyone, including [Company Name] employees.",
        "Do not use forced, bonded, trafficked or prison labour, or child labour. Workers must be free to leave, and must not pay recruitment fees or have identity documents withheld.",
        "Pay at least the legal minimum wage, keep working hours within legal limits, and respect freedom of association.",
        "Treat workers with dignity and without discrimination, harassment or abuse.",
        "Provide a safe and healthy workplace.",
        "Manage your environmental impact and comply with environmental laws.",
        "Protect [Company Name]'s confidential information and any personal information you handle for us, and tell us straight away of any data breach.",
        "Declare any conflict of interest involving a [Company Name] employee.",
        "Keep accurate records and allow [Company Name] or its nominee to audit compliance with this Code on reasonable notice.",
        "Tell us promptly if you become aware of a breach of this Code in your business or supply chain.",
      ],
      roles: "Suppliers are responsible for meeting this Code and for cascading it to their supply chain. [Company Name] procurement teams communicate it, include it in contracts, and assess compliance through the supplier questionnaire and audits.",
      concerns: EXTERNAL_CONCERNS,
      breaches: EXTERNAL_BREACHES,
      related: ["Modern slavery and human rights (internal)", "Third-party anti-bribery requirements"],
    }),
  },
  {
    id: "third-party-abc",
    name: "Third-party anti-bribery requirements",
    category: "Anti-bribery and corruption",
    audience: "external",
    kind: "policy",
    appliesTo: "Agents, distributors, consultants, brokers and joint venture partners who act for the company",
    summary: "The anti-bribery rules for third parties who act on the company's behalf, especially with public officials.",
    whyNeeded: "Associates acting for the company can make it liable for failing to prevent foreign bribery. Clear written requirements are part of adequate procedures.",
    content: build({
      purpose: "Anyone who acts for [Company Name] must meet our anti-bribery standards. This document sets out those requirements.",
      who: "Agents, distributors, consultants, brokers, joint venture partners and others who act on behalf of [Company Name], or who deal with public officials in connection with our business.",
      rules: [
        "Do not offer, give, ask for or accept a bribe or facilitation payment when acting for [Company Name], directly or through anyone else.",
        "Tell [Company Name] before any dealing with a public official on our behalf, unless the contract already covers it.",
        "Do not appoint a subcontractor to act for us without our written consent.",
        "Keep accurate records of payments and expenses relating to our business, and provide them on request.",
        "Complete the due diligence questionnaire and tell us promptly of any change, including any investigation or allegation of bribery.",
        "Confirm compliance in writing [annually] and complete any training we provide.",
      ],
      roles: "[Company Name]'s relationship owner manages the third party and makes sure these requirements are in the contract. [Compliance] carries out due diligence.",
      concerns: EXTERNAL_CONCERNS,
      breaches: "A breach entitles [Company Name] to stop payment of any related amount and end the relationship immediately, and may be reported to the authorities.",
      related: ["Supplier Code of Conduct"],
    }),
  },
  {
    id: "privacy",
    name: "Privacy policy (published)",
    category: "Privacy and data",
    audience: "external",
    kind: "policy",
    appliesTo: "Customers, website visitors, job applicants, suppliers and anyone whose personal information the company handles",
    summary: "The public statement of how the company collects, uses, discloses and protects personal information.",
    whyNeeded:
      "Organisations covered by the Privacy Act 1988 must have a clearly expressed and up-to-date privacy policy that is freely available (Australian Privacy Principle 1). [Drafting note: from 10 December 2026, privacy policies must also explain any substantially automated decisions that use personal information and significantly affect people. Check this against current guidance.]",
    content: build({
      purpose: "This policy explains how [Company Name] collects, uses, discloses and protects personal information, and how you can access or correct it or make a complaint.",
      who: "Anyone whose personal information [Company Name] handles, including customers, website users, job applicants, suppliers' representatives and patients or consumers who contact us. [Drafting note: list the groups that apply.]",
      rules: [
        "What we collect: [names, contact details, ... and any sensitive information, such as health information, collected with consent].",
        "How we collect it: directly from you where possible, and from [other sources].",
        "Why we use it: [to supply products and services, respond to enquiries, meet legal and safety reporting obligations, recruit, and market to you where you have not opted out].",
        "Who we share it with: [service providers, related companies, regulators where required]. We do not sell personal information.",
        "Overseas disclosure: [the countries where information may be sent or stored, or a statement that it is not sent overseas].",
        "Automated decisions: [describe any decisions made substantially by a computer program using personal information that significantly affect people, or state that none are made].",
        "Security: we take reasonable steps to protect personal information, and we will notify you and the regulator of an eligible data breach.",
        "Access and correction: you may ask for access to, or correction of, your personal information by contacting [privacy contact].",
      ],
      roles: "[The Privacy Officer] owns this policy, handles requests and complaints, and keeps the policy current.",
      concerns: "To make a privacy complaint, contact [the Privacy Officer at email address]. We will respond within [30] days. If you are not satisfied, you can complain to the Office of the Australian Information Commissioner (oaic.gov.au).",
      breaches: "If we breach this policy or the Privacy Act, you can complain to us and to the Office of the Australian Information Commissioner.",
      related: ["Information security and acceptable use (internal)", "Record keeping and retention (internal)"],
    }),
  },
  {
    id: "human-rights-statement",
    name: "Human rights statement",
    category: "Governance",
    audience: "external",
    kind: "policy",
    appliesTo: "The public, customers, investors and suppliers",
    summary: "The company's public commitment to respect human rights, including in its supply chain.",
    whyNeeded: "Often requested by customers and investors, and supports the modern slavery statement. Aligns with the UN Guiding Principles on Business and Human Rights.",
    content: build({
      purpose: "This statement sets out [Company Name]'s commitment to respect human rights in its own operations and through its business relationships.",
      who: "[Company Name] and its subsidiaries. We expect our suppliers and partners to share this commitment.",
      rules: [
        "We respect internationally recognised human rights, guided by the UN Guiding Principles on Business and Human Rights.",
        "We carry out human rights due diligence proportionate to our risks, with a focus on modern slavery in our supply chain.",
        "We do not tolerate forced labour, child labour or human trafficking.",
        "Where we have caused or contributed to harm, we will provide for or cooperate in remediation.",
        "We report each year on our actions in our modern slavery statement.",
      ],
      roles: "The board oversees this commitment. [Legal or Sustainability] is responsible for putting it into practice.",
      concerns: EXTERNAL_CONCERNS,
      breaches: "Where a supplier or partner does not meet this commitment, we will work with them to put things right, and may end the relationship.",
      related: ["Supplier Code of Conduct", "Modern slavery and human rights (internal)"],
    }),
  },
  {
    id: "complaints",
    name: "Customer complaints",
    category: "General",
    audience: "external",
    kind: "policy",
    appliesTo: "Customers and consumers",
    summary: "How customers can complain, how complaints are handled, and the time frames.",
    whyNeeded: "Expected under consumer law and industry codes, and required in some regulated sectors. Gives customers a clear path before they go to a regulator or ombudsman.",
    content: build({
      purpose: "[Company Name] wants to know when something has gone wrong so we can fix it. This policy explains how to complain and what to expect.",
      who: "Customers and consumers of [Company Name]'s products and services.",
      rules: [
        "You can complain by [phone, email, web form or post]. Complaints are free to make.",
        "We will acknowledge your complaint within [2] business days.",
        "We aim to resolve complaints within [30] days, and will keep you informed if it will take longer.",
        "Complaints are handled fairly and confidentially, by someone not directly involved where possible.",
        "Your rights under the Australian Consumer Law are not affected by this policy.",
        "[Drafting note: for therapeutic goods, food or other regulated products, add how product safety complaints and adverse events are escalated and reported.]",
      ],
      roles: "[The Customer Service Manager] owns this policy and reports complaint trends to [management] [quarterly].",
      concerns: "If you are not satisfied with our response, you can contact [the relevant ombudsman, regulator or your state consumer protection agency].",
      breaches: "If we do not follow this policy, you can escalate your complaint to [the Customer Service Manager] or to the bodies above.",
    }),
  },
];

/** Fills in the company name; everything else in [brackets] is left for the drafter */
export const fillTemplate = (content: string, companyName: string) => content.replace(/\[Company Name\]/g, companyName);

/** Placeholders and drafting notes still in a draft */
export const placeholdersIn = (content: string) => [...new Set([...content.matchAll(/\[[^\]\n]{2,200}\]/g)].map((m) => m[0]))];
