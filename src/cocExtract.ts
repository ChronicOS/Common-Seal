// Reads the key details from a certificate of currency. No AI and no outside
// service: the PDF's own text is read in the browser and matched against the
// usual wording. Anything found is a suggestion for the person to check.

export type Extracted = {
  policy_type: string | null;
  insurer: string | null;
  broker: string | null;
  policy_number: string | null;
  insured_name: string | null;
  limit_amount: number | null;
  limit_basis: string | null;
  excess_amount: number | null;
  currency: string | null;
  period_from: string | null;
  period_to: string | null;
};

const TYPES: [RegExp, string][] = [
  [/directors[’'`]?\s*(and|&)\s*officers|\bD\s*&\s*O\b|management liability/i, "Directors and officers liability"],
  [/public\s*(and|&)\s*products?\s*liability|general liability|broadform liability/i, "Public and products liability"],
  [/products?\s*recall|contamination/i, "Product recall"],
  [/products?\s*liability/i, "Products liability"],
  [/professional\s*indemnity|errors\s*(and|&)\s*omissions/i, "Professional indemnity"],
  [/clinical\s*trials?/i, "Clinical trials"],
  [/cyber/i, "Cyber"],
  [/industrial\s*special\s*risks|\bISR\b|property damage/i, "Industrial special risks (property)"],
  [/business\s*interruption/i, "Business interruption"],
  [/workers[’']?\s*comp/i, "Workers compensation"],
  [/marine\s*transit|goods in transit/i, "Marine transit"],
  [/motor\s*(vehicle|fleet)|fleet/i, "Motor vehicle"],
  [/employment\s*practices/i, "Employment practices liability"],
  [/statutory\s*liability/i, "Statutory liability"],
  [/crime|fidelity/i, "Crime"],
  [/trade\s*credit/i, "Trade credit"],
  [/corporate\s*travel|business travel/i, "Corporate travel"],
];
export const POLICY_TYPES = [...new Set(TYPES.map(([, t]) => t))].concat("Other");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})|(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})|(\d{4})-(\d{2})-(\d{2})/gi;
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);
function toIso(m: RegExpExecArray): string | null {
  if (m[1]) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    // Australian order: day, month, year
    return iso(y, Number(m[2]), Number(m[1]));
  }
  if (m[4]) return iso(Number(m[6]), MONTHS.indexOf(m[5].slice(0, 3).toLowerCase()) + 1, Number(m[4]));
  return iso(Number(m[7]), Number(m[8]), Number(m[9]));
}
export function datesIn(text: string): string[] {
  const out: string[] = [];
  DATE.lastIndex = 0;
  for (let m = DATE.exec(text); m; m = DATE.exec(text)) {
    const d = toIso(m);
    if (d) out.push(d);
  }
  return out;
}

/** "$10,000,000", "AUD 10m", "$5 million" */
function amountIn(text: string): { amount: number; currency: string | null } | null {
  const m = /(AUD|USD|NZD|GBP|EUR|SGD|A\$|US\$|NZ\$|\$|£|€)\s*([\d,]+(?:\.\d+)?)\s*(m\b|million|mil\b|k\b|thousand|bn|billion)?/i.exec(text);
  if (!m) return null;
  let n = Number(m[2].replace(/,/g, ""));
  const unit = (m[3] ?? "").toLowerCase();
  if (unit.startsWith("m")) n *= 1e6;
  else if (unit.startsWith("k") || unit === "thousand") n *= 1e3;
  else if (unit.startsWith("b")) n *= 1e9;
  const c = m[1].toUpperCase();
  const currency = c === "$" || c === "A$" ? null : c === "US$" ? "USD" : c === "NZ$" ? "NZD" : c === "£" ? "GBP" : c === "€" ? "EUR" : c;
  return Number.isFinite(n) && n > 0 ? { amount: n, currency } : null;
}

/** The value after a label, on the same line (or the next line when the label stands alone) */
function after(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:–—-]+/, "").trim();
    if (rest.length >= 2) return rest;
    const next = lines[i + 1]?.trim();
    if (next && next.length >= 2) return next;
  }
  return null;
}
const clean = (v: string | null, max = 120) => (v ? v.replace(/\s{2,}/g, " ").trim().slice(0, max) || null : null);

