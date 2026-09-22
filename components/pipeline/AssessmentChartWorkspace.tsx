"use client";

import { getPlannedAdmissionDate, plannedAdmissionDateError } from "@/lib/pipeline/admission-lifecycle";
import { useCallback, useEffect, useRef, useState } from "react";
import HandoffDraftStatus, { HandoffDraftError } from "./HandoffDraftStatus";
import { ArrowRight, Check, FileText, LoaderCircle, Paperclip, RefreshCw, X } from "lucide-react";

import type {
  AssessmentSummaryItem,
  AssessmentSummaryReport,
} from "@/lib/assessment/assessment-summary";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import ReadableChartText from "@/components/pipeline/ReadableChartText";
import ReferralHandoffContacts from "./ReferralHandoffContacts";
import type { HandoffRecipients } from "./useHandoffRecipients";
import MeetClientMessageEditor from "./MeetClientMessageEditor";
import MeetClientAdmissionReview from "./MeetClientAdmissionReview";
import AdmissionPacketAccessControls from "./AdmissionPacketAccessControls";
import OutlookHandoffControls from "./OutlookHandoffControls";
import type { OutlookDraftView } from "@/lib/notifications/outlook-draft-contract";
import type { MeetClientMessage } from "@/lib/notifications/meet-client-message";

import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./MeetClientEmailPage.module.css";

type ChartPayload = {
  referral: Referral;
  report: AssessmentSummaryReport | null;
  email: {
    example_only: boolean;
    outlook_draft?: OutlookDraftView | null;
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
      revision: string;
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
      delivery_mode: "direct" | "draft_upload" | "secure_link" | null;
    };
  };
};

