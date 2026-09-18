import type { ClinicalClientRecord } from "@/lib/clinical/clinical-contracts";
import { hasReadableClinicalValue } from "@/lib/clinical/clinical-value-presentation";
import type { UnifiedClientProfileResponse } from "./unified-profile-contracts";
import { formatProfileDate, type ClientProfileSection } from "./client-profile-presentation";
import type { HistoricalProfileResponse, HistoricalProfileSource } from "./historical-profile-contracts";
import { persistedCanvasFieldKeys, referralCanvasValue } from "./referral-canvas-persistence";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";

export function clientChartAssessments(profile: UnifiedClientProfileResponse, referralId: number, assessment?: PipelineAssessmentRecord): PipelineAssessmentRecord[] {
  if (!assessment || assessment.referral_id !== referralId || !profile.pipeline.referrals.some((item) => item.id === referralId)) return profile.pipeline.assessments;
  const stored = profile.pipeline.assessments.find((item) => item.assessment_id === assessment.assessment_id);
  // Only the assessment reading section consumes this preview. Clinical
  // priorities keep the saved profile, even while signed answers are edited.
  // Never mutate the shared cache or replace a newer server version.
  if (stored && stored.version > assessment.version) return profile.pipeline.assessments;
  return stored
    ? profile.pipeline.assessments.map((item) => item.assessment_id === assessment.assessment_id ? assessment : item)
    : [assessment, ...profile.pipeline.assessments];
}

const clinicalFields = {
  dob: "date_of_birth", gender: "gender", reportedAge: "age", phone: "phone", email: "email",
  county: "county", currentMedications: "medications_at_intake", conserved: "conservatorship_status",
  responsiblePerson: "responsible_person", payer: "payor",
} as const;

export function clientChartRecord(profile: UnifiedClientProfileResponse): ClinicalClientRecord {
  const record = { ...profile.client.enrichment };
  const resident = profile.resident;
  if (resident) {
    const current = {
      date_of_birth: resident.date_of_birth, admit_date: resident.admit_date,
      latest_admit_date: resident.admit_date, resident_number: resident.resident_number,
      age: resident.age, primary_diagnosis: resident.primary_diagnosis,
      physician: resident.physician, payor: resident.payor,
    };
    for (const [key, value] of Object.entries(current)) {
      if (hasReadableClinicalValue(value, key)) record[key] = value;
    }
  }
  // Saved episode values fill gaps only. Different/older values remain visible below,
  // and unreviewed imported proposals never replace the clinical record.
  for (const referral of profile.pipeline.referrals) {
    for (const [key, target] of Object.entries(clinicalFields)) {
      const value = referral[key as keyof typeof clinicalFields];
      if (value?.trim() && !hasReadableClinicalValue(record[target], target)) record[target] = value;
    }
  }
  return record;
}

const fieldLabels: Record<string, string> = {
  name: "Name", gender: "Gender", age: "Recorded age", dob: "Date of birth", ssn: "SSN",
  owner: "Assessor", referralReceived: "Referral received", admissionDate: "Admission date",
  community: "Community", county: "County", referent: "Referral source", responsiblePerson: "Responsible person",
  phone: "Phone", email: "Email", summary: "Referral summary", currentMedications: "Medications on record",
};

export function clientReferralSections(profile: UnifiedClientProfileResponse): ClientProfileSection[] {
  return profile.pipeline.referrals.map((referral) => ({
    key: `referral:${referral.id}`,
    label: `Workspace #${referral.id} · ${referral.community} · ${referral.date || referral.createdAt.slice(0, 10)}`,
    facts: [
      ...(referral.admissionDecision ? [
        { label: "Decision", value: referral.admissionDecision.outcome === "accepted" ? "Accept" : "Deny" },
        { label: "Decision reason", value: referral.admissionDecision.reasonNote },
        { label: "Decision recorded by", value: referral.admissionDecision.decidedByName },
        { label: "Decision date", value: formatProfileDate(referral.admissionDecision.decidedAt) ?? "" },
      ] : referral.assessmentRecommendation ? [
        { label: "Placement recommendation", value: referral.assessmentRecommendation.outcome === "accept" ? "Accept" : referral.assessmentRecommendation.outcome === "decline" ? "Deny" : "Under review" },
        { label: "Recommendation reason", value: referral.assessmentRecommendation.reasonNote },
      ] : []),
      ...persistedCanvasFieldKeys.map((key) => ({ label: fieldLabels[key], value: referralCanvasValue(referral, key) })),
      { label: "Conserved", value: referral.conserved === "yes" ? "Yes" : referral.conserved === "no" ? "No" : "" },
      { label: "Payor", value: referral.payer },
      { label: "Original interview notes", value: referral.interview ?? "" },
      ...(referral.packetFields ?? []).map((field) => ({
        label: `${field.field_key} (${field.review_status})`, value: field.final_value ?? field.proposed_value ?? "",
      })),
    ].filter((fact) => typeof fact.value === "string" && fact.value.trim()),
  }));
}

function sourceDescription(source: HistoricalProfileSource) {
  return [source.sourceCanvasName, source.sourceProjectName, source.capturedAt].filter(Boolean).join(" · ");
}

export function workspaceSourceSections(source: HistoricalProfileResponse): ClientProfileSection[] {
  return [
    { key: "imported-facts", label: "Recorded source information", facts: source.facts.map((fact) => ({
      label: fact.key === "assessment_date" ? "ALLO assessment date (imported)" : fact.label,
      value: `${fact.value}\nSource: ${sourceDescription(fact.source)}`,
    })) },
    ...source.sections.map((section) => ({ key: `source:${section.section}`, label: section.label,
      facts: section.fields.map((field) => ({ label: field.label, value: field.evidence.map((item) =>
        `${item.text}\nSource: ${sourceDescription(item.source)}\n${item.confidence === "high" ? "Stronger field match" : "Possible field match"}`).join("\n\n") })),
    })),
    { key: "unmapped-source", label: "Other source notes", facts: source.unmappedEvidence.map((item, index) => ({
      label: `Note ${index + 1}`, value: `${item.text}\nSource: ${sourceDescription(item.source)}`,
    })) },
    ...source.sourceSections.map((section) => ({ key: `blocks:${section.sectionId}`, label: section.label,
      facts: section.blocks.map((block) => ({ label: `Source block ${block.ordinal}`, value: `${block.text}\nSource: ${sourceDescription(section.source)}` })),
    })),
  ].filter((section) => section.facts.length);
}

export function clientSourceSections(profile: UnifiedClientProfileResponse) {
  return (profile.pipeline.source_profiles ?? []).flatMap((source) => workspaceSourceSections(source.profile)
    .map((section) => ({ ...section, key: `${source.referral_id}:${section.key}`, label: `Workspace #${source.referral_id} · ${section.label}` })));
}
