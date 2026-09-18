"use client";

import { createPortal } from "react-dom";
import { assessmentPreparationGroups, preparationQuestions } from "@/lib/assessment/assessment-preparation";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { WorkingAssessmentField, type WorkingSectionProps } from "@/components/pipeline/AssessmentWorkingSection";
import { assessmentWorkingCounts, groupWorkingQuestions } from "@/components/pipeline/assessment-working-view";
import folderStyles from "@/components/pipeline/ClientFolder.module.css";
import styles from "@/components/pipeline/AssessmentPreparation.module.css";
import { ClientChartFrame, ClientChartHeader } from "@/components/pipeline/ClientMedicalChart";

export function AssessmentFileNavigation({ hidden, disabled, preparing, onReferral, onPrepare, onAssessment }: {
  hidden: boolean;
  disabled: boolean;
  preparing: boolean;
  onReferral?: () => void;
  onPrepare: () => void;
  onAssessment: () => void;
}) {
  if (hidden) return null;
  return <nav aria-label="Client file pages" className={styles.filePages}>
    {onReferral ? <button type="button" disabled={disabled} onClick={onReferral}>Referral</button> : null}
    <button type="button" aria-current={preparing ? "page" : undefined} onClick={onPrepare}>Prepare</button>
    <button type="button" aria-current={!preparing ? "page" : undefined} onClick={onAssessment}>Assessment</button>
  </nav>;
}

export function AssessmentFileSurface({ title, container, header, pages, dialogs, children }: {
  title?: string;
  container: HTMLElement | null;
  header: React.ReactNode;
  pages: React.ReactNode;
  dialogs: React.ReactNode;
  children: React.ReactNode;
}) {
  if (title) return <>
    <PreparationFile title={title}>
      <section role="region" aria-label="Referral preparation" data-assessment-view="preparation" className={styles.embedded}>{children}</section>
    </PreparationFile>
    {createPortal(dialogs, container?.parentElement ?? document.body)}
  </>;
  return createPortal(
    <section role="dialog" aria-modal="false" aria-label="Assessment interview" data-assessment-view="chart" className={`${styles.surface} ${container ? "absolute" : "fixed"} inset-0 z-[90] flex flex-col overflow-hidden bg-white`}>
      <div className={styles.interviewHeader}>{header}{pages}</div>
      {children}{dialogs}
    </section>,
    container ?? document.body,
  );
}

function PreparationFile({ title, children }: { title: string; children: React.ReactNode }) {
  return <div data-testid="preparation-client-folder" className={`${folderStyles.recordFolder} ${styles.file}`}>
    <strong className={folderStyles.tab}><span className={folderStyles.tabLabel}>{title}</span></strong>
    <div className={folderStyles.body}>
      <div className={`${folderStyles.paper} ${folderStyles.recordPaper}`}>
        <ClientChartFrame label="Referral preparation chart">
          <ClientChartHeader title="Assessment preparation">{null}</ClientChartHeader>
          {children}
        </ClientChartFrame>
      </div>
    </div>
  </div>;
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
