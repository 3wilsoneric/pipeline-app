import type { ReferralOwner, ReferralOwnerResponsibility } from "./referral-types";
import { isUnassignedOwner, normalizeOwnerName } from "./referral-owner-identity";

export { isUnassignedOwner, normalizeOwnerName } from "./referral-owner-identity";

type AssignedUser = {
  id: string;
  email?: string;
  name: string;
};

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

export function isReferralOwner(
  referral: { ownerId?: string | null; owner?: string | null; owners?: ReferralOwner[] },
  user: AssignedUser,
) {
  if (isAssignedToUser(referral, user)) return true;
  const userId = user.id.trim().toLowerCase();
  return normalizeReferralOwners(referral.owners).some((owner) => owner.id.trim().toLowerCase() === userId);
}

export function createReferralOwners(
  creator: AssignedUser,
  assignment: { ownerId?: string | null; owner?: string | null },
  creatorCanSupervise: boolean,
): ReferralOwner[] {
  const owners: ReferralOwner[] = [];
  addResponsibility(owners, creator, "creator");
  const assignee = assignedIdentity(assignment);
  if (!assignee) return owners;
  if (creatorCanSupervise && !sameIdentity(creator, assignee)) {
    addResponsibility(owners, creator, "assigning_supervisor");
  }
  addResponsibility(owners, assignee, "assignee");
  return owners;
}

export function reassignReferralOwners(
  current: ReferralOwner[] | undefined,
  actor: AssignedUser,
  assignment: { ownerId?: string | null; owner?: string | null },
  actorCanSupervise: boolean,
): ReferralOwner[] {
  const owners = normalizeReferralOwners(current)
    .map((owner) => ({
      ...owner,
      responsibilities: owner.responsibilities.filter((responsibility) =>
        responsibility !== "assignee" && responsibility !== "assigning_supervisor"),
    }))
    .filter((owner) => owner.responsibilities.length > 0);
  const assignee = assignedIdentity(assignment);
  if (!assignee) return owners;
  if (actorCanSupervise && !sameIdentity(actor, assignee)) {
    addResponsibility(owners, actor, "assigning_supervisor");
  }
  addResponsibility(owners, assignee, "assignee");
  return owners;
}

export function normalizeReferralOwners(value: unknown): ReferralOwner[] {
  if (!Array.isArray(value)) return [];
  const owners: ReferralOwner[] = [];
  for (const candidate of value) {
    const owner = parseReferralOwner(candidate);
    if (!owner) continue;
    for (const responsibility of owner.responsibilities) addResponsibility(owners, owner, responsibility);
  }
  return owners;
}

function parseReferralOwner(value: unknown): ReferralOwner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<ReferralOwner>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? normalizeOwnerName(input.name) : "Unassigned";
  if (!id || isUnassignedOwner(name)) return null;
  const responsibilities = Array.isArray(input.responsibilities)
    ? input.responsibilities.filter(isOwnerResponsibility)
    : [];
  return { id, name, responsibilities };
}

function assignedIdentity(assignment: { ownerId?: string | null; owner?: string | null }): AssignedUser | null {
  const id = assignment.ownerId?.trim();
  const name = normalizeOwnerName(assignment.owner);
  return id && !isUnassignedOwner(name) ? { id, name } : null;
}

function addResponsibility(
  owners: ReferralOwner[],
  identity: AssignedUser,
  responsibility: ReferralOwnerResponsibility,
) {
  const id = identity.id.trim();
  const name = normalizeOwnerName(identity.name);
  if (!id || isUnassignedOwner(name)) return;
  const existing = owners.find((owner) => owner.id.toLowerCase() === id.toLowerCase());
  if (existing) {
    existing.name = name;
    if (!existing.responsibilities.includes(responsibility)) existing.responsibilities.push(responsibility);
    return;
  }
  owners.push({ id, name, responsibilities: [responsibility] });
}

function sameIdentity(left: AssignedUser, right: AssignedUser) {
  return left.id.trim().toLowerCase() === right.id.trim().toLowerCase();
}

function isOwnerResponsibility(value: unknown): value is ReferralOwnerResponsibility {
  return value === "creator" || value === "assignee" || value === "assigning_supervisor";
}
