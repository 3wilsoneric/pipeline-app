import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { assessmentInterviewQuestions } from "@/lib/assessment/assessment-interview-schema";
import { assessmentToolFieldForExtractionKey } from "@/lib/assessment/assessment-tool-schema";
import type { ClinicalResident } from "@/lib/clinical/clinical-contracts";
import { buildClientMedicalChart } from "./client-medical-chart";
import { normalizeClientName, resolveClientCommunity } from "./client-identity-presentation.mjs";
import { pipelineCommunityFromClinicalName } from "./community-config";
import { isDocumentRequirementType } from "./document-requirements";
import { careReportTopics, type OperationsReportDefinition, type OperationsReportFilters, type OperationsReportResult, type OperationsReportRow } from "./operations-report-types";
import type { AdmissionRequirement, Referral } from "./referral-types";
import { isRequirementGateActive, isRequirementResolved } from "./workspace-state";

export type ClientReportEvidence = {
  fields: Record<string, unknown>;
  documentCount: number;
  requirements: AdmissionRequirement[];
  assessment?: PipelineAssessmentRecord;
  residentKey?: string;
};

type ClientRecord = {
  key: string;
  name: string;
  community: string;
  county: string;
  referrals: Referral[];
  evidence: ClientReportEvidence[];
  resident: ClinicalResident | null;
  admitted: boolean;
  admissionDate: string;
  fields: Record<string, unknown>;
};

const missingValue = /^(?:unassigned|unknown|not (?:recorded|reported|documented|available)|pending|n\/a|null|undefined|nan|unable(?:_| )to(?:_| )assess|[-]+)$/i;

export function reportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (Array.isArray(value)) return [...new Set(value.map(reportValue).filter(Boolean))].join("; ");
  if (typeof value !== "string") return "";
  const text = reportText(value);
  return missingValue.test(text) ? "" : text;
}

function reportText(value: string) {
  let previous: string;
  // Labels remain React text and quoted CSV, never executable HTML.
  do {
    previous = value;
    value = value.replace(/<\/?[a-z][^<>]*>/gi, "");
  } while (value !== previous);
  return value.replace(/\*\*|__/g, "").trim();
}

export function reportDate(value: unknown): string {
  const text = reportValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
}

export function reviewedReportFields(fields: NonNullable<Referral["packetFields"]>) {
  return Object.fromEntries(fields
    .filter((field) => field.review_status === "accepted" || field.review_status === "edited")
    .map((field) => [field.field_key, field.final_value]));
}

export function buildClientDataReport(
  definition: OperationsReportDefinition,
  filters: OperationsReportFilters,
  referrals: Referral[],
  evidence: Map<number, ClientReportEvidence>,
  residents: ClinicalResident[] = [],
  notes: string[] = [],
): OperationsReportResult & { counties: Array<{ value: string; count: number }>; communities: Array<{ value: string; count: number }> } {
  const clients = clientRecords(referrals, evidence, residents);
  const cohort = filters.month && definition.id === "clients_by_community" ? clients.map((client) => admissionMonthClient(client, filters.month)) : clients;
  const scope = cohort.filter((client) =>
    (!filters.community || client.community === filters.community)
    && (!filters.county || client.county === filters.county)
    && (filters.client_scope !== "admitted" || client.admitted)
    && (filters.client_scope !== "current" || Boolean(client.resident)));
  const dated = filters.month ? scope.filter((client) => clientDateMatches(client, filters)) : scope;
  const rows = dated.flatMap((client) => clientRows(client, definition.id, filters));
  if (definition.id === "chart_completeness") rows.sort((a, b) => {
    const gaps = (row: OperationsReportRow) => Number.parseFloat(String(row.values.chart_fields).split("/")[1]) - Number.parseFloat(String(row.values.chart_fields).split("/")[0]) + (row.values.missing_documents ? 1 : 0);
    return gaps(b) - gaps(a) || String(a.client_name).localeCompare(String(b.client_name));
  });
  const knownClients = new Set(rows.map((row) => row.values.client_key)).size;
  const omitted = dated.length - knownClients;
  const dateMissing = scope.filter((client) => !clientHasReportDate(client, filters)).length;
  const reportNotes = clientReportNotes(definition.id, filters, { residents: residents.length, dateMissing, omitted, knownClients, total: dated.length }, notes);
  return {
    definition,
    columns: clientColumns(definition.id, filters),
    metrics: clientReportMetrics(definition.id, dated, rows, knownClients),
    rows,
    row_count: rows.length,
    truncated: false,
    generated_at: new Date().toISOString(),
    ...(definition.id === "chart_completeness" ? {} : { summary: {
      columns: [{ key: "group", label: definition.id === "clients_by_community" ? "Community" : definition.id === "referral_sources" ? "Referral source" : topicLabel(filters) }, { key: "clients", label: "Clients", align: "right" }, { key: "share", label: "Share of known", align: "right" }],
      rows: summaryRows(rows, knownClients),
    } }),
    notes: reportNotes,
    counties: facets(clients.map((client) => client.county)),
    communities: facets(clients.map((client) => client.community)),
  };
}