export function extractFromText(text: string): Extracted {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const all = lines.join("\n");

  // Type: the first match in the title area counts most
  let policy_type: string | null = null;
  const head = lines.slice(0, 25).join("\n");
  for (const [re, t] of TYPES) if (re.test(head)) { policy_type = t; break; }
  if (!policy_type) for (const [re, t] of TYPES) if (re.test(all)) { policy_type = t; break; }

  const insurer = clean(after(lines, /\b(insurer|underwriter|underwritten by|issued by)\b/i));
  const broker = clean(after(lines, /\b(broker|intermediary)\b/i));
  const number = after(lines, /\b(policy\s*(number|no\.?|#)|certificate\s*(number|no\.?))\b/i);
  const policy_number = number ? (/[A-Z0-9][A-Z0-9\/\-. ]{2,38}[A-Z0-9]/i.exec(number)?.[0] ?? null) : null;
  const insured_name = clean(after(lines, /\b(named insured|the insured|insured name|insured|policyholder|policy holder)\b(?!\s*(amount|sum|value))/i));

  // Period: "from X to Y", or the first two dates on the period line
  let period_from: string | null = null;
  let period_to: string | null = null;
  const periodIdx = lines.findIndex((l) => /period of (insurance|cover)|policy period|insurance period|\bperiod\b|valid from|current from|from/i.test(l));
  if (periodIdx >= 0) {
    const window = lines.slice(periodIdx, periodIdx + 3).join(" ");
    const ds = datesIn(window);
    if (ds.length >= 2) [period_from, period_to] = [ds[0], ds[1]];
    else if (ds.length === 1) period_to = ds[0];
  }
  if (!period_to) {
    const ds = datesIn(all).sort();
    if (ds.length >= 2) [period_from, period_to] = [ds[ds.length - 2], ds[ds.length - 1]];
  }
  if (period_from && period_to && period_to < period_from) [period_from, period_to] = [period_to, period_from];

  // Limit and excess
  let limit_amount: number | null = null;
  let currency: string | null = null;
  const limitLine = lines.findIndex((l) => /limit of (indemnity|liability)|indemnity limit|sum insured|limit\b|aggregate limit/i.test(l));
  if (limitLine >= 0) {
    const a = amountIn(lines.slice(limitLine, limitLine + 2).join(" "));
    if (a) ({ amount: limit_amount, currency } = a);
  }
  const basisMatch = /any one (claim|occurrence|event|loss)(?: and in the (?:annual )?aggregate)?|in the (annual )?aggregate/i.exec(all);
  const limit_basis = basisMatch ? basisMatch[0].toLowerCase() : null;
  let excess_amount: number | null = null;
  const excessLine = lines.findIndex((l) => /excess|deductible/i.test(l));
  if (excessLine >= 0) excess_amount = amountIn(lines.slice(excessLine, excessLine + 2).join(" "))?.amount ?? null;
  if (!currency) currency = /\bUSD\b|US\$/.test(all) ? "USD" : /\bNZD\b|NZ\$/.test(all) ? "NZD" : /\bGBP\b|£/.test(all) ? "GBP" : /\bEUR\b|€/.test(all) ? "EUR" : /\$|AUD/.test(all) ? "AUD" : null;

  return { policy_type, insurer, broker, policy_number, insured_name, limit_amount, limit_basis, excess_amount, currency, period_from, period_to };
}

/** Reads the text of a PDF in the browser. Returns an empty string for a scanned PDF with no text in it. */
export async function pdfText(file: File, maxPages = 10): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    // Group the pieces into lines by their height on the page
    let lastY: number | null = null;
    let line = "";
    const out: string[] = [];
    for (const item of content.items as { str: string; transform: number[] }[]) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        out.push(line);
        line = "";
      }
      line += (line && !line.endsWith(" ") ? " " : "") + item.str;
      lastY = y;
    }
    out.push(line);
    pages.push(out.join("\n"));
  }
  return pages.join("\n");
}
