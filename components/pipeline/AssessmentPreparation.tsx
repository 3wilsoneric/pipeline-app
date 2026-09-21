"use client";

import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import folderStyles from "@/components/pipeline/ClientFolder.module.css";
import workspaceFolderStyles from "@/components/pipeline/ReferralWorkspaceFolder.module.css";
import styles from "@/components/pipeline/AssessmentPreparation.module.css";

export function AssessmentFileNavigation({ hidden, disabled, preparing, reviewingChart, preparationAvailable = true, onPrepare, onAssessment, onChart }: {
  hidden: boolean;
  disabled: boolean;
  preparing: boolean;
  reviewingChart: boolean;
  preparationAvailable?: boolean;
  onPrepare: () => void;
  onAssessment: () => void;
  onChart: () => void;
}) {
  if (hidden) return null;
  return <nav aria-label="Client file pages" className={`${workspaceFolderStyles.stages} ${styles.filePages}`}>
    {preparationAvailable ? <button type="button" className={workspaceFolderStyles.stageTab} data-folder-stage="1" disabled={disabled} aria-current={preparing ? "page" : undefined} onClick={onPrepare}>Prepare</button> : null}
    <button type="button" className={workspaceFolderStyles.stageTab} data-folder-stage="2" disabled={disabled} aria-current={!preparing && !reviewingChart ? "page" : undefined} onClick={onAssessment}>Assessment</button>
    <button type="button" className={workspaceFolderStyles.stageTab} data-folder-stage="3" disabled={disabled} aria-current={reviewingChart ? "page" : undefined} onClick={onChart}>Chart</button>
  </nav>;
}

export function AssessmentFileSurface({ title, container, header, dialogs, children }: {
  title?: string;
  container: HTMLElement | null;
  header: React.ReactNode;
  dialogs: React.ReactNode;
  children: React.ReactNode;
}) {
  const portalReady = useSyncExternalStore(subscribeToBrowser, () => true, () => false);
  if (title) return <>
    <div data-testid="assessment-client-folder" className={`${folderStyles.recordFolder} ${workspaceFolderStyles.connectedFolder} ${styles.workspaceFile}`}>
      <div className={folderStyles.body}>
        <section aria-label="Assessment pages" data-assessment-view="assessment" className={`${folderStyles.paper} ${styles.workspacePaper}`}>{children}</section>
      </div>
    </div>
    {portalReady ? createPortal(dialogs, container?.parentElement ?? document.body) : null}
  </>;
  if (!portalReady) return null;
  return createPortal(
    <section role="dialog" aria-modal="false" aria-label="Assessment interview" data-assessment-view="chart" data-testid="assessment-client-folder" className={`${folderStyles.folder} ${styles.surface} ${container ? "absolute" : "fixed"} inset-0 z-[90] overflow-hidden`}>
      {header}
      <div className={`${folderStyles.body} ${styles.folderBody}`}>
        <div className={`${folderStyles.paper} ${styles.folderPaper}`}>{children}</div>
      </div>
      {dialogs}
    </section>,
    container ?? document.body,
  );
}

function subscribeToBrowser() {
  return () => undefined;
}
