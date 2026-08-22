import type { Referral } from "./referral-types";

export type WorkspaceAdmissionOutcome = {
  status: "admitted" | "not_admitted" | "pending" | "unknown";
  label: "Admitted" | "Not admitted" | "Pending" | "Outcome not recorded";
  evidence: "recorded" | "client_history" | "open" | "unknown";
  explanation: string;
};

const hiddenWorkspaceTags = new Set(["historical"]);

export function getWorkspaceAdmissionOutcome(referral: Referral): WorkspaceAdmissionOutcome {
  if (referral.admissionDecision?.outcome === "accepted" || referral.stage === "Accepted / Admitted") {
    return {
      status: "admitted",
      label: "Admitted",
      evidence: "recorded",
      explanation: "The workspace has a recorded accepted or admitted outcome.",
    };
  }

  if (referral.admissionDecision?.outcome === "declined" || referral.stage === "Declined") {
    return {
      status: "not_admitted",
      label: "Not admitted",
      evidence: "recorded",
      explanation: "The workspace has a recorded declined outcome.",
    };
  }

  if (referral.admissionDate?.trim()) {
    return {
      status: "admitted",
      label: "Admitted",
      evidence: "client_history",
      explanation: "The linked client has a recorded admission date in the governed client history.",
    };
  }

  if (referral.workspaceStatus === "historical") {
    return {
      status: "unknown",
      label: "Outcome not recorded",
      evidence: "unknown",
      explanation: "The imported workspace has no explicit decision and is not linked to recorded admission history.",
    };
  }

  return {
    status: "pending",
    label: "Pending",
    evidence: "open",
    explanation: "No admission decision has been recorded yet.",
  };
}

export function visibleWorkspaceTags(tags: string[] | undefined) {
  return (tags ?? []).filter((tag) => !hiddenWorkspaceTags.has(tag.trim().toLowerCase()));
}

export function presentWorkspaceNote(note: string) {
  return note.replace(/^Historical workspace\b/i, "Imported workspace");
}
