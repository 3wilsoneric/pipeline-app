import { canEditWorkspace } from "./referral-ownership";
import "server-only";

import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import {
  getAssessmentStoreReadiness,
  listAssessments,
} from "@/lib/assessment/assessment-store";
import { getAssessmentToolCoverage } from "@/lib/assessment/assessment-tool-schema";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import {
  getClinicalClient,
  getClinicalResident,
  type ClinicalClientDetail,
  type ClinicalResident,
} from "@/lib/clinical/clinical-data";
import { logApi } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import { getClientHistoryForResident } from "./client-history-store";
import { getHistoricalProfile } from "./historical-profile-store";
import { isImportedWorkspace } from "./workspace-presentation";
import { normalizeClientName, resolveClientGender } from "./client-identity-presentation.mjs";
import { pipelineCommunityFromClinicalName } from "./community-config";
import { findClinicalResidentMatch } from "./referral-clinical-reconciliation";
import type {
  AdmissionRequirement,
  Referral,
} from "./referral-types";
import {
  getReferral,
  getReferralStoreReadiness,
  listReferralFilesByClient,
  listReferralFilesByCanonicalClient,
  listReferrals,
  listReferralsByClient,
  type ReferralListOptions,
} from "./referral-store";
import type { PipelineResidentLink } from "./resident-link-records";
import {
  getResidentLinkStoreReadiness,
  listResidentLinks,
} from "./resident-link-store";
import {
  canAccessReferral,
  scopeReferralListOptions,
} from "./referral-access";
import type {
  UnifiedClientProfileResponse,
  UnifiedProfileConnection,
  UnifiedProfileLinkSuggestion,
} from "./unified-profile-contracts";

export type {
  UnifiedClientProfileResponse,
  UnifiedProfileConnection,
} from "./unified-profile-contracts";

export class UnifiedProfileError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UnifiedProfileError";
  }
}

type UnifiedProfileObservability = {
  requestId: string;
};

type PipelineProjectionStage =
  | "load_links"
  | "filter_links"
  | "load_suggestions"
  | "load_canonical_documents"
  | "load_referrals"
  | "load_assessments_and_documents"
  | "assemble_projection";

export async function getUnifiedClientProfile(
  request: Request,
  canonicalClientId: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"] = {
    can_create_identity_candidate: false,
    can_review_identity: false,
  },
  user?: PipelineUser,
  observability?: UnifiedProfileObservability,
): Promise<UnifiedClientProfileResponse> {
  const profile = await loadUnifiedClientProfile(request, canonicalClientId, permissions, user, observability);
  const sources = [];
  const warnings: string[] = [];
  // One client's visible episodes only, read sequentially to bound database work.
  for (const referral of profile.pipeline.referrals.filter(isImportedWorkspace)) {
    try {
      sources.push({ referral_id: referral.id, profile: await getHistoricalProfile(referral) });
    } catch {
      warnings.push(`Original notes for workspace #${referral.id} could not be loaded. Retry the chart.`);
    }
  }
  return { ...profile, pipeline: { ...profile.pipeline, source_profiles: sources, source_warnings: warnings } };
}

