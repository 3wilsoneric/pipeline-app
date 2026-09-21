"use client";

import { useState, type ReactNode } from "react";
import { Mail } from "lucide-react";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import { emptyMeetClientMessage, meetClientBodyLimit, meetClientSubjectLimit, type MeetClientMessage } from "@/lib/notifications/meet-client-message";
import type { HandoffRecipients } from "./useHandoffRecipients";
import styles from "./MeetClientEmailPage.module.css";

export default function MeetClientMessageEditor({ summary, preview, preparedBy, attachments, children, draft, admissionDate, disabled, onEdited, demo = false }: {
  summary?: MeetClientSummary;
  preview: { subject: string; html: string; text?: string } | null;
  preparedBy: string;
  attachments: string[];
  children: ReactNode;
  draft?: HandoffRecipients;
  admissionDate: string;
  disabled: boolean;
  onEdited: () => void;
  demo?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const content = draft?.fields.message ?? emptyMeetClientMessage();
  const rendered = summary ? renderMeetClientEmail(summary, preparedBy, "Preview — assigned when sent", attachments, content, { demo }) : preview;
  const editable = Boolean(draft?.editable) && !disabled;
  const change = (patch: Partial<MeetClientMessage>) => { draft?.changeMessage({ ...content, ...patch }); onEdited(); };
  const flush = () => { void draft?.flush().catch(() => undefined); };
  const renderBody = () => editing ? <label className={styles.messageEditor}><span>Message</span><textarea aria-label="Meet the Client message" rows={18} maxLength={meetClientBodyLimit}
    value={content.body ?? rendered?.text ?? ""} readOnly={!editable} onChange={(event) => change({ body: event.target.value })} onBlur={flush} /></label>
    : rendered ? <iframe title="Meet the Client email preview" srcDoc={rendered.html} sandbox="" referrerPolicy="no-referrer" className={styles.emailFrame} />
      : <div className={styles.emptyPreview}><Mail size={30} /><h3>Your email preview will appear here</h3><p>You can edit the message and review files and recipients now. The summary is prepared from your signed assessment.</p></div>;
  return <>
    <div className={styles.addressRow}>
      <label htmlFor="meet-client-subject">Subject</label>
      <input id="meet-client-subject" className={styles.subjectInput} value={content.subject ?? rendered?.subject ?? "Meet the Client"} maxLength={meetClientSubjectLimit} readOnly={!editable}
        onChange={(event) => change({ subject: event.target.value })} onBlur={flush} />
    </div>
    <div className={styles.addressRow}><span>Admission</span><span>{admissionDate || "Add the planned admission date in Decision before sending."}</span></div>
    {children}
    <div className={styles.messageTools}>
      <div><button type="button" className={styles.textButton} aria-pressed={editing} disabled={!editable} onClick={() => setEditing(true)}>Edit message</button>
        <button type="button" className={styles.textButton} aria-pressed={!editing} onClick={() => { flush(); setEditing(false); }}>Preview message</button></div>
      {editing ? <span>Client details and admission date stay linked above the message.</span> : null}
    </div>
    <div className={styles.messageBody}>
      <h3 className={styles.messageHeading}>Message</h3>
      {renderBody()}
    </div>
  </>;
}
