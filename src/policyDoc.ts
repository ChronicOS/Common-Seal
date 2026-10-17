// Reads an existing policy document (Word or PDF) in the browser: its title,
// the date it is current from if the document says, and its text. No outside
// service. Everything found is a suggestion for the person to check.

import { datesIn, pdfText } from "./cocExtract";

export type PolicyDoc = { title: string | null; effectiveOn: string | null; text: string; kind: "docx" | "pdf" | "other" };

const TITLE_WORDS = /\b(policy|code of conduct|code|charter|procedure|standard|statement|guidelines?|framework|protocol)\b/i;
const NOISE = /^(confidential|internal use only|uncontrolled when printed|page \d+|version\b|v\d|draft|document (number|control)|table of contents|contents)/i;

function titleFrom(lines: string[], fileName: string): string | null {
  const top = lines.slice(0, 20).map((l) => l.trim()).filter((l) => l.length >= 3 && l.length <= 120 && !NOISE.test(l) && !/^\d+(\.\d+)*$/.test(l));
  const named = top.find((l) => TITLE_WORDS.test(l));
  if (named) return named.replace(/\s+/g, " ").replace(/[:.]$/, "");
  if (top[0]) return top[0];
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base.length >= 3 ? base : null;
}

/** The date a policy is current from: effective, approved, issued or last updated, nearest to the label */
function effectiveFrom(lines: string[]): string | null {
  const labels = [/effective\s*(date|from|on)?/i, /commencement|commences|in force from|current from/i, /date of approval|approved\s*(on|date)?|board approved|approval date/i, /issued|issue date|date issued/i, /last (updated|reviewed)|version date|revision date|^date\b/i];
  for (const label of labels) {
    for (let i = 0; i < Math.min(lines.length, 200); i++) {
      if (!label.test(lines[i])) continue;
      const ds = datesIn(`${lines[i]} ${lines[i + 1] ?? ""}`);
      if (ds.length) return ds[0];
    }
  }
  return null;
}

async function docxRead(file: File): Promise<{ title: string | null; lines: string[]; text: string }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const out: string[] = [];
  let headingTitle: string | null = null;
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    const text = Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const style = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttribute("w:val") ?? "";
    if (/^title$/i.test(style) && !headingTitle) headingTitle = text;
    // Word headings become sections in VeraPhius
    out.push(/^(heading1|heading 1|title)$/i.test(style) ? `# ${text}` : /^heading\s?[23]$/i.test(style) ? text : text);
  }
  const coreTitle = /<dc:title>([^<]{3,150})<\/dc:title>/.exec(core)?.[1]?.trim() ?? null;
  const plain = out.map((l) => l.replace(/^# /, ""));
  // A first Heading 1 is the document title, not a section
  if (out[0]?.startsWith("# ") && !headingTitle) {
    headingTitle = out[0].slice(2);
    out[0] = out[0].slice(2);
  }
  return { title: headingTitle ?? coreTitle, lines: plain, text: out.join("\n") };
}

export async function readPolicyFile(file: File): Promise<PolicyDoc> {
  const isDocx = /\.docx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  try {
    if (isDocx) {
      const d = await docxRead(file);
      return { title: d.title ?? titleFrom(d.lines, file.name), effectiveOn: effectiveFrom(d.lines), text: d.text.slice(0, 200_000), kind: "docx" };
    }
    if (isPdf) {
      const text = await pdfText(file, 60);
      const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
      return { title: titleFrom(lines, file.name), effectiveOn: effectiveFrom(lines), text: lines.join("\n").slice(0, 200_000), kind: "pdf" };
    }
  } catch {
    // Unreadable: fall through to the file name
  }
  return { title: titleFrom([], file.name), effectiveOn: null, text: "", kind: "other" };
}
