"use client";

import { getPlannedAdmissionDate } from "@/lib/pipeline/admission-lifecycle";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileText, LoaderCircle, Mail, Paperclip, RefreshCw, Send, X } from "lucide-react";

import type {
  AssessmentSummaryItem,
  AssessmentSummaryReport,
} from "@/lib/assessment/assessment-summary";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import ReadableChartText from "@/components/pipeline/ReadableChartText";
import ReferralHandoffContacts from "./ReferralHandoffContacts";
import type { HandoffRecipients } from "./useHandoffRecipients";
import MeetClientMessageEditor from "./MeetClientMessageEditor";
import type { MeetClientMessage } from "@/lib/notifications/meet-client-message";

import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./MeetClientEmailPage.module.css";

type ChartPayload = {
  referral: Referral;
  report: AssessmentSummaryReport | null;
  email: {
    example_only: boolean;
    configured: boolean;
    sender: string;
    preview: { subject: string; html: string; text?: string } | null;
    prepared_by?: string;
    allowed_recipient_domains: string[];
    eligible: boolean;
    can_send: boolean;
    can_edit_recipients: boolean;
    ready: boolean;
    sent_at?: string | null;
    blockers: string[];
    admission_packet: {
      files: Array<{
        document_id: string;
        name: string;
        category: string;
        byte_size: number;
        ready: boolean;
        generated?: boolean;
      }>;
      total_bytes: number;
      ready: boolean;
      delivery_mode: "direct" | "draft_upload" | null;
    };
  };
};