async function loadUnifiedClientProfile(
  request: Request,
  canonicalClientId: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"] = {
    can_create_identity_candidate: false,
    can_review_identity: false,
  },
  user?: PipelineUser,
  observability?: UnifiedProfileObservability,
): Promise<UnifiedClientProfileResponse> {
  if (canonicalClientId.startsWith("pipeline:")) {
    return loadPipelineLinkedClientProfile(request, canonicalClientId.slice("pipeline:".length), permissions, user, observability);
  }
  const clinical = await getClinicalClient(request, canonicalClientId);
  const resident = await loadCurrentResident(request, clinical.client);
  // Both reads require the resolved resident but do not depend on one another.
  // Start link resolution while the unchanged history projection is prepared.
  const residentLinkReadiness = getResidentLinkStoreReadiness();
  const [history, initialLinks] = await loadProfileHistoryAndLinks(clinical.client, resident, residentLinkReadiness.ready);
  if (!residentLinkReadiness.ready) {
    return {
      ...clinical,
      profile_origin: "alamo_platform",
      resident,
      history,
      pipeline: unavailablePipelineProjection(
        "Referral information is not configured in this environment. The client record remains available.",
        permissions,
      ),
    };
  }

  let projectionStage: PipelineProjectionStage = "load_links";
  try {
    const linkResults = unwrapProfileLinks(initialLinks);
    projectionStage = "filter_links";
    const links = await filterLinksForUser(linkResults, user);
    const confirmed = links.filter((link) => link.status === "confirmed");
    if (new Set(confirmed.map((link) => link.pipeline_client_id)).size > 1) {
      return {
        ...clinical,
        profile_origin: "alamo_platform",
        resident,
        history,
        pipeline: unavailablePipelineProjection(
          "More than one referral connection exists for this client. The client record remains available while an administrator resolves the conflict.",
          permissions,
        ),
      };
    }
    const candidates = links.filter((link) => link.status === "candidate");
    let suggestions: UnifiedProfileLinkSuggestion[] = [];
    if (confirmed.length === 0 && candidates.length === 0) {
      try {
        projectionStage = "load_suggestions";
        suggestions = await loadReferralSuggestions(clinical.client, resident, links, user);
      } catch {
        // Suggestions are optional. The governed clinical profile must remain
        // available even when operational search is temporarily unavailable.
        suggestions = [];
      }
    }
    const connection = buildConnection(confirmed[0] ?? null, candidates, suggestions);
    projectionStage = "load_canonical_documents";
    const canonicalDocumentCandidates = getReferralStoreReadiness().ready
      ? await listReferralFilesByCanonicalClient(clinical.client.canonical_client_id).catch(() => [])
      : [];
    const canonicalDocuments = await filterDocumentsForUser(canonicalDocumentCandidates, user);
    if (!connection.confirmed_link) {
      return {
        ...clinical,
        profile_origin: "alamo_platform",
        resident,
        history,
        pipeline: emptyPipelineProjection(connection, permissions, canonicalDocuments),
      };
    }

    const referralReadiness = getReferralStoreReadiness();
    const assessmentReadiness = getAssessmentStoreReadiness();
    if (!referralReadiness.ready || !assessmentReadiness.ready) {
      return {
        ...clinical,
        profile_origin: "alamo_platform",
        resident,
        history,
        pipeline: unavailablePipelineProjection(
          "The client record is available, but referral information cannot be loaded until operational storage is restored.",
          permissions,
        ),
      };
    }

    const link = connection.confirmed_link;
    projectionStage = "load_referrals";
    const referrals = await loadLinkedReferrals(link, user);
    projectionStage = "load_assessments_and_documents";
    const [assessments, linkedDocuments] = await Promise.all([
      loadLinkedAssessments(link, referrals, clinical.client.canonical_client_id, user),
      loadLinkedDocuments(link, referrals),
    ]);
    const documents = dedupeDocuments([
      ...canonicalDocuments,
      ...linkedDocuments,
    ]);
    projectionStage = "assemble_projection";

    return {
      ...clinical,
      profile_origin: "alamo_platform",
      resident,
      history,
      pipeline: buildPipelineProjection({
        permissions,
        connection,
        referrals,
        assessments,
        documents,
      }),
    };
  } catch (error) {
    logApi("error", {
      route: "/api/profiles/[residentKey]",
      requestId: observability?.requestId ?? crypto.randomUUID(),
      status: 200,
      msg: "pipeline_projection_failed",
      error: `${projectionStage}:${safeProjectionErrorCode(error)}`,
    });
    recordPipelineMetric("pipeline.profile_projection.failures", 1, "count", {
      route: "/api/profiles/[residentKey]",
      operation: projectionStage,
      result: safeProjectionErrorCode(error),
    });
    return {
      ...clinical,
      profile_origin: "alamo_platform",
      resident,
      history,
      pipeline: unavailablePipelineProjection(
        "The client record loaded, but referral information is temporarily unavailable. Retry later without losing access to this profile.",
        permissions,
      ),
    };
  }
}

