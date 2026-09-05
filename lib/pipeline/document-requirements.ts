import type { DocumentCategory } from "@/lib/extraction/contracts";
import type { RequirementType } from "@/lib/pipeline/referral-types";

const categoryByRequirement: Partial<Record<RequirementType, DocumentCategory>> = {
  medication_list: "medication_list",
  tb_test: "tb_test",
  signed_admission_agreement: "signed_admission_agreement",
  conservatorship_document: "conservatorship_document",
  lic_602: "lic_602",
  lic_601_603: "lic_601_603",
  provider_form: "provider_form",
  face_sheet: "face_sheet",
  payer_verification: "payer_verification",
  responsible_party: "responsible_party",
};

const requirementByCategory = Object.fromEntries(
  Object.entries(categoryByRequirement).map(([requirement, category]) => [category, requirement]),
) as Partial<Record<DocumentCategory, RequirementType>>;

export function documentCategoryForRequirement(type: RequirementType): DocumentCategory {
  return categoryByRequirement[type] ?? "other";
}

export function requirementForDocumentCategory(category: DocumentCategory): RequirementType | null {
  return requirementByCategory[category] ?? null;
}

export function isDocumentRequirementType(type: RequirementType) {
  return categoryByRequirement[type] !== undefined;
}
