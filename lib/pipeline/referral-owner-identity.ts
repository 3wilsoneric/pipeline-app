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

// Canonical labels for ReferralOwner["responsibilities"]. The referral's
// owner/ownerId is the assigned assessor; an assessment keeps its own assessor
// and author (created_by), which can differ, e.g. when an unassigned referral's
// assessment was started by the signed-in user. Never infer any of these roles
// from the current viewer.
export const referralOwnerResponsibilityLabels = {
  creator: "Created workspace",
  assigning_supervisor: "Assigning supervisor",
  assignee: "Assigned assessor",
} as const satisfies Record<string, string>;

type RolePerson = { id?: string | null; name?: string | null };

export type ReferralRoleFact = {
  role: "assigned_assessor" | "assessment_assessor" | "assessment_author";
  label: string;
  value: string;
};

export function referralRoleFacts(input: {
  owner?: string | null;
  ownerId?: string | null;
  assessment?: { assessor?: RolePerson | null; author?: RolePerson | null } | null;
}): ReferralRoleFact[] {
  const assigned: RolePerson | null = isUnassignedOwner(input.owner) ? null : { id: input.ownerId, name: input.owner };
  const facts: ReferralRoleFact[] = [{ role: "assigned_assessor", label: "Assigned assessor", value: normalizeOwnerName(input.owner) }];
  const assessor = namedPerson(input.assessment?.assessor);
  if (assessor && !samePerson(assessor, assigned)) {
    facts.push({ role: "assessment_assessor", label: "Assessment assessor", value: normalizeOwnerName(assessor.name) });
  }
  const author = namedPerson(input.assessment?.author);
  if (author && !samePerson(author, assessor ?? assigned)) {
    facts.push({ role: "assessment_author", label: "Assessment started by", value: normalizeOwnerName(author.name) });
  }
  return facts;
}

function namedPerson(person: RolePerson | null | undefined) {
  return person && !isUnassignedOwner(person.name) ? person : null;
}

function samePerson(left: RolePerson, right: RolePerson | null) {
  if (!right) return false;
  const leftId = left.id?.trim().toLowerCase();
  const rightId = right.id?.trim().toLowerCase();
  if (leftId && rightId) return leftId === rightId;
  return normalizeOwnerName(left.name).toLowerCase() === normalizeOwnerName(right.name).toLowerCase();
}
