import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";
import {
  contactMethods,
  referralContactRoles,
  type ContactInput,
  type ContactPatch,
  type ReferralContactInput,
  type ReferralContactPatch,
} from "@/lib/pipeline/contact-types";

type Valid<T> = { ok: true; value: T };
type Invalid = { ok: false; message: string; status: number };
type Validation<T> = Valid<T> | Invalid;

const contactLimits = {
  firstName: 120,
  lastName: 120,
  organization: 240,
  jobTitle: 160,
  phone: 80,
  email: 320,
  bestContactTime: 240,
  notes: 2_000,
} as const;

export function validateContactCreateBody(value: unknown): Validation<{ contact: ContactInput; mutationId?: string }> {
  const body = record(value);
  if (!body) return invalid("The request body must be an object.");
  const mutation = validateClientMutationId(body.client_mutation_id);
  if (!mutation.ok) return invalid(mutation.message);
  const contact = parseContactInput(body.contact, false);
  return contact.ok ? valid({ contact: contact.value as ContactInput, mutationId: mutation.value }) : contact;
}

export function validateContactPatchBody(value: unknown): Validation<{ patch: ContactPatch; expectedVersion: number; mutationId?: string }> {
  const body = record(value);
  if (!body) return invalid("The request body must be an object.");
  const expectedVersion = positiveVersion(body.if_match);
  if (!expectedVersion) return invalid("if_match must be a positive version number.");
  const mutation = validateClientMutationId(body.client_mutation_id);
  if (!mutation.ok) return invalid(mutation.message);
  const contact = parseContactInput(body.contact, true);
  if (!contact.ok) return contact;
  if (Object.keys(contact.value).length === 0) return invalid("contact must include at least one change.");
  return valid({ patch: contact.value, expectedVersion, mutationId: mutation.value });
}

export function validateReferralContactCreateBody(value: unknown): Validation<{ link: ReferralContactInput; mutationId?: string }> {
  const body = record(value);
  if (!body) return invalid("The request body must be an object.");
  const mutation = validateClientMutationId(body.client_mutation_id);
  if (!mutation.ok) return invalid(mutation.message);
  const contactId = identifier(body.contact_id, "contact_id");
  if (!contactId.ok) return contactId;
  const role = referralContactRoles.find((item) => item === body.role);
  if (!role) return invalid("role is invalid.");
  const relationship = boundedText(body.relationship, "relationship", 240);
  if (!relationship.ok) return relationship;
  const notes = boundedText(body.notes, "notes", 1_000);
  if (!notes.ok) return notes;
  if (body.primary_for_scheduling !== undefined && typeof body.primary_for_scheduling !== "boolean") {
    return invalid("primary_for_scheduling must be a boolean.");
  }
  return valid({
    link: {
      contactId: contactId.value,
      role,
      relationship: relationship.value,
      notes: notes.value,
      primaryForScheduling: body.primary_for_scheduling === true,
    },
    mutationId: mutation.value,
  });
}

export function validateReferralContactPatchBody(value: unknown): Validation<{ patch: ReferralContactPatch; expectedVersion: number; mutationId?: string }> {
  const body = record(value);
  if (!body) return invalid("The request body must be an object.");
  const expectedVersion = positiveVersion(body.if_match);
  if (!expectedVersion) return invalid("if_match must be a positive version number.");
  const mutation = validateClientMutationId(body.client_mutation_id);
  if (!mutation.ok) return invalid(mutation.message);
  const patch: ReferralContactPatch = {};
  if (body.role !== undefined) {
    const role = referralContactRoles.find((item) => item === body.role);
    if (!role) return invalid("role is invalid.");
    patch.role = role;
  }
  for (const [source, target, maximum] of [
    ["relationship", "relationship", 240],
    ["notes", "notes", 1_000],
  ] as const) {
    if (body[source] === undefined) continue;
    const text = boundedText(body[source], source, maximum);
    if (!text.ok) return text;
    patch[target] = text.value;
  }
  if (body.primary_for_scheduling !== undefined) {
    if (typeof body.primary_for_scheduling !== "boolean") return invalid("primary_for_scheduling must be a boolean.");
    patch.primaryForScheduling = body.primary_for_scheduling;
  }
  if (Object.keys(patch).length === 0) return invalid("The link update must include at least one change.");
  return valid({ patch, expectedVersion, mutationId: mutation.value });
}