async function loadPipelineLinkedClientProfile(
  request: Request,
  clientId: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"],
  user?: PipelineUser,
  observability?: UnifiedProfileObservability,
): Promise<UnifiedClientProfileResponse> {
  const pipeline = await getPipelineOnlyClientProfile(clientId, permissions, user);
  if (!getResidentLinkStoreReadiness().ready) return pipeline;
  const links = await listProfileLinks({ pipelineClientId: clientId, status: "confirmed" });
  const keys = [...new Set(links.map((link) => link.resident_key))];
  if (!keys.length) return pipeline;
  if (keys.length !== 1) {
    return unavailableLinkedChart(pipeline, "Conflicting clinical identity links need review. Only this client's Pipeline records are shown.");
  }
  const key = keys[0];
  if (key.startsWith("pipeline:")) throw new UnifiedProfileError(409, "invalid_clinical_link", "The client identity connection needs review.");
  try {
    if (key.includes(":")) {
      const current = await getClinicalResident(request, key);
      if (!current.resident.canonical_client_id) {
        return { ...currentCensusProfile(current), pipeline: { ...pipeline.pipeline, connection: buildConnection(links[0], [], []) } };
      }
      return await loadUnifiedClientProfile(request, current.resident.canonical_client_id, permissions, user, observability);
    }
    return await loadUnifiedClientProfile(request, key, permissions, user, observability);
  } catch {
    return unavailableLinkedChart(pipeline, "The linked clinical chart is temporarily unavailable. Pipeline records remain available; retry for the complete chart.");
  }
}

async function loadProfileHistoryAndLinks(client: ClinicalClientDetail, resident: ClinicalResident | null, linksReady: boolean) {
  return Promise.all([
    resident ? getClientHistoryForResident(resident.resident_number, resident.date_of_birth) : unavailableHistoricalProjection(),
    linksReady ? loadClientLinks(client, resident).then((value) => ({ value }), (error: unknown) => ({ error })) : { value: [] },
  ] as const);
}

function unavailableLinkedChart(profile: UnifiedClientProfileResponse, message: string): UnifiedClientProfileResponse {
  return { ...profile, freshness: { ...profile.freshness, warning: message }, pipeline: {
    ...profile.pipeline, connection: { ...profile.pipeline.connection, status: "unavailable", message },
  } };
}

function unwrapProfileLinks(result: { value: PipelineResidentLink[] } | { error: unknown }) {
  if ("error" in result) throw result.error;
  return result.value;
}

function safeProjectionErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (/^[A-Za-z0-9_]{1,64}$/.test(code)) return code;
  }
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) {
    return error.name;
  }
  return "unknown_error";
}

