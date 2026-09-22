"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import { emptyMeetClientMessage, meetClientBodyLimit, meetClientSubjectLimit, type MeetClientMessage } from "@/lib/notifications/meet-client-message";
import type { HandoffRecipients } from "./useHandoffRecipients";
import styles from "./MeetClientEmailPage.module.css";

export default function MeetClientMessageEditor({ summary, preview, preparedBy, attachments, draft, admissionDate, disabled, demo = false }: {
  summary?: MeetClientSummary;
  preview: { subject: string; html: string; text?: string } | null;
  preparedBy: string;
  attachments: string[];
  draft?: HandoffRecipients;
  admissionDate: string;
  disabled: boolean;
  demo?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const content = draft?.fields.message ?? emptyMeetClientMessage();
  const rendered = summary ? renderMeetClientEmail(summary, preparedBy, "Preview — assigned when sent", attachments, content, { demo, logoUrl: toPipelinePath("/brand/alamo-health-management.png") }) : preview;
  const editableText = summary ? renderMeetClientEmail(summary, preparedBy, "Preview", [], content).text : preview?.text;
  const editable = Boolean(draft?.editable) && !disabled;
  const change = (patch: Partial<MeetClientMessage>) => { draft?.changeMessage({ ...content, ...patch }); };
  const flush = () => { void draft?.flush().catch(() => undefined); };
  const renderBody = () => editing ? <label className={styles.messageEditor}><span>Message</span><textarea aria-label="Meet the Client message" rows={18} maxLength={meetClientBodyLimit}
    value={content.body ?? editableText ?? ""} readOnly={!editable} onChange={(event) => change({ body: event.target.value })} onBlur={flush} /></label>
    : rendered ? <iframe title="Meet the Client email preview" srcDoc={rendered.html} sandbox="" referrerPolicy="no-referrer" className={styles.emailFrame} />
      : <div className={styles.emptyPreview}><Mail size={30} /><h3>Your email preview will appear here</h3><p>You can edit the message and review files and recipients now. The summary is prepared from your signed assessment.</p></div>;
  const renderEnvelope = () => <>
    <div className={styles.addressRow}>
      <label htmlFor="meet-client-subject">Subject</label>
      <input id="meet-client-subject" className={styles.subjectInput} value={content.subject ?? rendered?.subject ?? "Meet the Client"} maxLength={meetClientSubjectLimit} readOnly={!editable || !editing}
        onChange={(event) => change({ subject: event.target.value })} onBlur={flush} />
    </div>
    <div className={styles.addressRow}><span>Admission</span><span>{admissionDate || "Add the planned admission date in Decision before sending."}</span></div>
    {editable ? <div className={styles.messageTools}>
      <button type="button" className={styles.textButton} onClick={() => { flush(); setEditing(!editing); }}>{editing ? "Back to email preview" : "Edit message"}</button>
      {editing ? <span>Client details stay linked to the assessment.</span> : null}
    </div> : null}
  </>;
  return <>
    {renderEnvelope()}
    <div className={styles.messageBody}>
      {renderBody()}
    </div>
  </>;
}
