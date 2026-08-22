import type { Referral } from "./referral-types";

export type WorkspaceAdmissionOutcome = {
  status: "admitted" | "not_admitted" | "pending";
  label: "Admitted" | "Not admitted" | "Pending";
  evidence: "recorded" | "inferred" | "open";
  explanation: string;
};

const hiddenWorkspaceTags = new Set(["historical"]);

export function getWorkspaceAdmissionOutcome(referral: Referral): WorkspaceAdmissionOutcome {
  if (referral.admissionDate?.trim() || referral.admissionDecision?.outcome === "accepted" || referral.stage === "Accepted / Admitted") {
    return {
      status: "admitted",
      label: "Admitted",
      evidence: "recorded",
      explanation: referral.admissionDate?.trim()
        ? "An admission date is recorded for this workspace."
        : "The workspace has a recorded accepted or admitted outcome.",
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

  if (referral.workspaceStatus === "historical") {
    return {
      status: "not_admitted",
      label: "Not admitted",
      evidence: "inferred",
      explanation: "Inferred from a closed imported workspace with no admission record.",
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
