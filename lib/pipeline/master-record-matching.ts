export type MasterIdentity = {
  canonical_person_id: string;
  resident_number: string | null;
  date_of_birth: string | null;
  display_name: string;
};

export type SourceIdentity = {
  source_record_id: string;
  resident_number: string | null;
  date_of_birth: string | null;
  display_name: string;
};

export type MasterIdentityDecision =
  | { status: "matched"; canonical_person_id: string; warnings: string[] }
  | { status: "no_match"; reason: "resident_number_not_found" }
  | {
      status: "human_review";
      reason:
        | "source_resident_number_missing"
        | "master_date_of_birth_missing"
        | "duplicate_resident_number";
      candidate_person_ids: string[];
    }
  | {
      status: "blocked_conflict";
      reason: "date_of_birth_conflict";
      candidate_person_ids: string[];
    };

export type AdmissionEvidence = {
  admission_episode_id: string;
  canonical_person_id: string;
  admit_date: string;
  discharge_date: string | null;
};

export type CensusTruth = {
  canonical_person_id: string;
  active: boolean;
  community_id: string | null;
  as_of: string;
};

export function decideMasterIdentityMatch(
  source: SourceIdentity,
  candidates: readonly MasterIdentity[],
): MasterIdentityDecision {
  const residentNumber = normalizeResidentNumber(source.resident_number);
  if (!residentNumber) {
    return {
      status: "human_review",
      reason: "source_resident_number_missing",
      candidate_person_ids: nameAndDobCandidates(source, candidates),
    };
  }

  const residentMatches = candidates.filter(
    (candidate) => normalizeResidentNumber(candidate.resident_number) === residentNumber,
  );
  if (residentMatches.length === 0) {
    return { status: "no_match", reason: "resident_number_not_found" };
  }

  const personIds = unique(residentMatches.map((candidate) => candidate.canonical_person_id));
  if (personIds.length !== 1) {
    return {
      status: "human_review",
      reason: "duplicate_resident_number",
      candidate_person_ids: personIds,
    };
  }

  const sourceDob = normalizeDate(source.date_of_birth);
  const candidateDobs = unique(
    residentMatches.map((candidate) => normalizeDate(candidate.date_of_birth)).filter(Boolean),
  );
  if (!sourceDob || candidateDobs.length === 0) {
    return {
      status: "human_review",
      reason: "master_date_of_birth_missing",
      candidate_person_ids: personIds,
    };
  }
  if (candidateDobs.length !== 1 || candidateDobs[0] !== sourceDob) {
    return {
      status: "blocked_conflict",
      reason: "date_of_birth_conflict",
      candidate_person_ids: personIds,
    };
  }

  const warnings = residentMatches.some(
    (candidate) => normalizeName(candidate.display_name) !== normalizeName(source.display_name),
  )
    ? ["display_name_disagreement"]
    : [];
  return { status: "matched", canonical_person_id: personIds[0], warnings };
}

export function dedupeAdmissionEvidence(records: readonly AdmissionEvidence[]) {
  const byEpisode = new Map<string, AdmissionEvidence>();
  const conflicts: string[] = [];
  for (const record of records) {
    const existing = byEpisode.get(record.admission_episode_id);
    if (!existing) {
      byEpisode.set(record.admission_episode_id, record);
      continue;
    }
    if (stableAdmissionValue(existing) !== stableAdmissionValue(record)) {
      conflicts.push(record.admission_episode_id);
    }
  }
  return {
    episodes: [...byEpisode.values()],
    conflicting_episode_ids: unique(conflicts),
  };
}

export function projectCurrentCensus(
  canonicalPersonId: string,
  census: readonly CensusTruth[],
) {
  const matches = census
    .filter((record) => record.canonical_person_id === canonicalPersonId)
    .sort((left, right) => right.as_of.localeCompare(left.as_of));
  if (matches.length === 0) return { status: "unknown" as const, community_id: null, as_of: null };
  const latestDate = matches[0].as_of;
  const latest = matches.filter((record) => record.as_of === latestDate);
  if (latest.length !== 1) {
    return { status: "conflict" as const, community_id: null, as_of: latestDate };
  }
  return {
    status: latest[0].active ? "active" as const : "inactive" as const,
    community_id: latest[0].community_id,
    as_of: latestDate,
  };
}

function nameAndDobCandidates(source: SourceIdentity, candidates: readonly MasterIdentity[]) {
  const name = normalizeName(source.display_name);
  const dob = normalizeDate(source.date_of_birth);
  if (!name || !dob) return [];
  return unique(candidates
    .filter((candidate) => normalizeName(candidate.display_name) === name
      && normalizeDate(candidate.date_of_birth) === dob)
    .map((candidate) => candidate.canonical_person_id));
}

function normalizeResidentNumber(value: string | null) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "") || null;
}

function normalizeDate(value: string | null) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeName(value: string) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stableAdmissionValue(record: AdmissionEvidence) {
  return [record.canonical_person_id, record.admit_date, record.discharge_date ?? ""].join("\u0000");
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}
