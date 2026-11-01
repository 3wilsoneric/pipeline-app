export const meetClientSectionIds = ["message", "coordination", "bio", "medications", "safety", "diet", "billing", "support"] as const;
export type MeetClientSectionId = typeof meetClientSectionIds[number];
export type MeetClientMessage = { subject: string | null; body: string | null; sectionOrder?: MeetClientSectionId[] };

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
  const { subject, body, sectionOrder } = value as Record<string, unknown>;
  if (!validMessageText(subject, meetClientSubjectLimit, false)) return null;
  if (!validMessageText(body, meetClientBodyLimit, true)) return null;
  if (sectionOrder !== undefined && (!Array.isArray(sectionOrder) || sectionOrder.length !== meetClientSectionIds.length
    || new Set(sectionOrder).size !== meetClientSectionIds.length || sectionOrder.some((id) => !meetClientSectionIds.includes(id)))) return null;
  return { subject, body, ...(sectionOrder !== undefined ? { sectionOrder: [...sectionOrder] as MeetClientSectionId[] } : {}) };
}

function validMessageText(value: unknown, limit: number, multiline: boolean): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > limit) return false;
  return !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u : /[\x00-\x1f\x7f]/u).test(value);
}
