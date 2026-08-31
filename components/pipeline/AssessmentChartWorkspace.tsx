"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, LoaderCircle, Mail, RefreshCw, Send, UserRound } from "lucide-react";

import type {
  AssessmentSummaryItem,
  AssessmentSummaryReport,
  MeetClientSummary,
} from "@/lib/assessment/assessment-summary";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";

type ChartView = "complete" | "meet-client";

type ChartPayload = {
  referral: Referral;
  report: AssessmentSummaryReport | null;
  email: {
    configured: boolean;
    allowed_recipient_domains: string[];
    eligible: boolean;
    ready: boolean;
    blockers: string[];
  };
};

export default function AssessmentChartWorkspace({ referralId }: { referralId?: number }) {
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [view, setView] = useState<ChartView>("complete");
  const [loading, setLoading] = useState(Boolean(referralId));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recipients, setRecipients] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    if (!referralId) return;
    setLoading(true);
    setError("");
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
    if (!payload?.email.ready || !confirmed) return;
    const recipientList = recipients.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean);
    setSending(true);
    setError("");
    setMessage("");
    try {
      const result = await fetchPipelineJson<{ recipient_count: number }>(
        `/api/referrals/${payload.referral.id}/meet-client-email`,
        {
          method: "POST",
          body: JSON.stringify({
            recipients: recipientList,
            confirmed: true,
            client_mutation_id: crypto.randomUUID(),
          }),
        },
        { timeoutMs: 20_000 },
      );
      setConfirmed(false);
      setMessage(`Sent to ${result.recipient_count} recipient${result.recipient_count === 1 ? "" : "s"}.`);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Meet the Client could not be emailed.");
    } finally {
      setSending(false);
    }
  };

  const unavailable = chartUnavailableState(referralId, loading, payload, error, load);
  if (unavailable) return unavailable;
  const readyPayload = payload!;
  const report = readyPayload.report!;

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#d9dfdb]">
        <nav aria-label="Assessment chart views" className="flex gap-7">
          <ChartTab active={view === "complete"} icon={<FileText size={14} />} label="Complete chart" onClick={() => setView("complete")} />
          <ChartTab active={view === "meet-client"} icon={<UserRound size={14} />} label="Meet the Client" onClick={() => setView("meet-client")} />
        </nav>
        <button type="button" onClick={() => void load()} disabled={loading || sending} className="mb-2 flex h-8 items-center gap-2 px-2 text-[10px] font-black text-[#59635e] hover:text-[#0f8b73] disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <ChartStatusMessage error={error} message={message} />

      <div className="mt-5">
        {view === "complete" ? (
          <CompleteAssessmentChart report={report} />
        ) : (
          <MeetClientChart
            summary={report.meetClient}
            email={readyPayload.email}
            recipients={recipients}
            confirmed={confirmed}
            sending={sending}
            onRecipients={setRecipients}
            onConfirmed={setConfirmed}
            onSend={() => void emailMeetClient()}
          />
        )}
      </div>
    </div>
  );
}

function chartUnavailableState(
  referralId: number | undefined,
  loading: boolean,
  payload: ChartPayload | null,
  error: string,
  load: () => Promise<void>,
) {
  if (!referralId) return <EmptyState text="Save the referral before opening its assessment records." />;
  if (loading && !payload) return <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-[#66706b]"><LoaderCircle size={16} className="animate-spin" /> Loading assessment records...</div>;
  if (!payload) return <EmptyState text={error || "The assessment records are unavailable."} onRetry={() => void load()} />;
  if (!payload.report) return <EmptyState text="Complete and sign the assessment to generate the client charts." onRetry={() => void load()} />;
  return null;
}

function ChartStatusMessage({ error, message }: { error: string; message: string }) {
  const text = error || message;
  if (!text) return null;
  return <div role={error ? "alert" : "status"} className={`mt-4 border-l-2 px-4 py-3 text-[12px] ${error ? "border-[#a4473c] bg-[#fff7f5] text-[#6e342d]" : "border-[#0f8b73] bg-[#f0f8f5] text-[#285f53]"}`}>{text}</div>;
}

function ChartTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`flex h-10 items-center gap-2 border-b-2 px-1 text-[11px] font-black ${active ? "border-[#0f8b73] text-[#17211d]" : "border-transparent text-[#707975] hover:text-[#0f8b73]"}`}>
      {icon}{label}
    </button>
  );
}

function CompleteAssessmentChart({ report }: { report: AssessmentSummaryReport }) {
  return (
    <article aria-label="Complete assessment chart" className="border border-[#cfd7d2] bg-white">
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
        <div className="border border-white/25 px-3 py-1 text-[9px] font-black uppercase tracking-[0.08em]">Signed assessment</div>
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
            <dd className="mt-1 whitespace-pre-line text-[11px] leading-5 text-[#222a26]">{item.value}</dd>
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
      <span>Signed {report.signedAt ? formatTimestamp(report.signedAt) : ""}{report.signedBy ? ` by ${report.signedBy}` : ""}</span>
    </footer>
  );
}