async function getPipelineOnlyClientProfile(
  pipelineClientId: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"],
  user?: PipelineUser,
): Promise<UnifiedClientProfileResponse> {
  const normalizedClientId = pipelineClientId.trim();
  if (!normalizedClientId || normalizedClientId.length > 256) {
    throw new UnifiedProfileError(400, "pipeline_client_id_invalid", "Pipeline client identifier is invalid.");
  }
  if (!getReferralStoreReadiness().ready) {
    throw new UnifiedProfileError(503, "pipeline_store_unavailable", "Pipeline client workspaces are temporarily unavailable.");
  }
  const [clientReferrals, documents] = await Promise.all([
    listReferralsByClient(normalizedClientId),
    listReferralFilesByClient(normalizedClientId),
  ]);
  const referrals = clientReferrals
    .filter((referral) => !user || canAccessReferral(user, referral))
    .sort(compareReferrals);
  if (user && !canEditWorkspace(user) && referrals.length === 0) {
    throw new UnifiedProfileError(404, "pipeline_client_not_found", "This client profile could not be loaded.");
  }
  if (referrals.length === 0 && documents.length === 0) {
    throw new UnifiedProfileError(404, "pipeline_client_not_found", "This client profile could not be loaded.");
  }
  const latest = referrals[0] ?? null;
  const workspaceCommunity = latest?.community ?? documents.find((document) => document.community)?.community ?? "";
  const rawWorkspaceName = latest?.name ?? documents[0].referralName;
  const workspaceName = normalizeClientName(rawWorkspaceName, { community: workspaceCommunity }) || rawWorkspaceName.trim();
  const workspaceUpdatedAt = latest?.updatedAt ?? latest?.createdAt ?? documents[0].uploadedAt;
  const assessments = await loadPipelineOnlyAssessments(referrals, user);
  const visibleReferralIds = new Set(referrals.map((referral) => referral.id));
  const visibleDocuments = documents
    .filter((document) => document.referralId === null || visibleReferralIds.has(document.referralId));
  const generatedAt = new Date().toISOString();
  const dataAsOf = workspaceUpdatedAt.slice(0, 10);
  const communities = [...new Set(referrals.map((referral) => referral.community))];
  if (workspaceCommunity && !communities.includes(workspaceCommunity)) communities.push(workspaceCommunity);
  const enrichment = {
    gender: latest?.gender || null,
    date_of_birth: latest?.dob || null,
    referral_source: latest?.source || null,
    responsible_person: latest?.responsiblePerson || null,
    conservatorship_status: latest?.conserved || null,
    community: workspaceCommunity || null,
    latest_referral_stage: latest?.stage || null,
  };
  const fields = Object.keys(enrichment);

  return {
    source: "pipeline",
    profile_origin: "pipeline",
    snapshot_id: `pipeline-client-${normalizedClientId}`,
    generated_at: generatedAt,
    data_as_of: dataAsOf,
    retrieved_at: generatedAt,
    freshness: {
      status: "fresh",
      age_hours: 0,
      max_age_hours: 24,
      warning: null,
    },
    client: {
      canonical_client_id: `pipeline:${normalizedClientId}`,
      display_name: workspaceName,
      gender: resolveClientGender(latest?.gender),
      resident_numbers: reviewedResidentNumbers(referrals),
      current_resident: false,
      community_names: communities,
      current_community: workspaceCommunity || null,
      unit: null,
      admit_date: isoDateOrNull(latest?.admissionDate),
      care_level: null,
      episode_count: referrals.filter((referral) => isoDateOrNull(referral.admissionDate)).length,
      resident_profile: null,
      resident_profiles: [],
      resident_episode_history: [],
      enrichment,
      source_documents: [],
      facts: [],
    },
    client_database: {
      dataset: "pipeline_client_workspace",
      version: 1,
      baseline_date: dataAsOf,
      generated_at: generatedAt,
      client_count: 1,
      field_count: fields.length,
      fields,
    },
    resident: null,
    history: unavailableHistoricalProjection(),
    pipeline: buildPipelineProjection({
      permissions,
      connection: {
        status: "pipeline_only",
        confirmed_link: null,
        candidates: [],
        suggestions: [],
        message: referrals.length > 0
          ? "This workspace is keyed to the Pipeline client identity. A reviewed Alamo resident link can be added after admission without changing its referral history or files."
          : "This client workspace preserves reviewed files. It can be joined to a governed Alamo client later without moving or duplicating those files.",
      },
      referrals,
      assessments,
      documents: visibleDocuments,
    }),
  };
}

export async function getCurrentCensusClientProfile(
  request: Request,
  locator: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"],
  user?: PipelineUser,
  observability?: UnifiedProfileObservability,
) {
  const current = await getClinicalResident(request, locator.slice("resident:".length));
  if (current.resident.canonical_client_id) {
    return getUnifiedClientProfile(request, current.resident.canonical_client_id, permissions, user, observability);
  }
  const census = currentCensusProfile(current);
  if (!getResidentLinkStoreReadiness().ready) return census;
  try {
    const links = await filterLinksForUser(await listProfileLinks({ residentKey: current.resident.resident_key, status: "confirmed" }), user);
    const clients = [...new Set(links.map((link) => link.pipeline_client_id))];
    if (!clients.length) return census;
    if (clients.length !== 1) return unavailableLinkedChart(census, "Conflicting workspace identity links need review. Only census information is shown.");
    return await getUnifiedClientProfile(request, `pipeline:${clients[0]}`, permissions, user, observability);
  } catch {
    return unavailableLinkedChart(census, "Linked workspace records could not be loaded. Retry for the complete chart.");
  }
}