export default function AssessmentChartWorkspace({ referralId, embedded = false, emailPage = false, emailDraft, finishActions, onSendingChange, onOpenFiles, onOpenAssessment, onOpenDecision }: {
  referralId?: number;
  embedded?: boolean;
  emailPage?: boolean;
  emailDraft?: HandoffRecipients;
  finishActions?: React.ReactNode;
  onSendingChange?: (sending: boolean) => void;
  onOpenFiles?: () => void;
  onOpenAssessment?: () => void;
  onOpenDecision?: () => void;
}) {
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(referralId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recipients = emailDraft?.fields.to.map((contact) => contact.email) ?? [];
  const ccRecipients = emailDraft?.fields.cc.map((contact) => contact.email) ?? [];
  const [confirmed, setConfirmed] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [exampleReviewed, setExampleReviewed] = useState(false);
  const [acceptedReferralId, setAcceptedReferralId] = useState<number | null>(null);
  const sendRequest = useRef<{ key: string; mutationId: string } | null>(null);
  const sendInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!referralId) return;
    setLoading(true);
    setError("");
    setConfirmed(false);
    try {
      const next = await fetchPipelineJson<ChartPayload>(
        `/api/referrals/${referralId}/admission-summary`,
        { cache: "no-store" },
      );
      setPayload(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The assessment records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [referralId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => { setConfirmed(false); }, [emailDraft?.fields, referralId]);

  const emailMeetClient = async () => {
    if (!canStartMeetClientSend(payload, acceptedReferralId === referralId, confirmed, sendInFlight.current)) return;
    if (!handoffDraftReady(emailDraft)) return;
    const recipientList = recipients;
    const requestKey = handoffRequestKey(payload, recipientList, ccRecipients, emailDraft.fields.message);
    if (sendRequest.current?.key !== requestKey) sendRequest.current = { key: requestKey, mutationId: crypto.randomUUID() };
    sendInFlight.current = true;
    setSending(true);
    onSendingChange?.(true);
    setError("");
    setMessage("");
    try {
      await emailDraft.flush();
      const result = await fetchPipelineJson<{ recipient_count: number; attachment_count: number; delivery_id: string; audit_pending?: boolean }>(
        `/api/referrals/${payload.referral.id}/meet-client-email`,
        {
          method: "POST",
          body: JSON.stringify({
            recipients: recipientList,
            cc_recipients: ccRecipients,
            confirmed: true,
            if_match: payload.referral.version,
            assessment_id: payload.report?.assessmentId,
            if_match_assessment: payload.report?.assessmentVersion,
            client_mutation_id: sendRequest.current.mutationId,
            message: emailDraft.fields.message,
          }),
        },
        { timeoutMs: 300_000 },
      );
      setConfirmed(false);
      setAcceptedReferralId(payload.referral.id);
      setMessage(`Microsoft 365 accepted the summary and ${result.attachment_count} admission file${result.attachment_count === 1 ? "" : "s"} for ${result.recipient_count} recipient${result.recipient_count === 1 ? "" : "s"}.${result.audit_pending ? ` Send history is pending; do not resend. Reference: ${result.delivery_id}.` : ""}`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Meet the Client could not be emailed.");
    } finally {
      sendInFlight.current = false;
      setSending(false);
      onSendingChange?.(false);
    }
  };

  const unavailable = chartUnavailableState(referralId, loading, payload, error, load, embedded, emailPage);
  if (unavailable) return unavailable;
  const readyPayload = payload!;
  const sent = Boolean(readyPayload.email.sent_at) || acceptedReferralId === referralId;
  const deliveryStatus = meetClientDeliveryStatus(readyPayload.email, sent, sending, confirmed, recipients);
  const refresh = <button type="button" onClick={() => void load()} disabled={loading || sending} className={styles.textButton}>
    <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
  </button>;

  const renderEmailPage = () => (
    <section data-guide-target="workspace-packet-preview" className={styles.page} aria-label="Email and referral packet">
      <header className={styles.pageHeader}>
        <div><h2>Meet the Client</h2><p>{readyPayload.report?.meetClient.name || readyPayload.referral.name} · {readyPayload.report?.meetClient.community || readyPayload.referral.community}</p></div>
        <span data-guide-target="packet-delivery-status" role="status" aria-label="Email delivery status" className={sent ? styles.deliveryStatus : "sr-only"} data-sent={sent || undefined}>{deliveryStatus}</span>
      </header>
      {!composerOpen ? <ChartStatusMessage error={error} message={message} /> : null}
      {!composerOpen && readyPayload.email.example_only ? <p role="status" className={styles.previewNote}>Demo — not live. No email will be sent.</p> : null}
      <p className={styles.packetDescription}>The admission packet includes your message and every file uploaded to this workspace.</p>
      <HandoffOverview payload={readyPayload} sent={sent} exampleReviewed={exampleReviewed} finishActions={finishActions}
        composerOpen={composerOpen} onPreviewEmail={() => { setConfirmed(false); setComposerOpen(true); }}
        onOpenAssessment={onOpenAssessment} onOpenDecision={onOpenDecision} />
      {composerOpen ? <MeetClientComposeDialog sending={sending} onClose={() => { setComposerOpen(false); setConfirmed(false); }}>
      <MeetClientEmailPreview email={readyPayload.email} report={readyPayload.report} emailDraft={emailDraft} referral={readyPayload.referral} confirmed={confirmed} sending={sending} sent={sent} error={error} message={message} refresh={refresh}
        onOpenFiles={onOpenFiles} onReviewComplete={() => { setExampleReviewed(readyPayload.email.example_only); setComposerOpen(false); setConfirmed(false); }}
        onConfirmed={setConfirmed}
        onSend={() => void emailMeetClient()} />
      </MeetClientComposeDialog> : null}
    </section>
  );
  if (emailPage) return renderEmailPage();

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <div className={styles.chartActions}>
        {refresh}
      </div>
      <ChartStatusMessage error={error} message={message} />
      <AssessmentRecord report={readyPayload.report!} embedded={embedded} />
    </div>
  );
}

function HandoffOverview({ payload, sent, exampleReviewed, finishActions, composerOpen, onPreviewEmail, onOpenAssessment, onOpenDecision }: {
  payload: ChartPayload; sent: boolean; exampleReviewed: boolean; composerOpen: boolean;
  finishActions?: React.ReactNode;
  onPreviewEmail: () => void;
  onOpenAssessment?: () => void; onOpenDecision?: () => void;
}) {
  const { report, email } = payload;
  const complete = sent || (email.example_only && exampleReviewed);
  const finishRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (complete && !composerOpen) finishRef.current?.querySelector("button")?.focus();
  }, [complete, composerOpen]);
  const previewButton = <button type="button" data-guide-target={composerOpen ? undefined : ["chart-email-handoff", "packet-open-email"].join(" ")} className={styles.sendButton}
    onClick={(event) => { event.currentTarget.focus(); onPreviewEmail(); }}>
    {complete ? "View email" : "Preview email"}<ArrowRight size={18} aria-hidden="true" />
  </button>;

  if (complete) return <section className={styles.guidedTask} aria-label="Handoff readiness">
    <Check className={styles.taskIcon} size={32} aria-hidden="true" />
    <h3>{sent ? "Handoff sent" : "Demo review complete"}</h3>
    <p>{sent ? "Microsoft 365 accepted the handoff. Delivery is not yet confirmed." : "No email was sent."}</p>
    <footer ref={finishRef} aria-label="Handoff actions" className={styles.taskActions}>{finishActions}</footer>
    <details className={styles.completedDetails}><summary>Review email again</summary>{previewButton}</details>
  </section>;

  if (!report?.signed || !email.eligible) return <HandoffPendingTask signed={Boolean(report?.signed)} onOpenAssessment={onOpenAssessment} onOpenDecision={onOpenDecision} />;

  return <section aria-label="Handoff readiness" className={styles.handoffOverview}>
    <h3 className={styles.reviewHeading}>Review the client summary</h3>
    <HandoffClinicalSummary report={report} />
    <footer aria-label="Handoff actions" className={styles.reviewActions}><span>Next: recipients & attachments</span>{previewButton}</footer>
  </section>;
}

