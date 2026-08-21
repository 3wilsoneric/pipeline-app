import {
  assessmentToolFieldDefinitions,
  assessmentToolSections,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "./assessment-tool-schema";

export type AssessmentSectionVersions = Record<AssessmentToolSection, number>;

export function defaultAssessmentSectionVersions(): AssessmentSectionVersions {
  return Object.fromEntries(assessmentToolSections.map((section) => [section, 1])) as AssessmentSectionVersions;
}

export function normalizeAssessmentSectionVersions(value: unknown): AssessmentSectionVersions {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<AssessmentToolSection, unknown>>
    : {};
  const versions = defaultAssessmentSectionVersions();
  for (const section of assessmentToolSections) {
    const version = Number(source[section]);
    versions[section] = Number.isInteger(version) && version > 0 ? version : 1;
  }
  return versions;
}

export function assessmentSectionForField(field: AssessmentToolFieldKey) {
  return assessmentToolFieldDefinitions.find((definition) => definition.key === field)?.section;
}

export function incrementAssessmentSectionVersions(
  value: unknown,
  sections: Iterable<AssessmentToolSection>,
) {
  const versions = normalizeAssessmentSectionVersions(value);
  for (const section of new Set(sections)) versions[section] += 1;
  return versions;
}

export function fieldsForAssessmentSection(section: AssessmentToolSection) {
  return assessmentToolFieldDefinitions
    .filter((definition) => definition.section === section)
    .map((definition) => definition.key);
}

export function isAssessmentToolSection(value: unknown): value is AssessmentToolSection {
  return typeof value === "string" && (assessmentToolSections as readonly string[]).includes(value);
}
