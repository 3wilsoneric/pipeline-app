import { normalizeCalendarDate } from "@/lib/pipeline/calendar-date";

export type MeetClientReviewDraft = {
  plannedDate: { value: string; base: string } | null;
  selectedFiles: { revision: string; ids: string[] } | null;
};

export function parseMeetClientReviewDraft(value: unknown): MeetClientReviewDraft | null {
  if (value == null) return { plannedDate: null, selectedFiles: null };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const date = draft.plannedDate;
  const files = draft.selectedFiles;
  if (date != null && (typeof date !== "object" || Array.isArray(date)
    || !validDate((date as Record<string, unknown>).value)
    || !validDate((date as Record<string, unknown>).base))) return null;
  if (files != null && (typeof files !== "object" || Array.isArray(files))) return null;
  const selection = files as Record<string, unknown> | null;
  if (selection && (typeof selection.revision !== "string" || !selection.revision || selection.revision.length > 200
    || !Array.isArray(selection.ids) || selection.ids.length > 500
    || selection.ids.some((id) => typeof id !== "string" || !id || id.length > 200)
    || new Set(selection.ids).size !== selection.ids.length)) return null;
  return {
    plannedDate: date as MeetClientReviewDraft["plannedDate"] ?? null,
    selectedFiles: selection as MeetClientReviewDraft["selectedFiles"] ?? null,
  };
}

function validDate(value: unknown) {
  return typeof value === "string" && (!value || value.length === 10 && normalizeCalendarDate(value) === value);
}
