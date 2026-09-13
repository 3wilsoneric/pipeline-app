import type { ContactInput, ContactRecord } from "@/lib/pipeline/contact-types";
import { validateContactCreateBody } from "@/lib/pipeline/contact-validation";

export const contactImportMaxBytes = 1024 * 1024;
export const contactImportMaxRows = 500;
export const contactImportColumns = {
  first_name: "firstName",
  last_name: "lastName",
  organization: "organization",
  job_title: "jobTitle",
  phone: "phone",
  email: "email",
  preferred_contact_method: "preferredContactMethod",
  best_contact_time: "bestContactTime",
  notes: "notes",
} as const;
export const contactImportTemplate = `${Object.keys(contactImportColumns).join(",")}\r\n`;

export type ContactImportRow = { row: number; contact: ContactInput | null; error?: string };
export type ContactImportPreviewRow = ContactImportRow & {
  status: "ready" | "duplicate" | "invalid";
  message: string;
};
export type ContactImportCounts = { total: number; ready: number; duplicates: number; invalid: number };
export type ContactImportPreview = { counts: ContactImportCounts; rows: ContactImportPreviewRow[] };
export type ContactImportSummary = {
  counts: ContactImportCounts & { imported: number };
  rows: { row: number; status: "imported" | "duplicate"; contactId?: string }[];
};
export type ContactImportResult =
  | { ok: true; summary: ContactImportSummary; idempotentReplay: boolean }
  | { ok: false; status: 409 | 422; error: string; preview?: ContactImportPreview };

export class ContactImportError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ContactImportError";
  }
}

export async function readContactImportCsv(request: Request): Promise<string> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/csv") {
    throw new ContactImportError("Upload a UTF-8 CSV file (text/csv).", 415);
  }
  if (Number(request.headers.get("content-length")) > contactImportMaxBytes) {
    throw new ContactImportError("CSV must be at most 1 MiB.", 413);
  }
  if (!request.body) throw new ContactImportError("CSV is empty.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > contactImportMaxBytes) {
        await reader.cancel();
        throw new ContactImportError("CSV must be at most 1 MiB.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof ContactImportError) throw error;
    throw new ContactImportError("CSV could not be read. Use UTF-8 encoding.");
  } finally {
    reader.releaseLock();
  }
  return text;
}

export function parseContactImportCsv(source: string): ContactImportRow[] {
  if (new TextEncoder().encode(source).byteLength > contactImportMaxBytes) {
    throw new ContactImportError("CSV must be at most 1 MiB.", 413);
  }
  const table = parseCsv(source.replace(/^\uFEFF/u, ""));
  const headers = table[0]?.cells.map((cell) => cell.trim().toLowerCase()) ?? [];
  if (!headers.length || headers.some((header) => !Object.hasOwn(contactImportColumns, header))) {
    throw new ContactImportError("Use the template columns only: first_name, last_name, organization, job_title, phone, email, preferred_contact_method, best_contact_time, notes.");
  }
  if (new Set(headers).size !== headers.length) throw new ContactImportError("CSV has duplicate column headers.");
  if (!["first_name", "last_name", "organization"].some((header) => headers.includes(header))) {
    throw new ContactImportError("CSV needs a first_name, last_name, or organization column.");
  }
  const rows = table.slice(1).map(({ cells, row }): ContactImportRow => {
    if (cells.length !== headers.length) return { row, contact: null, error: "Wrong column count. Check commas and quotes." };
    const input = Object.fromEntries(headers.map((header, column) => [
      contactImportColumns[header as keyof typeof contactImportColumns], cells[column].trim(),
    ]));
    if (!input.preferredContactMethod) delete input.preferredContactMethod;
    if (cells.some((cell) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(cell))) {
      return { row, contact: null, error: "Unsupported control character." };
    }
    const validation = validateContactCreateBody({ contact: input });
    return validation.ok
      ? { row, contact: validation.value.contact }
      : { row, contact: null, error: validation.message };
  });
  if (!rows.length) throw new ContactImportError("CSV needs at least one contact or facility row.");
  return rows;
}

