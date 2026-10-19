import "server-only";

import {
  ClinicalDataError,
  getClinicalAuthMode,
  getClinicalClient,
  getClinicalRoster,
  type ClinicalResident,
} from "@/lib/clinical/clinical-data";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import { normalizeSourceCalendarDate } from "@/lib/pipeline/calendar-date";
import { selectAdmissionIdentityCandidates, selectAutomaticAdmissions, verifiedAdmissionBirthDate } from "@/lib/pipeline/clinical-admission-selection";
import { findClinicalResidentMatch } from "@/lib/pipeline/referral-clinical-reconciliation";
import type { Referral } from "@/lib/pipeline/referral-types";
import { listReferrals } from "@/lib/pipeline/referral-store";
import type { PipelineResidentLink } from "@/lib/pipeline/resident-link-records";
import { createResidentLink, listResidentLinks, reviewResidentLink } from "@/lib/pipeline/resident-link-store";
import { transitionReferral } from "@/lib/pipeline/workflow-store";

export type ClinicalBacklogReconciliationResult = {
  status: "complete" | "source_not_fresh";
  data_as_of: string | null;
  scanned_referrals: number;
  scanned_clients: number;
  roster_residents: number;
  already_connected: number;
  awaiting_review: number;
  candidates_created: number;
  rejected_matches: number;
  no_match: number;
  errors: number;
  admissions_confirmed: number;
  admission_conflicts: number;
};

const pageSize = 200;
const maxReferralRows = 100_000;
const maxResidentRows = 20_000;
const maxResidentLinkRows = 100_000;

