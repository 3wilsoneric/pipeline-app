export type StaffProfilePreferences = {
  preferred_name: string | null;
  job_title: string | null;
  team: string | null;
  work_phone: string | null;
  time_zone: string | null;
  status_message: string | null;
};

export type StaffProfile = StaffProfilePreferences & {
  version: number;
  updated_at: string | null;
};

export const emptyStaffProfile: StaffProfile = {
  preferred_name: null,
  job_title: null,
  team: null,
  work_phone: null,
  time_zone: null,
  status_message: null,
  version: 1,
  updated_at: null,
};

type ProfileParseResult =
  | { ok: true; profile: StaffProfilePreferences }
  | { ok: false; message: string };

const fieldRules = {
  preferred_name: { label: "Preferred name", max: 80 },
  job_title: { label: "Job title", max: 120 },
  team: { label: "Team or program", max: 120 },
  work_phone: { label: "Work phone", max: 40 },
  time_zone: { label: "Time zone", max: 100 },
  status_message: { label: "Status message", max: 120 },
} as const;

export function parseStaffProfilePreferences(value: unknown): ProfileParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "profile must be an object." };
  }

  const input = value as Record<string, unknown>;
  const profile = {} as StaffProfilePreferences;
  for (const [key, rule] of Object.entries(fieldRules) as Array<[
    keyof StaffProfilePreferences,
    (typeof fieldRules)[keyof typeof fieldRules],
  ]>) {
    const parsed = parseOptionalSingleLine(input[key], rule.label, rule.max);
    if (!parsed.ok) return parsed;
    profile[key] = parsed.value;
  }

  if (profile.work_phone && !/^[0-9+().\- x#]+$/i.test(profile.work_phone)) {
    return { ok: false, message: "Work phone contains unsupported characters." };
  }
  if (profile.time_zone && !isValidTimeZone(profile.time_zone)) {
    return { ok: false, message: "Select a valid time zone." };
  }
  return { ok: true, profile };
}

function parseOptionalSingleLine(
  value: unknown,
  label: string,
  max: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, message: `${label} must be text.` };
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > max) return { ok: false, message: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value: normalized };
}

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
