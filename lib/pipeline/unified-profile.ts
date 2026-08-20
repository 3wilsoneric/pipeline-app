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
  type ClinicalClientDetail,
  type ClinicalResident,
} from "@/lib/clinical/clinical-data";
import { getClientHistoryForResident } from "./client-history-store";
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
  isAssessorUser,
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

export async function getUnifiedClientProfile(
  request: Request,
  canonicalClientId: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"] = {
    can_create_identity_candidate: false,
    can_review_identity: false,
  },
  user?: PipelineUser,
): Promise<UnifiedClientProfileResponse> {
  const clinical = await getClinicalClient(request, canonicalClientId);
  const resident = currentResidentFromClient(clinical.client);
  const residentLinkReadiness = getResidentLinkStoreReadiness();
  const historyPromise = resident
    ? getClientHistoryForResident(resident.resident_number, resident.date_of_birth)
    : Promise.resolve(unavailableHistoricalProjection());
  if (!residentLinkReadiness.ready) {
    const history = await historyPromise;
    return {
      ...clinical,
      resident,
      history,
      pipeline: unavailablePipelineProjection(
        "Pipeline work data is not configured in this runtime. The governed Alamo client record remains available.",
        permissions,
      ),
    };
  }

  let history = unavailableHistoricalProjection();
  try {
    const [loadedHistory, linkResults] = await Promise.all([
      historyPromise,
      loadClientLinks(clinical.client, resident),
    ]);
    history = loadedHistory;
    const links = await filterLinksForUser(linkResults, user);
    const confirmed = links.filter((link) => link.status === "confirmed");
    if (confirmed.length > 1) {
      return {
        ...clinical,
        resident,
        history,
        pipeline: unavailablePipelineProjection(
          "Multiple reviewed Pipeline identity links exist for this resident. The Alamo client record is available, but an administrator must resolve the link conflict before Pipeline work can be shown.",
          permissions,
        ),
      };
    }
    const candidates = links.filter((link) => link.status === "candidate");
    let suggestions: UnifiedProfileLinkSuggestion[] = [];
    if (confirmed.length === 0 && candidates.length === 0) {
      try {
        suggestions = await loadReferralSuggestions(clinical.client, resident, links, user);
      } catch {
        // Suggestions are optional. The governed clinical profile must remain
        // available even when operational search is temporarily unavailable.
        suggestions = [];
      }
    }
    const connection = buildConnection(confirmed[0] ?? null, candidates, suggestions);
    if (!connection.confirmed_link) {
      return {
        ...clinical,
        resident,
        history,
        pipeline: emptyPipelineProjection(connection, permissions),
      };
    }

    const referralReadiness = getReferralStoreReadiness();
    const assessmentReadiness = getAssessmentStoreReadiness();
    if (!referralReadiness.ready || !assessmentReadiness.ready) {
      return {
        ...clinical,
        resident,
        history,
        pipeline: unavailablePipelineProjection(
          "The Alamo client record is available, but linked Pipeline work cannot be loaded until operational storage is restored.",
          permissions,
        ),
      };
    }

    const link = connection.confirmed_link;
    const referrals = await loadLinkedReferrals(link, user);
    const assessments = await loadLinkedAssessments(
      link,
      referrals,
      clinical.client.canonical_client_id,
      user,
    );
    const documents = await loadLinkedDocuments(link, referrals);
    const requirements = referrals.flatMap((referral) => referral.requirements ?? []);
    const latestAssessment = assessments[0] ?? null;
    const latestCoverage = latestAssessment ? getAssessmentToolCoverage(latestAssessment) : null;
    const openRequirements = requirements.filter((item) => !["reviewed", "waived"].includes(item.status));
    const blockers = openRequirements.filter((item) => item.blocker);

    return {
      ...clinical,
      resident,
      history,
      pipeline: {
        permissions,
        connection,
        referrals,
        assessments,
        requirements,
        documents,
        summary: {
          referral_count: referrals.length,
          active_referral_count: referrals.filter((referral) => !["Accepted / Admitted", "Declined"].includes(referral.stage)).length,
          assessment_count: assessments.length,
          latest_assessment_status: latestAssessment?.status ?? null,
          latest_assessment_completion_pct: latestCoverage?.percent ?? null,
          open_requirement_count: openRequirements.length,
          blocker_count: blockers.length,
          document_count: documents.length,
          actions_needed: getActionsNeeded(referrals, assessments, blockers),
        },
      },
    };
  } catch {
    return {
      ...clinical,
      resident,
      history,
      pipeline: unavailablePipelineProjection(
        "The governed Alamo client record loaded, but Pipeline work data is temporarily unavailable. Retry later without losing access to the client profile.",
        permissions,
      ),
    };
  }
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
      message: "Pipeline records are joined through a reviewed resident link.",
    };
  }
  if (candidates.length > 0) {
    return {
      status: "candidate",
      confirmed_link: null,
      candidates,
      suggestions: [],
      message: "A possible Pipeline identity match needs human review before records can be joined.",
    };
  }
  return {
    status: "unlinked",
    confirmed_link: null,
    candidates: [],
    suggestions,
    message: "No reviewed Pipeline identity link exists. Residents will not be matched by name, and suggestions never join records automatically.",
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
): UnifiedClientProfileResponse["pipeline"] {
  return {
    permissions,
    connection,
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
      actions_needed: [connection.status === "candidate" ? "Review the resident-link candidate" : "Create and review a resident link"],
    },
  };
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
    ...referrals.map((referral) => listAssessments({ referralId: referral.id, limit: 100 })),
    ...(canonicalClientId ? [listAssessments({ canonicalClientId, limit: 100 })] : []),
    listAssessments({ residentKey: link.resident_key, limit: 100 }),
    ...(link.resident_number ? [listAssessments({ residentNumber: link.resident_number, limit: 100 })] : []),
  ]);
  const byId = new Map<string, PipelineAssessmentRecord>();
  const visibleReferralIds = new Set(referrals.map((referral) => referral.id));
  for (const result of results) {
    if (!result) continue;
    for (const assessment of result.assessments) {
      if (user && isAssessorUser(user) && !visibleReferralIds.has(assessment.referral_id)) continue;
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
  return documents.filter((document) => explicitIds.has(document.referralId));
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

function currentResidentFromClient(client: ClinicalClientDetail): ClinicalResident | null {
  if (!client.current_resident) return null;
  const profile = client.resident_profile;
  if (!profile) return null;
  const facilityId = scalarString(profile.facility_id);
  const residentId = scalarString(profile.res_number ?? profile.resident_id);
  const communityName = client.current_community || scalarString(profile.facility_name);
  if (!facilityId || !residentId || !communityName) return null;
  const profileClientId = scalarString(profile.canonical_client_id);
  if (profileClientId && profileClientId !== client.canonical_client_id) return null;

  return {
    resident_id: residentId,
    resident_key: `${facilityId}:${residentId}`,
    canonical_client_id: client.canonical_client_id,
    resident_number: residentId,
    display_name: client.display_name,
    first_name: null,
    last_name: null,
    date_of_birth: isoDateOrNull(client.enrichment.date_of_birth),
    community_id: facilityId,
    community_name: communityName,
    unit: client.unit,
    age: boundedIntegerOrNull(client.enrichment.age, 0, 125),
    admit_date: client.admit_date,
    length_of_stay_days: null,
    care_level: client.care_level,
    payor: scalarOrNull(client.enrichment.payor ?? client.enrichment.payer),
    primary_diagnosis: scalarOrNull(client.enrichment.primary_diagnosis),
    physician: scalarOrNull(client.enrichment.primary_physician),
    diet: scalarOrNull(client.enrichment.diet),
  };
}

function scalarString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function scalarOrNull(value: unknown) {
  const normalized = scalarString(value);
  return normalized || null;
}

function isoDateOrNull(value: unknown) {
  const normalized = scalarString(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function boundedIntegerOrNull(value: unknown, minimum: number, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

async function loadClientLinks(client: ClinicalClientDetail, resident: ClinicalResident | null) {
  const requests = [
    ...(resident ? [listResidentLinks({ residentKey: resident.resident_key, limit: 100 })] : []),
    ...client.resident_numbers.map((residentNumber) =>
      listResidentLinks({ residentNumber, limit: 100 }),
    ),
  ];
  if (requests.length === 0) return [];
  const results = await Promise.all(requests);
  return dedupeLinks(results.flatMap((result) => result.links));
}

async function filterLinksForUser(links: PipelineResidentLink[], user?: PipelineUser) {
  if (!user || !isAssessorUser(user)) return links;
  const visible = await Promise.all(links.map(async (link) => {
    if (!link.referral_id) return null;
    const referral = await getReferral(link.referral_id);
    return referral && canAccessReferral(user, referral) ? link : null;
  }));
  return visible.filter((link): link is PipelineResidentLink => Boolean(link));
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
