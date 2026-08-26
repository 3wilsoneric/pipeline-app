import {
  referralCanvasFieldKeys,
  type ReferralCanvasFieldKey,
} from "@/lib/pipeline/referral-types";
import {
  pickAssessmentToolData,
  type AssessmentToolData,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import {
  isAssessmentToolSection,
  normalizeAssessmentSectionVersions,
  type AssessmentSectionVersions,
} from "@/lib/assessment/assessment-sections";

export const pipelineRecentDestinationKinds = ["page", "profile", "referral"] as const;
export const pipelineRecentDestinationScreens = [
  "referrals",
  "profiles",
  "operations",
  "packet",
  "profile",
] as const;

export type PipelineRecentDestination =
  | {
      id: string;
      kind: "page";
      screen: "referrals" | "profiles" | "operations" | "packet";
      title: string;
      detail: string;
      visitedAt: string;
    }
  | {
      id: string;
      kind: "profile";
      screen: "profile";
      title: string;
      detail: string;
      clientId: string;
      visitedAt: string;
    }
  | {
      id: string;
      kind: "referral";
      screen: "packet";
      title: string;
      detail: string;
      referralId: number;
      community: string;
      visitedAt: string;
    };

export type RecentDestinationInput =
  | Omit<Extract<PipelineRecentDestination, { kind: "page" }>, "visitedAt"> & { visitedAt?: string }
  | Omit<Extract<PipelineRecentDestination, { kind: "profile" }>, "visitedAt"> & { visitedAt?: string }
  | Omit<Extract<PipelineRecentDestination, { kind: "referral" }>, "visitedAt"> & { visitedAt?: string };

export const referralDraftExtraKeys = ["conserved", "tags", "documents", "initialPacket"] as const;
export type ReferralDraftDirtyKey = ReferralCanvasFieldKey | (typeof referralDraftExtraKeys)[number];

export type PipelineReferralDraft = {
  schema: 1;
  savedAt: string;
  baseVersion?: number;
  baseValues?: Partial<Record<ReferralDraftDirtyKey, string>>;
  dirtyKeys: ReferralDraftDirtyKey[];
  fields: Record<ReferralCanvasFieldKey, { value: string; sourceFile?: string }>;
  conserved: "yes" | "no" | "";
  tagsInput: string;
  documents: Record<string, string>;
  initialPacketName?: string;
  initialPacketCategory?: "referral_packet" | "face_sheet";
};

export type PipelineAssessmentDraft = {
  schema: 1;
  assessmentId: string;
  savedAt: string;
  baseVersion: number;
  sectionVersions: AssessmentSectionVersions;
  dirtySections: AssessmentToolSection[];
  data: AssessmentToolData;
  baseData: AssessmentToolData;
};

export function isReferralDraftDirtyKey(value: unknown): value is ReferralDraftDirtyKey {
  return typeof value === "string" && (
    (referralCanvasFieldKeys as readonly string[]).includes(value)
    || (referralDraftExtraKeys as readonly string[]).includes(value)
  );
}

export function isPipelineRecentDestination(value: unknown): value is PipelineRecentDestination {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<PipelineRecentDestination>;
  const baseIsValid = (
    isBoundedText(item.id, 160)
    && isBoundedText(item.title, 200)
    && isBoundedText(item.detail, 300, true)
    && typeof item.visitedAt === "string"
    && Number.isFinite(Date.parse(item.visitedAt))
  );
  if (!baseIsValid) return false;

  if (item.kind === "page") {
    return item.screen === "referrals" || item.screen === "profiles" || item.screen === "operations" || item.screen === "packet";
  }
  if (item.kind === "profile") {
    return item.screen === "profile" && isBoundedText(item.clientId, 256);
  }
  if (item.kind === "referral") {
    return item.screen === "packet"
      && Number.isSafeInteger(item.referralId)
      && Number(item.referralId) > 0
      && isBoundedText(item.community, 120);
  }
  return false;
}

export function parsePipelineReferralDraft(value: unknown): PipelineReferralDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PipelineReferralDraft>;
  if (candidate.schema !== 1 || !validTimestamp(candidate.savedAt)) return null;
  if (candidate.baseVersion !== undefined && (!Number.isSafeInteger(candidate.baseVersion) || candidate.baseVersion < 1)) return null;
  if (!Array.isArray(candidate.dirtyKeys) || candidate.dirtyKeys.length > referralCanvasFieldKeys.length + referralDraftExtraKeys.length) return null;
  const hasLegacyCommunity = candidate.fields?.community === undefined
    && candidate.fields?.county !== undefined;
  const dirtyKeys = [...new Set(candidate.dirtyKeys
    .filter(isReferralDraftDirtyKey)
    .map((key) => hasLegacyCommunity && key === "county" ? "community" : key))];
  if (dirtyKeys.length !== candidate.dirtyKeys.length) return null;
  if (!candidate.fields || typeof candidate.fields !== "object" || Array.isArray(candidate.fields)) return null;

  const fields = {} as PipelineReferralDraft["fields"];
  const legacyCommunity = candidate.fields.community === undefined
    ? candidate.fields.county
    : undefined;
  for (const key of referralCanvasFieldKeys) {
    const field = key === "community" && legacyCommunity
      ? legacyCommunity
      : key === "county" && legacyCommunity
        ? { value: "" }
        : candidate.fields[key];
    if (!field || typeof field !== "object" || Array.isArray(field) || !isBoundedText(field.value, 40_000, true)) return null;
    if (field.sourceFile !== undefined && !isBoundedText(field.sourceFile, 255, true)) return null;
    fields[key] = {
      value: field.value,
      ...(field.sourceFile ? { sourceFile: field.sourceFile } : {}),
    };
  }

  const rawBaseValues = parseBoundedStringRecord(candidate.baseValues, 24, 48_000);
  const baseValues = rawBaseValues && hasLegacyCommunity && rawBaseValues.county !== undefined
    ? { ...rawBaseValues, community: rawBaseValues.county, county: "" }
    : rawBaseValues;
  if (candidate.baseValues !== undefined && !baseValues) return null;
  const documents = parseBoundedStringRecord(candidate.documents, 64, 16_000);
  if (!documents) return null;
  if (candidate.conserved !== "yes" && candidate.conserved !== "no" && candidate.conserved !== "") return null;
  if (!isBoundedText(candidate.tagsInput, 2_000, true)) return null;
  if (candidate.initialPacketName !== undefined && !isBoundedText(candidate.initialPacketName, 255, true)) return null;
  if (candidate.initialPacketCategory !== undefined && candidate.initialPacketCategory !== "referral_packet" && candidate.initialPacketCategory !== "face_sheet") return null;

  return {
    schema: 1,
    savedAt: candidate.savedAt,
    ...(candidate.baseVersion ? { baseVersion: candidate.baseVersion } : {}),
    ...(baseValues ? { baseValues: baseValues as Partial<Record<ReferralDraftDirtyKey, string>> } : {}),
    dirtyKeys,
    fields,
    conserved: candidate.conserved,
    tagsInput: candidate.tagsInput,
    documents,
    ...(candidate.initialPacketName ? { initialPacketName: candidate.initialPacketName } : {}),
    ...(candidate.initialPacketCategory ? { initialPacketCategory: candidate.initialPacketCategory } : {}),
  };
}