function currentCensusProfile(current: Awaited<ReturnType<typeof getClinicalResident>>): UnifiedClientProfileResponse {
  const resident = current.resident;
  // Keep an unlinked census resident openable without inventing a canonical
  // person identity, joining by name, or projecting a referral as a live client.
  const record = { ...resident };
  return {
    ...current,
    profile_origin: "alamo_platform",
    resident,
    history: unavailableHistoricalProjection(),
    client: {
      canonical_client_id: "",
      display_name: resident.display_name,
      gender: null,
      resident_numbers: resident.resident_number ? [resident.resident_number] : [],
      current_resident: true,
      community_names: [resident.community_name],
      current_community: resident.community_name,
      unit: resident.unit,
      admit_date: resident.admit_date,
      care_level: resident.care_level,
      episode_count: 1,
      resident_profile: record,
      resident_profiles: [record],
      resident_episode_history: [],
      enrichment: record,
      source_documents: [],
      facts: [],
    },
    client_database: {
      dataset: "alamo_current_census",
      version: current.snapshot_id,
      baseline_date: current.data_as_of,
      generated_at: current.generated_at,
      client_count: null,
      fields: Object.keys(record),
      field_count: Object.keys(record).length,
    },
    pipeline: unavailablePipelineProjection("The current platform record is available. No enhanced profile identity is linked.", {
      can_create_identity_candidate: false,
      can_review_identity: false,
    }),
  };
}

export function unifiedProfileErrorResponse(error: unknown) {
  if (error instanceof UnifiedProfileError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: privateHeaders() },
    );
  }
  return null;
}

function buildConnection(
  confirmedLink: PipelineResidentLink | null,
  candidates: PipelineResidentLink[],
  suggestions: UnifiedProfileLinkSuggestion[],
): UnifiedProfileConnection {
  if (confirmedLink) {
    return {
      status: "confirmed",
      confirmed_link: confirmedLink,
      candidates,
      suggestions: [],
      message: "Referral history is connected to this client.",
    };
  }
  if (candidates.length > 0) {
    return {
      status: "candidate",
      confirmed_link: null,
      candidates,
      suggestions: [],
      message: "A possible referral match needs review before its records are shown with this client.",
    };
  }
  return {
    status: "unlinked",
    confirmed_link: null,
    candidates: [],
    suggestions,
    message: "No Pipeline referral history is connected to this client.",
  };
}

async function loadReferralSuggestions(
  client: ClinicalClientDetail,
  resident: ClinicalResident | null,
  links: PipelineResidentLink[],
  user?: PipelineUser,
): Promise<UnifiedProfileLinkSuggestion[]> {
  if (!getReferralStoreReadiness().ready) return [];
  const query = normalizeNameTokens(client.display_name).at(-1);
  if (!query) return [];

  const rejectedReferralIds = new Set(
    links
      .filter((link) => link.status === "rejected" && (!resident || link.resident_key === resident.resident_key))
      .map((link) => link.referral_id)
      .filter((value): value is number => value !== null),
  );
  const result = await listReferrals(scopeReferralListOptionsIfUser(user, { query, limit: 100 }));
  const clinicalCommunity = pipelineCommunityFromClinicalName(
    resident?.community_name ?? client.current_community ?? "",
  );
  const suggestions = result.referrals.flatMap((referral) => {
    if (!referral.clientId || rejectedReferralIds.has(referral.id)) return [];
    const reviewedNumber = reviewedResidentNumber(referral);
    const residentNumbers = new Set(client.resident_numbers.map(normalizeIdentifier).filter(Boolean));
    const residentNumberMatch = Boolean(reviewedNumber && residentNumbers.has(reviewedNumber));
    const nameDobMatch = resident ? findClinicalResidentMatch(referral, [resident]) : null;
    if (!residentNumberMatch && !nameDobMatch) return [];

    const matchMethod = residentNumberMatch
      ? "resident_number_exact" as const
      : nameDobMatch!.method;
    const reasons = [
      residentNumberMatch
        ? "Reviewed resident number matches exactly"
        : nameDobMatch!.method === "exact_name_dob"
          ? "Name and date of birth match exactly"
          : "Name is compatible and date of birth matches exactly",
      ...(clinicalCommunity === referral.community ? ["Community matches the current census"] : []),
    ];
    return [{
      referral_id: referral.id,
      pipeline_client_id: referral.clientId,
      client_name: referral.name,
      gender: referral.gender?.trim() || null,
      community: referral.community,
      stage: referral.stage,
      received_at: referral.date,
      confidence: residentNumberMatch ? 1 : nameDobMatch!.confidence,
      match_method: matchMethod,
      reasons,
    }];
  });

  const latestByClient = new Map<string, UnifiedProfileLinkSuggestion>();
  for (const suggestion of suggestions.sort(compareSuggestions)) {
    if (!latestByClient.has(suggestion.pipeline_client_id)) {
      latestByClient.set(suggestion.pipeline_client_id, suggestion);
    }
  }
  return [...latestByClient.values()].slice(0, 5);
}

