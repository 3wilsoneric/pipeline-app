import { documentCategories, type DocumentCategory, maxUploadFileBytes } from "@/lib/extraction/contracts";

export type LabeledReferralFile = { file: File; category: DocumentCategory };

export const referralDocumentLabels: Record<DocumentCategory, string> = {
  referral_packet: "Combined referral packet",
  face_sheet: "Face sheet",
  assessment: "Assessment / clinical notes",
  medication_list: "Medication list",
  tb_test: "TB test results",
  signed_admission_agreement: "Signed admission agreement",
  conservatorship_document: "Conservatorship documents",
  lic_602: "LIC 602",
  lic_601_603: "LIC 601 / LIC 603",
  provider_form: "Provider form",
  payer_verification: "Payer verification",
  responsible_party: "Responsible party",
  other: "Other document",
};

export function suggestReferralDocumentLabel(name: string): DocumentCategory | "" {
  const words = name.toLowerCase().replace(/[_-]/g, " ");
  if (/face\s*sheet/.test(words)) return "face_sheet";
  if (/\b(referral|combined)\s*packet\b/.test(words)) return "referral_packet";
  if (/\b(medication|meds|mar)\b/.test(words)) return "medication_list";
  if (/\blic\s*602\b/.test(words)) return "lic_602";
  if (/\blic\s*(601|603)\b/.test(words)) return "lic_601_603";
  if (/\btb\b|tuberculosis/.test(words)) return "tb_test";
  if (/conservator/.test(words)) return "conservatorship_document";
  if (/\bprovider\s*form\b/.test(words)) return "provider_form";
  if (/\b(assessment|psych|clinical)\b/.test(words)) return "assessment";
  // A filename cannot establish that an admission agreement has been signed.
  return "";
}

export function validateReferralDocumentFiles(files: readonly File[]) {
  const invalid = files.find((file) => !file.size || file.size > maxUploadFileBytes);
  return invalid ? `${invalid.name}: choose a nonempty file, up to 100 MB.` : "";
}

export function isReferralDocumentCategory(value: unknown): value is DocumentCategory {
  return documentCategories.some((category) => category === value);
}
