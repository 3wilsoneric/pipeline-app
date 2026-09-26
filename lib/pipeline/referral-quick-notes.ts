// Private quick notes (docs/design/DECISIONS.md, "Quick note"): each person's own short reminder
// of where a referral stands, stored per principal in the workspace-state store. Nobody else sees them.

export const quickNoteMaxLength = 2_000;
// Refreshed on every save; a note untouched for a year is pruned by the workspace-state retention job.
export const quickNoteTtlDays = 365;

export type ReferralQuickNote = { referralId: number; text: string; updatedAt: string; version: number };
export type QuickNotePayload = { text: string };

// Plain text: newlines and tabs allowed, other control characters rejected; surrounding space trimmed.
export function parseQuickNoteText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > quickNoteMaxLength) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

export function isQuickNotePayload(value: unknown): value is QuickNotePayload {
  return typeof value === "object" && value !== null && parseQuickNoteText((value as QuickNotePayload).text) !== null;
}
