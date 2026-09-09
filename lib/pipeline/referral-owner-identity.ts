const unassignedOwnerValues = new Set(["", "pending", "unassigned", "unknown"]);

export function isUnassignedOwner(value: unknown) {
  return typeof value !== "string" || unassignedOwnerValues.has(value.trim().toLowerCase());
}

export function normalizeOwnerName(value: unknown) {
  return isUnassignedOwner(value) ? "Unassigned" : String(value).trim().replace(/\s+/g, " ");
}
