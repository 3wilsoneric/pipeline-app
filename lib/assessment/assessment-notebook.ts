// Interview notebook (docs/design/DECISIONS.md, "Interview notebook"): the assessor's preparation and
// interview notes, part of the assessment record. Notes are kept in blocks, one per heading, each with its
// own version, so a note never waits on or conflicts with the assessment's answers.
import { assessmentInterviewSections } from "@/lib/assessment/assessment-interview-schema";

export const notebookBlockMaxLength = 20_000;

// Headings, in order: before the interview, one per interview topic, then calls and collateral contacts.
export const notebookGeneralBlocks = [
  { key: "before", label: "Before the interview" },
  { key: "collateral", label: "Collateral and calls" },
] as const;

export function notebookHeadings() {
  return [
    notebookGeneralBlocks[0],
    ...assessmentInterviewSections.map((section) => ({ key: `topic:${section.key}`, label: section.label })),
    notebookGeneralBlocks[1],
  ];
}

const blockKeys = new Set(notebookHeadings().map((heading) => heading.key));
export function isNotebookBlockKey(value: unknown): value is string {
  return typeof value === "string" && blockKeys.has(value);
}

export type NotebookBlock = { block_key: string; body: string; version: number; updated_at: string; updated_by_name: string };

// Plain text: newlines and tabs allowed, other control characters rejected. Kept as typed (not trimmed),
// so saving while someone types never moves their cursor.
export function parseNotebookBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n");
  if (body.length > notebookBlockMaxLength) return null;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) return null;
  return body;
}
