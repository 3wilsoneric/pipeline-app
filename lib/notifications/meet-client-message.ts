export const meetClientSectionIds = ["message", "bio", "coordination", "medications", "safety", "diet", "billing", "support"] as const;
export type MeetClientSectionId = typeof meetClientSectionIds[number];
export const meetClientSectionFormats = ["default", "paragraphs", "bullets"] as const;
export type MeetClientSectionFormat = typeof meetClientSectionFormats[number];
export type MeetClientLayout = { sectionOrder: MeetClientSectionId[]; sectionFormats: Partial<Record<MeetClientSectionId, MeetClientSectionFormat>> };
export type MeetClientMessage = { subject: string | null; body: string | null; sectionOrder?: MeetClientSectionId[];
  sectionFormats?: MeetClientLayout["sectionFormats"]; sectionText?: Partial<Record<MeetClientSectionId, string>> };

// A non-referral key within the existing per-user handoff state. Numeric keys remain client drafts.
// Layouts contain only enumerated IDs/formats, never reusable clinical text.
export const meetClientLayoutKey = "preferred-layout";
export function meetClientLayout(message?: MeetClientMessage): MeetClientLayout {
  return { sectionOrder: [...meetClientSectionOrder(message)], sectionFormats: orderedSectionMap(message?.sectionFormats ?? {}) };
}
export function parseMeetClientLayout(value: unknown): MeetClientLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some(key => key !== "sectionOrder" && key !== "sectionFormats")) return null;
  const { sectionOrder, sectionFormats } = value as MeetClientLayout;
  if (sectionOrder === undefined || sectionFormats === undefined) return null;
  const parsed = parseMeetClientMessage({ subject: null, body: null, sectionOrder, sectionFormats });
  return parsed ? meetClientLayout(parsed) : null;
}

export function meetClientSectionOrder(message?: MeetClientMessage): readonly MeetClientSectionId[] {
  return message?.sectionOrder ?? meetClientSectionIds;
}

export const meetClientSubjectLimit = 200;
export const meetClientBodyLimit = 20_000;

export function emptyMeetClientMessage(): MeetClientMessage {
  return { subject: null, body: null };
}

export function parseMeetClientMessage(value: unknown): MeetClientMessage | null {
  if (value === undefined) return emptyMeetClientMessage();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { subject, body, sectionOrder, sectionFormats, sectionText } = value as Record<string, unknown>;
  if (!validMessageText(subject, meetClientSubjectLimit, false)) return null;
  if (!validMessageText(body, meetClientBodyLimit, true)) return null;
  if (sectionOrder !== undefined && (!Array.isArray(sectionOrder) || sectionOrder.length !== meetClientSectionIds.length
    || new Set(sectionOrder).size !== meetClientSectionIds.length || sectionOrder.some((id) => !meetClientSectionIds.includes(id)))) return null;
  if (sectionFormats !== undefined && !validSectionMap(sectionFormats, value => typeof value === "string" && meetClientSectionFormats.includes(value as MeetClientSectionFormat))) return null;
  if (sectionText !== undefined && (!validSectionMap(sectionText, value => typeof value === "string" && validMessageText(value, meetClientBodyLimit, true))
    || Object.values(sectionText as Record<string, string>).reduce((size, text) => size + text.length, (body ?? "").length) > meetClientBodyLimit)) return null;
  if (body !== null && sectionText && Object.hasOwn(sectionText, "message")) return null;
  return { subject, body, ...(sectionFormats !== undefined ? { sectionFormats: orderedSectionMap(sectionFormats as MeetClientLayout["sectionFormats"]) } : {}),
    ...(sectionText !== undefined ? { sectionText: orderedSectionMap(sectionText as NonNullable<MeetClientMessage["sectionText"]>) } : {}), ...(sectionOrder !== undefined ? { sectionOrder: [...sectionOrder] as MeetClientSectionId[] } : {}) };
}

function validMessageText(value: unknown, limit: number, multiline: boolean): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > limit) return false;
  return !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u : /[\x00-\x1f\x7f]/u).test(value);
}

function validSectionMap(value: unknown, valid: (entry: unknown) => boolean): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([key, entry]) => meetClientSectionIds.includes(key as MeetClientSectionId) && valid(entry)));
}

// PostgreSQL JSONB reorders object keys; canonical maps keep saved-draft and lost-response comparisons stable.
function orderedSectionMap<T>(value: Partial<Record<MeetClientSectionId, T>>): Partial<Record<MeetClientSectionId, T>> {
  return Object.fromEntries(meetClientSectionIds.filter(id => Object.hasOwn(value, id)).map(id => [id, value[id]]));
}