function clientReportMetrics(id: OperationsReportDefinition["id"], dated: ClientRecord[], rows: OperationsReportRow[], knownClients: number): OperationsReportResult["metrics"] {
  return [
      { label: "Clients", value: dated.length.toLocaleString(), detail: "Distinct recorded client identities; repeat referral episodes are not additional clients." },
      { label: id === "chart_completeness" ? "With documents" : "Included", value: (id === "chart_completeness" ? rows.filter((row) => Number(row.values.documents) > 0).length : knownClients).toLocaleString(), detail: "Clients represented in this scope." },
      { label: "Documented admissions", value: dated.filter((client) => client.admitted).length.toLocaleString(), detail: "Recorded admissions and current residents, not merely accepted referrals." },
  ];
}

function clientReportNotes(id: OperationsReportDefinition["id"], filters: OperationsReportFilters, counts: { residents: number; dateMissing: number; omitted: number; knownClients: number; total: number }, notes: string[]) {
  const reportNotes = [...notes];
  if (counts.residents && filters.client_scope !== "current") reportNotes.push("Resident and referral records are combined only after identity confirmation. Unlinked records remain separate; matching names do not merge people.");
  if (filters.month && counts.dateMissing) reportNotes.push(`${counts.dateMissing.toLocaleString()} clients have no documented ${id === "clients_by_community" ? "admission" : "referral received"} date and are excluded from this month.`);
  if (counts.omitted && id !== "chart_completeness") reportNotes.push(`${counts.knownClients.toLocaleString()} of ${counts.total.toLocaleString()} clients have ${coverageLabel(id)}. Others are excluded from the breakdown, not counted as 'No'.`);
  const note = clientReportMethodNotes[id];
  if (note) reportNotes.push(note);
  return reportNotes;
}

const clientReportMethodNotes: Partial<Record<OperationsReportDefinition["id"], string>> = {
  client_care_needs: "Uses signed assessment answers, reviewed document fields, and recorded resident diagnoses/care levels. Narrative values are not automatically classified; this is not a clinical decision tool.",
  referral_sources: "A client may have referrals from more than one source; source shares can total more than 100%.",
  chart_completeness: "Chart fields use the same core fields as the client chart. Document gaps reflect only applicable configured requirements; unconfigured requirements do not mean a complete packet.",
};

function coverageLabel(id: OperationsReportDefinition["id"]) {
  return id === "clients_by_community" ? "a known community" : id === "referral_sources" ? "a documented referral source" : "a reviewed answer for this topic";
}