function HandoffPendingTask({ signed, onOpenAssessment, onOpenDecision }: { signed: boolean; onOpenAssessment?: () => void; onOpenDecision?: () => void }) {
  const needsAssessment = !signed;
  const onContinue = needsAssessment ? onOpenAssessment : onOpenDecision;
  return <section className={styles.guidedTask} aria-label="Handoff readiness">
      <FileText className={styles.taskIcon} size={32} aria-hidden="true" />
      <h3>{needsAssessment ? "Sign the assessment" : "Record the admission decision"}</h3>
      <p>{needsAssessment ? "The signed assessment becomes the email summary." : "An accepted decision is required to send this handoff."}</p>
      <footer aria-label="Handoff actions" className={styles.taskActions}>
        {onContinue ? <button type="button" className={styles.sendButton} onClick={onContinue}>{needsAssessment ? "Review & sign assessment" : "Open decision"}<ArrowRight size={18} aria-hidden="true" /></button> : null}
      </footer>
    </section>;
}

export function HandoffClinicalSummary({ report }: { report: AssessmentSummaryReport }) {
  const summary = report.meetClient;
  return <div className={styles.handoffReading}>
        <HandoffSection title="Medications & injections" items={summary.medicationNotes}>
          {summary.medications.length ? <ul className={styles.medicationList}>{summary.medications.map((medication, index) => <li key={index}><ReadableChartText value={medication} /></li>)}</ul> : <p className={styles.missing}>Medication list not recorded. Confirm with the referring team.</p>}
        </HandoffSection>
        <HandoffSection title="Behavior & safety" items={summary.safetyNotes ?? []} />
        <HandoffSection title="Arrival & admission" items={summary.admissionNotes ?? []} />
        <HandoffSection title="Daily support & diet" items={Array.from(new Map([...summary.supportSnapshot, ...(summary.dietaryNotes ?? [])].map((item) => [item.label, item])).values())} />
        <HandoffSection title="Billing & benefits" items={summary.billingNotes ?? []} />
        {summary.bio.length ? <HandoffSection title="Getting to know the client" items={[]}><ul className={styles.medicationList}>{summary.bio.map((line, index) => <li key={index}><ReadableChartText value={line} /></li>)}</ul></HandoffSection> : null}
        <p className={styles.sourceNote}>From signed assessment version {report.assessmentVersion}. Corrections belong in the chart; the email uses the same record.</p>
    </div>;
}

function HandoffSection({ title, items, children }: { title: string; items: AssessmentSummaryItem[]; children?: React.ReactNode }) {
  return <section className={styles.handoffSection} aria-label={title}><h3>{title}</h3>{children}<dl>{items.map((item, index) => <div key={`${item.label}-${index}`} data-handoff-field={item.label}><dt>{item.label}</dt><dd><ReadableChartText value={item.value} /></dd></div>)}</dl></section>;
}

