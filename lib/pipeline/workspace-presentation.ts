import type { Referral } from "./referral-types";

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

const countyNames = [
  "Alameda",
  "Calaveras",
  "Contra Costa",
  "Los Angeles",
  "Marin",
  "Merced",
  "Monterey",
  "Sacramento",
  "San Francisco",
  "San Joaquin",
  "San Mateo",
  "Santa Clara",
  "Sonoma",
  "Stanislaus",
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

export function getWorkspaceCounty(referral: Referral) {
  const extractedCounty = referral.packetFields?.find((field) => {
    const key = field.field_key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return key === "county" || key.endsWith("county");
  });
  const extractedValue = (extractedCounty?.final_value ?? extractedCounty?.proposed_value)?.trim();
  if (extractedValue) return extractedValue;

  const sourceText = [
    referral.sourceWorkspaceName,
    referral.sourceProjectName,
    referral.payer,
    referral.source,
  ].filter(Boolean).join(" ");
  if (/\bLA County\b/i.test(sourceText)) return "Los Angeles County";
  const county = countyNames.find((name) => new RegExp(`\\b${name} County\\b`, "i").test(sourceText));
  return county ? `${county} County` : "Not recorded";
}

export function presentWorkspaceNote(note: string) {
  return note.replace(/^Historical workspace\b/i, "Imported workspace");
}