export function validateReferralContactDeleteBody(value: unknown): Validation<{ expectedVersion: number; mutationId?: string }> {
  const body = record(value);
  if (!body) return invalid("The request body must be an object.");
  const expectedVersion = positiveVersion(body.if_match);
  if (!expectedVersion) return invalid("if_match must be a positive version number.");
  const mutation = validateClientMutationId(body.client_mutation_id);
  return mutation.ok ? valid({ expectedVersion, mutationId: mutation.value }) : invalid(mutation.message);
}

export function parseContactSearch(url: URL): Validation<{ query: string; limit: number }> {
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length > 160) return invalid("q is too long.");
  const requested = Number(url.searchParams.get("limit") ?? 20);
  if (!Number.isInteger(requested) || requested < 1 || requested > 50) return invalid("limit must be between 1 and 50.");
  return valid({ query, limit: requested });
}

function parseContactInput(value: unknown, partial: boolean): Validation<ContactInput | ContactPatch> {
  const source = record(value);
  if (!source) return invalid("contact must be an object.");
  const textFields = parseContactTextFields(source, partial);
  if (!textFields.ok) return textFields;
  const method = parsePreferredContactMethod(source, partial);
  if (!method.ok) return method;
  const active = parseActive(source, partial);
  if (!active.ok) return active;
  const parsed: Record<string, string | boolean> = { ...textFields.value, ...method.value, ...active.value };
  if (typeof parsed.email === "string" && parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(parsed.email)) {
    return invalid("email is invalid.");
  }
  if (!partial && ![parsed.firstName, parsed.lastName, parsed.organization].some(hasText)) {
    return invalid("Enter a first name, last name, or organization.");
  }
  return valid(parsed as ContactInput | ContactPatch);
}

function parseContactTextFields(source: Record<string, unknown>, partial: boolean): Validation<Record<string, string>> {
  const parsed: Record<string, string> = {};
  for (const [key, maximum] of Object.entries(contactLimits) as Array<[keyof typeof contactLimits, number]>) {
    if (partial && source[key] === undefined) continue;
    const text = boundedText(source[key] ?? "", key, maximum);
    if (!text.ok) return text;
    parsed[key] = text.value;
  }
  return valid(parsed);
}

function parsePreferredContactMethod(source: Record<string, unknown>, partial: boolean): Validation<Record<string, string>> {
  if (!partial || source.preferredContactMethod !== undefined) {
    const method = contactMethods.find((item) => item === (source.preferredContactMethod ?? "not_recorded"));
    if (!method) return invalid("preferredContactMethod is invalid.");
    return valid({ preferredContactMethod: method });
  }
  return valid({});
}

function parseActive(source: Record<string, unknown>, partial: boolean): Validation<Record<string, boolean>> {
  if (partial && source.active !== undefined) {
    if (typeof source.active !== "boolean") return invalid("active must be a boolean.");
    return valid({ active: source.active });
  }
  return valid({});
}

function hasText(value: unknown) {
  return typeof value === "string" && value.length > 0;
}

function boundedText(value: unknown, key: string, maximum: number): Validation<string> {
  if (typeof value !== "string" || value.length > maximum) return invalid(`${key} must be at most ${maximum} characters.`);
  return valid(value.trim());
}

function identifier(value: unknown, key: string): Validation<string> {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || !/^[a-zA-Z0-9_.:-]+$/u.test(value)) {
    return invalid(`${key} is invalid.`);
  }
  return valid(value);
}

function positiveVersion(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function valid<T>(value: T): Valid<T> {
  return { ok: true, value };
}

function invalid(message: string, status = 400): Invalid {
  return { ok: false, message, status };
}
