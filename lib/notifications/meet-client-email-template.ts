import { formatMeetClientDate, type MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { medicationAttachmentReference } from "@/lib/notifications/meet-client-medications";
import { meetClientSectionOrder, type MeetClientMessage, type MeetClientSectionId } from "@/lib/notifications/meet-client-message";

export function renderMeetClientEmail(
  summary: MeetClientSummary,
  preparedBy: string,
  deliveryId: string,
  attachmentNames: string[] = [],
  message?: MeetClientMessage,
  options: { demo?: boolean; packetUrl?: string; packetLinkPreview?: boolean; logoUrl?: string } = {},
) {
  const subject = `${options.demo ? "[DEMO] " : ""}${message?.subject ?? `Meet the Client | ${summary.community || "New admission"}`}`;

  const linked = Boolean(options.packetUrl || options.packetLinkPreview);
  const content = meetClientContent(summary, linked ? [] : attachmentNames, message);
  if (linked) appendPacketLink(content, attachmentNames.length, options.packetUrl);
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:600px){.email-sheet{padding:24px 16px!important}.email-table td{display:block!important;width:auto!important}.email-table td:first-child{border:0!important;padding:14px 0 2px!important}.email-table td:last-child{padding:0 0 14px!important}}</style></head><body style="margin:0;background:#fff;color:#243b32;font-family:Arial,sans-serif;font-size:17px;line-height:1.65;overflow-wrap:anywhere"><div class="email-sheet" style="max-width:760px;margin:0 auto;padding:32px;box-sizing:border-box"><div style="border-top:3px solid #0f8b73;padding-top:24px">${renderEmailHeader(options)}${content.html}<div style="margin-top:32px;border-top:1px solid #d9dfdb;padding-top:18px;font-size:13px;line-height:1.6;color:#59665f">${content.edited ? "Sender-edited handoff based on" : "Prepared from"} the signed assessment by ${escapeHtml(preparedBy)}.<br>Agreement status and coordination details come from the referral record; signing an assessment does not sign the admission agreement.<br>Confidential: contains protected health information. Use only for authorized care coordination.</div></div></div></body></html>`;
  return { subject, html, text: `${options.demo ? "Not production yet — no email will be sent. This admission packet is a demo.\n\n" : ""}${content.text}` };
}

function renderEmailHeader(options: { demo?: boolean; logoUrl?: string }) {
  const demoNotice = options.demo ? '<p style="padding:14px 16px;border:1px solid #d8c387;border-radius:6px;background:#fff8e6;color:#684f17;font-size:16px;font-weight:700">Not production yet — no email will be sent. This admission packet is a demo.</p>' : "";
  return `<img src="${escapeHtml(options.logoUrl ?? "https://alamo-pipeline.com/brand/alamo-health-management.png")}" alt="Alamo Health Management" width="300" height="80" style="display:block;width:300px;max-width:100%;height:auto;margin:0 0 24px;border:0">${demoNotice}`;
}

export function meetClientIdentityRows(summary: MeetClientSummary) {
  return [
    ["Name", summary.name],
    ["Date of birth", formatMeetClientDate(summary.dateOfBirth)],
    ["Community", summary.community],
    ["Admission date", formatMeetClientDate(summary.admissionDate)],
  ].filter(([, value]) => value);
}

export type MeetClientSection = {
  id: MeetClientSectionId;
  title: string;
} & ({ kind: "items"; items: Array<{ label: string; value: string }> }
  | { kind: "list"; values: string[] }
  | { kind: "message"; text: string });

/** One source for the working page, HTML email, and plain-text email. No sections can be removed by ordering. */
function sourceSections(summary: MeetClientSummary, message?: MeetClientMessage): MeetClientSection[] {
  const sections: MeetClientSection[] = message?.body != null ? [
    { id: "message", title: "Message", kind: "message", text: message.body },
    ...(message.body.includes(medicationAttachmentReference) ? [] : [{ id: "medications" as const, title: "Medications", kind: "list" as const, values: [medicationAttachmentReference] }]),
  ] : [
    { id: "coordination", title: "Admission & coordination", kind: "items", items: summary.admissionNotes ?? [] },
    { id: "bio", title: "Meet the client", kind: "list", values: summary.bio },
    { id: "medications", title: "Med room", kind: "items", items: [{ label: "Medications", value: medicationAttachmentReference }, ...summary.medicationNotes] },
    { id: "safety", title: "Behavior & safety", kind: "items", items: summary.safetyNotes ?? [] },
    { id: "diet", title: "Allergies & diet", kind: "items", items: summary.dietaryNotes ?? [] },
    { id: "billing", title: "Billing team", kind: "items", items: summary.billingNotes ?? [] },
    { id: "support", title: "Support snapshot", kind: "items", items: summary.supportSnapshot },
  ];
  return meetClientSectionOrder(message).flatMap((id) => {
    const section = sections.find((item) => item.id === id);
    return section && (section.kind === "message" || (section.kind === "items" ? section.items.length : section.values.length)) ? [section] : [];
  });
}

export function meetClientSectionText(section: MeetClientSection): string {
  return section.kind === "message" ? section.text : section.kind === "list" ? section.values.join("\n")
    : section.items.map(({ label, value }) => `${label}: ${value}`).join("\n");
}

export function meetClientSourceSections(summary: MeetClientSummary, message?: MeetClientMessage) {
  return sourceSections(summary, { ...message, subject: message?.subject ?? null, body: null });
}

