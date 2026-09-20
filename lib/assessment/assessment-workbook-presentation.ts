import { getAssessmentQuestionConditions, getRequiredAssessmentInterviewQuestions, hasAssessmentInterviewValue, isAssessmentQuestionVisible, type AssessmentQuestionRule } from "./assessment-interview-schema";
import { assessmentWorkbookFields } from "./assessment-workbook-contract";
import { requiredAssessmentToolFields, type AssessmentToolData } from "./assessment-tool-schema";

type Field = typeof assessmentWorkbookFields[number];

export const assessmentWorkbookPresentationVersion = "3";

export function workbookFieldStatus(field: Field, data: AssessmentToolData) {
  if (!field.editable) return "Reference only";
  if (field.question && !isAssessmentQuestionVisible(field.question, data)) {
    const retained = hasAssessmentInterviewValue(data[field.key]) || data.unable_to_assess_reasons[field.key]?.trim();
    return retained ? "Review previous answer" : "Not applicable";
  }
  return applicableFieldStatus(field, data);
}

function applicableFieldStatus(field: Field, data: AssessmentToolData) {
  const reason = data.unable_to_assess_reasons[field.key]?.trim();
  if (reason && data[field.key] !== "unable_to_assess") return "Review previous reason";
  if (data[field.key] === "unable_to_assess" && field.question?.control === "yes_no" && !reason) return "Explain why";
  if (hasAssessmentInterviewValue(data[field.key])) return "Answered";
  const required = requiredAssessmentToolFields.includes(field.key) || getRequiredAssessmentInterviewQuestions(data).some((q) => q.field === field.key);
  return required ? "Needs answer" : "Optional";
}

const literal = (text: string) => `"${text.replaceAll('"', '""')}"`;
const reference = (field: Field) => `'${field.sheet.replaceAll("'", "''")}'!$C$${field.row}`;

function ruleFormula(rule: AssessmentQuestionRule) {
  const parent = assessmentWorkbookFields.find((field) => field.key === rule.field)!;
  const cell = reference(parent);
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  const choices = [...new Set(values.flatMap((value) => [value, parent.question?.options?.find((o) => o.value === value)?.label ?? value]))];
  const text = `LOWER(TRIM(${cell}&""))`;
  const tests = choices.map((value) => rule.operator === "includes"
    ? `ISNUMBER(SEARCH(CHAR(10)&${literal(value.toLowerCase())}&CHAR(10),CHAR(10)&LOWER(SUBSTITUTE(${cell},CHAR(13),""))&CHAR(10)))`
    : `${text}=${literal(value.toLowerCase())}`);
  const match = `OR(${tests.join(",")})`;
  return rule.operator === "not_equals" ? `AND(LEN(${text})>0,NOT(${match}))` : match;
}

export function workbookFieldStatusFormula(field: Field) {
  if (!field.editable) return '="Reference only"';
  const { row } = field;
  const conditions = field.question ? getAssessmentQuestionConditions(field.question) : [];
  const visible = conditions.length ? `AND(${conditions.map(ruleFormula).join(",")})` : "TRUE";
  const required = requiredAssessmentToolFields.includes(field.key) || field.required_for_completion ? "TRUE" : field.question?.requiredWhen ? ruleFormula(field.question.requiredWhen) : "FALSE";
  const answer = `LEN(TRIM(${Array.from({ length: field.chunks }, (_, i) => `C${row + i}`).join('&""&')}))>0`;
  const reason = `LEN(TRIM(D${row}))>0`;
  const unable = field.question?.control === "yes_no" ? `OR(LOWER(TRIM(C${row}))="unable to assess",C${row}="unable_to_assess")` : "FALSE";
  return `=IF(NOT(${visible}),IF(OR(${answer},${reason}),"Review previous answer","Not applicable"),IF(AND(${reason},NOT(${unable})),"Review previous reason",IF(AND(${unable},NOT(${reason})),"Explain why",IF(${answer},"Answered",IF(${required},"Needs answer","Optional")))))`;
}