function clientRecords(referrals: Referral[], evidence: Map<number, ClientReportEvidence>, residents: ClinicalResident[]) {
  const groups = new Map<string, ClientRecord>();
  const residentByKey = new Map(residents.flatMap((resident) => [
    [resident.resident_key, resident] as const,
    ...(resident.canonical_client_id ? [[resident.canonical_client_id, resident] as const] : []),
  ]));
  // Only a reviewed identity link joins a referral to a resident. Matching
  // names are never sufficient for merging clinical people in reports.
  const clientResidentKeys = new Map<string, string>();
  for (const referral of referrals) {
    const residentKey = evidence.get(referral.id)?.residentKey;
    if (residentKey && referral.clientId) clientResidentKeys.set(referral.clientId, residentKey);
  }
  for (const referral of [...referrals].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))) {
    appendClientReferral(groups, referral, evidence, clientResidentKeys, residentByKey);
  }
  for (const resident of residents) {
    const key = residentRecordKey(resident);
    if (!groups.has(key)) groups.set(key, emptyClientRecord(key, undefined, resident));
  }
  for (const group of groups.values()) {
    mergeClientFields(group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function emptyClientRecord(key: string, referral: Referral | undefined, resident: ClinicalResident | null): ClientRecord {
  return { key, name: normalizeClientName(resident?.display_name ?? referral?.name ?? ""), community: cleanCommunity(resident?.community_name ?? referral?.community ?? ""), county: reportValue(referral?.county), referrals: [], evidence: [], resident, admitted: Boolean(resident), admissionDate: reportDate(resident?.admit_date), fields: {} };
}

function residentRecordKey(resident: ClinicalResident) {
  return `resident:${resident.canonical_client_id ?? resident.resident_key}`;
}

function linkedResident(referral: Referral, item: ClientReportEvidence, clientResidentKeys: Map<string, string>, residentByKey: Map<string, ClinicalResident>) {
  const key = referral.clientId ? clientResidentKeys.get(referral.clientId) : item.residentKey;
  return key ? residentByKey.get(key) ?? null : null;
}

function appendClientReferral(groups: Map<string, ClientRecord>, referral: Referral, evidence: Map<number, ClientReportEvidence>, clientResidentKeys: Map<string, string>, residentByKey: Map<string, ClinicalResident>) {
  const item = evidence.get(referral.id) ?? { fields: {}, documentCount: 0, requirements: [] };
  const resident = linkedResident(referral, item, clientResidentKeys, residentByKey);
  const key = resident ? residentRecordKey(resident) : `pipeline:${referral.clientId ?? referral.id}`;
  let group = groups.get(key);
  if (!group) {
    group = emptyClientRecord(key, referral, resident);
    groups.set(key, group);
  }
  group.referrals.push(referral);
  group.evidence.push(item);
  group.county ||= reportValue(referral.county);
  group.community ||= cleanCommunity(referral.community);
  const admitted = referralAdmitted(referral);
  group.admitted ||= admitted;
  if (admitted && !group.admissionDate) group.admissionDate = reportDate(referral.admissionDate);
}

function mergeClientFields(group: ClientRecord) {
  for (const item of group.evidence) {
    for (const [key, value] of Object.entries(item.fields)) {
      if (!(key in group.fields)) group.fields[key] = value;
    }
  }
}

function referralAdmitted(referral: Referral) {
  const historicalOutcome = (referral as Referral & { historicalOutcome?: string }).historicalOutcome;
  return referral.workflowStatus === "admitted" || historicalOutcome === "admitted"
    || (referral.workspaceStatus === "historical" && referral.stage === "Accepted / Admitted" && Boolean(reportDate(referral.admissionDate)));
}

function cleanCommunity(value: unknown) {
  const text = resolveClientCommunity(reportValue(value));
  return text ? pipelineCommunityFromClinicalName(text) ?? reportValue(text) : "";
}

function clientDateMatches(client: ClientRecord, filters: OperationsReportFilters) {
  if (filters.report_id === "clients_by_community") {
    return client.admitted && (client.admissionDate.startsWith(filters.month)
      || client.referrals.some((referral) => referralAdmitted(referral) && reportDate(referral.admissionDate).startsWith(filters.month)));
  }
  return client.referrals.some((referral) => reportDate(referral.date).startsWith(filters.month));
}

function admissionMonthClient(client: ClientRecord, month: string): ClientRecord {
  if (client.resident && client.admissionDate.startsWith(month)) return client;
  const event = client.referrals.filter((referral) => referralAdmitted(referral) && reportDate(referral.admissionDate).startsWith(month))
    .sort((a, b) => String(b.admissionDate).localeCompare(String(a.admissionDate)))[0];
  return event ? { ...client, community: cleanCommunity(event.community), county: reportValue(event.county), admissionDate: reportDate(event.admissionDate) } : client;
}

function clientHasReportDate(client: ClientRecord, filters: OperationsReportFilters) {
  return filters.report_id === "clients_by_community" ? Boolean(client.admissionDate)
    : client.referrals.some((referral) => Boolean(reportDate(referral.date)));
}

function clientRows(client: ClientRecord, id: OperationsReportDefinition["id"], filters: OperationsReportFilters): OperationsReportRow[] {
  const base = clientBaseRow(client, id, filters);
  if (id === "clients_by_community") return client.community ? [{ ...base, values: { ...base.values, group: client.community } }] : [];
  if (id === "referral_sources") return clientSourceRows(client, base, filters);
  if (id === "client_care_needs") return clientCareRows(client, base, filters);
  return clientChartRows(client, base);
}

function clientBaseRow(client: ClientRecord, id: OperationsReportDefinition["id"], filters: OperationsReportFilters): OperationsReportRow {
  const referral = client.referrals[0];
  const admissionDate = filters.month && id === "clients_by_community"
    ? [client.admissionDate, ...client.referrals.filter(referralAdmitted).map((item) => reportDate(item.admissionDate))].find((date) => date.startsWith(filters.month)) ?? ""
    : client.admissionDate;
  return {
    row_id: client.key,
    referral_id: referral?.id ?? null,
    client_name: client.name,
    community: client.community || null,
    values: { client_key: client.key, client: client.name, profile_id: client.resident ? `resident:${client.resident.resident_key}` : client.key, community: client.community, county: client.county, status: clientStatus(client), admission_date: admissionDate, referrals: client.referrals.length },
  };
}

function clientStatus(client: ClientRecord) {
  if (client.admitted) return "Admitted";
  return client.referrals.some((item) => item.admissionDecision?.outcome === "accepted" || item.workflowStatus === "accepted") ? "Accepted" : "Potential client";
}

function clientSourceRows(client: ClientRecord, base: OperationsReportRow, filters: OperationsReportFilters) {
    const sources = new Map<string, { value: string; date: string }>();
    client.referrals.forEach((item, index) => {
      if (filters.month && !reportDate(item.date).startsWith(filters.month)) return;
      const fields = client.evidence[index].fields;
      const value = reportValue(fields["report.referral_source"]) || reportValue(fields["referral.referring_facility"] ?? fields.referringFacility)
        || (item.chartSource ? "" : documentedReferralSource(item.source));
      if (value && !sources.has(value.toLocaleLowerCase())) sources.set(value.toLocaleLowerCase(), { value, date: reportDate(item.date) });
    });
    return [...sources.values()].map(({ value, date }) => ({ ...base, row_id: `${client.key}:${value}`, values: { ...base.values, group: value, referral_source: value, received_date: date } }));
}

function clientCareRows(client: ClientRecord, base: OperationsReportRow, filters: OperationsReportFilters) {
    const topic = filters.care_topic ?? "primary_diagnosis";
    const signed = client.evidence.map((item) => item.assessment).filter((item): item is PipelineAssessmentRecord => Boolean(item?.signed_at && item.status === "complete"))
      .sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0];
    const extracted = fieldValue(client.fields, topic);
    const raw = signed && topic in signed ? signed[topic as keyof PipelineAssessmentRecord]
      : topic === "care_level" ? client.resident?.care_level ?? extracted
      : topic === "primary_diagnosis" && client.resident?.primary_diagnosis ? client.resident.primary_diagnosis
      : extracted;
    const value = careAnswer(topic, raw);
    return value ? [{ ...base, values: { ...base.values, group: value, answer: value } }] : [];
}

function clientChartFacts(client: ClientRecord) {
  return [
    { label: "Date of birth", value: reportDate(client.resident?.date_of_birth) || client.referrals.map((item) => reportDate(item.dob)).find(Boolean) || reportDate(fieldValue(client.fields, "date_of_birth")) },
    { label: "Primary diagnosis", value: fieldValue(client.fields, "primary_diagnosis", "referral.primary_diagnosis", "person.primary_diagnosis") },
    { label: "Active allergies", value: fieldValue(client.fields, "allergies", "person.allergies", "referral.allergies") },
    { label: "Active medications", value: fieldValue(client.fields, "medications_at_intake", "person.current_medications", "referral.current_medications") || client.referrals.filter((item) => !item.chartSource).map((item) => reportValue(item.currentMedications)).find(Boolean) || "" },
  ];
}

function clientChartRows(client: ClientRecord, base: OperationsReportRow) {
  const assessments = client.evidence.flatMap((item) => item.assessment ? [item.assessment] : []);
  const chart = buildClientMedicalChart({ name: client.name, gender: null, community: client.community }, client.resident, [{ key: "report", label: "Chart", facts: clientChartFacts(client) }], assessments.sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at))));
  const requiredFields = [...chart.identity, ...chart.priorities].filter((fact) => fact.required);
  const gaps = requiredFields.filter((fact) => !reportValue(fact.value)).map((fact) => fact.label);
  const missingDocuments = clientDocumentGaps(client);
  const requirements = client.evidence.flatMap((item) => item.requirements);
  const documents = client.evidence.length ? Math.max(...client.evidence.map((item) => item.documentCount)) : null;
  return [{ ...base, values: { ...base.values, chart_fields: `${requiredFields.length - gaps.length} / ${requiredFields.length}`, chart_percent: `${Math.round((requiredFields.length - gaps.length) / requiredFields.length * 100)}%`, documents, assessment: assessments.length ? "Signed" : "", missing_fields: gaps.join("; "), missing_documents: [...missingDocuments].join("; "), packet_requirements: requirements.some((requirement) => isDocumentRequirementType(requirement.type)) ? "Configured" : "Not configured" } }];
}

