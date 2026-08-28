export type AcademyIdentity = {
  id: string;
  email: string;
};

export type AcademyOwnerPolicy = {
  emails: readonly string[];
  objectIds: readonly string[];
  explicitlyConfigured: boolean;
};

export function createAcademyOwnerPolicy({
  ownerEmails,
  ownerObjectIds,
  mockUserEmail,
  production,
}: {
  ownerEmails?: string;
  ownerObjectIds?: string;
  mockUserEmail?: string;
  production: boolean;
}): AcademyOwnerPolicy {
  const emails = parseList(ownerEmails, normalizeEmail);
  const objectIds = parseList(ownerObjectIds, normalizeIdentifier);
  const explicitlyConfigured = emails.length > 0 || objectIds.length > 0;

  if (!production && !explicitlyConfigured) {
    emails.push(normalizeEmail(mockUserEmail || "demo@pipeline.local"));
  }

  return {
    emails: unique(emails),
    objectIds: unique(objectIds),
    explicitlyConfigured,
  };
}

export function canAccessDeveloperAcademy(
  identity: AcademyIdentity | null,
  policy: AcademyOwnerPolicy,
) {
  if (!identity) return false;
  return policy.emails.includes(normalizeEmail(identity.email))
    || policy.objectIds.includes(normalizeIdentifier(identity.id));
}

function parseList(value: string | undefined, normalize: (item: string) => string) {
  return (value ?? "")
    .split(",")
    .map(normalize)
    .filter(Boolean);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values)];
}
