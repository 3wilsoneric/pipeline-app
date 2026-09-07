export function validateClientMutationId(value: unknown):
  | { ok: true; value?: string }
  | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[a-zA-Z0-9_.:-]+$/.test(value)) {
    return { ok: false, message: "client_mutation_id is invalid." };
  }
  return { ok: true, value };
}
