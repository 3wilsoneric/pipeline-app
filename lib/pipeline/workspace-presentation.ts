import type { Referral } from "./referral-types";
import { extractImportedClientMetadata } from "./client-identity-presentation.mjs";

export type WorkspaceAdmissionOutcome = {
  status: "admitted" | "accepted" | "denied" | "pending" | "unmatched";
  label: "Admitted" | "Accepted" | "Denied" | "In progress" | "No admission match";
  evidence: "recorded" | "census_match" | "no_census_match" | "open";
  explanation: string;
};

const hiddenWorkspaceTags = new Set(["historical"]);

const internalWorkspaceTags = new Set([
  "allo-import",
  "face-sheet",
  "historical",
  "needs-assignment",
  "needs-review",
  "real-intake",
]);

const missingWorkspaceCommunities = new Set([
  "unassigned",
  "unknown",
  "not recorded",
  "community not recorded",
]);

export const californiaCountyNames = [
  "Alameda",
  "Alpine",
  "Amador",
  "Butte",
  "Calaveras",
  "Colusa",
  "Contra Costa",
  "Del Norte",
  "El Dorado",
  "Fresno",
  "Glenn",
  "Humboldt",
  "Imperial",
  "Inyo",
  "Kern",
  "Kings",
  "Lake",
  "Lassen",
  "Los Angeles",
  "Madera",
  "Marin",
  "Mariposa",
  "Mendocino",
  "Merced",
  "Modoc",
  "Mono",
  "Monterey",
  "Napa",
  "Nevada",
  "Orange",
  "Placer",
  "Plumas",
  "Riverside",
  "Sacramento",
  "San Benito",
  "San Bernardino",
  "San Diego",
  "San Francisco",
  "San Joaquin",
  "San Luis Obispo",
  "San Mateo",
  "Santa Barbara",
  "Santa Clara",
  "Santa Cruz",
  "Shasta",
  "Sierra",
  "Siskiyou",
  "Solano",
  "Sonoma",
  "Stanislaus",
  "Sutter",
  "Tehama",
  "Trinity",
  "Tulare",
  "Tuolumne",
  "Ventura",
  "Yolo",
  "Yuba",
] as const;

export const californiaCountyOptions = californiaCountyNames.map((county) => `${county} County`);

const countyAliases = [
  { aliases: ["COCO", "CCC"], county: "Contra Costa" },
  { aliases: ["LA", "LAC"], county: "Los Angeles" },
  { aliases: ["SAC"], county: "Sacramento" },
  { aliases: ["SB"], county: "San Bernardino" },
  { aliases: ["SF"], county: "San Francisco" },
] as const;

export function getWorkspaceAdmissionOutcome(referral: Referral): WorkspaceAdmissionOutcome {
  if (referral.admissionDate?.trim()) {
    return {
      status: "admitted",
      label: "Admitted",
      evidence: "census_match",
      explanation: "The workspace matches a client with a governed admission record.",
    };
  }

  if (
    referral.stage === "Accepted / Admitted"
    && referral.admissionDecision?.outcome === "accepted"
    && referral.admissionDecision.reasonCode === "supervisor_confirmed_admission"
  ) {
    return {
      status: "admitted",
      label: "Admitted",
      evidence: "recorded",
      explanation: "Admission was confirmed by a supervisor while the governed census link remains unavailable.",
    };
  }

  if (referral.admissionDecision?.outcome === "declined") {
    return {
      status: "denied",
      label: "Denied",
      evidence: "recorded",
      explanation: "The workspace has a recorded declined outcome.",
    };
  }

  if (referral.admissionDecision?.outcome === "accepted") {
    return {
      status: "accepted",
      label: "Accepted",
      evidence: "recorded",
      explanation: "The workspace has a recorded accepted decision but no governed admission match yet.",
    };
  }

  if (referral.workspaceStatus === "historical") {
    return {
      status: "unmatched",
      label: "No admission match",
      evidence: "no_census_match",
      explanation: "No governed admission record has been matched to this imported workspace. This does not mean the referral was denied.",
    };
  }

  return {
    status: "pending",
    label: "In progress",
    evidence: "open",
    explanation: "The referral is open and has no recorded decision or governed admission match yet.",
  };
}

export function visibleWorkspaceTags(tags: string[] | undefined) {
  return (tags ?? []).filter((tag) => !hiddenWorkspaceTags.has(tag.trim().toLowerCase()));
}

export function isInternalWorkspaceTag(tag: string) {
  const normalized = tag.trim().toLowerCase();
  return internalWorkspaceTags.has(normalized)
    || normalized.startsWith("allo-")
    || normalized.startsWith("import-")
    || normalized.startsWith("needs-");
}

export function isRecordedWorkspaceCommunity(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return Boolean(normalized) && !missingWorkspaceCommunities.has(normalized);
}

export function getWorkspaceCounty(referral: Referral) {
  return resolveWorkspaceCounty(referral) ?? "";
}

export function resolveWorkspaceCounty(referral: Partial<Referral>) {
  const firstClassCounty = referral.county?.trim();
  if (firstClassCounty) return canonicalCountyLabel(firstClassCounty) ?? firstClassCounty;

  const extractedCounty = referral.packetFields?.find((field) => {
    const key = field.field_key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return key === "county" || key.endsWith("county");
  });
  const extractedValue = (extractedCounty?.final_value ?? extractedCounty?.proposed_value)?.trim();
  if (extractedValue) return canonicalCountyLabel(extractedValue) ?? extractedValue;

  const storedCounty = referral.community ? canonicalCountyLabel(referral.community) : null;
  if (storedCounty) return storedCounty;

  const importedTitleCounty = canonicalCountyLabel(extractImportedClientMetadata(referral.name) ?? "");
  if (importedTitleCounty) return importedTitleCounty;

  const sourceValues = [
    referral.sourceWorkspaceName,
    referral.sourceProjectName,
    referral.payer,
    referral.source,
    ...(referral.tags ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const value of sourceValues) {
    const county = canonicalCountyLabel(value);
    if (county) return county;
  }

  return undefined;
}

function canonicalCountyLabel(value: string) {
  const county = [...californiaCountyNames]
    .sort((left, right) => right.length - left.length)
    .find((name) => countyNamePattern(name).test(value));
  if (county) return `${county} County`;

  for (const definition of countyAliases) {
    if (definition.aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(value))) {
      return `${definition.county} County`;
    }
  }

  return null;
}

function countyNamePattern(name: string) {
  const countyName = escapeRegExp(name).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b(?:County\\s+(?:of\\s+)?${countyName}|${countyName}(?:\\s+County)?)\\b`, "i");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function presentWorkspaceNote(note: string) {
  return note.replace(/^Historical workspace\b/i, "Imported workspace");
}
