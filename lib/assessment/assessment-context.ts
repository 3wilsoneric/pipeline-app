import { createHash } from "node:crypto";
import { assessmentToolFieldDefinitions } from "./assessment-tool-schema";
import {
  assessmentInterviewQuestions,
  assessmentInterviewSections,
  assessmentRetainedAnswerFields,
  getAssessmentQuestionConditions,
  getAssessmentUnableReason,
  getRequiredAssessmentInterviewQuestions,
  isAssessmentQuestionVisible,
} from "./assessment-interview-schema";
import { getAssessmentCompletionSummary } from "./assessment-completion";
import type { PipelineAssessmentRecord } from "./assessment-records";

// Definitions are owned by the same modules that render and validate the form.
// Consumers must preserve this hash: a question can change without an answer changing.
export function assessmentContextDefinitions() {
  return {
    sections: assessmentInterviewSections,
    fields: assessmentToolFieldDefinitions.map((field) => {
      const question = assessmentInterviewQuestions.find((item) => item.field === field.key);
      return { ...field, question: question ? {
        ...question,
        conditions: getAssessmentQuestionConditions(question),
        visibility: assessmentRetainedAnswerFields.includes(question.field)
          ? "conditions-and-existing-answer" : "conditions",
      } : null };
    }),
  };
}

export function buildAssessmentContext(record: PipelineAssessmentRecord) {
  const definitions = assessmentContextDefinitions();
  const required = new Set(getRequiredAssessmentInterviewQuestions(record).map((question) => question.field));
  const definitionHash = createHash("sha256").update(JSON.stringify(definitions)).digest("hex");
  const readPath = `/api/assessments/${encodeURIComponent(record.assessment_id)}`;
  const fields = definitions.fields.map((definition) => {
    const value = record[definition.key];
    const question = assessmentInterviewQuestions.find((item) => item.field === definition.key);
    return {
      id: `pipeline:field:${definition.key}`,
      definition,
      answer: {
        // Do not merge unanswered, empty, unknown, unable, zero or hidden values.
        value: value === undefined ? null : value,
        state: value === undefined ? "absent" : value === null ? "null" :
          value === "" || Array.isArray(value) && value.length === 0 ||
          value && typeof value === "object" && Object.keys(value).length === 0 ? "empty" : "recorded",
        visible: question ? isAssessmentQuestionVisible(question, record) : null,
        required: definition.required_for_completion || required.has(definition.key),
        unableReason: getAssessmentUnableReason(record, definition.key) || null,
        // Record-level timestamps/actors cannot establish field authorship or interview time.
        fieldRecordedAt: null,
        askedAt: null,
        provenance: record.field_provenance[definition.key] ?? [],
      },
      evidence: { path: readPath, pointer: `/assessment/${definition.key}`, recordVersion: record.version },
    };
  });
  return {
    schemaVersion: 1,
    kind: "pipeline.assessment-context",
    ownerApplication: "pipeline",
    definitionHash,
    source: { path: readPath, assessmentId: record.assessment_id, referralId: record.referral_id,
      recordVersion: record.version, updatedAt: record.updated_at },
    // Retain the exact source record, including unmapped extraction, addenda,
    // signature, schedule, revisions and audit. No summary replaces the evidence.
    record,
    fields,
    completion: getAssessmentCompletionSummary(record),
    relatedSources: [
      { kind: "workflow", path: `/api/referrals/${record.referral_id}/workflow` },
      { kind: "activity", path: `/api/referrals/${record.referral_id}/activity`, limit: 100 },
      { kind: "assessments", path: `/api/referrals/${record.referral_id}/assessments` },
      { kind: "packet", path: `/api/referrals/${record.referral_id}/packet` },
      { kind: "contacts", path: `/api/referrals/${record.referral_id}/contacts` },
      { kind: "notes", path: `/api/referrals/${record.referral_id}/notes` },
    ],
    coverage: {
      fields: fields.length, questions: assessmentInterviewQuestions.length,
      currentRecord: "complete", history: "partial", originals: "references-only",
      gaps: ["question-asked-time", "per-field-author-and-time", "complete-before-after-history",
        "historical-questionnaire-version", "original-document-bytes", "recipient-acknowledgment"],
    },
    authority: {
      facts: "current-source-record", definitions: "application-behavior-not-approved-policy",
      access: "same-user-and-referral-access-as-source", canExecute: false,
      crossCaseUse: "not-authorized-by-this-response",
    },
  };
}
