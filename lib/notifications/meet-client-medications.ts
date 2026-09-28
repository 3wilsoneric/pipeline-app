export type MedicationReview = {
  assessmentId: string;
  assessmentVersion: number;
  inventory: string[];
  selected: string[];
  status: "confirmed" | "none" | "unconfirmed";
};

export function medicationInventory(assessmentMedications: readonly string[], intakeHistory: string): string[] {
  const entries = [...assessmentMedications, ...intakeHistory.split(/\r?\n/u)]
    .map((entry) => entry.trim()).filter(Boolean);
  return [...new Map(entries.map((entry) => [entry.toLocaleLowerCase(), entry])).values()];
}

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

export function medicationReviewMatches(review: MedicationReview | null, assessmentId: string, assessmentVersion: number, inventory: string[]): review is MedicationReview {
  return Boolean(review && review.assessmentId === assessmentId && review.assessmentVersion === assessmentVersion
    && JSON.stringify(review.inventory) === JSON.stringify(inventory));
}