export function previewContactImport(rows: ContactImportRow[], existing: readonly ContactRecord[]): ContactImportPreview {
  // Identity-only matching is conservative: different details are skipped, never merged.
  const identities = new Map<string, ContactInput>(existing.map((contact) => [contactImportIdentity(contact), contact]));
  const counts: ContactImportCounts = { total: rows.length, ready: 0, duplicates: 0, invalid: 0 };
  const preview = rows.map((row): ContactImportPreviewRow => {
    if (!row.contact) {
      counts.invalid += 1;
      return { ...row, status: "invalid", message: row.error ?? "Invalid contact." };
    }
    const key = contactImportIdentity(row.contact);
    const duplicate = identities.get(key);
    if (duplicate) {
      counts.duplicates += 1;
      const differs = Object.values(contactImportColumns).some((field) => normalizeIdentity(duplicate[field]) !== normalizeIdentity(row.contact![field]));
      return {
        ...row, status: "duplicate",
        message: differs
          ? "Matching name/organization, different details. Skipped; existing details unchanged."
          : "Matching name/organization. Skipped; existing details unchanged.",
      };
    }
    identities.set(key, row.contact);
    counts.ready += 1;
    return { ...row, status: "ready", message: "New directory entry." };
  });
  return { counts, rows: preview };
}

export function contactImportIdentity(contact: Pick<ContactInput, "firstName" | "lastName" | "organization">) {
  return JSON.stringify([contact.firstName, contact.lastName, contact.organization].map(normalizeIdentity));
}

function normalizeIdentity(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

// No installed CSV parser meets this boundary. Strict RFC-style quoting, bounded
// rows/cells, and physical line numbers are intentionally limited to comma CSV.
function parseCsv(text: string): { cells: string[]; row: number }[] {
  const rows: { cells: string[]; row: number }[] = [];
  let cells: string[] = [];
  let cell = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  let line = 1;
  let rowLine = 1;
  const finishCell = () => {
    cells.push(cell);
    if (cells.length > Object.keys(contactImportColumns).length) throw new ContactImportError(`Too many columns at line ${rowLine}.`);
    cell = "";
    state = "plain";
  };
  const finishRow = () => {
    finishCell();
    if (cells.length > 1 || cells.some((value) => value.trim())) rows.push({ cells, row: rowLine });
    cells = [];
    if (rows.length > contactImportMaxRows + 1) throw new ContactImportError("CSV must contain at most 500 data rows.");
    rowLine = line + 1;
  };
  const consumeQuoted = (index: number) => {
    const character = text[index];
    if (character === '"') {
      if (text[index + 1] === '"') { cell += '"'; index += 1; }
      else state = "closed";
    } else {
      cell += character;
      if (character === "\n" || (character === "\r" && text[index + 1] !== "\n")) line += 1;
    }
    return index;
  };
  const consumePlainCharacter = (character: string) => {
    if (character === '"' && state === "plain" && cell.length === 0) {
      state = "quoted";
    } else if (state === "closed" || character === '"') {
      throw new ContactImportError(`Malformed CSV quotes at line ${line}.`);
    } else {
      cell += character;
    }
  };
  const consumeUnquoted = (index: number) => {
    const character = text[index];
    if (character === ",") {
      finishCell();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
      line += 1;
    } else {
      consumePlainCharacter(character);
    }
    return index;
  };
  const consumeCharacter = (index: number) => {
    if (state === "quoted") return consumeQuoted(index);
    return consumeUnquoted(index);
  };
  const finishInput = () => {
    if (state === "quoted") throw new ContactImportError(`Unterminated CSV quotes at line ${rowLine}.`);
    if (cell.length || cells.length || state === "closed") finishRow();
  };
  for (let index = 0; index < text.length; index += 1) {
    index = consumeCharacter(index);
    if (cell.length > 2000) throw new ContactImportError(`Field exceeds 2000 characters at line ${rowLine}.`);
  }
  finishInput();
  return rows;
}
