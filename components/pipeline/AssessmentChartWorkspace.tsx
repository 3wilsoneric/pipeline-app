"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle, Mail, Paperclip, RefreshCw, Send } from "lucide-react";

import type {
  AssessmentSummaryItem,
  AssessmentSummaryReport,
} from "@/lib/assessment/assessment-summary";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import ReadableChartText from "@/components/pipeline/ReadableChartText";

import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./MeetClientEmailPage.module.css";

type ChartPayload = {
  referral: Referral;
  report: AssessmentSummaryReport | null;
  email: {
    configured: boolean;
    sender: string;
    preview: { subject: string; html: string } | null;
    allowed_recipient_domains: string[];
    eligible: boolean;
    can_send: boolean;
    ready: boolean;
    blockers: string[];
    admission_packet: {
      files: Array<{
        document_id: string;
        name: string;
        category: string;
        byte_size: number;
        ready: boolean;
      }>;
      total_bytes: number;
      ready: boolean;
      delivery_mode: "direct" | "draft_upload" | null;
    };
  };
};

export default function AssessmentChartWorkspace({ referralId, embedded = false, emailPage = false, emailDraft, onOpenEmail, onOpenFiles, onOpenAssessment, onOpenDecision }: {
  referralId?: number;
  embedded?: boolean;
  emailPage?: boolean;
  emailDraft?: { recipients: string; onChange: (value: string) => void };
  onOpenEmail?: () => void;
  onOpenFiles?: () => void;
  onOpenAssessment?: () => void;
  onOpenDecision?: () => void;
}) {
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(referralId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const recipients = emailDraft?.recipients ?? "";
  const [confirmed, setConfirmed] = useState(false);
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

  const emailMeetClient = async () => {
    if (!payload?.email.ready || !confirmed || sendInFlight.current) return;
    const recipientList = recipients.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean);
    const requestKey = JSON.stringify([
      payload.referral.id, payload.referral.version, payload.report?.assessmentId, payload.report?.assessmentVersion,
      [...new Set(recipientList.map((recipient) => recipient.toLowerCase()))].sort(),
      payload.email.admission_packet.files.map((file) => file.document_id).sort(),
    ]);
    if (sendRequest.current?.key !== requestKey) sendRequest.current = { key: requestKey, mutationId: crypto.randomUUID() };
    sendInFlight.current = true;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const result = await fetchPipelineJson<{ recipient_count: number; attachment_count: number; delivery_id: string; audit_pending?: boolean }>(
        `/api/referrals/${payload.referral.id}/meet-client-email`,
        {
          method: "POST",
          body: JSON.stringify({
            recipients: recipientList,
            confirmed: true,
            if_match: payload.referral.version,
            client_mutation_id: sendRequest.current.mutationId,
          }),
        },
        { timeoutMs: 300_000 },
      );
      setConfirmed(false);
      setMessage(`Microsoft 365 accepted the summary and ${result.attachment_count} admission file${result.attachment_count === 1 ? "" : "s"} for ${result.recipient_count} recipient${result.recipient_count === 1 ? "" : "s"}.${result.audit_pending ? ` Send history is pending; do not resend. Reference: ${result.delivery_id}.` : ""}`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Meet the Client could not be emailed.");
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  };

  const unavailable = chartUnavailableState(referralId, loading, payload, error, load, embedded, emailPage);
  if (unavailable) return unavailable;
  const readyPayload = payload!;
  const refresh = <button type="button" onClick={() => void load()} disabled={loading || sending} className={styles.textButton}>
    <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
  </button>;

  if (emailPage) return (
    <section className={styles.page} aria-label="Email and referral packet">
      <header className={styles.pageHeader}>
        <div><h2>Email &amp; packet</h2><p>Review Meet the Client and the files that travel with it.</p></div>
        {refresh}
      </header>
      <ChartStatusMessage error={error} message={message} />
      <MeetClientEmailPreview email={readyPayload.email} recipients={recipients} confirmed={confirmed} sending={sending}
        onRecipients={(value) => { emailDraft?.onChange(value); setConfirmed(false); }} onConfirmed={setConfirmed}
        onSend={() => void emailMeetClient()} onOpenFiles={onOpenFiles} onOpenAssessment={onOpenAssessment} onOpenDecision={onOpenDecision} />
    </section>
  );

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <div className={styles.chartActions}>
        {onOpenEmail ? <button type="button" data-guide-target="chart-meet-client-tab" className={styles.textButton} onClick={onOpenEmail}><Mail size={16} />Open email &amp; packet</button> : null}
        {refresh}
      </div>
      <ChartStatusMessage error={error} message={message} />
      <AssessmentRecord report={readyPayload.report!} embedded={embedded} />
    </div>
  );
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
        {items.map((item) => (
          <div key={`${title}:${item.label}`} className="min-w-0">
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

function MeetClientEmailPreview({ email, recipients, confirmed, sending, onRecipients, onConfirmed, onSend, onOpenFiles, onOpenAssessment, onOpenDecision }: {
  email: ChartPayload["email"];
  recipients: string;
  confirmed: boolean;
  sending: boolean;
  onRecipients: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onSend: () => void;
  onOpenFiles?: () => void;
  onOpenAssessment?: () => void;
  onOpenDecision?: () => void;
}) {
  const status = !email.configured ? "Preview only · email delivery is not connected."
    : !email.eligible ? "Preview ready · record acceptance before sending."
    : !email.preview ? "Your summary will appear when an assessment is signed."
    : !email.ready ? "Preview ready · review the items below before sending."
    : "Review the recipients and packet, then send when ready.";
  return (
    <div className={styles.composer} data-guide-target="chart-email-handoff">
      <div className={styles.toolbar}>
        <button type="button" className={styles.sendButton} onClick={onSend}
          disabled={sending || !email.ready || !confirmed || !recipients.trim()}>
          <Send size={16} />{sending ? "Sending…" : "Send email & packet"}
        </button>
        <span className={styles.previewLabel}>Email preview</span>
      </div>
      <div className={styles.addressRow}><span>From</span><span>{email.sender || "Sending account not connected"}</span></div>
      <div className={styles.addressRow}>
        <label htmlFor="meet-client-recipients">To</label>
        <textarea id="meet-client-recipients" aria-label="Authorized recipients" value={recipients} onChange={(event) => onRecipients(event.target.value)}
          disabled={!email.can_send || sending} rows={1} placeholder="Add authorized recipients" spellCheck={false} autoComplete="off" />
      </div>
      <div className={styles.addressRow}><span>Subject</span><span className={styles.subject}>{email.preview?.subject || "Meet the Client"}</span></div>
      <section className={styles.attachments} aria-label="Referral packet attachments">
        <div className={styles.attachmentHeading}>
          <span><Paperclip size={15} />{email.admission_packet.files.length} attachment{email.admission_packet.files.length === 1 ? "" : "s"} · {formatBytes(email.admission_packet.total_bytes)}</span>
          {onOpenFiles ? <button type="button" className={styles.textButton} onClick={onOpenFiles}>Manage files</button> : null}
        </div>
        {email.admission_packet.files.length ? <ul className={styles.attachmentList}>
          {email.admission_packet.files.map((file) => <li key={file.document_id}>
            <a className={styles.attachment} href={toPipelinePath(`/api/files/${encodeURIComponent(file.document_id)}/download`)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${file.name}`}>
              <FileText size={23} aria-hidden="true" /><span><strong>{file.name}</strong><small>{file.ready ? formatBytes(file.byte_size) : "Not ready to send"}</small></span>
            </a>
          </li>)}
        </ul> : <p className={styles.emptyAttachments}>No packet files yet. Add them in Files whenever you’re ready.</p>}
      </section>
      <div className={styles.messageBody}>
        {email.preview ? <iframe title="Meet the Client email preview" srcDoc={email.preview.html} sandbox="" referrerPolicy="no-referrer" className={styles.emailFrame} />
          : <div className={styles.emptyPreview}><Mail size={30} /><h3>Your email preview will appear here</h3><p>You can review files and recipients now. Sign an assessment to fill in the client summary.</p>{onOpenAssessment ? <button type="button" className={styles.textButton} onClick={onOpenAssessment}>Open assessment</button> : null}</div>}
      </div>
      <footer className={styles.footer}>
        <p role="status">{status}</p>
        <details className={styles.deliveryDetails}>
          <summary>Delivery details</summary>
          {email.blockers.length ? <ul>{email.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}
          <p>Approved recipient domains: {email.allowed_recipient_domains.join(", ") || "Not connected yet"}.</p>
          <div className={styles.detailActions}>
            {!email.eligible && onOpenDecision ? <button type="button" className={styles.textButton} onClick={onOpenDecision}>Open decision</button> : null}
            {onOpenAssessment ? <button type="button" className={styles.textButton} onClick={onOpenAssessment}>Review assessment</button> : null}
          </div>
        </details>
        {email.can_send ? <label className={styles.confirmation}><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} disabled={sending} /><span>I verified that each recipient is authorized to receive this summary and the attached files.</span></label> : null}
      </footer>
    </div>
  );
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
