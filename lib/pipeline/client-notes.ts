// Client notes (docs/design/DECISIONS.md, "Notes"): notes attached to a referral, taken by the assessor while
// preparing for and doing the interview. Anyone who can open the referral reads them. Kept per heading, each
// with its own version, so one heading's save never overwrites another's.
import { assessmentInterviewSections } from "@/lib/assessment/assessment-interview-schema";

export const noteBlockMaxLength = 20_000;

// Headings, in order: before the interview, one per interview topic, then calls and collateral contacts.
export function noteHeadings() {
  return [
    { key: "before", label: "Before the interview" },
    ...assessmentInterviewSections.map((section) => ({ key: `topic:${section.key}`, label: section.label })),
    { key: "collateral", label: "Collateral and calls" },
  ];
}

const headingKeys = new Set(noteHeadings().map((heading) => heading.key));
export function isNoteHeadingKey(value: unknown): value is string {
  return typeof value === "string" && headingKeys.has(value);
}

export type NoteBlock = { block_key: string; body: string; version: number; updated_at: string; updated_by_name: string };
export type LatestNote = { referral_id: number; text: string; updated_at: string };

// Plain text: newlines and tabs allowed, other control characters rejected. Kept as typed (not trimmed),
// so saving while someone types never moves their cursor.
export function parseNoteBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n");
  if (body.length > noteBlockMaxLength) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) return null;
  return body;
}
