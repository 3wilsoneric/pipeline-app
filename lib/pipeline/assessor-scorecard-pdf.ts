import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadImage, PDFDocument, type CanvasRenderingContext2D, type SKRSContext2D } from "@napi-rs/canvas";
import { scorecardRecentWindow, scorecardSelection, scorecardPersonColor, scorecardMeasures, scorecardValue, sortScorecardPeople, type ScorecardMeasure, type ScorecardSort } from "./assessor-scorecard-presentation";
import { scorecardNarrative, scorecardNarrativeText } from "./assessor-scorecard-narrative";
import type { AssessorScorecard, AssessorScorecardPerson } from "./assessor-scorecard-types";

type Context = CanvasRenderingContext2D & Pick<SKRSContext2D, "drawImage">;
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
  let ctx: Context, y = 0, page = 0, pageTitle = "";
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
    pageTitle = title;
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
    if (y + wrapped.length * size * 1.4 + 4 > bottom) newPage("Report notes");
    for (const line of wrapped) {
      if (y + size * 1.4 > bottom) newPage("Report notes");
      text(line, left, y, size, false, fill); y += size * 1.4;
    }
    y += 4;
  };
  const groups: AssessorScorecardPerson[][] = [];
  for (let i = 0; i < people.length; i += 5) groups.push(people.slice(i, i + 5));
  const recent = scorecardRecentWindow(snapshot);
  const ledger = (group: AssessorScorecardPerson[], measures: ScorecardMeasure[], top: number) => {
    const nameWidth = 210, column = (width - nameWidth) / measures.length;
    const headerHeight = Math.max(...measures.map(measure => lines(scorecardMeasures[measure], column - 14, 9, true).length)) * 13 + 12;
    const heights = group.map(person => Math.max(34, lines(person.name, nameWidth - 16, 10, true).length * 14 + 14));
    if (top + headerHeight + heights.reduce((a, b) => a + b, 0) > bottom) { newPage(`${pageTitle.replace(/ \(continued\)$/, "")} (continued)`); top = y; }
    measures.forEach((measure, i) => lines(scorecardMeasures[measure], column - 14, 9, true).forEach((line, n) => text(line, left + nameWidth + i * column, top + n * 13, 9, true, muted)));
    let row = top + headerHeight;
    group.forEach((person, i) => {
      ctx.fillStyle = rule; ctx.fillRect(left, row, width, .5);
      lines(person.name, nameWidth - 16, 10, true).forEach((line, n) => text(line, left, row + 10 + n * 14, 10, true));
      measures.forEach((measure, n) => { const value = scorecardValue(person, measure); text(value === null ? "Not tracked" : value.toLocaleString("en-US"), left + nameWidth + n * column, row + 10, value === null ? 9 : 13, true, measure === "overdue" ? color("warning") : blue); });
      row += heights[i];
    });
    return row + 20;
  };
  if (!people.length) { newPage("Assessor work"); paragraph("No assessor records in this period.", 12, ink); }
  for (const person of people) {
    const review = scorecardNarrative(snapshot, person);
    newPage(person.name);
    if (!person.active) paragraph("Inactive account", 10);
    paragraph(review.lead, 15, color(scorecardPersonColor(snapshot.people, person.id)));
    y += 10;
    for (const section of review.paragraphs) { paragraph(scorecardNarrativeText(section), 11, ink); y += 8; }
    paragraph("Follow-up", 11, color("stage-amber"));
    paragraph(review.question, 11, ink);
  }
  for (const group of groups) {
    newPage("Current follow-through");
    paragraph(`Assignments and completion items as of ${date(snapshot.through)}. Gaps include admitted clients; they are not a quality grade.`);
    y = ledger(group, ["assigned", "overdue", "gaps"], y);
    text("Selected period", left, y, 12, true);
    y = ledger(group, ["confirmed", "clients", "handoffs", "fields", "uploads"], y + 24);
  }
  for (const group of groups) {
    newPage("Activity detail");
    paragraph(snapshot.usageSince ? `Usage tracking began ${date(snapshot.usageSince)}. Earlier clicks and active minutes are unavailable.` : "Historical clicks and active minutes are unavailable. Tracking starts when this release is enabled.");
    y = ledger(group, ["interactions", "activeMinutes", "resends", "sendIssues"], y);
  }
  newPage("Reading the scorecard");
  paragraph(snapshot.usageSince ? `Usage tracking began ${date(snapshot.usageSince)}. Earlier clicks and active minutes are unavailable.` : "Historical clicks and active minutes are unavailable. Tracking starts when this release is enabled.", 11, ink);
  if (snapshot.unattributedEvents || snapshot.unassignedWorkspaces || snapshot.unassignedGapItems) paragraph(`${snapshot.unattributedEvents} unlinked audit events | ${snapshot.unassignedWorkspaces} unassigned workspaces | ${snapshot.unassignedGapItems} completion items without a linked owner. These are not credited to an assessor.`, 10, ink);
  for (const person of people) {
    paragraph(`${person.name}: ${person.activeDays} days with recorded work; ${person.evidence.interviews.length} explicit interviews finished. Interview interval: ${person.interviewSpanHours === null ? "not available" : `${person.interviewSpanHours.toFixed(1)} hours (${person.interviewSpanSamples} interviews)`}.${person.active ? "" : " Inactive account."}`, 9, ink);
  }
  paragraph(`Recent activity: ${date(`${recent.start}T12:00:00Z`)} - ${date(snapshot.through)}`, 12, ink);
  for (const person of people) {
    const count = (measure: ScorecardMeasure) => scorecardSelection(person, measure, recent).value;
    paragraph(`${person.name}: ${count("days")} days with recorded work across ${count("clients")} clients; ${count("confirmed")} first confirmations, ${count("handoffs")} first handoffs, ${count("uploads")} uploads. ${person.evidence.assigned.length} assigned now.`, 9, ink);
  }
  y += 12;
  if (y + 90 > bottom) newPage("Report notes");
  paragraph("Counting rules", 12, ink);
  paragraph("Recorded-work days count substantive saved work, not attendance or time worked. Empty autosaves do not count. A client can appear in multiple weeks; weekly client counts must not be added to produce a distinct total.");
  paragraph("Charts confirmed are the primary completion measure. Separate interview-finished events are not available for every completed assessment; absence of that event does not mean no interview occurred.");
  paragraph("Completions count the first interview finish or chart confirmation per assessment, including denied cases. Later reconfirmations add no credit. Credit follows the person who recorded the action, not today's owner.");
  paragraph("Clients worked are distinct workspaces with a recorded contribution. Fields are counted once per assessor and assessment. Handoffs count accepted sends, not confirmed recipient delivery; retries and additional sends are separate.");
  paragraph("Current assignments and gaps use Home and completion-memo rules. Gaps may depend on other teams. Clicks and active minutes are approximate foreground usage, not work hours or an assessment of quality. No overall performance grade is calculated.");
  paragraph("Scope: genuine Pipeline workspaces since launch; historical imports, trash, demo sessions and recorded God mode actions are excluded. Notes have no complete author history and do not contribute totals. Open the scorecard in Pipeline for client-level evidence.");
  pdf.endPage();
  return pdf.close();
}