function reviewedResidentNumber(referral: Referral) {
  const field = referral.packetFields?.find((candidate) => {
    const key = candidate.field_key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return ["residentnumber", "eldermarkresidentnumber"].includes(key)
      && ["accepted", "edited"].includes(candidate.review_status);
  });
  return normalizeIdentifier(field?.final_value ?? field?.proposed_value);
}

function compareSuggestions(left: UnifiedProfileLinkSuggestion, right: UnifiedProfileLinkSuggestion) {
  return right.confidence - left.confidence
    || right.received_at.localeCompare(left.received_at)
    || right.referral_id - left.referral_id;
}

function normalizeNameTokens(value: string) {
  return value.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

function emptyPipelineProjection(
  connection: UnifiedProfileConnection,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"],
  documents: UnifiedClientProfileResponse["pipeline"]["documents"] = [],
): UnifiedClientProfileResponse["pipeline"] {
  return {
    permissions,
    connection,
    referrals: [],
    assessments: [],
    requirements: [],
    documents,
    summary: {
      referral_count: 0,
      active_referral_count: 0,
      assessment_count: 0,
      latest_assessment_status: null,
      latest_assessment_completion_pct: null,
      open_requirement_count: 0,
      blocker_count: 0,
      document_count: documents.length,
      actions_needed: [connection.status === "candidate" ? "Review the resident-link candidate" : "Create and review a resident link"],
    },
  };
}

function buildPipelineProjection(input: {
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"];
  connection: UnifiedProfileConnection;
  referrals: Referral[];
  assessments: PipelineAssessmentRecord[];
  documents: UnifiedClientProfileResponse["pipeline"]["documents"];
}): UnifiedClientProfileResponse["pipeline"] {
  const operationalReferrals = input.referrals.filter(isOperationalReferral);
  const requirements = operationalReferrals.flatMap((referral) => referral.requirements ?? []);
  const latestAssessment = input.assessments[0] ?? null;
  const latestCoverage = latestAssessment ? getAssessmentToolCoverage(latestAssessment) : null;
  const openRequirements = requirements.filter((item) => !["reviewed", "waived"].includes(item.status));
  const blockers = openRequirements.filter((item) => item.blocker);

  return {
    ...input,
    requirements,
    summary: {
      referral_count: input.referrals.length,
      active_referral_count: operationalReferrals.length,
      assessment_count: input.assessments.length,
      latest_assessment_status: latestAssessment?.status ?? null,
      latest_assessment_completion_pct: latestCoverage?.percent ?? null,
      open_requirement_count: openRequirements.length,
      blocker_count: blockers.length,
      document_count: input.documents.length,
      actions_needed: operationalReferrals.length > 0
        ? getActionsNeeded(
            operationalReferrals,
            input.assessments.filter((assessment) => operationalReferrals.some((referral) => referral.id === assessment.referral_id)),
            blockers,
          )
        : [],
    },
  };
}

function isOperationalReferral(referral: Referral) {
  return referral.workspaceStatus !== "historical"
    && referral.workspaceStatus !== "archived"
    && !["Accepted / Admitted", "Declined"].includes(referral.stage);
}

function dedupeDocuments(documents: UnifiedClientProfileResponse["pipeline"]["documents"]) {
  return [...new Map(documents.map((document) => [document.id, document])).values()]
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt) || right.id.localeCompare(left.id));
}

