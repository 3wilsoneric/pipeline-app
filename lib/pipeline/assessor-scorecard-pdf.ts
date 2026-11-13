import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadImage, PDFDocument, type CanvasRenderingContext2D, type SKRSContext2D } from "@napi-rs/canvas";
import { sortScorecardPeople, type ScorecardSort } from "./assessor-scorecard-presentation";
import type { AssessorScorecard } from "./assessor-scorecard-types";

type Context = CanvasRenderingContext2D & Pick<SKRSContext2D, "drawImage">;
type Cell = { value: string; note?: string; blue?: boolean; warm?: boolean };
const date = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

// Reuse Pipeline's installed, embedded-font PDF engine and the report palette.
// This is a summary export: client-level evidence stays behind the signed-in drill-down.
export async function renderAssessorScorecardPdf(snapshot: AssessorScorecard, sort: ScorecardSort): Promise<Buffer> {
  const [tokens, logo] = await Promise.all([
    readFile(join(process.cwd(), "app/design-tokens.css"), "utf8"),
    loadImage(join(process.cwd(), "public/brand/alamo-health-management.png")),
  ]);
  const color = (name: string) => {
    const value = tokens.match(new RegExp(`--color-${name}:\\s*([^;]+);`))?.[1]?.trim();
    if (!value) throw new Error("Report design token unavailable");
    return value;
  };
  const ink = color("report-ink"), muted = color("report-muted"), blue = color("report-blue"), rule = color("report-rule");
  const pdf = new PDFDocument({ title: "Pipeline assessor scorecard", author: "Alamo Health Management", creator: "Pipeline" });
  const people = sortScorecardPeople(snapshot.people, sort);
  const left = 38, width = 716, bottom = 552;
  const period = `${date(snapshot.since)} - ${date(snapshot.through)}`;
  let ctx: Context, y = 0, page = 0;
  const font = (size: number, bold = false) => { ctx.font = `${bold ? "bold " : ""}${size}px "Noto Sans", Arial, sans-serif`; ctx.textBaseline = "top"; };
  const text = (value: string, x: number, top: number, size: number, bold = false, fill = ink) => {
    font(size, bold); ctx.fillStyle = fill; ctx.fillText(value, x, top);
  };
  const lines = (value: string, available: number, size: number, bold = false) => {
    font(size, bold);
    const result: string[] = [];
    for (const paragraph of value.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (ctx.measureText(line ? `${line} ${word}` : word).width <= available) { line = line ? `${line} ${word}` : word; continue; }
        if (line) result.push(line);
        line = "";
        for (const char of word) {
          if (line && ctx.measureText(line + char).width > available) { result.push(line); line = ""; }
          line += char;
        }
      }
      result.push(line);
    }
    return result;
  };
  const newPage = (title: string) => {
    if (page) pdf.endPage();
    ctx = pdf.beginPage(792, 612) as Context; page++;
    ctx.fillStyle = color("on-fill"); ctx.fillRect(0, 0, 792, 612);
    ctx.drawImage(logo, left, 24, 145, 145 * logo.height / logo.width);
    text("PIPELINE  /  ASSESSOR SCORECARD", 468, 28, 9, true, blue);
    text(period, 468, 44, 9, false, muted);
    text(title, left, 75, 24, true);
    ctx.fillStyle = rule; ctx.fillRect(left, 572, width, 1);
    text("Confidential staff report  |  Source: Pipeline audit history and current workspace records", left, 583, 8, false, muted);
    text(`Page ${page}`, 714, 583, 8, false, muted);
    y = 114;
  };
  const paragraph = (value: string, size = 9, fill = muted) => {
    const wrapped = lines(value, width, size);
    if (y + wrapped.length * size * 1.5 + 6 > bottom) newPage("Report notes");
    for (const line of wrapped) {
      if (y + size * 1.5 > bottom) newPage("Report notes");
      text(line, left, y, size, false, fill); y += size * 1.5;
    }
    y += 6;
  };
  const table = (title: string, headers: string[], widths: number[], rows: Cell[][]) => {
    const header = () => {
      const wrapped = headers.map((label, i) => lines(label, widths[i] - 20, 9, true));
      const height = Math.max(...wrapped.map(item => item.length)) * 12 + 16;
      ctx.fillStyle = blue; ctx.fillRect(left, y, width, height);
      let x = left;
      wrapped.forEach((items, i) => { items.forEach((line, j) => text(line, x + 10, y + 8 + j * 12, 9, true, color("on-fill"))); x += widths[i]; });
      y += height;
    };
    header();
    for (const row of rows) {
      const wrapped = row.map((cell, i) => ({ value: lines(cell.value, widths[i] - 20, i ? 13 : 10, true), note: cell.note ? lines(cell.note, widths[i] - 20, 8) : [] }));
      const height = Math.max(36, ...wrapped.map((item, i) => item.value.length * (i ? 17 : 14) + item.note.length * 11 + 12));
      if (y + height > bottom) { newPage(`${title} (continued)`); header(); }
      let x = left;
      row.forEach((cell, i) => {
        ctx.fillStyle = cell.warm ? color("task-peach") : color("report-paper"); ctx.fillRect(x, y, widths[i], height);
        const item = wrapped[i], lineHeight = i ? 17 : 14;
        item.value.forEach((line, j) => text(line, x + 10, y + 6 + j * lineHeight, i ? 13 : 10, true, cell.blue ? blue : ink));
        item.note.forEach((line, j) => text(line, x + 10, y + 6 + item.value.length * lineHeight + j * 11, 8, false, muted));
        x += widths[i];
      });
      ctx.fillStyle = rule; ctx.fillRect(left, y + height - .5, width, .5); y += height;
    }
    y += 16;
  };

  newPage("Assessor work & follow-through");
  paragraph(`Activity: ${period}, Pacific time. Assignments and completion items are current as of this export.`, 9);
  table("Assessor work & follow-through", ["Assessor", "Interviews finished", "Clients worked", "Handoffs sent", "Assigned now", "Open completion items", "Clicks / taps"], [206, 85, 85, 85, 85, 85, 85], people.map(person => [
    { value: person.name, note: `${person.activeDays} days with recorded work${person.active ? "" : " | Inactive account"}` },
    { value: String(person.evidence.interviews.length), note: `${person.evidence.confirmed.length} confirmed`, blue: true },
    { value: String(person.evidence.clients.length), blue: true }, { value: String(person.evidence.handoffs.length), blue: true },
    { value: String(person.evidence.assigned.length), blue: true, warm: true }, { value: String(person.evidence.gaps.length), blue: true, warm: true },
    { value: person.usage ? person.usage.interactions.toLocaleString("en-US") : "-", note: person.usage ? `${person.usage.activeMinutes} active min` : "Not tracked" },
  ]));
  if (!people.length) paragraph("No assessor records in this period.", 12, ink);
  newPage("Activity detail");
  table("Activity detail", ["Assessor", "Fields touched", "Files uploaded", "Additional handoffs", "Failed / unknown sends", "Overdue assignments", "Interview interval"], [206, 85, 85, 85, 85, 85, 85], people.map(person => [
    { value: person.name, note: person.usage ? `${person.usage.days} days with tracked interaction` : "Usage not tracked" },
    { value: String(person.evidence.fields.length), blue: true }, { value: String(person.evidence.uploads.length), blue: true },
    { value: String(person.evidence.resends.length), blue: true }, { value: String(person.evidence.sendIssues.length) }, { value: String(person.evidence.overdue.length), warm: true },
    { value: person.interviewSpanHours === null ? "-" : `${person.interviewSpanHours.toFixed(1)} h`, note: person.interviewSpanHours === null ? "Not available" : `${person.interviewSpanSamples} interviews` },
  ]));
  paragraph("Interview interval is the median recorded start-to-finish span. It includes pauses and is not time worked.");
  newPage("Reading the scorecard");
  paragraph(snapshot.usageSince ? `Usage tracking began ${date(snapshot.usageSince)}. Earlier clicks and active minutes are unavailable.` : "Historical clicks and active minutes are unavailable. Tracking starts when this release is enabled.", 11, ink);
  if (snapshot.unattributedEvents || snapshot.unassignedWorkspaces || snapshot.unassignedGapItems) paragraph(`${snapshot.unattributedEvents} unlinked audit events | ${snapshot.unassignedWorkspaces} unassigned workspaces | ${snapshot.unassignedGapItems} completion items without a linked owner. These are not credited to an assessor.`, 10, ink);
  y += 12;
  paragraph("Counting rules", 12, ink);
  paragraph("Charts confirmed appear below interviews finished on the comparison page. These are separate milestones, not additional interviews.");
  paragraph("Completions count the first interview finish or chart confirmation per assessment, including denied cases. Later reconfirmations add no credit. Credit follows the person who recorded the action, not today's owner.");
  paragraph("Clients worked are distinct workspaces with a recorded contribution. Fields are counted once per assessor and assessment. Handoffs count accepted sends, not confirmed recipient delivery; retries and additional sends are separate.");
  paragraph("Current assignments and gaps use Home and completion-memo rules. Gaps may depend on other teams. Clicks and active minutes are approximate foreground usage, not work hours or an assessment of quality. No overall performance grade is calculated.");
  paragraph("Scope: genuine Pipeline workspaces since launch; historical imports, trash, demo sessions and recorded God mode actions are excluded. Notes have no complete author history and do not contribute totals. Open the scorecard in Pipeline for client-level evidence.");
  pdf.endPage();
  return pdf.close();
}
