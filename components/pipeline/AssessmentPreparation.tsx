"use client";

import { createPortal } from "react-dom";
import { assessmentPreparationGroups, preparationQuestions } from "@/lib/assessment/assessment-preparation";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { WorkingAssessmentField, type WorkingSectionProps } from "@/components/pipeline/AssessmentWorkingSection";
import { assessmentWorkingCounts, groupWorkingQuestions } from "@/components/pipeline/assessment-working-view";
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
  if (title) return <>
    <div data-testid="assessment-client-folder" className={`${folderStyles.recordFolder} ${workspaceFolderStyles.connectedFolder} ${styles.workspaceFile}`}>
      <div className={folderStyles.body}>
        <section aria-label="Assessment pages" data-assessment-view="assessment" className={`${folderStyles.paper} ${styles.workspacePaper}`}>{children}</section>
      </div>
    </div>
    {createPortal(dialogs, container?.parentElement ?? document.body)}
  </>;
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

export function PreparationNavigation({ active, data, pending, onChange }: Pick<WorkingSectionProps, "data" | "pending"> & {
  active: AssessmentToolSection;
  onChange: (section: AssessmentToolSection) => void;
}) {
  return <nav aria-label="Preparation groups" className={styles.groupNavigation}>
    {assessmentPreparationGroups.map((group, index) => {
      const questions = preparationQuestions(group, data);
      const counts = assessmentWorkingCounts(questions, data, pending);
      return <button key={group.key} type="button" aria-current={active === group.key ? "step" : undefined} onClick={() => onChange(group.key)}>
        <span className={styles.groupNumber}>{index + 1}</span>
        <span><span>{group.label}</span><small>{counts.captured} of {questions.length} recorded{counts.verify ? ` · ${counts.verify} to verify` : ""}</small></span>
      </button>;
    })}
    <p>Fill in what the referral supports. You can begin the assessment with unanswered questions.</p>
  </nav>;
}

export default function AssessmentPreparation(props: WorkingSectionProps) {
  return <article aria-label="Referral preparation worksheet" data-assessment-preparation className={`${folderStyles.body} ${styles.worksheet}`}>
    <div className={folderStyles.paper}>
      {groupWorkingQuestions(props.questions).map((group) => <section key={group.label} aria-label={group.label} className={styles.questionGroup}>
        <h4>{group.label}</h4>
        <div className={styles.fields}>
          {group.questions.map((question) => <WorkingAssessmentField key={question.field} {...props} question={question} />)}
        </div>
      </section>)}
    </div>
  </article>;
}
