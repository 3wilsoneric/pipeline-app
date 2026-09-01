import {
  createEmptyAssessmentToolData,
  type AssessmentToolData,
} from "@/lib/assessment/assessment-tool-schema";

export const ASSESSMENT_PRACTICE_TUTORIAL_ID = "practice-assessment";
export const ASSESSMENT_PRACTICE_SCHEMA_VERSION = 1 as const;

export function createAssessmentPracticeData(): AssessmentToolData {
  return {
    ...createEmptyAssessmentToolData(),
    resident_name: "Jordan Practice",
    date_of_birth: "1988-04-12",
    community: "Training community",
    assessment_date: "2026-08-25",
    assessor: "Training assessor",
    referral_received_date: "2026-08-22",
    referrer_name: "Training coordinator",
    referrer_contact: "Synthetic contact",
    current_location: "Training facility",
    time_at_current_location: "Three weeks",
    referring_facility: "Training facility",
    prior_setting_bucket: "Adult residential",
    county: "Practice County",
    source_file: "synthetic-practice-packet.pdf",
    extraction_date: "2026-08-25T12:00:00.000Z",
    assessment_notes: "Synthetic training scenario. No client record is associated with this assessment.",
  };
}
