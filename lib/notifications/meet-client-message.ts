export const meetClientSectionIds = ["message", "bio", "coordination", "medications", "safety", "diet", "billing", "support"] as const;
export type MeetClientSectionId = typeof meetClientSectionIds[number];
export const meetClientSectionFormats = ["default", "paragraphs", "bullets"] as const;
export type MeetClientSectionFormat = typeof meetClientSectionFormats[number];
export type MeetClientLayout = { sectionOrder: MeetClientSectionId[]; sectionFormats: Partial<Record<MeetClientSectionId, MeetClientSectionFormat>> };
export type MeetClientSectionEdits = Partial<Record<MeetClientSectionId, { text: string; source: string }>>;
export type MeetClientMessage = { subject: string | null; body: string | null; sectionOrder?: MeetClientSectionId[]; sectionEdits?: MeetClientSectionEdits; sectionFormats?: MeetClientLayout["sectionFormats"] };

// Only enumerated layout preferences are reusable. Client wording stays in its referral draft.
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
  const { subject, body, sectionOrder, sectionEdits, sectionFormats } = value as Record<string, unknown>;
  if (!validMessageText(subject, meetClientSubjectLimit, false)) return null;
  if (!validMessageText(body, meetClientBodyLimit, true)) return null;
  if (sectionOrder !== undefined && (!Array.isArray(sectionOrder) || sectionOrder.length !== meetClientSectionIds.length
    || new Set(sectionOrder).size !== meetClientSectionIds.length || sectionOrder.some((id) => !meetClientSectionIds.includes(id)))) return null;
  if (sectionFormats !== undefined && (!sectionFormats || typeof sectionFormats !== "object" || Array.isArray(sectionFormats)
    || !Object.entries(sectionFormats).every(([id, format]) => meetClientSectionIds.includes(id as MeetClientSectionId)
      && typeof format === "string" && meetClientSectionFormats.includes(format as MeetClientSectionFormat)))) return null;
  const edits: MeetClientSectionEdits = {};
  if (sectionEdits !== undefined) {
    if (!sectionEdits || typeof sectionEdits !== "object" || Array.isArray(sectionEdits)) return null;
    let total = 0;
    for (const [id, edit] of Object.entries(sectionEdits)) {
      if (!meetClientSectionIds.includes(id as MeetClientSectionId) || !edit || typeof edit !== "object" || Array.isArray(edit)) return null;
      const { text, source } = edit as Record<string, unknown>;
      if (Object.keys(edit).some(key => !["text", "source"].includes(key)) || typeof text !== "string"
        || typeof source !== "string" || !validMessageText(text, meetClientBodyLimit, true) || !validMessageText(source, meetClientBodyLimit, true)) return null;
      if (id === "message" && (body !== null || source !== "")) return null;
      total += text.length + source.length;
      if (total > meetClientBodyLimit * 3) return null;
      edits[id as MeetClientSectionId] = { text, source };
    }
  }
  // Whole-message edits remain authoritative for older saved drafts.
  return { subject, body, ...(sectionOrder !== undefined ? { sectionOrder: [...sectionOrder] as MeetClientSectionId[] } : {}),
    ...(sectionEdits !== undefined ? { sectionEdits: orderedSectionMap(edits) } : {}),
    ...(sectionFormats !== undefined ? { sectionFormats: orderedSectionMap(sectionFormats as MeetClientLayout["sectionFormats"]) } : {}) };
}

// JSONB changes object-key order; stable maps preserve save and lost-response comparisons.
function orderedSectionMap<T>(value: Partial<Record<MeetClientSectionId, T>>): Partial<Record<MeetClientSectionId, T>> {
  return Object.fromEntries(meetClientSectionIds.filter(id => Object.hasOwn(value, id)).map(id => [id, value[id]]));
}

function validMessageText(value: unknown, limit: number, multiline: boolean): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > limit) return false;
  return !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u : /[\x00-\x1f\x7f]/u).test(value);
}
