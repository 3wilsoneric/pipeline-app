"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { fetchPipelineApi } from "@/lib/auth/authenticated-fetch";
import { communicationStatusLabels, type CommunicationView } from "@/lib/notifications/communication-contract";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import styles from "./CommunicationHistory.module.css";

export function CommunicationDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.dialogHeader}><h2>{title}</h2><button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${title}`}><X aria-hidden="true" size={22} /></button></header>
    <div className={styles.body}>{children}</div>
  </dialog>;
}

export default function CommunicationRecord({ record, history = false }: { record: CommunicationView; history?: boolean }) {
  const [error, setError] = useState("");
  const [file, setFile] = useState<{ url: string; name: string; type: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  const openFile = async (id: string) => {
    const attachment = record.files.find(item => item.id === id)!;
    setError(""); setOpening(id);
    try {
      const query = new URLSearchParams({ referral_id: String(record.referralId), packet_id: record.id, file_id: id });
      const response = await fetchPipelineApi(`/api/communications?${query}`, { cache: "no-store" }, { timeoutMs: 120_000 });
      if (!response.ok) { const problem = await response.json().catch(() => null); throw new Error(problem?.error || "The saved attachment could not be opened."); }
      const url = URL.createObjectURL(await response.blob());
      if (attachment.contentType === "application/pdf" || ["image/png", "image/jpeg", "image/webp"].includes(attachment.contentType)) setFile({ url, name: attachment.name, type: attachment.contentType });
      else { const link = document.createElement("a"); link.href = url; link.download = attachment.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The saved file could not be opened."); }
    finally { setOpening(null); }
  };
  return <>
    {history ? <p className={styles.status} role="status">{communicationStatusLabels[record.status]} · {new Date(record.submittedAt || record.createdAt).toLocaleString()}</p> : null}
    <dl className={styles.envelope}>
      <dt>From</dt><dd>Alamo Admissions &lt;{record.from}&gt;</dd>
      <dt>To</dt><dd>{record.to.join("; ")}</dd>
      <dt>Cc</dt><dd>{record.cc.join("; ") || "None"}</dd>
      <dt>Reply-To</dt><dd>{record.replyTo}</dd>
      <dt>Subject</dt><dd><strong>{record.subject}</strong></dd>
      <dt>Admission</dt><dd>{record.admissionDate}</dd>
    </dl>
    {record.html ? <iframe title={history ? "Saved handoff email" : "Exact email preview"} srcDoc={record.html.replace('src="https://alamo-pipeline.com/brand/alamo-health-management.png"', `src="${toPipelinePath("/brand/alamo-health-management.png")}"`)} sandbox="" referrerPolicy="no-referrer" className={styles.email} /> : null}
    <details className={styles.files} open><summary>{record.files.length} {record.files.length === 1 ? "attachment" : "attachments"} · original files and client data sheet</summary>
      {record.files.map(item => <button type="button" className={styles.file} key={item.id} disabled={Boolean(opening)} onClick={() => void openFile(item.id)}>
        {opening === item.id ? "Opening…" : item.name}<span>{Math.max(1, Math.round(item.byteSize / 1024))} KB</span>
      </button>)}
    </details>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {history ? <p className={styles.muted}>Prepared by {record.preparedBy} · Assessor: {record.assessorName} · Assessment version {record.assessmentVersion}. {record.status === "submitted" ? "Microsoft accepted this email for delivery. Recipient receipt and replies are not tracked." : record.note}</p> : null}
    {file ? <CommunicationDialog title={file.name} onClose={() => setFile(null)}>
      <iframe title={file.name} src={file.url} className={styles.email} />
      <a href={file.url} download={file.name} className={styles.secondary}>Download original file</a>
    </CommunicationDialog> : null}
  </>;
}
