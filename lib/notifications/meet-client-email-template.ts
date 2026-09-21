import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import type { MeetClientMessage } from "./meet-client-message";

export function renderMeetClientEmail(
  summary: MeetClientSummary,
  preparedBy: string,
  deliveryId: string,
  attachmentNames: string[] = [],
  message?: MeetClientMessage,
) {
  const subject = message?.subject ?? `Meet the Client | ${summary.community || "New admission"}`;
  const content = meetClientContent(summary, attachmentNames, message?.body);
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:600px){.email-sheet{padding:24px 16px!important}.email-table td{display:block!important;width:auto!important}.email-table td:first-child{border:0!important;padding:14px 0 2px!important}.email-table td:last-child{padding:0 0 14px!important}}</style></head><body style="margin:0;background:#fff;color:#243b32;font-family:Arial,sans-serif;font-size:17px;line-height:1.65;overflow-wrap:anywhere"><div class="email-sheet" style="max-width:1100px;margin:0 auto;padding:32px;box-sizing:border-box"><div style="border-top:3px solid #0f8b73;padding-top:24px"><div style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#08745d;text-transform:uppercase">Pipeline</div><h1 style="margin:8px 0 24px;font-size:30px;line-height:1.2">Meet the Client</h1>${content.html}<div style="margin-top:32px;border-top:1px solid #d9dfdb;padding-top:18px;font-size:13px;line-height:1.6;color:#59665f">${content.edited ? "Sender-edited handoff based on" : "Prepared from"} signed Pipeline assessment ${escapeHtml(summary.preparedFromAssessmentId)} version ${summary.preparedFromAssessmentVersion} by ${escapeHtml(preparedBy)}.<br>Agreement status and coordination details come from the referral record; signing an assessment does not sign the admission agreement.<br>Confidential: contains protected health information. Use only for authorized care coordination. Delivery ${escapeHtml(deliveryId)}.</div></div></div></body></html>`;
  return { subject, html, text: content.text };
}

function meetClientContent(summary: MeetClientSummary, attachmentNames: string[], body?: string | null) {
  const identityRows = [
    ["Name", summary.name],
    ["Date of birth", summary.dateOfBirth],
    ["Community", summary.community],
    ["Admission date", summary.admissionDate],
    ["Assessment date", summary.assessmentDate],
  ];
  if (body != null) return {
    html: `${table(identityRows)}<div style="white-space:pre-wrap">${escapeHtml(body)}</div>${emailSection("Admission packet", attachmentNames)}`,
    text: body, edited: true,
  };
  return { html: defaultMeetClientContent(summary, identityRows, attachmentNames), text: meetClientMessageText(summary), edited: false };
}

function defaultMeetClientContent(summary: MeetClientSummary, identityRows: string[][], attachmentNames: string[]) {
  const medicationRows = [{ label: "Recorded medications", value: summary.medications.length ? summary.medications.join("\n") : "Not recorded; confirm the medication list with the referring team." }, ...summary.medicationNotes];
  return `${admissionIntroduction(summary)}${table(identityRows)}${emailItemSection("Admission & coordination", summary.admissionNotes ?? [])}${emailSection("Meet the client", summary.bio)}${emailItemSection("Med room", medicationRows)}${emailItemSection("Behavior & safety", summary.safetyNotes ?? [])}${emailItemSection("Allergies & diet", summary.dietaryNotes ?? [])}${emailItemSection("Billing team", summary.billingNotes ?? [])}${emailItemSection("Support snapshot", summary.supportSnapshot)}${emailSection("Admission packet", attachmentNames)}`;
}

function meetClientMessageText(summary: MeetClientSummary) {
  const items = (title: string, values: Array<{ label: string; value: string }>) => values.length
    ? `${title}\n${values.map(({ label, value }) => `${label}: ${value}`).join("\n")}` : "";
  return [
    "Hello team,\n\nPlease review the handoff details below and the attached records.",
    items("Admission & coordination", summary.admissionNotes ?? []),
    summary.bio.length ? `Meet the client\n${summary.bio.join("\n")}` : "",
    items("Med room", [{ label: "Recorded medications", value: summary.medications.join("\n") || "Not recorded; confirm the medication list with the referring team." }, ...summary.medicationNotes]),
    items("Behavior & safety", summary.safetyNotes ?? []),
    items("Allergies & diet", summary.dietaryNotes ?? []),
    items("Billing team", summary.billingNotes ?? []),
    items("Support snapshot", summary.supportSnapshot),
  ].filter(Boolean).join("\n\n");
}
function admissionIntroduction(summary: MeetClientSummary) {
  const arrival = summary.admissionDate ? `scheduled for admission on ${summary.admissionDate}` : "being prepared for admission (date to be confirmed)";
  return `<p>Hello team,</p><p>Attached are the chart documents and client data sheet for <strong>${escapeHtml(summary.name)}</strong>, ${escapeHtml(arrival)}${summary.community ? ` at ${escapeHtml(summary.community)}` : ""}.</p><p>Please review the handoff details below and the attached records. Unrecorded information is marked for confirmation, not assumed.</p>`;
}

function table(rows: string[][]) {
  return `<table class="email-table" role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:28px;table-layout:fixed">${rows.filter(([, value]) => value).map(([label, value]) => `<tr><td style="width:26%;vertical-align:top;border-bottom:1px solid #e4e8e5;padding:13px 20px 13px 0;font-size:14px;font-weight:600;color:#59665f">${escapeHtml(label)}</td><td style="vertical-align:top;border-bottom:1px solid #e4e8e5;padding:13px 0;font-size:17px;font-weight:600">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function emailSection(title: string, values: string[]) {
  if (values.length === 0) return "";
  return `<h2 style="margin:30px 0 12px;font-size:21px;line-height:1.3">${escapeHtml(title)}</h2><ul style="margin:0;padding-left:22px;font-size:17px;line-height:1.7">${values.map((value) => `<li style="margin-bottom:10px">${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function emailItemSection(title: string, values: Array<{ label: string; value: string }>) {
  if (values.length === 0) return "";
  return `<h2 style="margin:30px 0 12px;font-size:21px;line-height:1.3">${escapeHtml(title)}</h2>${table(values.map((value) => [value.label, value.value]))}`;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character).replace(/\n/g, "<br>");
}
