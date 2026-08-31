import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";

export function renderMeetClientEmail(summary: MeetClientSummary, preparedBy: string, deliveryId: string) {
  const subject = `Meet the Client | ${summary.community || "New admission"}`;
  const identityRows = [
    ["Name", summary.name],
    ["Date of birth", summary.dateOfBirth],
    ["Community", summary.community],
    ["Assessment date", summary.assessmentDate],
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f5;color:#1d2421;font-family:Arial,sans-serif"><div style="max-width:720px;margin:0 auto;padding:24px"><div style="border-top:5px solid #0f8b73;background:#fff;padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#0f8b73;text-transform:uppercase">Pipeline</div><h1 style="margin:8px 0 22px;font-size:26px">Meet the Client</h1>${table(identityRows)}${emailSection("A little about the client", summary.bio)}${emailSection("Current medications", summary.medications)}${emailItemSection("Medication notes", summary.medicationNotes)}${emailItemSection("Support snapshot", summary.supportSnapshot)}<div style="margin-top:26px;border-top:1px solid #d9dfdb;padding-top:14px;font-size:11px;line-height:1.5;color:#66706b">Prepared from signed Pipeline assessment ${escapeHtml(summary.preparedFromAssessmentId)} version ${summary.preparedFromAssessmentVersion} by ${escapeHtml(preparedBy)}.<br>Confidential: contains protected health information. Use only for authorized care coordination. Delivery ${escapeHtml(deliveryId)}.</div></div></div></body></html>`;
  return { subject, html };
}
function table(rows: string[][]) {
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:22px">${rows.filter(([, value]) => value).map(([label, value]) => `<tr><td style="width:145px;border-bottom:1px solid #e4e8e5;padding:9px 8px 9px 0;font-size:11px;font-weight:700;color:#66706b;text-transform:uppercase">${escapeHtml(label)}</td><td style="border-bottom:1px solid #e4e8e5;padding:9px 0;font-size:14px;font-weight:700">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function emailSection(title: string, values: string[]) {
  if (values.length === 0) return "";
  return `<h2 style="margin:22px 0 8px;font-size:16px">${escapeHtml(title)}</h2><ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.6">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function emailItemSection(title: string, values: Array<{ label: string; value: string }>) {
  if (values.length === 0) return "";
  return `<h2 style="margin:22px 0 8px;font-size:16px">${escapeHtml(title)}</h2>${table(values.map((value) => [value.label, value.value]))}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character).replace(/\n/g, "<br>");
}