function unavailablePipelineProjection(
  message: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"],
): UnifiedClientProfileResponse["pipeline"] {
  return {
    permissions,
    connection: {
      status: "unavailable",
      confirmed_link: null,
      candidates: [],
      suggestions: [],
      message,
    },
    referrals: [],
    assessments: [],
    requirements: [],
    documents: [],
    summary: {
      referral_count: 0,
      active_referral_count: 0,
      assessment_count: 0,
      latest_assessment_status: null,
      latest_assessment_completion_pct: null,
      open_requirement_count: 0,
      blocker_count: 0,
      document_count: 0,
      actions_needed: [],
    },
  };
}

async function loadLinkedReferrals(link: PipelineResidentLink, user?: PipelineUser) {
  const referrals = await listReferralsByClient(link.pipeline_client_id);
  if (link.referral_id && !referrals.some((referral) => referral.id === link.referral_id)) {
    const explicit = await getReferral(link.referral_id);
    if (explicit) referrals.push(explicit);
  }
  return referrals
    .filter((referral) => !user || canAccessReferral(user, referral))
    .sort(compareReferrals);
}

async function loadLinkedAssessments(
  link: PipelineResidentLink,
  referrals: Referral[],
  canonicalClientId: string | null,
  user?: PipelineUser,
) {
  const results = await Promise.all([
    ...referrals.map((referral) => listProfileAssessments({ referralId: referral.id })),
    ...(canonicalClientId ? [listProfileAssessments({ canonicalClientId })] : []),
    listProfileAssessments({ residentKey: link.resident_key }),
    ...(link.resident_number ? [listProfileAssessments({ residentNumber: link.resident_number })] : []),
  ]);
  const byId = new Map<string, PipelineAssessmentRecord>();
  const visibleReferralIds = new Set(referrals.map((referral) => referral.id));
  for (const result of results) {
    if (!result) continue;
    for (const assessment of result) {
      if (user && !canEditWorkspace(user) && !visibleReferralIds.has(assessment.referral_id)) continue;
      byId.set(assessment.assessment_id, assessment);
    }
  }
  return [...byId.values()].sort((left, right) =>
    (right.assessment_date ?? right.created_at).localeCompare(left.assessment_date ?? left.created_at) ||
    right.created_at.localeCompare(left.created_at),
  );
}

async function loadLinkedDocuments(link: PipelineResidentLink, referrals: Referral[]) {
  const documents = await listReferralFilesByClient(link.pipeline_client_id);
  const explicitIds = new Set(referrals.map((referral) => referral.id));
  return documents.filter((document) => document.referralId === null || explicitIds.has(document.referralId));
}

async function loadPipelineOnlyAssessments(referrals: Referral[], user?: PipelineUser) {
  if (!getAssessmentStoreReadiness().ready) return [];
  const results = await Promise.all(
    referrals.map((referral) => listProfileAssessments({ referralId: referral.id })),
  );
  const visibleReferralIds = new Set(referrals.map((referral) => referral.id));
  const byId = new Map<string, PipelineAssessmentRecord>();
  for (const result of results) {
    for (const assessment of result) {
      if (user && !canEditWorkspace(user) && !visibleReferralIds.has(assessment.referral_id)) continue;
      byId.set(assessment.assessment_id, assessment);
    }
  }
  return [...byId.values()].sort((left, right) =>
    (right.assessment_date ?? right.created_at).localeCompare(left.assessment_date ?? left.created_at)
      || right.created_at.localeCompare(left.created_at));
}

function reviewedResidentNumbers(referrals: Referral[]) {
  const values = new Set<string>();
  for (const referral of referrals) {
    const value = referral.packetFields?.find((field) => {
      const key = field.field_key.toLowerCase().replace(/[^a-z0-9]/g, "");
      return ["residentnumber", "eldermarkresidentnumber"].includes(key)
        && ["accepted", "edited"].includes(field.review_status);
    });
    const normalized = (value?.final_value ?? value?.proposed_value)?.trim();
    if (normalized) values.add(normalized);
  }
  return [...values];
}

