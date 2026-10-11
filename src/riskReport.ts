import type { Category, Contact, Item, Request, Review } from "./risk";

const FONT = "Arial";
const SIZE = 10;
const HEADINGS = ["Incident or update", "Action, control or mitigation", "Actioner", "Due", "Status"];
const COLUMNS = [4.6, 3.6, 1.5, 1.1, 1.5];
const TABLE_TOP = 1.3;
// Room for the table between its top and the footer, in inches
const TABLE_ROOM = 5.5;
const LINE = 0.165;
// A cautious count of 10 point Arial characters per inch, so rows are never under-measured
const CHARS_PER_INCH = 15;

function rowHeight(row: string[]) {
  const lines = row.map((text, col) => text.split("\n").reduce((n, part) => n + Math.max(1, Math.ceil(part.length / ((COLUMNS[col] - 0.2) * CHARS_PER_INCH))), 0));
  return Math.max(...lines) * LINE + 0.1;
}

/** Splits a category's rows into slides so no table runs off the bottom. */
export function paginate(rows: string[][]): string[][][] {
  const pages: string[][][] = [[]];
  let used = LINE + 0.12;
  for (const row of rows) {
    const h = rowHeight(row);
    if (used + h > TABLE_ROOM && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = LINE + 0.12;
    }
    pages[pages.length - 1].push(row);
    used += h;
  }
  return pages;
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

/**
 * Builds the risk report as a PowerPoint file: a title slide, then one slide per risk category in 10 point Arial.
 * A category whose table does not fit runs on to further slides.
 */
export async function downloadRiskReport(organisation: string, review: Review, categories: Category[], contacts: Contact[], requests: Request[], items: Item[]) {
  const { default: Pptx } = await import("pptxgenjs");
  const pptx = new Pptx();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${review.name} - risk report`;
  pptx.company = organisation;
  pptx.defineSlideMaster({
    title: "RISK",
    background: { color: "FFFFFF" },
    objects: [{ text: { text: `${organisation} · ${review.name} · ${review.status === "final" ? "Final" : "Draft"}`, options: { x: 0.5, y: 7.05, w: 10, h: 0.3, fontFace: FONT, fontSize: 8, color: "666666" } } }],
    slideNumber: { x: 12.3, y: 7.05, fontFace: FONT, fontSize: 8, color: "666666" },
  });

  const cover = pptx.addSlide({ masterName: "RISK" });
  cover.addText("Risk report", { x: 0.5, y: 2.3, w: 12.3, h: 0.5, fontFace: FONT, fontSize: 14, color: "666666" });
  cover.addText(review.name, { x: 0.5, y: 2.8, w: 12.3, h: 0.9, fontFace: FONT, fontSize: 32, bold: true, color: "10231F" });
  cover.addText(`${organisation}${review.forum ? ` · ${review.forum}` : ""} · ${day(review.forum_on)}`, { x: 0.5, y: 3.8, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 14, color: "10231F" });

  const inReview = categories.filter((c) => requests.some((q) => q.review_id === review.id && q.category_id === c.id));
  const cell = (text: string, bold = false) => ({ text, options: { fontFace: FONT, fontSize: SIZE, bold, color: "10231F", valign: "top" as const } });
  const head = (text: string) => ({ text, options: { fontFace: FONT, fontSize: SIZE, bold: true, color: "FFFFFF", fill: { color: "10231F" } } });

  inReview.forEach((c, n) => {
    const request = requests.find((q) => q.review_id === review.id && q.category_id === c.id)!;
    const rows = items.filter((i) => i.review_id === review.id && i.category_id === c.id);
    const responsible = contacts.filter((k) => k.category_id === c.id && k.role === "responsible").map((k) => k.name);
    const texts = rows.map((i) => [
      `${i.title}${i.detail ? `\n${i.detail}` : ""}`,
      i.action,
      i.actioner ?? "Not assigned",
      i.due_on ? day(i.due_on) : "No date",
      i.is_closed ? `Resolved${i.resolution ? `: ${i.resolution}` : ""}` : i.carried_from_id ? "Open, carried forward" : "Open",
    ]);
    // One category per slide; a category that does not fit runs on to further slides under the same heading
    const pages = rows.length === 0 ? [[]] : paginate(texts);
    pages.forEach((page, k) => {
      const slide = pptx.addSlide({ masterName: "RISK" });
      slide.addText(`${n + 1}. ${c.name}${k > 0 ? " (continued)" : ""}`, { x: 0.5, y: 0.35, w: 12.3, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: "10231F" });
      slide.addText(
        `Responsible: ${responsible.join(", ") || "not assigned"}${request.submitted_at ? ` · input from ${request.submitted_by ?? "the responsible person"}, ${day(request.submitted_at)}` : " · NO RESPONSE RECEIVED"}${pages.length > 1 ? ` · page ${k + 1} of ${pages.length}` : ""}`,
        { x: 0.5, y: 0.85, w: 12.3, h: 0.3, fontFace: FONT, fontSize: SIZE, color: request.submitted_at ? "666666" : "8F2F1B" },
      );
      if (page.length === 0) {
        slide.addText(request.submitted_at ? "Nothing to report this period." : "No input was received for this category. It should not be read as nothing to report.", {
          x: 0.5,
          y: 1.4,
          w: 12.3,
          h: 0.4,
          fontFace: FONT,
          fontSize: SIZE,
          color: "10231F",
        });
        return;
      }
      slide.addTable([HEADINGS.map(head), ...page.map((row) => row.map((t) => cell(t)))], {
        x: 0.5,
        y: TABLE_TOP,
        w: 12.3,
        colW: COLUMNS,
        border: { type: "solid", pt: 0.5, color: "BBBBBB" },
        fontFace: FONT,
        fontSize: SIZE,
      });
    });
  });

  await pptx.writeFile({ fileName: `${review.name.replace(/[^A-Za-z0-9 _-]/g, "")} risk report.pptx` });
}
