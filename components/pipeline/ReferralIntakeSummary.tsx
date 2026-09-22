import type { ReactNode } from "react";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { referralRoleFacts } from "@/lib/pipeline/referral-owner-identity";
import { referralCanvasValue, type PersistedCanvasFieldKey } from "@/lib/pipeline/referral-canvas-persistence";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { presentClientName } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { ClientChartFact } from "@/lib/pipeline/client-medical-chart";
import { referralChartEditFields, type ReferralChartEditField } from "@/lib/pipeline/client-chart-context";
import { ClientChartFrame, ClientChartHeader, ChartHeaderCell, ChartBand, ChartGrid, ChartCell } from "./ClientMedicalChart";

// Reuse the client chart's presentation, not its resident/census data model.
// Every value here belongs to this referral and its existing intake editor.
export default function ReferralIntakeSummary({ referral, assessment, headerActions, contactActions, onEditField }: {
  referral: Referral;
  assessment?: Pick<PipelineAssessmentRecord, "assessor" | "assessor_id" | "created_by">;
  headerActions?: ReactNode;
  contactActions?: ReactNode;
  onEditField?: (field: ReferralChartEditField) => void;
}) {
  const fact = (label: string, key: PersistedCanvasFieldKey, wide = false): ClientChartFact => {
    const value = referralCanvasValue(referral, key);
    return { label, value: (key === "name" ? presentClientName(value, referral.id) : key === "dob" || key === "referralReceived" ? formatProfileDate(value) : value)?.trim() || "Not documented", ...(wide ? { span: "wide" } : {}) };
  };
  const cell = (value: ClientChartFact) => {
    const field = referralChartEditFields[value.label as keyof typeof referralChartEditFields];
    return <ChartCell key={value.label} fact={value} onEdit={onEditField && field ? () => onEditField(field) : undefined} editHint="Edit in intake" multiline />;
  };

  return <ClientChartFrame label="Referral chart">
    <ClientChartHeader title="Referral chart" actions={headerActions}>
      <ChartHeaderCell label="Referral updated" value={formatProfileDate(referral.updatedAt || referral.createdAt) || "Not documented"} />
    </ClientChartHeader>
    <ChartGrid ariaLabel="Referral identity" columns="identity">
      {[
        fact("Client", "name", true), fact("Date of birth", "dob"),
        fact("Gender", "gender"), fact("SSN", "ssn", true),
      ].map(cell)}
    </ChartGrid>
    <ChartBand title="Referral details">
      <ChartGrid ariaLabel="Referral details" columns="care">
        {[
          fact("Assigned assessor", "owner"),
          ...referralRoleFacts({
            owner: referral.owner,
            ownerId: referral.ownerId,
            assessment: assessment ? { assessor: { id: assessment.assessor_id, name: assessment.assessor }, author: assessment.created_by } : null,
          }).filter((role) => role.role !== "assigned_assessor").map(({ label, value }) => ({ label, value })),
          fact("Referral received", "referralReceived"),
          fact("Community", "community"), fact("County", "county"), fact("Referral source", "referent"), fact("Responsible person", "responsiblePerson"),
        ].map(cell)}
      </ChartGrid>
    </ChartBand>
    <ChartBand title="Contact information">
      <ChartGrid ariaLabel="Contact information" columns="priorities">
        {[fact("Phone", "phone"), fact("Email", "email")].map(cell)}
      </ChartGrid>
      {contactActions}
    </ChartBand>
    <ChartBand title="Intake information">
      <ChartGrid ariaLabel="Intake information" columns="care">
        {cell(fact("Medications on record", "currentMedications"))}
        {cell({ label: "Conserved status", value: referral.conserved === "yes" ? "Yes" : referral.conserved === "no" ? "No" : "Not documented" })}
      </ChartGrid>
    </ChartBand>
  </ClientChartFrame>;
}
