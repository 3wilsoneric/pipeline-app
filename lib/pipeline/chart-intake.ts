import type { Referral, ReferralCreateInput } from "./referral-types";
import type { UnifiedClientProfileResponse } from "./unified-profile-contracts";
import { clientChartRecord } from "./client-chart-context";
import { formatClinicalValue, hasReadableClinicalValue } from "@/lib/clinical/clinical-value-presentation";
import { pipelineCommunityFromClinicalName } from "./community-config";
import { persistedCanvasFieldKeys, referralCanvasValue } from "./referral-canvas-persistence";

type ChartText = (...keys: string[]) => string;

export function buildChartIntake(profile: UnifiedClientProfileResponse, source: Referral, now: string): ReferralCreateInput {
  const record = clientChartRecord(profile);
  const text = (...keys: string[]) => {
    const key = keys.find((key) => hasReadableClinicalValue(record[key], key));
    return key ? formatClinicalValue(record[key], key) : "";
  };
  const referral: ReferralCreateInput = {
    clientId: source.clientId,
    workspaceOrigin: "pipeline", workspaceStatus: "active",
    ...chartIntakeIdentity(profile, source, text),
    ...chartIntakeContacts(profile, source, text),
    ...chartIntakeCare(profile, source, text),
    community: pipelineCommunityFromClinicalName(profile.client.current_community || "") || source.community,
    county: text("county") || source.county || "",
    date: now.slice(0, 10), createdAt: now, stage: "New", priority: "standard",
    source: "", owner: "Unassigned", note: "", documentName: "", documentStatus: "Missing",
    admissionDate: "", reportedAge: "", tags: [], requirements: [],
  };
  // Carry identity/contact/medication fields, not old encounter dates, decisions,
  // signatures, assignment, packet IDs or document approvals.
  const provenance = `Chart from workspace #${source.id}, as of ${profile.data_as_of}; verify for this referral`;
  referral.fieldSources = Object.fromEntries(persistedCanvasFieldKeys
    .filter((key) => !["owner", "referralReceived", "admissionDate", "referent", "summary"].includes(key))
    .filter((key) => referralCanvasValue(referral as Referral, key).trim())
    .map((key) => [key, provenance]));
  return referral;
}

function chartIntakeIdentity(profile: UnifiedClientProfileResponse, source: Referral, text: ChartText) {
  return {
    name: profile.client.display_name || source.name,
    dob: profile.resident?.date_of_birth || text("date_of_birth") || source.dob,
    gender: profile.client.gender || text("gender") || source.gender || "",
    ssn: text("ssn", "social_security_number") || source.ssn || "",
  };
}

function chartIntakeContacts(profile: UnifiedClientProfileResponse, source: Referral, text: ChartText) {
  return {
    phone: text("phone", "phone_values_json") || source.phone,
    email: text("email", "email_values_json") || source.email,
    responsiblePerson: text("responsible_person", "conservator_name") || source.responsiblePerson || "",
    payer: profile.resident?.payor || text("payor") || source.payer,
  };
}

function chartIntakeCare(profile: UnifiedClientProfileResponse, source: Referral, text: ChartText): Pick<ReferralCreateInput, "currentMedications" | "conserved"> {
  const signed = profile.pipeline.assessments.find((assessment) => assessment.status === "complete" && assessment.signed_at);
  const conservedStatus = signed?.conservatorship_type || text("conservatorship_type", "conservatorship", "conservatorship_status");
  const conserved = /^(?:non[-_ ]conserved|no)$/i.test(conservedStatus) ? "no"
    : /^(?:lps|tcon|murphy'?s?|yes)$/i.test(conservedStatus) ? "yes" : source.conserved || "";
  return {
    currentMedications: (hasReadableClinicalValue(signed?.medications_at_intake) ? formatClinicalValue(signed?.medications_at_intake) : "") || text("active_medications_json", "active_medications", "medications_at_intake") || source.currentMedications || "",
    conserved,
  };
}
