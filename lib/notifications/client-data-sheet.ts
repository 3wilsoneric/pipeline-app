import { buildAdmissionAgreementSummary, type AssessmentSummaryReport, type AssessmentSummaryItem } from "@/lib/assessment/assessment-summary";
import type { Referral } from "@/lib/pipeline/referral-types";
import { escapeHtml } from "./meet-client-email-template";
import { getPlannedAdmissionDate } from "@/lib/pipeline/admission-lifecycle";

export const clientDataSheetName = "Client data sheet.html";

export function renderClientDataSheet(report: AssessmentSummaryReport | null, referral: Referral) {
  const identity = report?.identity.map((item) => item.label === "Community" && referral.community
    ? { ...item, value: referral.community } : item) ?? [
    { label: "Name", value: referral.name }, { label: "Date of birth", value: referral.dob },
    { label: "Community", value: referral.community }, { label: "Referrer", value: referral.source },
  ];
  const recordStatus = report?.signed ? `Signed ${report.signedAt ?? ""} by ${report.signedBy}` : "Working chart - not signed";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Client data sheet</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f3f5f4;color:#233b32;font:16px/1.6 Georgia,serif}main{max-width:980px;margin:28px auto;padding:38px 44px;background:#fff;border:1px solid #dce3de}header{border-top:4px solid #087d66;padding-top:22px}h1{font:700 30px/1.2 sans-serif;margin:6px 0}h2{font:650 19px/1.3 sans-serif;border-bottom:1px solid #d4ded8;padding-bottom:10px;margin:30px 0 16px}.eyebrow,dt,footer{font-family:sans-serif}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#087d66}dl{margin:0;display:grid;gap:18px 32px;grid-template-columns:1fr 1fr}dl>div{break-inside:avoid;min-width:0}dt{font-size:13px;font-weight:650;color:#607168}dd{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:32px;border-top:1px solid #d4ded8;padding-top:16px;font-size:12px;color:#607168}@media(max-width:600px){main{margin:0;padding:24px 18px;border:0}dl{grid-template-columns:1fr}}@media print{body{background:#fff}main{margin:0;border:0;padding:0;max-width:none}h2{break-after:avoid}header{border-color:#087d66}@page{size:letter;margin:.65in}}
    </style></head><body><main><header><div class="eyebrow">Alamo Health Management / Clinical handoff</div><h1>${escapeHtml(referral.name)}</h1><p>Client data sheet · ${escapeHtml(recordStatus)}</p></header>
    ${section("Client & referral", identity)}${section("Admission", admissionItems(referral))}
    ${report ? report.sections.map((item) => section(item.title, item.items)).join("") : section("Intake notes", [{ label: "Summary", value: referral.note || "Not recorded" }, { label: "Medications", value: referral.currentMedications || "Not recorded" }])}
    <footer>${report ? `Assessment ${escapeHtml(report.assessmentId)} · Version ${report.assessmentVersion}. ` : "Assessment not yet recorded. "}Referral version ${referral.version}. Snapshot only; later chart changes are not reflected in this copy.<br>Confidential client information. For authorized care coordination only.</footer></main></body></html>`;
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

function section(title: string, items: AssessmentSummaryItem[]) {
  return `<section><h2>${escapeHtml(title)}</h2><dl>${items.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value || "Not recorded")}</dd></div>`).join("")}</dl></section>`;
}
