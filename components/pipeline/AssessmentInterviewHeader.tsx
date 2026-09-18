"use client";

import { ArrowLeft } from "lucide-react";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import folderStyles from "@/components/pipeline/ReferralWorkspaceFolder.module.css";
import styles from "@/components/pipeline/AssessmentPreparation.module.css";

export default function AssessmentInterviewHeader({ name, community, disabled, returnLabel, pages, onClose }: {
  name: string | null;
  community: string | null;
  disabled: boolean;
  returnLabel: string;
  pages: React.ReactNode;
  onClose: () => void;
}) {
  const title = formatClientIdentityTitle({ name: name || "Client", community });
  return (
    <header data-assessment-folder-header className={styles.folderHeader}>
      <h2 className={`${folderStyles.identity} ${styles.folderIdentity}`} title={title}>
        <span className={folderStyles.nameLabel}>{title}</span>
      </h2>
      {pages}
      <button type="button" data-assessment-return onClick={onClose} disabled={disabled} aria-label={returnLabel} className={styles.returnButton}>
        <ArrowLeft size={17} aria-hidden="true" /><span className={styles.returnText}>{returnLabel}</span><span className={styles.returnCompact} aria-hidden="true">{returnLabel === "Back to referral" ? "Referral" : "Workspace"}</span>
      </button>
    </header>
  );
}
