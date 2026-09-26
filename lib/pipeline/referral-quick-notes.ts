// Private quick notes (docs/design/DECISIONS.md, "Quick note"): each person's own reminders of where a
// referral stands, stored per principal in the workspace-state store. Nobody else sees them.
// A note is a short list of entries, newest first. Each entry is dated by the server when first saved
// and tagged with the record step the person was on, so notes structure themselves as they are written.

export const quickNoteMaxLength = 2_000;
export const quickNoteMaxEntries = 30;
// All entries together, so one person's notes on a referral stay small.
export const quickNoteMaxTotalLength = 12_000;
// Refreshed on every save; a note untouched for a year is pruned by the workspace-state retention job.
export const quickNoteTtlDays = 365;

export const quickNoteSteps = ["intake", "chart", "assessment", "decision", "send"] as const;
export type QuickNoteStep = (typeof quickNoteSteps)[number];
export const quickNoteStepLabels: Record<QuickNoteStep, string> = { intake: "Intake", chart: "Chart", assessment: "Assessment", decision: "Decision", send: "Finish & send" };

export type QuickNoteEntry = { id: string; text: string; step: QuickNoteStep | null; at: string };
export type ReferralQuickNote = { referralId: number; entries: QuickNoteEntry[]; updatedAt: string; version: number };
// Stored shape. Notes saved before entries existed hold `text` and read back as one undated-step entry.
export type QuickNotePayload = { entries: QuickNoteEntry[] } | { text: string };

// Plain text: newlines and tabs allowed, other control characters rejected; surrounding space trimmed.
export function parseQuickNoteText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > quickNoteMaxLength) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

const entryIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const isStep = (value: unknown): value is QuickNoteStep => typeof value === "string" && (quickNoteSteps as readonly string[]).includes(value);

// Entries the person sent: ids, text, and step only. Dates are never taken from the request.
export type QuickNoteEntryInput = { id: string; text: string; step: QuickNoteStep | null };
export function parseQuickNoteEntries(value: unknown): QuickNoteEntryInput[] | null {
  if (!Array.isArray(value) || value.length > quickNoteMaxEntries) return null;
  const seen = new Set<string>();
  const entries: QuickNoteEntryInput[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { id, text, step } = item as Record<string, unknown>;
    if (typeof id !== "string" || !entryIdPattern.test(id) || seen.has(id)) return null;
    const parsed = parseQuickNoteText(text);
    if (parsed === null || (step !== null && step !== undefined && !isStep(step))) return null;
    seen.add(id);
    // Emptied entries drop out, so clearing an entry's text removes it.
    if (parsed) entries.push({ id, text: parsed, step: isStep(step) ? step : null });
  }
  return entries.reduce((total, entry) => total + entry.text.length, 0) > quickNoteMaxTotalLength ? null : entries;
}

// Keeps each existing entry's original date; new entries are dated now. Newest first.
export function stampQuickNoteEntries(input: readonly QuickNoteEntryInput[], stored: readonly QuickNoteEntry[], now: string): QuickNoteEntry[] {
  const dates = new Map(stored.map((entry) => [entry.id, entry.at]));
  return input.map((entry) => ({ ...entry, at: dates.get(entry.id) ?? now }))
    .sort((left, right) => right.at.localeCompare(left.at));
}

export function quickNoteEntriesFrom(payload: unknown, updatedAt: string): QuickNoteEntry[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  if ("entries" in payload && Array.isArray(payload.entries)) {
    const entries = payload.entries.filter((entry: unknown): entry is QuickNoteEntry => {
      if (typeof entry !== "object" || entry === null) return false;
      const { id, text, step, at } = entry as Record<string, unknown>;
      return typeof id === "string" && entryIdPattern.test(id) && typeof text === "string" && parseQuickNoteText(text) === text && text.length > 0
        && (step === null || isStep(step)) && typeof at === "string" && !Number.isNaN(Date.parse(at));
    });
    return entries.length ? entries : null;
  }
  if ("text" in payload && typeof payload.text === "string") {
    const text = parseQuickNoteText(payload.text);
    return text ? [{ id: "earlier", text, step: null, at: updatedAt }] : null;
  }
  return null;
}