export async function reconcileClinicalBacklog(
  request: Request,
): Promise<ClinicalBacklogReconciliationResult> {
  if (getClinicalAuthMode() !== "client_credentials") {
    throw new ClinicalDataError(
      503,
      "clinical_worker_auth_unavailable",
      "Daily clinical reconciliation requires server-to-server client-credential authentication.",
    );
  }
  const [referrals, links, roster] = await Promise.all([
    loadReferrals(),
    loadResidentLinks(),
    loadClinicalRoster(request),
  ]);
  const clients = latestReferralByClient(referrals);
  const base = {
    data_as_of: roster.dataAsOf,
    scanned_referrals: referrals.length,
    scanned_clients: clients.size,
    roster_residents: roster.residents.length,
    already_connected: 0,
    awaiting_review: 0,
    candidates_created: 0,
    rejected_matches: 0,
    no_match: 0,
    errors: 0,
    admissions_confirmed: 0,
    admission_conflicts: 0,
  };

  if (!roster.fresh) {
    recordPipelineMetric("pipeline.clinical_backlog.reconciled", 0, "count", {
      operation: "clinical_backlog_reconciliation",
      result: "source_not_fresh",
    });
    return { status: "source_not_fresh", ...base };
  }

  const counts = { ...base };
  const workingLinks = [...links];
  const verifiedResidents = [...roster.residents];
  const noMatchClients = new Set<string>();
  const linksByClient = groupLinksByClient(links);
  for (const [clientId, referral] of clients) {
    const currentLinks = linksByClient.get(clientId) ?? [];
    if (currentLinks.some((link) => link.status === "confirmed")) {
      counts.already_connected += 1;
      continue;
    }
    if (currentLinks.some((link) => link.status === "candidate")) {
      counts.awaiting_review += 1;
      continue;
    }

    const match = findReviewedResidentNumberMatch(referral, roster.residents)
      ?? findClinicalResidentMatch(referral, roster.residents);
    if (!match) {
      counts.no_match += 1;
      noMatchClients.add(clientId);
      continue;
    }
    if (currentLinks.some((link) => link.status === "rejected" && link.resident_key === match.resident.resident_key)) {
      counts.rejected_matches += 1;
      continue;
    }

    try {
      const result = await createResidentLink({
        pipeline_client_id: clientId,
        display_name: referral.name,
        date_of_birth: referral.dob || null,
        referral_id: referral.id,
        resident_key: match.resident.resident_key,
        resident_number: match.resident.resident_number,
        community_id: match.resident.community_id,
        match_method: match.method === "resident_number_exact" ? "resident_number_exact" : "imported",
        match_confidence: match.confidence,
      }, {
        id: "pipeline-clinical-reconciliation",
        name: "Pipeline Clinical Reconciliation",
      }, `clinical-backlog:${clientId}:${match.resident.resident_key}`);
      if (!result.ok) {
        counts.errors += 1;
        continue;
      }
      counts.candidates_created += 1;
      linksByClient.set(clientId, [...currentLinks, result.link]);
      workingLinks.push(result.link);
    } catch {
      counts.errors += 1;
    }
  }

  for (const { referral, resident } of selectAdmissionIdentityCandidates(referrals, workingLinks, roster.residents, roster.dataAsOf)) {
    try {
      if (resident.date_of_birth === referral.dob && workingLinks.some((link) => link.pipeline_client_id === referral.clientId
        && link.resident_key === resident.resident_key && link.status === "confirmed")) continue;
      const dob = resident.canonical_client_id
        ? verifiedAdmissionBirthDate(
          referral, resident, await getClinicalClient(request, resident.canonical_client_id),
          roster.snapshotId, roster.dataAsOf,
        )
        : normalizeSourceCalendarDate(resident.date_of_birth) === normalizeSourceCalendarDate(referral.dob)
          ? normalizeSourceCalendarDate(referral.dob)
          : null;
      if (!dob) continue;
      const verifiedIndex = verifiedResidents.findIndex((row) => row.resident_key === resident.resident_key);
      verifiedResidents[verifiedIndex] = { ...resident, date_of_birth: dob };
      if (workingLinks.some((link) => link.pipeline_client_id === referral.clientId
        && link.resident_key === resident.resident_key && link.status === "confirmed")) continue;
      const actor = { id: "pipeline-clinical-reconciliation", name: "Alamo census reconciliation" };
      const existing = workingLinks.find((link) => link.pipeline_client_id === referral.clientId
        && link.resident_key === resident.resident_key && link.status === "candidate");
      const created = existing ? null : await createResidentLink({
        pipeline_client_id: referral.clientId!, display_name: referral.name, date_of_birth: dob,
        referral_id: referral.id, resident_key: resident.resident_key,
        resident_number: resident.resident_number, community_id: resident.community_id,
        match_method: "imported", match_confidence: 1,
      }, actor, `clinical-census-identity:${referral.clientId}:${resident.resident_key}`);
      if (created && !created.ok) { counts.admission_conflicts += 1; continue; }
      const candidate = existing ?? created?.link;
      if (!candidate || candidate.status !== "candidate") { counts.admission_conflicts += 1; continue; }
      if (created) { counts.candidates_created += 1; workingLinks.push(candidate); }
      const reviewed = await reviewResidentLink(candidate.link_id, {
        action: "confirm", review_note: `Verified current census identity, date of birth, community and admit date in governed snapshot ${roster.snapshotId}.`,
      }, actor, candidate.version);
      if (!reviewed?.ok) { counts.admission_conflicts += 1; continue; }
      if (noMatchClients.delete(referral.clientId!)) counts.no_match -= 1;
      const index = workingLinks.findIndex((link) => link.link_id === candidate.link_id);
      if (index >= 0) workingLinks[index] = reviewed.link;
    } catch {
      counts.errors += 1;
    }
  }

  for (const { referral, actualDate } of selectAutomaticAdmissions(referrals, workingLinks, verifiedResidents, roster.dataAsOf)) {
    try {
      const result = await transitionReferral(
        referral.id, "Accepted / Admitted", referral.version!, referral.sectionVersions!.workflow,
        { id: "pipeline-clinical-reconciliation", name: "Alamo census reconciliation" },
        `clinical-admission:${referral.id}:${actualDate}`, actualDate,
        `Confirmed from governed Alamo census snapshot ${roster.snapshotId}.`,
      );
      if (result?.ok && !result.idempotentReplay) counts.admissions_confirmed += 1;
      else counts.admission_conflicts += 1;
    } catch {
      counts.errors += 1;
    }
  }

  recordPipelineMetric("pipeline.clinical_backlog.reconciled", counts.candidates_created, "count", {
    operation: "clinical_backlog_reconciliation",
    result: counts.errors > 0 ? "partial" : "complete",
  });
  recordPipelineMetric("pipeline.clinical_backlog.no_match", counts.no_match, "count", {
    operation: "clinical_backlog_reconciliation",
    result: "complete",
  });
  recordPipelineMetric("pipeline.clinical_backlog.admissions_confirmed", counts.admissions_confirmed, "count", {
    operation: "clinical_backlog_reconciliation",
    result: counts.admission_conflicts > 0 ? "conflict" : "complete",
  });
  return { status: "complete", ...counts };
}

