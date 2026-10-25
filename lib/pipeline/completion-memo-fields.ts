import { assessmentToolFieldDefinitions, type AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";

const assessmentFieldKeys = new Set<string>(assessmentToolFieldDefinitions.map((field) => field.key));
const memoAddendumPrefix = "completion_review:";

export function completionMemoAssessmentField(taskId: string): AssessmentToolFieldKey | null {
  if (taskId === "review:dob" || taskId === "assessment:signature") return null;
  const key = taskId.startsWith("assessment:field:") ? taskId.slice("assessment:field:".length)
    : taskId.startsWith("assessment:unable:") ? taskId.slice("assessment:unable:".length)
    : taskId.startsWith("assessment:") ? taskId.slice("assessment:".length)
    : taskId.startsWith("review:") ? taskId.slice("review:".length) : "";
  return assessmentFieldKeys.has(key) ? key as AssessmentToolFieldKey : null;
}

export function completionMemoAddendumReason(field: AssessmentToolFieldKey) {
  return `${memoAddendumPrefix}${field}`;
}
