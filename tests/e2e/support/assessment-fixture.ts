import { expect, type Page } from "@playwright/test";
import { assessmentFieldOwner } from "../../../lib/assessment/assessment-field-ownership";
import { assessmentToolFieldDefinitions } from "../../../lib/assessment/assessment-tool-schema";
import type { PipelineAssessmentRecord } from "../../../lib/assessment/assessment-records";
import { buildTrainingAssessment } from "../../../lib/training/mock-assessment";
import { activeOperationalAssessor, createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./operational-api";
import { waitForAssessmentReady } from "./assessment-navigation";

// Synthetic values, persisted through the real API in the isolated test store.
// Clinical UI checks must not depend on the retired tutorial runtime.
export async function openAssessmentFixture(page: Page, options: {
  mode: "prepare" | "schedule" | "interview";
  section?: string;
  stage?: string;
}) {
  const owner = await activeOperationalAssessor(page.request);
  const sample = buildTrainingAssessment(options.mode);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    owner: owner.display_name, dob: sample.date_of_birth,
    phone: "555-0100", email: "synthetic@example.invalid",
    source: sample.current_location, currentMedications: sample.medications_at_intake.join("; "),
    referrerName: sample.referrer_name, county: "Alameda",
  }, { assigneeId: owner.principal_id });
  const created = await createOperationalAssessment(page.request, referral.id);
  const data = Object.fromEntries(assessmentToolFieldDefinitions
    .filter(({ key }) => assessmentFieldOwner(key) === "assessment_answer")
    .map(({ key }) => [key, sample[key]]));
  const patched = await page.request.patch(`/api/assessments/${created.assessment_id}`, {
    data: { if_match: created.version, client_mutation_id: crypto.randomUUID(), patch: { data } },
  });
  expect(patched.status(), await patched.text()).toBe(200);
  let assessment = (await patched.json()).assessment;
  if (options.mode === "interview") assessment = await startOperationalAssessment(page.request, assessment);
  const params = new URLSearchParams({ view: "referrals", screen: "packet", referralId: String(referral.id), workspaceStage: options.stage ?? "assessment" });
  if (options.section) params.set("assessmentSection", options.section);
  if (options.mode === "schedule") params.set("assessmentDialog", "schedule");
  await page.goto(`/?${params}`);
  await waitForAssessmentReady(page);
  const read = async (): Promise<PipelineAssessmentRecord> => {
    const response = await page.request.get(`/api/assessments/${created.assessment_id}`);
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).assessment;
  };
  return { referral, assessment, read };
}
