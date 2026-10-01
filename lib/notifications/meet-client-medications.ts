export const medicationAttachmentReference = "Please refer to the medication file in the attached admission packet.";

// Retain the old draft payload when recipients or message edits are saved.
// New handoffs use the original attachment, not these historical selections.
export type MedicationReview = {
  assessmentId: string;
  assessmentVersion: number;
  inventory: string[];
  selected: string[];
  status: "confirmed" | "none" | "unconfirmed";
};

export function parseMedicationReview(value: unknown): MedicationReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const review = value as Record<string, unknown>;
  if (typeof review.assessmentId !== "string" || !review.assessmentId || review.assessmentId.length > 128
    || !Number.isSafeInteger(review.assessmentVersion) || Number(review.assessmentVersion) < 1
    || !Array.isArray(review.inventory) || !Array.isArray(review.selected)
    || review.inventory.length > 100 || review.selected.length > 100
    || !["confirmed", "none", "unconfirmed"].includes(String(review.status))) return null;
  const validEntry = (entry: unknown): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 500 && entry.trim() === entry;
  if (!review.inventory.every(validEntry) || !review.selected.every(validEntry)) return null;
  const inventory = review.inventory as string[];
  const selected = review.selected as string[];
  if (new Set(inventory).size !== inventory.length || new Set(selected).size !== selected.length
    || selected.some((entry) => !inventory.includes(entry))
    || (review.status === "confirmed" && !selected.length)
    || (review.status !== "confirmed" && selected.length)) return null;
  return { assessmentId: review.assessmentId, assessmentVersion: Number(review.assessmentVersion), inventory, selected, status: review.status as MedicationReview["status"] };
}