function clientDocumentGaps(client: ClientRecord) {
  const missingDocuments = new Set<string>();
  client.evidence.forEach((item, index) => {
    const ref = client.referrals[index];
    const outcome = ref.admissionDecision?.outcome ?? (ref.stage === "Accepted / Admitted" ? "accepted" : ref.stage === "Declined" ? "declined" : "pending");
    item.requirements.filter((requirement) => isDocumentRequirementType(requirement.type)
      && isRequirementGateActive(requirement, { outcome, assessmentComplete: Boolean(item.assessment) })
      && !isRequirementResolved(requirement)).forEach((requirement) => missingDocuments.add(requirement.label));
  });
  return missingDocuments;
}

function fieldValue(fields: Record<string, unknown>, ...keys: string[]) {
  return [...keys.map((key) => fields[key]), ...Object.entries(fields)
    .filter(([key]) => keys.includes(assessmentToolFieldForExtractionKey(key) ?? ""))
    .map(([, value]) => value)].map(reportValue).find(Boolean) || "";
}

function documentedReferralSource(value: unknown) {
  const text = reportValue(value);
  return /^(?:allo|import(?:ed)?|manual|email|fax|portal|referral packet|chart from|pipeline)(?:\b|$)/i.test(text) ? "" : text;
}

function careAnswer(topic: string, value: unknown) {
  const text = reportValue(value);
  if (!text) return "";
  const question = assessmentInterviewQuestions.find((item) => item.field === topic);
  if (question?.options) return question.options.find((option) => option.value === text.toLowerCase() || option.label.toLowerCase() === text.toLowerCase())?.label ?? "";
  return text;
}

