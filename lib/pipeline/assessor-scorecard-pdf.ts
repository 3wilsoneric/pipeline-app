import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadImage, PDFDocument, type CanvasRenderingContext2D, type SKRSContext2D } from "@napi-rs/canvas";
import { scorecardAxisMaximum, scorecardMeasures, scorecardTrend, scorecardValue, sortScorecardPeople, type ScorecardMeasure, type ScorecardSort } from "./assessor-scorecard-presentation";
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
    if (y + wrapped.length * size * 1.5 + 6 > bottom) newPage("Report notes");
    for (const line of wrapped) {
      if (y + size * 1.5 > bottom) newPage("Report notes");
      text(line, left, y, size, false, fill); y += size * 1.5;
    }
    y += 6;
  };
  const groups: AssessorScorecardPerson[][] = [];
  for (let i = 0; i < people.length; i += 5) groups.push(people.slice(i, i + 5));
  const trend = scorecardTrend(snapshot);
  const chart = (group: AssessorScorecardPerson[], measure: ScorecardMeasure, x: number, top: number, w: number) => {
    text(scorecardMeasures[measure], x, top, 12, true);
    const maximum = scorecardAxisMaximum(people.map(person => scorecardValue(person, measure)));
    let row = top + 28;
    for (const person of group) {
      const value = scorecardValue(person, measure);
      const overdue = measure === "assigned" ? person.evidence.overdue.length : 0;
      const label = value === null ? "Not tracked" : `${value.toLocaleString("en-US")}${overdue ? ` / ${overdue} overdue` : ""}`;
      font(value === null ? 8 : 11, true);
      const nameLines = lines(person.name, w - ctx.measureText(label).width - 12, 9, true);
      nameLines.forEach((line, i) => text(line, x, row + i * 12, 9, true));
      font(value === null ? 8 : 11, true);
      text(label, x + w - ctx.measureText(label).width, row, value === null ? 8 : 11, true, value === null ? muted : ink);
      row += nameLines.length * 12 + 5;
      ctx.fillStyle = color("report-blue-soft"); ctx.fillRect(x, row, w, 8);
      if (value !== null && value > 0) {
        const barWidth = w * value / maximum;
        ctx.fillStyle = blue; ctx.fillRect(x, row, barWidth, 8);
        if (measure === "assigned" && person.evidence.overdue.length) {
          const overdueWidth = w * person.evidence.overdue.length / maximum;
          ctx.fillStyle = color("action-edge"); ctx.fillRect(x + barWidth - overdueWidth, row, overdueWidth, 8);
        }
      }
      row += 17;
    }
    text("0", x, row, 8, false, muted);
    const ceiling = maximum.toLocaleString("en-US"); font(8);
    text(ceiling, x + w - ctx.measureText(ceiling).width, row, 8, false, muted);
    return row + 18;
  };
  const pair = (group: AssessorScorecardPerson[], measures: ScorecardMeasure[], top: number) => {
    const gap = 28, w = (width - gap * (measures.length - 1)) / measures.length;
    const height = 46 + group.reduce((sum, person) => sum + lines(person.name, w - 100, 9, true).length * 12 + 22, 0);
    if (top + height > bottom) { newPage(`${pageTitle.replace(/ \(continued\)$/, "")} (continued)`); top = y; }
    return Math.max(...measures.map((measure, i) => chart(group, measure, left + i * (w + gap), top, w)));
  };
  const timeline = (group: AssessorScorecardPerson[], top: number) => {
    const height = 85 + group.reduce((sum, person) => sum + Math.max(24, lines(person.name, 148, 9, true).length * 12 + 6) + 4, 0);
    if (top + height > bottom) { newPage("Assessor work (continued)"); top = y; }
    text("When charts were confirmed", left, top, 13, true);
    text(`${trend.unit} beginning | Pacific time | * Partial period`, left, top + 20, 8, false, muted);
    if (!trend.buckets.length) return top + 42;
    const nameWidth = 160, gap = 4, w = (width - nameWidth) / trend.buckets.length;
    const maximum = Math.max(1, ...trend.buckets.flatMap(bucket => Object.values(bucket.counts)));
    let row = top + 43;
    const headingLines = trend.buckets.map(bucket => lines(`${bucket.label}${bucket.partial ? " *" : ""}`, w - gap, 8));
    headingLines.forEach((labels, i) => labels.forEach((label, n) => text(label, left + nameWidth + i * w, row + n * 11, 8, false, muted)));
    row += Math.max(...headingLines.map(labels => labels.length)) * 11 + 8;
    for (const person of group) {
      const names = lines(person.name, nameWidth - 12, 9, true);
      const h = Math.max(24, names.length * 12 + 6);
      names.forEach((label, n) => text(label, left, row + 5 + n * 12, 9, true));
      trend.buckets.forEach((bucket, i) => {
        const value = bucket.counts[person.id] ?? 0, tone = value === 0 ? 0 : Math.ceil(4 * value / maximum);
        ctx.fillStyle = tone === 4 ? blue : color(`report-heat-${tone}`);
        ctx.fillRect(left + nameWidth + i * w, row, w - gap, h);
        const valueLabel = String(value); font(10, true);
        text(valueLabel, left + nameWidth + i * w + (w - gap - ctx.measureText(valueLabel).width) / 2, row + (h - 10) / 2, 10, true, tone === 4 ? color("on-fill") : ink);
      });
      row += h + 4;
    }
    if (trend.undated) { text(`${trend.undated} undated confirmations are included in totals, outside this timeline.`, left, row + 5, 8, false, muted); row += 20; }
    return row;
  };

  if (!people.length) { newPage("Assessor work"); paragraph("No assessor records in this period.", 12, ink); }
  for (const group of groups) {
    newPage("Assessor work");
    y = pair(group, ["confirmed", "clients", "handoffs"], y);
    y = timeline(group, y + 24);
  }
  for (const group of groups) {
    newPage("Current follow-through");
    paragraph(`Assignments and completion items as of ${date(snapshot.through)}. Gaps include admitted clients; they are not a quality grade.`);
    y = pair(group, ["assigned", "gaps"], y);
    text("Overdue assignments are shown in orange within the assigned total.", left, y, 8, false, muted); y += 24;
    y = pair(group, ["fields", "uploads"], y);
  }
  for (const group of groups) {
    newPage("Activity detail");
    paragraph(snapshot.usageSince ? `Usage tracking began ${date(snapshot.usageSince)}. Earlier clicks and active minutes are unavailable.` : "Historical clicks and active minutes are unavailable. Tracking starts when this release is enabled.");
    y = pair(group, ["interactions", "activeMinutes"], y);
    y = pair(group, ["resends", "sendIssues"], y + 24);
  }
  newPage("Reading the scorecard");
  paragraph(snapshot.usageSince ? `Usage tracking began ${date(snapshot.usageSince)}. Earlier clicks and active minutes are unavailable.` : "Historical clicks and active minutes are unavailable. Tracking starts when this release is enabled.", 11, ink);
  if (snapshot.unattributedEvents || snapshot.unassignedWorkspaces || snapshot.unassignedGapItems) paragraph(`${snapshot.unattributedEvents} unlinked audit events | ${snapshot.unassignedWorkspaces} unassigned workspaces | ${snapshot.unassignedGapItems} completion items without a linked owner. These are not credited to an assessor.`, 10, ink);
  for (const person of people) {
    paragraph(`${person.name}: ${person.activeDays} days with recorded work; ${person.evidence.interviews.length} explicit interviews finished. Interview interval: ${person.interviewSpanHours === null ? "not available" : `${person.interviewSpanHours.toFixed(1)} hours (${person.interviewSpanSamples} interviews)`}.${person.active ? "" : " Inactive account."}`, 9, ink);
  }
  y += 12;
  paragraph("Counting rules", 12, ink);
  paragraph("Charts confirmed are the primary completion measure. Separate interview-finished events are not available for every completed assessment; absence of that event does not mean no interview occurred.");
  paragraph("Completions count the first interview finish or chart confirmation per assessment, including denied cases. Later reconfirmations add no credit. Credit follows the person who recorded the action, not today's owner.");
  paragraph("Clients worked are distinct workspaces with a recorded contribution. Fields are counted once per assessor and assessment. Handoffs count accepted sends, not confirmed recipient delivery; retries and additional sends are separate.");
  paragraph("Current assignments and gaps use Home and completion-memo rules. Gaps may depend on other teams. Clicks and active minutes are approximate foreground usage, not work hours or an assessment of quality. No overall performance grade is calculated.");
  paragraph("Scope: genuine Pipeline workspaces since launch; historical imports, trash, demo sessions and recorded God mode actions are excluded. Notes have no complete author history and do not contribute totals. Open the scorecard in Pipeline for client-level evidence.");
  pdf.endPage();
  return pdf.close();
}