export default function AssessmentChartWorkspace({ referralId, embedded = false, emailPage = false, emailDraft, finishActions, onSendingChange, onReferralChange, onOpenFiles, onOpenAssessment, onOpenDecision }: {
  referralId?: number;
  embedded?: boolean;
  emailPage?: boolean;
  emailDraft?: HandoffRecipients;
  finishActions?: React.ReactNode;
  onSendingChange?: (sending: boolean) => void;
  onReferralChange?: (referral: Referral) => void;
  onOpenFiles?: () => void;
  onOpenAssessment?: () => void;
  onOpenDecision?: () => void;
}) {
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(referralId));
  const [sending, setSending] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recipients = emailDraft?.fields.to.map((contact) => contact.email) ?? [];
  const ccRecipients = emailDraft?.fields.cc.map((contact) => contact.email) ?? [];
  const [confirmed, setConfirmed] = useState(false);
  const [existingDraft, setExistingDraft] = useState<OutlookDraftView | null>(null);
  const [reviewStep, setReviewStep] = useState<number | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const composerOpen = reviewStep !== null;
  const [exampleReviewed, setExampleReviewed] = useState(false);
  const [acceptedReferralId, setAcceptedReferralId] = useState<number | null>(null);
  const sendRequest = useRef<{ key: string; mutationId: string } | null>(null);
  const sendInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!referralId) return;
    setLoading(true);
    setError("");
    setConfirmed(false);
    setReviewedCount(0);
    setExampleReviewed(false);
    setReviewStep(null);
    try {
      const next = await fetchPipelineJson<ChartPayload>(
        `/api/referrals/${referralId}/admission-summary`,
        { cache: "no-store" },
      );
      setPayload(next);
      setExistingDraft(next.email.outlook_draft && !["sent", "discarded"].includes(next.email.outlook_draft.status) ? next.email.outlook_draft : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The assessment records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [referralId]);

  useEffect(() => {
    void load();
  }, [load]);
  const recipientKey = JSON.stringify([referralId, recipients, ccRecipients, emailDraft?.recipientInput]);
  useEffect(() => { setConfirmed(false); setReviewedCount((count) => Math.min(count, 3)); }, [recipientKey]);

  const confirmAdmissionDate = async (saved: Referral) => {
    onReferralChange?.(saved);
    const next = await fetchPipelineJson<ChartPayload>(`/api/referrals/${saved.id}/admission-summary`, { cache: "no-store" });
    if (getPlannedAdmissionDate(next.referral) !== getPlannedAdmissionDate(saved) || !next.report?.signed || !next.email.eligible) {
      throw new PipelineApiError("The handoff changed. Reload and check the saved admit date before continuing.", 409);
    }
    setPayload(next);
    setConfirmed(false);
    setExampleReviewed(false);
    setReviewedCount(1);
    setReviewStep(1);
  };

  const emailMeetClient = async (outlookToken: string) => {
    if (!canStartMeetClientSend(payload, acceptedReferralId === referralId, confirmed, sendInFlight.current)) return;
    if (!handoffDraftReady(emailDraft)) return;
    const recipientList = recipients;
    const requestKey = handoffRequestKey(payload, recipientList, ccRecipients, emailDraft.fields.message);
    if (sendRequest.current?.key !== requestKey) sendRequest.current = { key: requestKey, mutationId: crypto.randomUUID() };
    const mutationId = sendRequest.current.mutationId;
    sendInFlight.current = true;
    setSending(true);
    onSendingChange?.(true);
    setError("");
    setMessage("");
    const deliver = async () => {
      await emailDraft.flush();
      const result = await fetchPipelineJson<{ recipient_count: number; attachment_count: number; delivery_id: string; audit_pending?: boolean; draft?: OutlookDraftView }>(
        `/api/referrals/${payload.referral.id}/meet-client-email?delivery=outlook`,
        {
          method: "POST",
          headers: { "x-pipeline-outlook-token": outlookToken },
          body: JSON.stringify({
            recipients: recipientList,
            cc_recipients: ccRecipients,
            confirmed: true,
            if_match: payload.referral.version,
            assessment_id: payload.report?.assessmentId,
            if_match_assessment: payload.report?.assessmentVersion,
            client_mutation_id: mutationId,
            packet_revision: payload.email.admission_packet.revision,
            message: emailDraft.fields.message,
          }),
        },
        { timeoutMs: 300_000 },
      );
      setConfirmed(false);
      if (result.draft) return result.draft;
      setAcceptedReferralId(payload.referral.id);
      setMessage(`Microsoft 365 accepted the summary and ${result.attachment_count} admission file${result.attachment_count === 1 ? "" : "s"} for ${result.recipient_count} recipient${result.recipient_count === 1 ? "" : "s"}.${result.audit_pending ? ` Send history is pending; do not resend. Reference: ${result.delivery_id}.` : ""}`);
    };
    const failed = (sendError: unknown) => {
      if (retryableSendError(sendError)) sendRequest.current = null;
      setError(sendError instanceof Error ? sendError.message : "Meet the Client could not be emailed.");
      throw sendError;
    };
    try {
      return await deliver();
    } catch (sendError) {
      failed(sendError);
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

  const renderReviewBody = (step: number) => {
    if (step === 0) return <MeetClientAdmissionReview referral={readyPayload.referral} editable={readyPayload.email.can_edit_recipients} demo={readyPayload.email.example_only}
      onConfirm={confirmAdmissionDate} onSavingChange={(saving) => { setSavingDate(saving); onSendingChange?.(saving); }} onReload={() => void load()} />;
    return step < 4 ? <HandoffReviewStep step={step} payload={readyPayload} draft={emailDraft} confirmed={confirmed} onConfirmed={setConfirmed}
          onBack={() => setReviewStep(step - 1)} onOpenFiles={onOpenFiles} onOpenAssessment={onOpenAssessment}
          onContinue={() => { setReviewedCount((count) => Math.max(count, step + 1)); setReviewStep(step + 1); }} />
          : <MeetClientEmailPreview email={readyPayload.email} report={readyPayload.report} emailDraft={emailDraft} referral={readyPayload.referral}
            confirmed={confirmed} sending={sending} sent={sent} error={error} message={message} refresh={refresh}
            onBack={() => setReviewStep(3)} onReviewComplete={() => { setExampleReviewed(readyPayload.email.example_only); setReviewStep(null); }}
            preparedDraft={existingDraft} onExistingDraft={(draft) => { setExistingDraft(draft); if (!draft && existingDraft) { setConfirmed(false); setReviewedCount(0); setReviewStep(null); } }}
            onPrepareOutlook={emailMeetClient} onOutlookSent={() => setAcceptedReferralId(readyPayload.referral.id)} />;
  };
  const renderReviewDialog = () => (reviewStep !== null ? <MeetClientComposeDialog key={reviewStep} step={reviewStep} sending={sending || savingDate} onClose={() => setReviewStep(null)}>
    {renderReviewBody(reviewStep)}
  </MeetClientComposeDialog> : null);

  const renderEmailPage = () => (
    <section data-guide-target="workspace-packet-preview" className={styles.page} aria-label="Email and referral packet">
      <header className={styles.pageHeader}>
        <div><h2>Meet the Client</h2><p>{readyPayload.report?.meetClient.name || readyPayload.referral.name} · {readyPayload.report?.meetClient.community || readyPayload.referral.community}</p></div>
        <span data-guide-target="packet-delivery-status" role="status" aria-label="Email delivery status" className={sent ? styles.deliveryStatus : "sr-only"} data-sent={sent || undefined}>{deliveryStatus}</span>
      </header>
      {!composerOpen ? <ChartStatusMessage error={error} message={message} /> : null}
      {!composerOpen ? <HandoffDraftError value={emailDraft} /> : null}
      {!composerOpen && readyPayload.email.example_only ? <p role="status" className={styles.previewNote}>Not production yet — no email will be sent.</p> : null}
      <HandoffOverview payload={readyPayload} sent={sent} exampleReviewed={exampleReviewed} finishActions={finishActions}
        existingDraft={existingDraft} composerOpen={composerOpen} reviewedCount={reviewedCount} onPreviewEmail={() => setReviewStep(sent || exampleReviewed || existingDraft ? 4 : Math.min(reviewedCount, 4))}
        onOpenAssessment={onOpenAssessment} onOpenDecision={onOpenDecision} />
      {renderReviewDialog()}
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

function HandoffOverview({ existingDraft, payload, sent, exampleReviewed, finishActions, composerOpen, reviewedCount, onPreviewEmail, onOpenAssessment, onOpenDecision }: {
  existingDraft: OutlookDraftView | null; payload: ChartPayload; sent: boolean; exampleReviewed: boolean; composerOpen: boolean; reviewedCount: number;
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
    {handoffReviewLabel(complete, reviewedCount, Boolean(existingDraft))}<ArrowRight size={18} aria-hidden="true" />
  </button>;

  if (complete) return <section className={styles.guidedTask} aria-label="Handoff readiness">
    <Check className={styles.taskIcon} size={32} aria-hidden="true" />
    <h3>{sent ? "Handoff sent" : "Demo review complete"}</h3>
    <p>{sent ? "The handoff is recorded as sent. Recipient delivery is not tracked." : "No email was sent."}</p>
    <footer ref={finishRef} aria-label="Handoff actions" className={styles.taskActions}>{finishActions}</footer>
    <details className={styles.completedDetails}><summary>Review email again</summary>{previewButton}</details>
  </section>;

  if (existingDraft) return <section aria-label="Handoff readiness" className={styles.reviewLanding}>
    <h3>Your Outlook draft is saved</h3>
    <p>Continue with the message and files you already reviewed.</p>
    <div aria-label="Handoff actions" className={styles.taskActions}>{previewButton}</div>
  </section>;

  if (!report?.signed || !email.eligible) return <HandoffPendingTask signed={Boolean(report?.signed)} onOpenAssessment={onOpenAssessment} onOpenDecision={onOpenDecision} />;

  return <section aria-label="Handoff readiness" className={styles.reviewLanding}>
    <h3>Ready to prepare the handoff</h3>
    <p>Confirm the admit date, check the handoff, then preview the email.</p>
    <div aria-label="Handoff actions" className={styles.taskActions}>{previewButton}</div>
    <ol className={styles.reviewChecklist} aria-label="Handoff review progress">
      {["Admit date", "Client summary", "Admission packet", "Recipients"].map((label, index) => <li key={label} data-complete={reviewedCount > index || undefined}>
        <span aria-hidden="true">{reviewedCount > index ? <Check size={18} /> : index + 1}</span>
        <strong>{label}</strong><small>{reviewedCount > index ? "Checked" : index === reviewedCount ? "Up next" : "To check"}</small>
      </li>)}
    </ol>
  </section>;
}

function handoffReviewLabel(complete: boolean, reviewedCount: number, existingDraft: boolean) {
  if (existingDraft) return "Continue with Outlook draft";
  if (complete) return "View email";
  if (reviewedCount === 4) return "Preview email";
  return reviewedCount ? "Continue review" : "Review handoff";
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

const handoffStepTitles = ["Confirm admit date", "Check client summary", "Check admission packet", "Check recipients", "Preview email"];

function MeetClientComposeDialog({ step, sending, onClose, children }: { step: number; sending: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    titleRef.current?.focus();
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog ref={dialogRef} className={`${styles.composeDialog} ${step < 4 ? styles.reviewDialog : ""} ${step === 0 ? styles.admissionDateDialog : ""}`} aria-label={step === 4 ? "Meet the Client email" : handoffStepTitles[step]} aria-busy={sending}
    onCancel={(event) => { event.preventDefault(); if (!sending) onClose(); }}>
    <header className={styles.dialogHeader}><div><span className={styles.stepNumber}>{step + 1} / {handoffStepTitles.length}</span><h2 ref={titleRef} tabIndex={-1}>{handoffStepTitles[step]}</h2></div><button type="button" aria-label={step === 4 ? "Close email preview" : "Close handoff review"} onClick={onClose} disabled={sending}><X size={22} aria-hidden="true" /></button></header>
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
  return Boolean(draft && !draft.error && !draft.loading && !draft.hasPendingRecipients);
}

function canStartMeetClientSend(payload: ChartPayload | null, alreadyAccepted: boolean, confirmed: boolean, inFlight: boolean): payload is ChartPayload {
  return Boolean(payload?.email.ready && !plannedAdmissionDateError(getPlannedAdmissionDate(payload.referral)) && !payload.email.example_only && !payload.email.sent_at && !alreadyAccepted && confirmed && !inFlight);
}

function meetClientDeliveryStatus(email: ChartPayload["email"], sent: boolean, sending: boolean, confirmed: boolean, recipients: string[]) {
  if (sent) return "Sent";
  if (sending) return "Sending";
  return !email.example_only && email.ready && confirmed && recipients.length ? "Ready to save draft" : "Preview";
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

function HandoffReviewStep({ step, payload, draft, confirmed, onConfirmed, onBack, onContinue, onOpenFiles, onOpenAssessment }: {
  step: number; payload: ChartPayload; draft?: HandoffRecipients; confirmed: boolean;
  onConfirmed: (value: boolean) => void; onBack: () => void; onContinue: () => void;
  onOpenFiles?: () => void; onOpenAssessment?: () => void;
}) {
  const recipientCheckReady = confirmed && handoffDraftReady(draft) && Boolean(draft.fields.to.length);
  return <div className={styles.composer}>
    <div className={styles.composeScroll}>
      {payload.email.example_only ? <p role="status" className={styles.demoNotice}>Demo only — no email will be sent.</p> : null}
      {step === 1 ? <HandoffSummaryReview report={payload.report} onOpenAssessment={onOpenAssessment} /> : null}
      {step === 2 ? <AdmissionPacketReview email={payload.email} referral={payload.referral} onOpenFiles={onOpenFiles} /> : null}
      {step === 3 ? <HandoffRecipientReview draft={draft} community={payload.referral.community} editable={payload.email.can_edit_recipients} confirmed={confirmed} onConfirmed={onConfirmed} /> : null}
      {step !== 3 ? <HandoffDraftError value={draft} /> : null}
    </div>
    <footer className={styles.toolbar}>
      <button type="button" className={styles.textButton} onClick={onBack}>Back</button>
      <button type="button" className={styles.sendButton} disabled={step === 3 && !recipientCheckReady} onClick={onContinue}>
        {["Confirm summary", "Confirm packet", "Preview email"][step - 1]}<ArrowRight size={18} aria-hidden="true" />
      </button>
    </footer>
  </div>;
}

function HandoffSummaryReview({ report, onOpenAssessment }: { report: AssessmentSummaryReport | null; onOpenAssessment?: () => void }) {
  return <div className={styles.reviewContent}>
        <p className={styles.reviewInstruction}>Check the details the receiving team will need.</p>
        {report ? <HandoffClinicalSummary report={report} /> : null}
        {onOpenAssessment ? <button type="button" className={styles.textButton} onClick={onOpenAssessment}>Correct the assessment</button> : null}
      </div>;
}

function HandoffRecipientReview({ draft, community, editable, confirmed, onConfirmed }: {
  draft?: HandoffRecipients; community: string; editable: boolean; confirmed: boolean; onConfirmed: (value: boolean) => void;
}) {
  return <div className={styles.reviewContent}>
        <p className={styles.reviewInstruction}>Who should receive this client’s information?</p>
        {draft ? <div data-guide-target="packet-recipients"><ReferralHandoffContacts key={community} composer value={draft} community={community} disabled={!editable} /></div> : <p role="status">Recipient settings are not available yet.</p>}
        <label className={styles.confirmation}>
          <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} disabled={!draft?.fields.to.length || !handoffDraftReady(draft)}
            aria-label="I verified that each recipient is authorized to receive this summary and the packet files." />
          <span><strong>These recipients are authorized</strong><span>I checked every address. Each person may receive this client’s summary and files.</span></span>
        </label>
      </div>;
}

function AdmissionPacketReview({ email, referral, onOpenFiles }: { email: ChartPayload["email"]; referral: Referral; onOpenFiles?: () => void }) {
  return <section data-guide-target="packet-attachments" className={`${styles.attachments} ${styles.packetReview}`} aria-label="Referral packet attachments">
    <div className={styles.attachmentHeading}><h3>Everything in the packet</h3><span><Paperclip size={15} aria-hidden="true" />{email.admission_packet.files.length} files · {formatBytes(email.admission_packet.total_bytes)}</span></div>
    <p>Check that the right files are included. These files will be attached to the email.</p>
    <ul className={styles.attachmentList}>{email.admission_packet.files.map((file) => <li key={file.document_id}>
      <a className={styles.attachment} href={toPipelinePath(file.generated ? `/api/referrals/${referral.id}/admission-summary?download=chart` : `/api/files/${encodeURIComponent(file.document_id)}/download`)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.name}`}>
        <FileText size={23} aria-hidden="true" /><span><strong>{file.name}</strong><small>{file.generated ? "Client data sheet · created automatically" : file.ready ? formatBytes(file.byte_size) : "Safety review needed before live delivery"}</small></span>
      </a>
    </li>)}</ul>
    {onOpenFiles ? <button type="button" className={styles.textButton} onClick={onOpenFiles}>Change packet files</button> : null}
  </section>;
}

function MeetClientEmailPreview({ preparedDraft, onExistingDraft, email, report, emailDraft, referral, confirmed, sending, sent, error, message, refresh, onBack, onReviewComplete, onPrepareOutlook, onOutlookSent }: {
  preparedDraft: OutlookDraftView | null; onExistingDraft: (draft: OutlookDraftView | null) => void;
  email: ChartPayload["email"]; report: AssessmentSummaryReport | null; emailDraft?: HandoffRecipients; referral: Referral;
  confirmed: boolean; sending: boolean; sent: boolean; error: string; message: string; refresh: React.ReactNode;
  onBack: () => void; onReviewComplete: () => void;
  onPrepareOutlook: (token: string) => Promise<OutlookDraftView | undefined>; onOutlookSent: () => void;
}) {
  const composerReadOnly = [!email.can_edit_recipients, sending, sent, Boolean(preparedDraft)].some(Boolean);
  const renderMessagePreview = () => (preparedDraft ? <PreparedDraftDetails draft={preparedDraft} /> : <>
        <div className={styles.addressRow}><span>From</span><strong>Your Outlook mailbox</strong></div>
        <div className={styles.addressRow}><span>To</span><span>{emailDraft?.fields.to.map((contact) => contact.email).join("; ") || "No recipients"}</span></div>
        {emailDraft?.fields.cc.length ? <div className={styles.addressRow}><span>Cc</span><span>{emailDraft.fields.cc.map((contact) => contact.email).join("; ")}</span></div> : null}
        <MeetClientMessageEditor demo={email.example_only} summary={report?.meetClient} preview={email.preview} preparedBy={email.prepared_by ?? ""}
          attachments={email.admission_packet.files.map((file) => file.name)} draft={emailDraft} admissionDate={getPlannedAdmissionDate(referral)} disabled={composerReadOnly} />
        {!email.example_only ? <details className={styles.deliveryDetails}><summary>Delivery details</summary>
          {email.blockers.length ? <ul>{email.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
          {refresh}{renderPacketAccess(email, sent, referral.id)}
        </details> : null}
      </>);
  const renderCompletion = () => <footer className={styles.toolbar}>
    <button type="button" className={styles.textButton} onClick={onBack}>Back</button>
    <button type="button" className={styles.sendButton} disabled={!sent && !handoffDraftReady(emailDraft)} onClick={onReviewComplete}>{email.example_only ? "Finish demo review" : "Done"}<Check size={18} aria-hidden="true" /></button>
  </footer>;
  return <div className={styles.composer} data-guide-target="chart-email-handoff">
    <div className={styles.composeScroll}>
      {email.example_only ? <p role="status" className={styles.demoNotice}>Not production yet — no draft will be created and no email will be sent.</p> : null}
      {renderMessagePreview()}
    </div>
    <ChartStatusMessage error={error} message={message} />
    {emailDraft && !preparedDraft ? <HandoffDraftStatus value={emailDraft} /> : null}
    {sent || email.example_only ? renderCompletion() : <footer className={`${styles.toolbar} ${styles.outlookToolbar}`}>
      {!preparedDraft ? <button type="button" className={styles.textButton} disabled={sending} onClick={onBack}>Back to recipients</button> : null}
      <OutlookHandoffControls selected referralId={referral.id} demo={false} ready={canSendHandoff(email, emailDraft, confirmed, sending)} readinessReasons={handoffReadinessReasons(email, emailDraft, confirmed, sending)} sending={sending}
        onPrepare={onPrepareOutlook} onSent={onOutlookSent} onExistingDraft={onExistingDraft} />
    </footer>}
  </div>;
}

function handoffReadinessReasons(email: ChartPayload["email"], draft: HandoffRecipients | undefined, confirmed: boolean, sending: boolean): string[] {
  if (sending) return ["Preparing your Outlook draft. Please wait."];
  const reasons = [...email.blockers];
  if (!email.can_send) reasons.push("This workspace cannot prepare an Outlook draft with your current access. Ask an administrator to check your access.");
  if (!draft || draft.loading) reasons.push("Loading the saved recipients and message. Please wait.");
  else if (draft.error) reasons.push(draft.error);
  else if (draft.hasPendingRecipients) reasons.push("Go back to recipients and press Enter or + to add the unfinished address.");
  else if (!draft.fields.to.length) reasons.push("Go back to recipients and add at least one authorized recipient to the To list.");
  else if (!confirmed) reasons.push("Go back to recipients and confirm that each person is authorized to receive this client's information.");
  return reasons;
}

function canSendHandoff(email: ChartPayload["email"], draft: HandoffRecipients | undefined, confirmed: boolean, sending: boolean) {
  return !sending && email.ready && confirmed && Boolean(draft?.fields.to.length) && handoffDraftReady(draft);
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

function retryableSendError(error: unknown) {
  return error instanceof PipelineApiError && (error.payload as { retryable?: boolean } | undefined)?.retryable === true;
}

function renderPacketAccess(email: ChartPayload["email"], sent: boolean, referralId: number) {
  return email.can_edit_recipients && !email.example_only ? <AdmissionPacketAccessControls key={sent ? "sent" : "pending"} referralId={referralId} /> : null;
}

function PreparedDraftDetails({ draft }: { draft: OutlookDraftView }) {
  return <section className={styles.recipientSection} style={{ overflowWrap: "anywhere" }} aria-label="Prepared handoff details">
    <h3>Prepared handoff</h3>
    <p>Use the prepared message in {draft.mailbox}. To change the message, recipients or files, prepare a replacement below.</p>
    {draft.to_recipients ? <>
      <div className={styles.addressRow}><span>To</span><div>{draft.to_recipients?.join("; ")}</div></div>
      <div className={styles.addressRow}><span>Cc</span><div>{draft.cc_recipients?.join("; ") || "None"}</div></div>
    </> : null}
    <p>Assessment version {draft.assessment_version} · {draft.file_count} files in the prepared packet.</p>
  </section>;
}
