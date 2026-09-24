import "server-only";
import { join } from "node:path";
import { loadImage, PDFDocument, type CanvasRenderingContext2D, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { buildAdmissionAgreementSummary, type AssessmentSummaryReport, type AssessmentSummaryItem } from "@/lib/assessment/assessment-summary";
import type { Referral } from "@/lib/pipeline/referral-types";
import { getPlannedAdmissionDate } from "@/lib/pipeline/admission-lifecycle";

export const clientDataSheetName = "Client data sheet.pdf";

// Embed the shipped brand asset so the logo also appears offline and in print.
let alamoLogo: Promise<Image> | undefined;
// Native PDF pages support drawImage, omitted by the package's base context type.
type PdfPageContext = CanvasRenderingContext2D & Pick<SKRSContext2D, "drawImage">;

// Use the existing server canvas PDF writer. Text remains selectable and fonts
// are embedded; the runtime image supplies Noto Sans instead of a browser.
export async function renderClientDataSheet(report: AssessmentSummaryReport | null, referral: Referral): Promise<Buffer> {
  const logo = await (alamoLogo ??= loadImage(join(process.cwd(), "public/brand/alamo-health-management.png")));
  const identity = report?.identity.map((item) => item.label === "Community" && referral.community
    ? { ...item, value: referral.community } : item) ?? [
    { label: "Name", value: referral.name }, { label: "Date of birth", value: referral.dob },
    { label: "Community", value: referral.community }, { label: "Referrer", value: referral.source },
  ];
  const sheet = new DataSheet(referral.name, logo);
  sheet.text(report?.signed ? `Signed ${report.signedAt ?? ""} by ${report.signedBy}` : "Working chart - not signed", 10, false, "#596d64");
  sheet.section("Client & referral", identity);
  sheet.section("Admission", admissionItems(referral));
  const sections = report?.sections ?? [{ title: "Intake notes", items: [
    { label: "Summary", value: referral.note || "Not recorded" },
    { label: "Medications", value: referral.currentMedications || "Not recorded" },
  ] }];
  for (const section of sections) sheet.section(section.title, section.items);
  sheet.section("About this copy", [{ label: "Source record", value:
    `${report ? `Assessment ${report.assessmentId} - Version ${report.assessmentVersion}.` : "Assessment not yet recorded."} Referral version ${referral.version}. Snapshot only; later chart changes are not reflected in this copy.` }]);
  return sheet.close();
}

function admissionItems(referral: Referral): AssessmentSummaryItem[] {
  return [
    buildAdmissionAgreementSummary(referral.requirements),
    { label: "Admission date", value: getPlannedAdmissionDate(referral) || "Not recorded" },
    { label: "County", value: referral.county || "Not recorded" },
    { label: "Contact", value: [referral.phone, referral.email].filter(Boolean).join(" / ") || "Not recorded" },
    { label: "Coverage / payer", value: referral.payer || "Not recorded" },
  ];
}

class DataSheet {
  private readonly pdf = new PDFDocument({ title: "Client data sheet", author: "Alamo Health Management", creator: "Alamo Health Management" });
  private ctx!: PdfPageContext;
  private y = 0;
  private page = 0;
  private readonly left = 44;
  private readonly width = 524;
  private readonly bottom = 714;

  constructor(private readonly name: string, private readonly logo: Image) { this.newPage(); }

  private font(size: number, bold: boolean) {
    this.ctx.font = `${bold ? "bold " : ""}${size}px "Noto Sans", Arial, sans-serif`;
    this.ctx.textBaseline = "top";
  }

  private newPage() {
    if (this.page) this.pdf.endPage();
    this.ctx = this.pdf.beginPage(612, 792) as PdfPageContext;
    this.page++;
    this.ctx.fillStyle = "#087d66";
    this.ctx.fillRect(this.left, 36, this.width, 3);
    this.y = 50;
    if (this.page === 1) {
      const logoWidth = 210;
      const logoHeight = logoWidth * this.logo.height / this.logo.width;
      this.ctx.drawImage(this.logo, this.left, 46, logoWidth, logoHeight);
      this.y = 46 + logoHeight + 12;
    }
    this.text("Client data sheet", 12, true);
    this.font(this.page === 1 ? 23 : 14, true);
    const nameLines = wrapText(this.ctx, this.name || "Name not recorded", this.width);
    this.ctx.fillStyle = "#233b32";
    // Bound the repeated header; the identity section retains the full name.
    for (const line of nameLines.slice(0, 2)) {
      this.ctx.fillText(line, this.left, this.y);
      this.y += this.page === 1 ? 34.5 : 21;
    }
    this.y += 10;
    this.ctx.fillStyle = "#d4ded8";
    this.ctx.fillRect(this.left, 739, this.width, 1);
    this.font(8, false);
    this.ctx.fillStyle = "#596d64";
    this.ctx.fillText("Confidential client information. For authorized care coordination only.", this.left, 750);
    const page = `Page ${this.page}`;
    this.ctx.fillText(page, 568 - this.ctx.measureText(page).width, 765);
  }

  private room(height: number) { if (this.y + height > this.bottom) this.newPage(); }

  text(value: string, size = 11, bold = false, color = "#233b32") {
    this.font(size, bold);
    const lines = wrapText(this.ctx, String(value), this.width);
    for (const line of lines) {
      this.room(size * 1.5);
      this.font(size, bold);
      this.ctx.fillStyle = color;
      this.ctx.fillText(line, this.left, this.y);
      this.y += size * 1.5;
    }
  }

  section(title: string, items: AssessmentSummaryItem[]) {
    this.room(92);
    this.y += 16;
    this.text(title, 14, true, "#087d66");
    this.ctx.fillStyle = "#d4ded8";
    this.ctx.fillRect(this.left, this.y + 3, this.width, 1);
    this.y += 16;
    for (const item of items) {
      this.font(10, true);
      // Keep the label and first value line together; long notes flow across pages.
      this.room(wrapText(this.ctx, item.label, this.width).length * 15 + 17);
      this.text(item.label, 10, true, "#596d64");
      this.text(item.value || "Not recorded");
      this.y += 10;
    }
  }

  close() { this.pdf.endPage(); return this.pdf.close(); }
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width) { line = next; continue; }
      if (line) lines.push(line);
      line = "";
      // Long unbroken identifiers and pasted URLs must not run off the page.
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}