export function parsePipelineAssessmentDraft(value: unknown): PipelineAssessmentDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PipelineAssessmentDraft>;
  if (candidate.schema !== 1 || !isBoundedText(candidate.assessmentId, 160) || !validTimestamp(candidate.savedAt)) return null;
  if (!Number.isSafeInteger(candidate.baseVersion) || Number(candidate.baseVersion) < 1) return null;
  if (!Array.isArray(candidate.dirtySections) || candidate.dirtySections.length > 11) return null;
  const dirtySections = [...new Set(candidate.dirtySections.filter(isAssessmentToolSection))];
  if (dirtySections.length !== candidate.dirtySections.length) return null;
  if (!candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) return null;
  if (!candidate.baseData || typeof candidate.baseData !== "object" || Array.isArray(candidate.baseData)) return null;

  return {
    schema: 1,
    assessmentId: candidate.assessmentId,
    savedAt: candidate.savedAt,
    baseVersion: Number(candidate.baseVersion),
    sectionVersions: normalizeAssessmentSectionVersions(candidate.sectionVersions),
    dirtySections,
    data: pickAssessmentToolData(candidate.data),
    baseData: pickAssessmentToolData(candidate.baseData),
  };
}

function parseBoundedStringRecord(value: unknown, maximumEntries: number, maximumCharacters: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > maximumEntries) return null;
  let totalCharacters = 0;
  for (const [key, entry] of entries) {
    if (!isBoundedText(key, 160) || !isBoundedText(entry, maximumCharacters, true)) return null;
    totalCharacters += key.length + entry.length;
    if (totalCharacters > maximumCharacters) return null;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function isBoundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