function MeetClientChart({
  summary,
  email,
  recipients,
  confirmed,
  sending,
  onRecipients,
  onConfirmed,
  onSend,
}: {
  summary: MeetClientSummary;
  email: ChartPayload["email"];
  recipients: string;
  confirmed: boolean;
  sending: boolean;
  onRecipients: (value: string) => void;
  onConfirmed: (value: boolean) => void;
  onSend: () => void;
}) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <article aria-label="Meet the Client chart" className="border border-[#cfd7d2] bg-white">
        <div className="bg-[#eaf3ef] px-5 py-5 sm:px-7">
          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-[#4e7167]">Admission face sheet</div>
          <h2 className="mt-1 text-[22px] font-black tracking-[-0.03em] text-[#183f37]">Meet the Client</h2>
        </div>
        <div className="grid gap-px border-y border-[#cfd7d2] bg-[#cfd7d2] sm:grid-cols-2 lg:grid-cols-4">
          <HeaderFact label="Name" value={summary.name} />
          <HeaderFact label="Date of birth" value={formatDate(summary.dateOfBirth)} />
          <HeaderFact label="Community" value={summary.community} />
          <HeaderFact label="Assessment date" value={formatDate(summary.assessmentDate)} />
        </div>
        <MeetSection title="A little about the client" values={summary.bio} />
        <MeetSection title="Current medications" values={summary.medications} empty="No reconciled medications were recorded." />
        <ChartSection title="Medication notes" items={summary.medicationNotes} />
        <ChartSection title="Support snapshot" items={summary.supportSnapshot} />
        <div className="bg-[#f7faf8] px-5 py-4 text-[9px] text-[#69736e] sm:px-7">Prepared from assessment {summary.preparedFromAssessmentId}, version {summary.preparedFromAssessmentVersion}.</div>
      </article>

      <aside className="border border-[#cfd7d2] bg-[#f8faf9] p-5" aria-label="Email Meet the Client">
        <div className="flex items-center gap-2"><Mail size={15} className="text-[#0f8b73]" /><h3 className="text-[12px] font-black">Email this face sheet</h3></div>
        {!email.eligible ? (
          <p className="mt-3 text-[11px] leading-5 text-[#67716c]">Email becomes available after the referral has an accepted admission decision.</p>
        ) : (
          <>
            <label htmlFor="meet-client-recipients" className="mt-4 block text-[9px] font-black uppercase text-[#5e6863]">Authorized recipients</label>
            <textarea id="meet-client-recipients" value={recipients} onChange={(event) => onRecipients(event.target.value)} rows={3} placeholder="name@organization.org" className="mt-2 w-full resize-y border border-[#cfd7d2] bg-white px-3 py-2 text-[11px] outline-none focus:border-[#0f8b73]" />
            <p className="mt-1 text-[9px] leading-4 text-[#727b76]">Approved domains: {email.allowed_recipient_domains.join(", ") || "not configured"}</p>
            <label className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-[#47514c]"><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} className="mt-0.5" /><span>I verified that each recipient is authorized to receive this protected information.</span></label>
            {email.blockers.length > 0 ? <p className="mt-3 text-[10px] leading-4 text-[#8a5a10]">{email.blockers.join(" ")}</p> : null}
            <button type="button" onClick={onSend} disabled={sending || !email.ready || !confirmed || !recipients.trim()} className="mt-4 flex h-9 w-full items-center justify-center gap-2 bg-[#0f8b73] px-4 text-[10px] font-black text-white hover:bg-[#0b725f] disabled:cursor-not-allowed disabled:bg-[#adb5b1]"><Send size={13} /> {sending ? "Sending..." : "Email Meet the Client"}</button>
          </>
        )}
      </aside>
    </div>
  );
}

function MeetSection({ title, values, empty = "Not recorded." }: { title: string; values: string[]; empty?: string }) {
  return (
    <section className="border-b border-[#dfe4e1] px-5 py-5 sm:px-7">
      <h3 className="text-[11px] font-black uppercase tracking-[0.04em] text-[#234c42]">{title}</h3>
      {values.length > 0 ? <ul className="mt-3 space-y-2 text-[11px] leading-5 text-[#222a26]">{values.map((value, index) => <li key={`${title}:${index}`} className="flex gap-2"><span className="text-[#0f8b73]">-</span><span>{value}</span></li>)}</ul> : <p className="mt-2 text-[11px] text-[#727b76]">{empty}</p>}
    </section>
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
