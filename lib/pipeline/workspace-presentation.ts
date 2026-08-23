import type { Referral } from "./referral-types";

export type WorkspaceAdmissionOutcome = {
  status: "admitted" | "accepted" | "denied" | "pending" | "unmatched";
  label: "Admitted" | "Accepted" | "Denied" | "In progress" | "No admission match";
  evidence: "recorded" | "census_match" | "no_census_match" | "open";
  explanation: string;
};

const hiddenWorkspaceTags = new Set(["historical"]);

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

export function presentWorkspaceNote(note: string) {
  return note.replace(/^Historical workspace\b/i, "Imported workspace");
}
