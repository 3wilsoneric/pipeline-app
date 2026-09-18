const unassignedOwnerValues = new Set(["", "pending", "unassigned", "unknown"]);

export function isUnassignedOwner(value: unknown) {
  return typeof value !== "string" || unassignedOwnerValues.has(value.trim().toLowerCase());
}

export function normalizeOwnerName(value: unknown) {
  return isUnassignedOwner(value) ? "Unassigned" : String(value).trim().replace(/\s+/g, " ");
}

// Retired historical owners remain on their records but are omitted from browse menus.
// Update this list if a retired staff member returns to the active roster.
const retiredOwnerOptions = new Set(["marta", "lorena renaud", "lily florian"]);

export function ownerFilterOptions(values: readonly string[]) {
  return [...new Set(values.map(normalizeOwnerName))]
    .filter((name) => !isUnassignedOwner(name) && !retiredOwnerOptions.has(name.toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
}
