const unassignedOwnerValues = new Set(["", "pending", "unassigned", "unknown"]);

type AssignedUser = {
  id: string;
  email?: string;
  name: string;
};

export function isUnassignedOwner(value: unknown) {
  return typeof value !== "string" || unassignedOwnerValues.has(value.trim().toLowerCase());
}

export function normalizeOwnerName(value: unknown) {
  return isUnassignedOwner(value) ? "Unassigned" : String(value).trim().replace(/\s+/g, " ");
}

export function normalizedOwnerAliases(user: AssignedUser) {
  return [...new Set([user.name, user.email]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => normalizeOwnerName(value).toLowerCase()))];
}

export function isAssignedToUser(
  assignment: { ownerId?: string | null; owner?: string | null },
  user: AssignedUser,
) {
  const ownerId = assignment.ownerId?.trim();
  if (ownerId) return ownerId.toLowerCase() === user.id.trim().toLowerCase();
  return normalizedOwnerAliases(user).includes(normalizeOwnerName(assignment.owner).toLowerCase());
}