function topicLabel(filters: OperationsReportFilters) {
  return careReportTopics.find((topic) => topic.value === (filters.care_topic ?? "primary_diagnosis"))?.label ?? "Answer";
}

function clientColumns(id: OperationsReportDefinition["id"], filters: OperationsReportFilters): OperationsReportResult["columns"] {
  const identity: OperationsReportResult["columns"] = [{ key: "client", label: "Client" }, { key: "community", label: "Community" }, { key: "county", label: "County" }];
  if (id === "clients_by_community") return [...identity, { key: "status", label: "Status" }, { key: "admission_date", label: "Admission date", format: "date" }, { key: "referrals", label: "Referrals", align: "right" }];
  if (id === "referral_sources") return [...identity, { key: "referral_source", label: "Referral source" }, { key: "received_date", label: "Received", format: "date" }, { key: "status", label: "Status" }];
  if (id === "client_care_needs") return [...identity, { key: "answer", label: topicLabel(filters) }, { key: "status", label: "Status" }];
  return [...identity.slice(0, 2), { key: "chart_fields", label: "Core chart fields", align: "right" }, { key: "documents", label: "Files", align: "right" }, { key: "assessment", label: "Assessment" }, { key: "missing_fields", label: "Chart gaps" }, { key: "missing_documents", label: "Documents needed" }, { key: "packet_requirements", label: "Packet requirements" }];
}

function summaryRows(rows: OperationsReportRow[], denominator: number) {
  const groups = new Map<string, { label: string; clients: Set<string> }>();
  for (const row of rows) {
    const label = String(row.values.group);
    const key = label.toLocaleLowerCase();
    const group = groups.get(key) ?? { label, clients: new Set() };
    group.clients.add(String(row.values.client_key));
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.clients.size - a.clients.size || a.label.localeCompare(b.label)).map((group) => ({ row_id: group.label, referral_id: null, client_name: null, community: null, values: { group: group.label, clients: group.clients.size, share: `${Math.round(group.clients.size / denominator * 100)}%` } }));
}

function facets(values: string[]) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }));
}