function MeetClientComposeDialog({ sending, onClose, children }: { sending: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog ref={dialogRef} className={styles.composeDialog} aria-label="Meet the Client email" aria-busy={sending}
    onCancel={(event) => { event.preventDefault(); if (!sending) onClose(); }}>
    <header className={styles.dialogHeader}><div><Mail size={20} aria-hidden="true" /><h2>Meet the Client email</h2></div><button type="button" aria-label="Close email preview" onClick={onClose} disabled={sending}><X size={22} aria-hidden="true" /></button></header>
    {children}
  </dialog>;
}

function handoffRequestKey(payload: ChartPayload, recipientList: string[], ccRecipients: string[], message: MeetClientMessage) {
  return JSON.stringify([
      payload.referral.id, payload.referral.version, payload.report?.assessmentId, payload.report?.assessmentVersion,
      [...new Set(recipientList.map((recipient) => recipient.toLowerCase()))].sort(),
      [...ccRecipients].sort(),
      payload.email.admission_packet.files.map((file) => file.document_id).sort(),
      message,
    ]);
}

function handoffDraftReady(draft?: HandoffRecipients): draft is HandoffRecipients {
  return Boolean(draft && !draft.error && !draft.loading);
}

function canStartMeetClientSend(payload: ChartPayload | null, alreadyAccepted: boolean, confirmed: boolean, inFlight: boolean): payload is ChartPayload {
  return Boolean(payload?.email.ready && !payload.email.example_only && !payload.email.sent_at && !alreadyAccepted && confirmed && !inFlight);
}

function meetClientDeliveryStatus(email: ChartPayload["email"], sent: boolean, sending: boolean, confirmed: boolean, recipients: string[]) {
  if (sent) return "Sent";
  if (sending) return "Sending";
  return !email.example_only && email.ready && confirmed && recipients.length ? "Ready to send" : "Preview";
}

function chartUnavailableState(
  referralId: number | undefined,
  loading: boolean,
  payload: ChartPayload | null,
  error: string,
  load: () => Promise<void>,
  embedded: boolean,
  emailPage: boolean,
) {
  if (!referralId) return <EmptyState text="Save the referral before opening its assessment records." />;
  if (loading && !payload) return <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-[#66706b]"><LoaderCircle size={16} className="animate-spin" /> Loading assessment records...</div>;
  if (!payload) return <EmptyState text={error || "The assessment records are unavailable."} onRetry={() => void load()} />;
  if (!payload.report && !emailPage) return embedded ? <></> : <EmptyState text="Complete and sign the assessment to generate the client charts." onRetry={() => void load()} />;
  return null;
}

function AssessmentRecord({ report, embedded }: { report: AssessmentSummaryReport; embedded: boolean }) {
  const record = <CompleteAssessmentChart report={report} />;
  if (!embedded) return record;
  return <details><summary className="cursor-pointer text-[12px] font-bold text-[#0f8b73]">Signed assessment record</summary><div className="mt-4">{record}</div></details>;
}

function ChartStatusMessage({ error, message }: { error: string; message: string }) {
  const text = error || message;
  if (!text) return null;
  return <div role={error ? "alert" : "status"} className={styles.notice}>{text}</div>;
}

export function CompleteAssessmentChart({ report }: { report: AssessmentSummaryReport }) {
  return (
    <article data-guide-target="chart-complete-record" aria-label="Complete assessment chart" className="border border-[#cfd7d2] bg-white">
      <ChartHeader report={report} title="Comprehensive Assessment Record" />
      <ChartSection title="Client and referral" items={report.identity} />
      {report.sections.map((section) => <ChartSection key={section.id} title={section.title} items={section.items} />)}
      <ChartSourceFooter report={report} />
    </article>
  );
}

function ChartHeader({ report, title }: { report: AssessmentSummaryReport; title: string }) {
  const name = report.identity.find((item) => item.label === "Name")?.value ?? "Client";
  const dob = report.identity.find((item) => item.label === "Date of birth")?.value ?? "Not recorded";
  const community = report.identity.find((item) => item.label === "Community")?.value ?? "Not assigned";
  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#183f37] px-5 py-4 text-white sm:px-7">
        <div><div className="text-[9px] font-black uppercase tracking-[0.12em] text-[#aad0c5]">Pipeline clinical record</div><h2 className="mt-1 text-[18px] font-black tracking-[-0.02em]">{title}</h2></div>
        <div className="border border-white/25 px-3 py-1 text-[9px] font-black uppercase tracking-[0.08em]">{report.signed ? "Signed assessment" : "Saved, unsigned"}</div>
      </div>
      <div className="grid gap-px border-b border-[#cfd7d2] bg-[#cfd7d2] sm:grid-cols-2 lg:grid-cols-4">
        <HeaderFact label="Client" value={name} />
        <HeaderFact label="Date of birth" value={formatDate(dob)} />
        <HeaderFact label="Community" value={community} />
        <HeaderFact label="Assessment date" value={formatDate(report.assessmentDate)} />
      </div>
    </header>
  );
}

function HeaderFact({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#f7faf8] px-5 py-3"><div className="text-[8px] font-black uppercase tracking-[0.08em] text-[#6a746f]">{label}</div><div className="mt-1 text-[12px] font-black text-[#202824]">{value}</div></div>;
}

function ChartSection({ title, items }: { title: string; items: AssessmentSummaryItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="grid border-b border-[#dfe4e1] px-5 py-5 sm:px-7 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-8">
      <h3 className="mb-4 text-[11px] font-black uppercase tracking-[0.04em] text-[#234c42] lg:mb-0">{title}</h3>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {items.map((item, index) => (
          <div key={`${title}:${index}:${item.label}`} className="min-w-0">
            <dt className="text-[8px] font-black uppercase tracking-[0.06em] text-[#737d78]">{item.label}</dt>
            <dd className="mt-1 whitespace-pre-line text-[11px] leading-5 text-[#222a26]"><ReadableChartText value={item.value} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ChartSourceFooter({ report }: { report: AssessmentSummaryReport }) {
  return (
    <footer className="flex flex-wrap justify-between gap-3 bg-[#f7faf8] px-5 py-4 text-[9px] leading-4 text-[#69736e] sm:px-7">
      <span>Assessment {report.assessmentId} | Version {report.assessmentVersion}</span>
      <span>{report.signed ? `Signed ${report.signedAt ? formatTimestamp(report.signedAt) : ""}${report.signedBy ? ` by ${report.signedBy}` : ""}` : "Saved, unsigned"}</span>
    </footer>
  );
}

function MeetClientEmailPreview({ email, report, emailDraft, referral, confirmed, sending, sent, error, message, refresh, onConfirmed, onSend, onOpenFiles, onReviewComplete }: {
  email: ChartPayload["email"];
  report: AssessmentSummaryReport | null;
  emailDraft?: HandoffRecipients;
  referral: Referral;
  confirmed: boolean;
  sending: boolean;
  sent: boolean;
  error: string;
  message: string;
  refresh: React.ReactNode;
  onConfirmed: (value: boolean) => void;
  onSend: () => void;
  onOpenFiles?: () => void;
  onReviewComplete: () => void;
}) {
  const status = meetClientPreviewStatus(email, sent, sending);
  const renderSendToolbar = () => (
    email.example_only || sent ? <footer className={styles.toolbar}><span>{sent ? "Handoff sent" : "No email will be sent"}</span><button type="button" className={styles.sendButton} onClick={onReviewComplete}>{sent ? "Done" : "Done reviewing"}<Check size={18} aria-hidden="true" /></button></footer> : <footer className={styles.toolbar}>
        {email.can_send ? <label className={styles.confirmation}>
          <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} disabled={sending} aria-label="I verified that each recipient is authorized to receive this summary and the attached files." />
          <span><strong>{confirmed ? "Recipients verified" : "Verify recipients"}</strong><span>I verified that each recipient is authorized to receive this summary and the attached files.</span></span>
        </label> : null}
        <button type="button" className={styles.sendButton} onClick={onSend}
          disabled={!canSendHandoff(email, emailDraft, confirmed, sending)}>
          <Send size={16} />{sending ? "Sending…" : "Send email & packet"}
        </button>
      </footer>
  );

  const renderPacketAttachments = () => (
    <section data-guide-target="packet-attachments" className={styles.attachments} aria-label="Referral packet attachments">
        <div className={styles.attachmentHeading}>
          <h3>Admission packet</h3>
          <span><Paperclip size={15} aria-hidden="true" />{email.admission_packet.files.length} attachment{email.admission_packet.files.length === 1 ? "" : "s"} · {formatBytes(email.admission_packet.total_bytes)}</span>
        </div>
        {!email.admission_packet.ready && !sent && onOpenFiles ? <button type="button" className={styles.textButton} disabled={sending} onClick={onOpenFiles}>{email.admission_packet.files.every((file) => file.generated) ? "Upload files" : "Review packet files"}<ArrowRight size={16} aria-hidden="true" /></button> : null}
        {email.admission_packet.files.length ? <ul className={styles.attachmentList}>
          {email.admission_packet.files.map((file) => <li key={file.document_id}>
            <a className={styles.attachment} href={toPipelinePath(file.generated ? `/api/referrals/${referral.id}/admission-summary?download=chart` : `/api/files/${encodeURIComponent(file.document_id)}/download`)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.name}`}>
              <FileText size={23} aria-hidden="true" /><span><strong>{file.name}</strong><small>{file.generated ? "Full chart · printable data sheet" : file.ready ? formatBytes(file.byte_size) : "Safety review needed"}</small></span>
            </a>
          </li>)}
        </ul> : <p className={styles.emptyAttachments}>No uploaded files yet. Upload files to this workspace to include them in the admission packet.</p>}
      </section>
  );
  const renderDeliveryDetails = () => (
    <details className={styles.deliveryDetails}>
          <summary>Delivery details</summary>
          {email.blockers.length ? <ul>{email.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
          <p>Approved recipient domains: {email.allowed_recipient_domains.join(", ") || "Not connected yet"}.</p>
        </details>
  );

  return (
    <div className={styles.composer} data-guide-target="chart-email-handoff">
      <div className={styles.composeScroll}>
      <div className={`${styles.nextStep} ${email.example_only ? styles.demoNotice : ""}`}><p role="status">{status}</p>{!email.example_only ? refresh : null}</div>
      <div className={styles.addressRow}><span>From</span><span>{email.sender || "Sending account not connected"}</span></div>
      {emailDraft ? <div data-guide-target="packet-recipients" className={styles.recipientSection}><ReferralHandoffContacts key={referral.community} composer value={{ ...emailDraft, change: (value) => { emailDraft.change(value); onConfirmed(false); } }} community={referral.community} disabled={!email.can_edit_recipients || sending || sent} /></div> : null}
      <MeetClientMessageEditor demo={email.example_only} summary={report?.meetClient} preview={email.preview} preparedBy={email.prepared_by ?? ""} attachments={email.admission_packet.files.map((file) => file.name)}
        draft={emailDraft} admissionDate={getPlannedAdmissionDate(referral)} disabled={!email.can_edit_recipients || sending || sent} onEdited={() => onConfirmed(false)}>
        {renderPacketAttachments()}
      </MeetClientMessageEditor>
      <footer className={styles.footer}>
        {renderDeliveryDetails()}
      </footer>
      </div>
      <ChartStatusMessage error={error} message={message} />
      {renderSendToolbar()}
    </div>
  );
}

function canSendHandoff(email: ChartPayload["email"], draft: HandoffRecipients | undefined, confirmed: boolean, sending: boolean) {
  return !sending && email.ready && confirmed && Boolean(draft?.fields.to.length) && handoffDraftReady(draft);
}

function meetClientPreviewStatus(email: ChartPayload["email"], sent: boolean, sending: boolean) {
  return sent ? "Microsoft 365 accepted this handoff for sending. This is not a delivery or read receipt."
    : sending ? "Sending the email and packet. Keep this workspace open until the result appears."
    : email.example_only ? "Demo — not live. No email will be sent." : !email.configured ? "Preview only · email delivery is not connected."
    : !email.preview ? "Assessment not signed yet. Review and sign it to prepare the summary."
    : !email.eligible ? "Assessment signed · record acceptance in Decision before sending."
    : !email.ready ? "Preview ready · review the items below before sending."
    : "Review the recipients and packet, then send when ready.";
}

function EmptyState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return <div className="flex min-h-52 flex-col items-center justify-center border border-dashed border-[#cfd7d2] bg-[#fafcfb] px-6 text-center text-[12px] text-[#66706b]"><p>{text}</p>{onRetry ? <button type="button" onClick={onRetry} className="mt-3 flex items-center gap-2 font-black text-[#0f8b73]"><RefreshCw size={13} /> Retry</button> : null}</div>;
}

function formatDate(value: string) {
  if (!value) return "Not recorded";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