function isoDateOrNull(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function getActionsNeeded(
  referrals: Referral[],
  assessments: PipelineAssessmentRecord[],
  blockers: AdmissionRequirement[],
) {
  const actions: string[] = [];
  if (referrals.length === 0) actions.push("No Pipeline referral history is linked");
  if (assessments.length === 0) actions.push("No Pipeline assessment is linked");
  if (assessments.some((assessment) => assessment.status !== "complete")) actions.push("Finish the open assessment");
  if (blockers.length > 0) actions.push(`Resolve ${blockers.length} blocking requirement${blockers.length === 1 ? "" : "s"}`);
  return actions;
}

function dedupeLinks(links: PipelineResidentLink[]) {
  return [...new Map(links.map((link) => [link.link_id, link])).values()];
}

async function loadCurrentResident(request: Request, client: ClinicalClientDetail) {
  if (!client.current_resident) return null;
  const residentKey = currentResidentKey(client.resident_profile);
  if (!residentKey) return null;
  try {
    const response = await getClinicalResident(request, residentKey);
    return response.resident.canonical_client_id === client.canonical_client_id
      ? response.resident
      : null;
  } catch {
    return null;
  }
}

function currentResidentKey(profile: ClinicalClientDetail["resident_profile"]) {
  if (!profile) return null;
  const facilityId = scalarString(profile.facility_id);
  const residentId = scalarString(profile.res_number ?? profile.resident_id);
  return facilityId && residentId ? `${facilityId}:${residentId}` : null;
}

function scalarString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

async function loadClientLinks(client: ClinicalClientDetail, resident: ClinicalResident | null) {
  const requests = [
    listProfileLinks({ residentKey: client.canonical_client_id }),
    ...(resident ? [listProfileLinks({ residentKey: resident.resident_key })] : []),
    ...client.resident_numbers.map((residentNumber) =>
      listProfileLinks({ residentNumber }),
    ),
  ];
  if (requests.length === 0) return [];
  const results = await Promise.all(requests);
  return dedupeLinks(results.flat());
}

async function listProfileAssessments(options: Parameters<typeof listAssessments>[0]) {
  const records: PipelineAssessmentRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await listAssessments({ ...options, limit: 100, cursor });
    records.push(...result.assessments);
    cursor = result.next_cursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw new Error("Assessment pagination did not advance.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return records;
}

async function listProfileLinks(options: Parameters<typeof listResidentLinks>[0]) {
  const links: PipelineResidentLink[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await listResidentLinks({ ...options, limit: 100, cursor });
    links.push(...result.links);
    cursor = result.next_cursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw new Error("Identity link pagination did not advance.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return links;
}

async function filterLinksForUser(links: PipelineResidentLink[], user?: PipelineUser) {
  if (!user || canEditWorkspace(user)) return links;
  const visible = await Promise.all(links.map(async (link) => {
    const referrals = await listReferralsByClient(link.pipeline_client_id);
    return referrals.some((referral) => canAccessReferral(user, referral)) ? link : null;
  }));
  return visible.filter((link): link is PipelineResidentLink => Boolean(link));
}

async function filterDocumentsForUser(documents: UnifiedClientProfileResponse["pipeline"]["documents"], user?: PipelineUser) {
  if (!user || canEditWorkspace(user)) return documents;
  const ids = [...new Set(documents.flatMap((document) => document.referralId === null ? [] : [document.referralId]))];
  const visible = new Set((await Promise.all(ids.map(async (id) => {
    const referral = await getReferral(id);
    return referral && canAccessReferral(user, referral) ? id : null;
  }))).filter((id) => id !== null));
  return documents.filter((document) => document.referralId === null || visible.has(document.referralId));
}

function scopeReferralListOptionsIfUser<T extends ReferralListOptions>(
  user: PipelineUser | undefined,
  options: T,
) {
  return user ? scopeReferralListOptions(user, options) : options;
}

function unavailableHistoricalProjection(): Awaited<ReturnType<typeof getClientHistoryForResident>> {
  return {
    status: "unavailable",
    source: null,
    data_as_of: null,
    imported_at: null,
    warning: "No current resident identity is available for the legacy placement-history projection.",
    episode_count: 0,
    current_episode_count: 0,
    discharged_episode_count: 0,
    first_admit_date: null,
    latest_admit_date: null,
    quality_flags: [],
    episodes: [],
  };
}

function compareReferrals(left: Referral, right: Referral) {
  return (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) || right.id - left.id;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
