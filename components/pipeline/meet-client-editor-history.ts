import { meetClientLayout, parseMeetClientMessage, type MeetClientMessage, type MeetClientSectionId } from "@/lib/notifications/meet-client-message";

type Edit = { message: MeetClientMessage; field: MeetClientSectionId | "subject" };
export type EditorHistory = { present: Edit; past: Edit[]; future: Edit[]; group: string; changedAt: number };
export const messageKey = (message: MeetClientMessage) => JSON.stringify(parseMeetClientMessage({ ...message, ...meetClientLayout(message) }));
export function createEditorHistory(message: MeetClientMessage): EditorHistory {
  return { present: { message, field: "subject" }, past: [], future: [], group: "", changedAt: 0 };
}

// Only this open editor owns undo. Fifty immutable snapshots bound memory; nothing
// is written to preferences or browser storage. Reopening starts a new history.
export function recordEditorChange(history: EditorHistory, before: MeetClientMessage, next: MeetClientMessage, field: Edit["field"], group = "", now = Date.now()): EditorHistory {
  const current = messageKey(history.present.message) === messageKey(before) ? history : createEditorHistory(before);
  if (messageKey(before) === messageKey(next)) return current;
  const typing = group && group === current.group && now - current.changedAt < 800;
  return { present: { message: next, field }, past: typing ? current.past : [...current.past, { message: before, field }].slice(-50), future: [], group, changedAt: now };
}

export function stepEditorHistory(history: EditorHistory, direction: "undo" | "redo"): EditorHistory {
  const source = direction === "undo" ? history.past : history.future;
  const next = source.at(-1);
  if (!next) return history;
  return { present: next, group: "", changedAt: 0,
    past: direction === "undo" ? history.past.slice(0, -1) : [...history.past, history.present],
    future: direction === "undo" ? [...history.future, history.present] : history.future.slice(0, -1) };
}
