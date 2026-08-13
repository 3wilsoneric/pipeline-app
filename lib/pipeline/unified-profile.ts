import "server-only";

import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import {
  getAssessmentStoreReadiness,
  listAssessments,
} from "@/lib/assessment/assessment-store";
import { getAssessmentToolCoverage } from "@/lib/assessment/assessment-tool-schema";
import { getClinicalResident } from "@/lib/clinical/clinical-data";
import { getClientHistoryForResident } from "./client-history-store";
import type {
  AdmissionRequirement,
  Referral,
} from "./referral-types";
import {
  getReferral,
  getReferralStoreReadiness,
  listReferralFilesByClient,
  listReferralsByClient,
} from "./referral-store";
import type { PipelineResidentLink } from "./resident-link-records";
import { listResidentLinks } from "./resident-link-store";
import type {
  UnifiedClientProfileResponse,
  UnifiedProfileConnection,
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
  residentKey: string,
  permissions: UnifiedClientProfileResponse["pipeline"]["permissions"] = {
    can_create_identity_candidate: false,
    can_review_identity: false,
  },
): Promise<UnifiedClientProfileResponse> {
  const clinical = await getClinicalResident(request, residentKey);
  const resident = clinical.resident;
  const history = await getClientHistoryForResident(
    resident.resident_number,
    resident.date_of_birth,
  );
  const linkResults = await Promise.all([
    listResidentLinks({ residentKey: resident.resident_key, limit: 100 }),
    resident.resident_number
      ? listResidentLinks({ residentNumber: resident.resident_number, limit: 100 })
      : Promise.resolve(null),
  ]);
  const links = dedupeLinks([
    ...linkResults[0].links,
    ...(linkResults[1]?.links ?? []),
  ]);
  const confirmed = links.filter((link) => link.status === "confirmed");
  if (confirmed.length > 1) {
    throw new UnifiedProfileError(
      409,
      "resident_link_conflict",
      "More than one confirmed Pipeline identity link exists for this resident. Resolve the link conflict before loading operational data.",
    );
  }
  const candidates = links.filter((link) => link.status === "candidate");
  const connection = buildConnection(confirmed[0] ?? null, candidates);
  if (!connection.confirmed_link) {
    return {
      ...clinical,
      history,
      pipeline: emptyPipelineProjection(connection, permissions),
    };
  }

  const referralReadiness = getReferralStoreReadiness();
  const assessmentReadiness = getAssessmentStoreReadiness();
  if (!referralReadiness.ready || !assessmentReadiness.ready) {
    throw new UnifiedProfileError(
      503,
      "pipeline_operational_store_unavailable",
      "The resident identity is linked, but Pipeline operational storage is unavailable.",
    );
  }

  const link = connection.confirmed_link;
  const referrals = await loadLinkedReferrals(link);
  const assessments = await loadLinkedAssessments(link, referrals);
  const documents = await loadLinkedDocuments(link, referrals);
  const requirements = referrals.flatMap((referral) => referral.requirements ?? []);
  const latestAssessment = assessments[0] ?? null;
  const latestCoverage = latestAssessment ? getAssessmentToolCoverage(latestAssessment) : null;
  const openRequirements = requirements.filter((item) => !["reviewed", "waived"].includes(item.status));
  const blockers = openRequirements.filter((item) => item.blocker);

  return {
    ...clinical,
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
): UnifiedProfileConnection {
  if (confirmedLink) {
    return {
      status: "confirmed",
      confirmed_link: confirmedLink,
      candidates,
      message: "Pipeline operational records are joined through a reviewed resident link.",
    };
  }
  if (candidates.length > 0) {
    return {
      status: "candidate",
      confirmed_link: null,
      candidates,
      message: "A possible Pipeline identity match needs human review before operational records can be joined.",
    };
  }
  return {
    status: "unlinked",
    confirmed_link: null,
    candidates: [],
    message: "No reviewed Pipeline identity link exists. This profile will not be matched by name.",
  };
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

async function loadLinkedReferrals(link: PipelineResidentLink) {
  const referrals = await listReferralsByClient(link.pipeline_client_id);
  if (link.referral_id && !referrals.some((referral) => referral.id === link.referral_id)) {
    const explicit = await getReferral(link.referral_id);
    if (explicit) referrals.push(explicit);
  }
  return referrals.sort(compareReferrals);
}

async function loadLinkedAssessments(link: PipelineResidentLink, referrals: Referral[]) {
  const results = await Promise.all([
    ...referrals.map((referral) => listAssessments({ referralId: referral.id, limit: 100 })),
    listAssessments({ residentKey: link.resident_key, limit: 100 }),
    ...(link.resident_number ? [listAssessments({ residentNumber: link.resident_number, limit: 100 })] : []),
  ]);
  const byId = new Map<string, PipelineAssessmentRecord>();
  for (const result of results) {
    for (const assessment of result.assessments) byId.set(assessment.assessment_id, assessment);
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

function compareReferrals(left: Referral, right: Referral) {
  return (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) || right.id - left.id;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
