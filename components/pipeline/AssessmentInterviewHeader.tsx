"use client";

import type { ReactNode, RefObject } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import folderStyles from "@/components/pipeline/ReferralWorkspaceFolder.module.css";
import styles from "@/components/pipeline/AssessmentPreparation.module.css";

export function AssessmentFileDetails({ label, children, detailsRef, className = "" }: {
  label: ReactNode;
  children: ReactNode;
  detailsRef: RefObject<HTMLDetailsElement | null>;
  className?: string;
}) {
  return <details ref={detailsRef} className={`${styles.fileDetails} ${className}`} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && event.currentTarget.open) {
      event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }} onClick={(event) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="Assessment details" title="Assessment details">{label}<ChevronDown size={14} aria-hidden="true" /></summary>
    <div role="group" aria-label="Assessment details" className={styles.fileDetailsPanel}>{children}</div>
  </details>;
}

export default function AssessmentInterviewHeader({ name, community, disabled, returnLabel, pages, details, detailsRef, onClose }: {
  name: string | null;
  community: string | null;
  disabled: boolean;
  returnLabel: string;
  pages: React.ReactNode;
  details: ReactNode;
  detailsRef: RefObject<HTMLDetailsElement | null>;
  onClose: () => void;
}) {
  const title = formatClientIdentityTitle({ name: name || "Client", community });
  return (
    <header data-assessment-folder-header className={styles.folderHeader}>
      {details ? <AssessmentFileDetails label={<h2 className={folderStyles.nameLabel}>{title}</h2>} detailsRef={detailsRef} className={`${folderStyles.identity} ${styles.folderIdentity}`}>{details}</AssessmentFileDetails> : <h2 className={`${folderStyles.identity} ${styles.folderIdentity}`} title={title}>
        <span className={folderStyles.nameLabel}>{title}</span>
      </h2>}
      {pages}
      <button type="button" data-assessment-return onClick={onClose} disabled={disabled} aria-label={returnLabel} className={styles.returnButton}>
        <ArrowLeft size={17} aria-hidden="true" /><span className={styles.returnText}>{returnLabel}</span><span className={styles.returnCompact} aria-hidden="true">{returnLabel === "Back to referral" ? "Referral" : "Workspace"}</span>
      </button>
    </header>
  );
}