export function meetClientSectionConflicts(summary: MeetClientSummary, message?: MeetClientMessage): MeetClientSectionId[] {
  if (message?.body != null) return [];
  const sources = meetClientSourceSections(summary, message);
  return Object.entries(message?.sectionEdits ?? {}).filter(([id, edit]) => {
    const source = sources.find(section => section.id === id);
    return !source || edit.source !== meetClientSectionText(source);
  }).map(([id]) => id as MeetClientSectionId);
}

export function meetClientSections(summary: MeetClientSummary, message?: MeetClientMessage): MeetClientSection[] {
  const sections = sourceSections(summary, message);
  // Preserve an edit even if its source section disappears; the sender must resolve it.
  if (message?.body == null) for (const id of meetClientSectionOrder(message)) {
    if (message?.sectionEdits?.[id] && !sections.some(section => section.id === id)) {
      const titles: Record<MeetClientSectionId, string> = { bio: "Meet the client", coordination: "Admission & coordination", medications: "Med room", safety: "Behavior & safety", diet: "Allergies & diet", billing: "Billing team", support: "Support snapshot", message: "Message" };
      sections.push({ id, title: titles[id], kind: "message", text: "" });
    }
  }
  return [...sections].sort((a, b) => meetClientSectionOrder(message).indexOf(a.id) - meetClientSectionOrder(message).indexOf(b.id)).map(section => {
    const edit = message?.body == null ? message?.sectionEdits?.[section.id] : undefined;
    if (!edit) return section;
    const text = section.id === "medications" && !edit.text.includes(medicationAttachmentReference)
      ? `${edit.text}\n\n${medicationAttachmentReference}` : edit.text;
    return { id: section.id, title: section.title, kind: "message" as const, text };
  });
}

function meetClientContent(summary: MeetClientSummary, attachmentNames: string[], message?: MeetClientMessage) {
  const customBody = message?.body != null;
  const edited = customBody || Boolean(Object.keys(message?.sectionEdits ?? {}).length);
  const sections = meetClientSections(summary, message);
  const html = sections.map((section, index) => section.kind === "items" ? emailItemSection(section.title, section.items)
    : section.kind === "list" ? emailSection(section.id === "bio" && index === 0 ? "" : section.title, section.values)
    : `${section.id === "message" || (section.id === "bio" && index === 0) ? "" : `<h2 style="margin:30px 0 12px;font-size:21px;line-height:1.3">${escapeHtml(section.title)}</h2>`}<div style="white-space:pre-wrap">${escapeHtml(section.text)}</div>`).join("");
  const text = sections.map((section) => section.kind === "message" ? `${section.id === "message" ? "" : `${section.title}\n`}${section.text}`
    : `${section.title}\n${section.kind === "items" ? section.items.map(({ label, value }) => `${label}: ${value}`).join("\n") : section.values.join("\n")}`).join("\n\n");
  return {
    html: `${customBody ? "" : admissionIntroduction(summary)}<h1 style="margin:8px 0 24px;font-size:30px;line-height:1.2">Meet the Client</h1>${table(meetClientIdentityRows(summary))}${html}${emailSection("Admission packet", attachmentNames)}`,
    text: customBody ? text : `Hello team,\n\nPlease review the handoff details below and the admission packet.\n\n${text}`,
    edited,
  };
}
function admissionIntroduction(summary: MeetClientSummary) {
  const arrival = summary.admissionDate ? `scheduled for admission on ${formatMeetClientDate(summary.admissionDate)}` : "being prepared for admission (date to be confirmed)";
  return `<p>Hello team,</p><p>The admission packet includes the selected documents and client data sheet for <strong>${escapeHtml(summary.name)}</strong>, ${escapeHtml(arrival)}${summary.community ? ` at ${escapeHtml(summary.community)}` : ""}.</p><p>Please review the handoff details below and the admission packet. Unrecorded information is marked for confirmation, not assumed.</p>`;
}

function table(rows: string[][]) {
  return `<table class="email-table" role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:28px;table-layout:fixed">${rows.filter(([, value]) => value).map(([label, value]) => `<tr><td style="width:26%;vertical-align:top;border-bottom:1px solid #e4e8e5;padding:13px 20px 13px 0;font-size:14px;font-weight:600;color:#59665f">${escapeHtml(label)}</td><td style="vertical-align:top;border-bottom:1px solid #e4e8e5;padding:13px 0;font-size:17px;font-weight:600">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function emailSection(title: string, values: string[]) {
  if (values.length === 0) return "";
  return `${title ? `<h2 style="margin:30px 0 12px;font-size:21px;line-height:1.3">${escapeHtml(title)}</h2>` : ""}<ul style="margin:0;padding-left:22px;font-size:17px;line-height:1.7">${values.map((value) => `<li style="margin-bottom:10px">${escapeHtml(value)}</li>`).join("")}</ul>`;
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

function appendPacketLink(content: { html: string; text: string }, fileCount: number, packetUrl?: string) {
  const link = packetUrl ? `<a href="${escapeHtml(packetUrl)}" style="display:inline-block;padding:12px 20px;background:#087d66;color:#fff;border-radius:6px;font-weight:700;text-decoration:none">Open admission packet</a>` : '<strong>Open admission packet — link included in your Outlook draft</strong>';
  content.html += `<section style="margin-top:24px;padding:20px;border:1px solid #cbd6d2;border-radius:6px"><h2 style="margin-top:0">Admission packet · ${fileCount} files</h2><p>All files are included in the secure packet. Verify the email address that received this message with a one-time code. No account is needed.</p>${link}</section>`;
  content.text += `\n\nAdmission packet: ${fileCount} files. Verify your email with a one-time code. ${packetUrl ?? "The secure link is included in your Outlook draft."}`;
}
