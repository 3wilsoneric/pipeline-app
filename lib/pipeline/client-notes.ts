// Client notes (docs/design/DECISIONS.md, "Notes"): notes attached to a referral, taken by the assessor while
// preparing for and doing the interview. Anyone who can open the referral reads them. Kept per heading, each
// with its own version, so one heading's save never overwrites another's.
import { assessmentInterviewSections } from "@/lib/assessment/assessment-interview-schema";

export const noteBlockMaxLength = 20_000;
export const unifiedNoteKey = "notes";
export const unifiedNoteMaxLength = 300_000;

// Headings, in order: before the interview, one per interview topic, then calls and collateral contacts.
export function noteHeadings() {
  return [
    { key: "before", label: "Before the interview" },
    ...assessmentInterviewSections.map((section) => ({ key: `topic:${section.key}`, label: section.label })),
    { key: "collateral", label: "Collateral and calls" },
  ];
}

const headingKeys = new Set([unifiedNoteKey, ...noteHeadings().map((heading) => heading.key)]);
export function isNoteHeadingKey(value: unknown): value is string {
  return typeof value === "string" && headingKeys.has(value);
}

export type NoteBlock = { block_key: string; body: string; version: number; updated_at: string; updated_by_name: string };
export type LatestNote = { referral_id: number; text: string; updated_at: string };
export type ClientNoteDraft = { body: string; version: number; saved: string; sent?: string; updated_at?: string };

// Old topic notes remain in storage. Until the first edit, show them together in the
// single editor; after that, only append a topic note if an older open tab saved it
// after the unified note. No existing note is deleted during this transition.
export function combinedClientNote(entries: Readonly<Record<string, Pick<ClientNoteDraft, "body" | "saved" | "updated_at">>>): string {
  const unified = entries[unifiedNoteKey];
  if (unified && unified.body !== unified.saved) return unified.body;
  const legacy = noteHeadings()
    .map(({ key, label }) => ({ label, entry: entries[key] }))
    .filter(({ label, entry }) => entry?.body?.trim()
      && !unified?.body.includes(`${label}\n${entry.body}`)
      && (!unified || entry.body !== entry.saved || (unified.updated_at && entry.updated_at && entry.updated_at > unified.updated_at)))
    .map(({ label, entry }) => `${label}\n${entry.body}`);
  return [unified?.body, ...legacy].filter((part) => part?.trim()).join("\n\n");
}

const oldHeadingLabels = new Set(noteHeadings().map(({ label }) => label));
export function clientNotePreview(body: string): string | undefined {
  return body.split("\n").map((line) => line.trim()).find((line) => line && !oldHeadingLabels.has(line));
}

// Plain text: newlines and tabs allowed, other control characters rejected. Kept as typed (not trimmed),
// so saving while someone types never moves their cursor.
export function parseNoteBody(value: unknown, maxLength = noteBlockMaxLength): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n");
  if (body.length > maxLength) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) return null;
  return body;
}