async function loadClinicalRoster(request: Request) {
  const residents: ClinicalResident[] = [];
  let cursor: string | undefined;
  let snapshotId: string | null = null;
  let dataAsOf: string | null = null;
  let fresh = true;

  do {
    const page = await getClinicalRoster(request, { limit: pageSize, cursor });
    if (snapshotId && (page.snapshot_id !== snapshotId || page.data_as_of !== dataAsOf)) {
      throw new ClinicalDataError(
        503,
        "clinical_snapshot_changed",
        "The governed clinical snapshot changed during reconciliation. Retry against one atomic snapshot.",
      );
    }
    snapshotId = page.snapshot_id;
    dataAsOf = page.data_as_of;
    fresh = fresh && page.freshness.status === "fresh";
    residents.push(...page.residents);
    if (residents.length > maxResidentRows) {
      throw new ClinicalDataError(502, "clinical_roster_too_large", "The governed roster exceeds the reconciliation safety limit.");
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);

  return { residents, snapshotId, dataAsOf, fresh };
}

async function loadReferrals() {
  const referrals: Referral[] = [];
  let cursor: string | undefined;
  do {
    const page = await listReferrals({ limit: pageSize, cursor });
    referrals.push(...page.referrals);
    if (referrals.length > maxReferralRows) throw new Error("Referral reconciliation capacity reached.");
    cursor = page.next_cursor;
  } while (cursor);
  return referrals;
}

async function loadResidentLinks() {
  const links: PipelineResidentLink[] = [];
  let cursor: string | undefined;
  do {
    const page = await listResidentLinks({ limit: pageSize, cursor });
    links.push(...page.links);
    if (links.length > maxResidentLinkRows) throw new Error("Resident-link reconciliation capacity reached.");
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return links;
}

function latestReferralByClient(referrals: Referral[]) {
  const result = new Map<string, Referral>();
  for (const referral of referrals) {
    if (!referral.clientId) continue;
    const current = result.get(referral.clientId);
    if (!current || referralTimestamp(referral) > referralTimestamp(current)) {
      result.set(referral.clientId, referral);
    }
  }
  return result;
}

function groupLinksByClient(links: PipelineResidentLink[]) {
  const result = new Map<string, PipelineResidentLink[]>();
  for (const link of links) {
    result.set(link.pipeline_client_id, [...(result.get(link.pipeline_client_id) ?? []), link]);
  }
  return result;
}

function findReviewedResidentNumberMatch(referral: Referral, residents: ClinicalResident[]) {
  const extracted = referral.packetFields?.find((field) => {
    const key = field.field_key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return ["residentnumber", "eldermarkresidentnumber"].includes(key)
      && ["accepted", "edited"].includes(field.review_status);
  });
  const residentNumber = normalizeIdentifier(extracted?.final_value ?? extracted?.proposed_value);
  if (!residentNumber) return null;
  const matches = residents.filter((resident) => normalizeIdentifier(resident.resident_number) === residentNumber);
  if (matches.length !== 1) return null;
  return {
    resident: matches[0],
    confidence: 1,
    method: "resident_number_exact" as const,
  };
}

function referralTimestamp(referral: Referral) {
  return referral.updatedAt ?? referral.createdAt;
}

function normalizeIdentifier(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}
