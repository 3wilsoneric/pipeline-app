"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralFile } from "@/lib/pipeline/referral-types";
import styles from "./InterviewContext.module.css";

const ReferralFilePreviewDialog = dynamic(() => import("./ReferralFilePreviewDialog"), { ssr: false });

// Interview context (docs/design/DECISIONS.md, "Interview context"): the referral summary and the
// referral's documents beside the questions, so the assessor can check them without leaving the
// interview. Documents open over the page and close back to the same question.
export default function InterviewContext({ referralId, summary }: { referralId: number; summary?: string }) {
  const [files, setFiles] = useState<ReferralFile[] | null>(null);
  const [preview, setPreview] = useState<ReferralFile | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<{ files: ReferralFile[] }>(`/api/files?referral_id=${referralId}&limit=12`, { signal: controller.signal }, { cacheTtlMs: 30_000 })
      .then((payload) => { if (!controller.signal.aborted) setFiles(payload.files); })
      // Context is a convenience; the interview works the same without it.
      .catch(() => undefined);
    return () => controller.abort();
  }, [referralId]);

  const text = summary?.trim();
  if (!text && !files?.length) return null;
  return <div className={styles.context}>
    {text ? <section aria-labelledby={`interview-summary-${referralId}`}>
      <h5 id={`interview-summary-${referralId}`} className={styles.heading}>Referral summary</h5>
      <p className={styles.summaryText} title={text}>{text}</p>
    </section> : null}
    {files?.length ? <section aria-labelledby={`interview-documents-${referralId}`} className={styles.documents}>
      <h5 id={`interview-documents-${referralId}`} className={styles.heading}>Documents</h5>
      <ul>
        {files.map((file) => <li key={file.id}>
          <button type="button" aria-label={`Preview ${file.name}`} onClick={() => setPreview(file)} className={styles.document}>
            <FileText size={15} aria-hidden="true" />
            <span className={styles.documentName}>{file.name}</span>
          </button>
        </li>)}
      </ul>
    </section> : null}
    {preview ? <ReferralFilePreviewDialog key={preview.id} file={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}
