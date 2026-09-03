import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { ClinicalResident } from "@/lib/clinical/clinical-contracts";
import type { ClientProfileSection } from "@/lib/pipeline/client-profile-presentation";

export type ClientChartIdentity = {
  name: string;
  gender: string | null;
  community: string;
};

export type ClientChartFact = {
  label: string;
  value: string;
  span?: "wide";
  required?: boolean;
};

export type ClientMedicalChartModel = {
  identity: ClientChartFact[];
  priorities: ClientChartFact[];
  care: ClientChartFact[];
  assessmentDate: string | null;
};

const promotedDetailLabels = new Set([
  "Resident number",
  "Date of birth",
  "Age",
  "Gender",
  "Most recent admission",
  "Primary diagnosis",
  "Active medications",
  "Medication at intake",
  "Active allergies",
  "Primary physician",
  "Care level",
  "Payor",
  "Mobility",
  "ADL needs",
  "Conservatorship",
  "Conserved status",
]);

export function buildClientMedicalChart(
  identity: ClientChartIdentity,
  resident: ClinicalResident | null,
  sections: ClientProfileSection[],
  assessments: PipelineAssessmentRecord[],
  recordStatus: string,
): ClientMedicalChartModel {
  const latestAssessment = assessments[0] ?? null;
  const chartValue = (...labels: string[]) => findProfileValue(sections, labels);
  const assessmentValue = (...values: unknown[]) => firstReadableValue(values);

  return {
    identity: [
      chartFact("Client", identity.name, { span: "wide", required: true }),
      chartFact("Date of birth", formatChartDate(resident?.date_of_birth ?? chartValue("Date of birth")), { required: true }),
      chartFact("Resident number", resident?.resident_number ?? chartValue("Resident number")),
      chartFact("Status", recordStatus),
      chartFact("Gender", identity.gender ?? chartValue("Gender")),
      chartFact("Community", identity.community, { span: "wide", required: true }),
      chartFact("Unit", resident?.unit),
      chartFact("Admission date", formatChartDate(resident?.admit_date ?? chartValue("Most recent admission"))),
      chartFact("Length of stay", resident?.length_of_stay_days == null ? null : `${resident.length_of_stay_days} days`),
      chartFact("Care level", resident?.care_level ?? chartValue("Care level")),
    ],
    priorities: [
      chartFact(
        "Primary diagnosis",
        assessmentValue(latestAssessment?.primary_diagnosis, resident?.primary_diagnosis, chartValue("Primary diagnosis")),
        { required: true },
      ),
      chartFact("Allergies", chartValue("Active allergies"), { required: true }),
      chartFact(
        "Medications on record",
        assessmentValue(latestAssessment?.medications_at_intake, chartValue("Active medications", "Medication at intake")),
        { required: true },
      ),
    ],
    care: [
      chartFact("Mobility", assessmentValue(latestAssessment?.mobility, chartValue("Mobility"))),
      chartFact("ADL support", assessmentValue(latestAssessment?.adl_needs, chartValue("ADL needs"))),
      chartFact("Diet", assessmentValue(latestAssessment?.special_diet_details, latestAssessment?.special_diet, resident?.diet)),
      chartFact("Physician", resident?.physician ?? chartValue("Primary physician")),
      chartFact("Conserved status", assessmentValue(latestAssessment?.conservatorship_type, chartValue("Conserved status", "Conservatorship"))),
      chartFact("Payor", resident?.payor ?? chartValue("Payor")),
    ],
    assessmentDate: latestAssessment?.assessment_date ?? null,
  };
}

export function removePromotedClientProfileFacts(sections: ClientProfileSection[]) {
  return sections
    .map((section) => ({
      ...section,
      facts: section.facts.filter((fact) => !promotedDetailLabels.has(fact.label)),
    }))
    .filter((section) => section.facts.length > 0);
}

function chartFact(
  label: string,
  value: unknown,
  options: Pick<ClientChartFact, "span" | "required"> = {},
): ClientChartFact {
  return {
    label,
    value: firstReadableValue([value]) || "Not documented",
    ...options,
  };
}

function findProfileValue(sections: ClientProfileSection[], labels: string[]) {
  for (const label of labels) {
    for (const section of sections) {
      const fact = section.facts.find((candidate) => candidate.label === label);
      if (fact?.value.trim()) return fact.value.trim();
    }
  }
  return null;
}

function firstReadableValue(values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const items = value.map((item) => String(item).trim()).filter(Boolean);
      if (items.length > 0) return items.join("\n");
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized) continue;
    return humanizeOptionValue(normalized);
  }
  return "";
}

function humanizeOptionValue(value: string) {
  if (!/^[a-z0-9_]+$/.test(value) || !value.includes("_")) return value;
  const normalized = value.replaceAll("_", " ");
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function formatChartDate(value: string | null | undefined) {
  if (!value) return value;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
