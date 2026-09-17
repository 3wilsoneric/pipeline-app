"use client";

import { assessmentPreparationGroups, preparationQuestions } from "@/lib/assessment/assessment-preparation";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { WorkingAssessmentField, type WorkingSectionProps } from "@/components/pipeline/AssessmentWorkingSection";
import { assessmentWorkingCounts, groupWorkingQuestions } from "@/components/pipeline/assessment-working-view";
import folderStyles from "@/components/pipeline/ClientFolder.module.css";
import styles from "@/components/pipeline/AssessmentPreparation.module.css";

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
