import { readFileSync } from "node:fs";
import path from "node:path";

export const clinicalFixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/fixtures/alamo-pipeline-clinical.sanitized.json"), "utf8"),
) as {
  roster: Record<string, unknown>;
  resident: Record<string, unknown>;
  clients: Record<string, unknown>;
  client: Record<string, unknown>;
};

export const unifiedProfileFixture = {
  ...clinicalFixture.client,
  resident: clinicalFixture.resident.resident,
  history: {
    status: "unavailable",
    source: null,
    data_as_of: null,
    imported_at: null,
    warning: "No legacy placement history fixture is loaded.",
    episode_count: 0,
    current_episode_count: 0,
    discharged_episode_count: 0,
    first_admit_date: null,
    latest_admit_date: null,
    quality_flags: [],
    episodes: [],
  },
  pipeline: {
    permissions: {
      can_create_identity_candidate: true,
      can_review_identity: true,
    },
    connection: {
      status: "unlinked",
      confirmed_link: null,
      candidates: [],
      suggestions: [],
      message: "No reviewed Pipeline identity link exists. Suggestions never join records automatically.",
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
      actions_needed: ["Create and review a resident link"],
    },
  },
};

export const clientDirectoryFixture = {
  ...clinicalFixture.clients,
  clients: ((clinicalFixture.clients as { clients: Array<Record<string, unknown>> }).clients ?? []).map((client) => ({
    ...client,
    workspace_origin: "alamo_platform",
    pipeline_client_id: null,
    referral_count: 0,
    active_referral_count: 0,
    historical_workspace_count: 0,
    document_count: 0,
  })),
};
