import { createHash } from "node:crypto";
import path from "node:path";

export const historicalSimulationVersion = 1;
export const defaultHistoricalSimulationSeed = "pipeline-allo-100-v1";
export const materializeConfirmation = "MATERIALIZE-HISTORICAL-SIMULATION";
export const runConfirmation = "RUN-ISOLATED-HISTORICAL-SIMULATION";
export const maximumSimulationCases = 500;
export const maximumUploadFileBytes = 100 * 1024 * 1024;

const allowedContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/heic",
]);

const contentTypeAliases = new Map([
  ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"],
  ["application/x-pdf", "application/pdf"],
]);

const contentTypeByExtension = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".heic", "image/heic"],
]);

const expectedStatusByDisposition = new Map([
  ["unsupported_type", 415],
  ["over_limit", 413],
  ["below_local_minimum", 413],
  ["invalid_descriptor", 400],
]);

const documentCategories = new Set([
  "referral_packet",
  "face_sheet",
  "assessment",
  "medication_list",
  "tb_test",
  "signed_admission_agreement",
  "conservatorship_document",
  "lic_602",
  "lic_601_603",
  "provider_form",
  "payer_verification",
  "responsible_party",
  "other",
]);

const behaviorProfiles = [
  "straight_through",
  "interrupted_resume",
  "concurrent_reads",
  "duplicate_retry",
  "reschedule_once",
  "save_reopen",
  "supervisor_review",
];

export function buildHistoricalSimulationPlan(localManifest, options = {}) {
  const count = positiveInteger(options.count ?? 100, "count", maximumSimulationCases);
  const seed = safeSeed(options.seed ?? defaultHistoricalSimulationSeed);
  validateHistoricalSourceManifest(localManifest);

  const eligible = localManifest.workspaces.filter((workspace) => (
    workspace.files.some(isUploadableSourceMaterial)
  ));
  if (eligible.length < count) {
    throw new Error(`Only ${eligible.length} workspaces have available source material; ${count} requested.`);
  }

  const selected = selectStratifiedWorkspaces(eligible, count, seed);
  const sourceManifestSha256 = sha256Json(localManifest);
  const simulationId = `historical_${hashText(`${sourceManifestSha256}:${seed}:${count}`).slice(0, 16)}`;
  const supervisor = {
    actor_id: "sim-supervisor-sandeep",
    display_name: "Sandeep",
    email: `sandeep+${simulationId}@pipeline.local`,
    role: "admin",
    source_owner: null,
  };

  const ownerNames = [...new Set(selected.map((workspace) => normalizedText(workspace.primary_owner)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const actors = [
    supervisor,
    ...ownerNames.map((owner) => ({
      actor_id: ownerActorId(owner),
      display_name: owner,
      email: `historical-owner-${hashText(owner).slice(0, 16)}@pipeline.local`,
      role: "reviewer",
      source_owner: owner,
    })),
  ];

  const cases = selected.map((workspace, index) => buildCase({
    workspace,
    index,
    seed,
    simulationId,
    supervisorId: supervisor.actor_id,
  }));

  const plan = {
    version: historicalSimulationVersion,
    kind: "pipeline_historical_multi_user_simulation",
    data_class: "user_supplied_real_private",
    environment: "isolated_local_only",
    production_mutation_allowed: false,
    simulation_id: simulationId,
    seed,
    source: {
      system: "allo",
      manifest_sha256: sourceManifestSha256,
      workspace_count: Number(localManifest.workspace_count),
      material_count: Number(localManifest.material_count),
    },
    controls: {
      source_files_are_read_only: true,
      deterministic_replay: true,
      clinical_values_must_be_source_verified: true,
      full_lifecycle_requires_verified_truth_packs: true,
      private_artifacts_only: true,
    },
    supervisor,
    actors,
    cases,
  };
  plan.summary = summarizeHistoricalSimulation(plan);
  return plan;
}

export function summarizeHistoricalSimulation(plan) {
  const materials = plan.cases.flatMap((item) => item.materials);
  return {
    version: plan.version,
    kind: "pipeline_historical_multi_user_simulation_summary",
    simulation_id: plan.simulation_id,
    seed: plan.seed,
    case_count: plan.cases.length,
    actor_count: plan.actors.length,
    assigned_owner_count: plan.actors.filter((actor) => actor.role === "reviewer").length,
    supervisor_assigned_case_count: plan.cases.filter((item) => item.assignment_basis === "supervisor_fallback").length,
    community_counts: countBy(plan.cases, (item) => item.community || "Unassigned"),
    behavior_counts: countBy(plan.cases, (item) => item.behavior),
    truth_pack_counts: countBy(plan.cases, (item) => item.truth_pack_status),
    material_counts: countBy(materials, (item) => item.disposition),
    available_material_bytes: materials
      .filter((item) => item.source_available)
      .reduce((sum, item) => sum + item.source_byte_size, 0),
    uploadable_material_bytes: materials
      .filter((item) => item.disposition === "upload")
      .reduce((sum, item) => sum + item.source_byte_size, 0),
    contains_names_or_source_paths: false,
  };
}

export function validateHistoricalSimulationPlan(plan) {
  validatePlanEnvelope(plan);
  validatePlanCollections(plan);
  const caseIds = new Set();
  for (const item of plan.cases) validateSimulationCase(item, caseIds);
  return plan;
}

function validatePlanEnvelope(plan) {
  if (plan?.version !== historicalSimulationVersion) throw new Error("historical_simulation_plan_invalid");
  if (plan.kind !== "pipeline_historical_multi_user_simulation") throw new Error("historical_simulation_plan_invalid");
  if (plan.environment !== "isolated_local_only") throw new Error("historical_simulation_plan_invalid");
  if (plan.production_mutation_allowed !== false) throw new Error("historical_simulation_plan_invalid");
}

function validatePlanCollections(plan) {
  if (!Array.isArray(plan.cases)) throw new Error("historical_simulation_case_count_invalid");
  if (plan.cases.length < 1 || plan.cases.length > maximumSimulationCases) {
    throw new Error("historical_simulation_case_count_invalid");
  }
  if (!Array.isArray(plan.actors)) throw new Error("historical_simulation_actor_roster_invalid");
  if (!plan.actors.some((actor) => actor.role === "admin")) throw new Error("historical_simulation_actor_roster_invalid");
}

function validateSimulationCase(item, caseIds) {
  if (!/^case_[a-f0-9]{24}$/.test(String(item.case_id))) throw new Error("historical_simulation_case_id_invalid");
  if (caseIds.has(item.case_id)) throw new Error("historical_simulation_case_id_invalid");
  caseIds.add(item.case_id);
  if (!Array.isArray(item.materials) || item.materials.length < 1) throw new Error("historical_simulation_case_invalid");
  if (!Array.isArray(item.actions)) throw new Error("historical_simulation_case_invalid");
  validateTimeline(item.timeline);
  for (const material of item.materials) validatePlannedMaterial(material);
}

export function truthPackTemplate(plan) {
  validateHistoricalSimulationPlan(plan);
  return {
    version: 1,
    simulation_id: plan.simulation_id,
    instructions: "Populate only from reviewed source material. Set review_status to verified only after human provenance review.",
    cases: plan.cases.map((item) => ({
      case_id: item.case_id,
      case_display_name: item.display_name,
      identity_seed: item.profile_candidate,
      logical_timeline: item.timeline,
      materials: item.materials.map((material) => ({
        material_id: material.material_id,
        filename: material.source_file_name,
        document_category: material.document_category,
        disposition: material.disposition,
      })),
      review_status: "pending",
      assessment_data: null,
      recommendation: null,
      supervisor_decision: null,
      provenance: [],
    })),
  };
}

export function assertVerifiedTruthPacks(plan, truthPacks) {
  validateHistoricalSimulationPlan(plan);
  validateTruthPackEnvelope(plan, truthPacks);
  const byCase = new Map(truthPacks.cases.map((item) => [item?.case_id, item]));
  const incomplete = [];
  for (const item of plan.cases) {
    const truth = byCase.get(item.case_id);
    if (!isVerifiedTruthPack(truth)) incomplete.push(item.case_id);
  }
  if (incomplete.length > 0) {
    throw new Error(`Full lifecycle is blocked: ${incomplete.length} case truth packs are not human-verified.`);
  }
  return truthPacks;
}

function validateTruthPackEnvelope(plan, truthPacks) {
  if (truthPacks?.version !== 1) throw new Error("truth_pack_manifest_invalid");
  if (truthPacks.simulation_id !== plan.simulation_id) throw new Error("truth_pack_manifest_invalid");
  if (!Array.isArray(truthPacks.cases)) throw new Error("truth_pack_manifest_invalid");
}

function isVerifiedTruthPack(truth) {
  if (truth?.review_status !== "verified") return false;
  if (!isPlainObject(truth.assessment_data)) return false;
  if (Object.keys(truth.assessment_data).length < 1) return false;
  if (!isPlainObject(truth.recommendation)) return false;
  if (!isPlainObject(truth.supervisor_decision)) return false;
  if (!Array.isArray(truth.provenance)) return false;
  return truth.provenance.length > 0;
}

export function contentTypeForMaterial(file) {
  const declared = normalizedText(file?.source_content_type).toLowerCase().split(";")[0];
  const aliased = contentTypeAliases.get(declared);
  if (aliased) return aliased;
  if (allowedContentTypes.has(declared)) return declared;
  const extension = path.extname(String(file?.source_file_name ?? "")).toLowerCase();
  return (contentTypeByExtension.get(extension) ?? declared) || "application/octet-stream";
}

export function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function buildCase({ workspace, index, seed, simulationId, supervisorId }) {
  const caseId = `case_${hashText(`${seed}:${workspace.source_workspace_id}`).slice(0, 24)}`;
  const profile = uniqueProfileCandidate(workspace.profile_candidates);
  const assignment = caseAssignment(workspace.primary_owner, supervisorId);
  const materials = workspace.files.map((file) => plannedMaterial(file, caseId));
  const timeline = historicalTimeline(workspace, profile, `${seed}:${workspace.source_workspace_id}`);
  const behavior = caseBehavior(materials, seed, workspace.source_workspace_id);

  return {
    sequence: index + 1,
    case_id: caseId,
    source_workspace_id: String(workspace.source_workspace_id),
    source_workspace_name: String(workspace.source_workspace_name),
    display_name: String(workspace.display_name),
    community: normalizedText(workspace.community) || "Unassigned",
    historical_stage: normalizedText(workspace.historical_stage) || null,
    assigned_actor_id: assignment.actorId,
    assigned_owner_name: assignment.ownerName,
    assignment_basis: assignment.basis,
    profile_candidate: profile,
    truth_pack_status: profile ? "identity_only" : "pending_source_review",
    behavior,
    timeline,
    materials,
    primary_material_id: choosePrimaryMaterial(materials)?.material_id ?? null,
    actions: actionPlan({ caseId, assignedActorId: assignment.actorId, supervisorId, behavior, timeline, simulationId }),
  };
}

function plannedMaterial(file, caseId) {
  const contentType = contentTypeForMaterial(file);
  const sourceAvailable = file.source_available === true;
  const size = Number(file.source_byte_size);
  const disposition = materialDisposition(file, contentType, size, sourceAvailable);
  const identity = `${caseId}:${file.source_item_id}:${file.source_sha256 ?? ""}`;
  const expectedSha256 = /^[a-f0-9]{64}$/.test(String(file.source_sha256 ?? ""))
    ? String(file.source_sha256)
    : null;
  return {
    material_id: `material_${hashText(identity).slice(0, 24)}`,
    source_item_id: String(file.source_item_id),
    source_file_name: String(file.source_file_name),
    source_content_type: contentType,
    source_byte_size: size,
    source_sha256: expectedSha256,
    source_path: sourceAvailable ? String(file.source_path) : null,
    source_available: sourceAvailable,
    source_created_at: validTimestamp(file.source_created_at),
    document_category: documentCategories.has(file.document_category) ? file.document_category : "other",
    disposition,
    expected_api_status: expectedStatusByDisposition.get(disposition) ?? null,
    expected_rejection_stage: disposition === "below_local_minimum" ? "local_upload" : "reservation",
    object_relpath: expectedSha256 ? objectRelativePath(expectedSha256) : null,
  };
}

function materialDisposition(file, contentType, size, sourceAvailable) {
  if (!sourceAvailable) return "missing_source";
  if (String(file.source_file_name).length > 240) return "invalid_descriptor";
  if (size < 5) return "below_local_minimum";
  if (size > maximumUploadFileBytes) return "over_limit";
  if (!allowedContentTypes.has(contentType)) return "unsupported_type";
  return "upload";
}

function caseAssignment(rawOwner, supervisorId) {
  const ownerName = normalizedText(rawOwner);
  if (!ownerName) return { actorId: supervisorId, ownerName: "Sandeep", basis: "supervisor_fallback" };
  return { actorId: ownerActorId(ownerName), ownerName, basis: "historical_owner" };
}

function caseBehavior(materials, seed, workspaceId) {
  if (materials.some((file) => file.disposition === "unsupported_type")) return "unsupported_material";
  if (materials.some((file) => file.disposition === "missing_source")) return "missing_material";
  return behaviorProfiles[rank(`${seed}:behavior:${workspaceId}`) % behaviorProfiles.length];
}

function isUploadableSourceMaterial(file) {
  return file?.source_available === true
    && String(file.source_file_name ?? "").length <= 240
    && Number.isSafeInteger(file.source_byte_size)
    && file.source_byte_size >= 5
    && file.source_byte_size <= maximumUploadFileBytes
    && allowedContentTypes.has(contentTypeForMaterial(file));
}

function choosePrimaryMaterial(materials) {
  const uploadable = materials.filter((file) => file.disposition === "upload");
  return uploadable.find((file) => (
    file.source_content_type === "application/pdf"
    && ["referral_packet", "face_sheet"].includes(file.document_category)
  )) ?? uploadable.find((file) => file.source_content_type === "application/pdf") ?? uploadable[0] ?? null;
}

function actionPlan({ caseId, assignedActorId, supervisorId, behavior, timeline, simulationId }) {
  const interrupted = ["interrupted_resume", "save_reopen"].includes(behavior);
  const rescheduled = behavior === "reschedule_once";
  const duplicateRetry = behavior === "duplicate_retry";
  const actions = [
    action("register_owner", assignedActorId, "Home / My Queue", timeline.referral_received_at),
    action("create_referral", supervisorId, "Referral creation", timeline.referral_received_at, { mutation_key: `${simulationId}:${caseId}:create` }),
    ...(duplicateRetry ? [action("retry_create_same_mutation", supervisorId, "Referral creation", timeline.referral_received_at)] : []),
    action("open_assigned_queue", assignedActorId, "Home / My Queue", timeline.referral_received_at),
    action("upload_all_supported_materials", assignedActorId, "Workspace / Files", timeline.referral_received_at),
    action("verify_material_dispositions", supervisorId, "Workspace / Files", timeline.referral_received_at),
    action("review_packet", assignedActorId, "Workspace / Intake", timeline.assessment_scheduled_at),
    action("open_workspace_surfaces", assignedActorId, "Intake · Files · Activity · Assessment · Chart", timeline.assessment_scheduled_at),
    action("create_assessment", assignedActorId, "Workspace / Assessment", timeline.assessment_scheduled_at),
    action("schedule_assessment", assignedActorId, "Calendar", timeline.assessment_scheduled_at),
    ...(rescheduled ? [action("reschedule_assessment", assignedActorId, "Calendar", timeline.assessment_scheduled_at)] : []),
    action("start_assessment", assignedActorId, "Assessment workbook", timeline.assessment_started_at),
    ...(interrupted ? [
      action("save_and_stop", assignedActorId, "Assessment workbook", timeline.assessment_started_at),
      action("resume_assessment", assignedActorId, "Assessment workbook", timeline.assessment_completed_at),
    ] : []),
    action("enter_verified_assessment_data", assignedActorId, "Assessment workbook", timeline.assessment_completed_at),
    action("sign_assessment", assignedActorId, "Assessment workbook", timeline.assessment_signed_at),
    action("submit_recommendation", assignedActorId, "Workspace / Decision", timeline.assessment_signed_at),
    action("supervisor_decision", supervisorId, "Supervisor queue", timeline.decision_at),
    action("resolve_requirements", supervisorId, "Workspace / Requirements", timeline.decision_at),
    action("complete_ehr_handoff", supervisorId, "Workspace / EHR", timeline.admit_at),
    action("reconcile_case", supervisorId, "Operations / Reports", timeline.admit_at),
  ];
  return actions.map((item, index) => ({ ...item, sequence: index + 1 }));
}

function action(operation, actorId, surface, logicalTime, extra = {}) {
  return { operation, actor_id: actorId, surface, logical_time: logicalTime, ...extra };
}

function historicalTimeline(workspace, profile, seed) {
  const admit = validDate(profile?.admit_date);
  const firstMaterial = validTimestamp(workspace.first_material_at);
  const anchor = admit ?? firstMaterial?.slice(0, 10) ?? "2026-01-15";
  const referralLeadDays = 14 + (rank(`${seed}:lead`) % 32);
  const scheduleLeadDays = 2 + (rank(`${seed}:schedule`) % Math.max(2, Math.min(11, referralLeadDays - 1)));
  const referral = admit ? addDays(anchor, -referralLeadDays) : anchor;
  const scheduled = admit ? addDays(anchor, -scheduleLeadDays) : addDays(anchor, 3 + (rank(`${seed}:post`) % 8));
  const started = scheduled;
  const completed = addDays(started, rank(`${seed}:complete`) % 2);
  const signed = addDays(completed, rank(`${seed}:sign`) % 2);
  const decision = maxDate(addDays(signed, rank(`${seed}:decision`) % 3), admit ?? signed);
  const admitAt = admit ? maxDate(admit, decision) : addDays(decision, 1 + (rank(`${seed}:admit`) % 6));
  return {
    basis: admit ? "unique_profile_admit_date" : firstMaterial ? "first_material_date" : "fixed_simulation_fallback",
    referral_received_at: atNoon(referral),
    assessment_scheduled_at: atNoon(scheduled),
    assessment_started_at: atNoon(started),
    assessment_completed_at: atNoon(completed),
    assessment_signed_at: atNoon(signed),
    decision_at: atNoon(decision),
    admit_at: atNoon(admitAt),
  };
}

function selectStratifiedWorkspaces(workspaces, count, seed) {
  const groups = new Map();
  for (const workspace of workspaces) {
    const community = normalizedText(workspace.community) || "Unassigned";
    const items = groups.get(community) ?? [];
    items.push(workspace);
    groups.set(community, items);
  }
  const quotas = proportionalQuotas([...groups.entries()].map(([community, items]) => ({ community, size: items.length })), count);
  const selected = [];
  for (const { community, quota } of quotas) {
    const items = groups.get(community) ?? [];
    items.sort((left, right) => stableWorkspaceRank(left, seed) - stableWorkspaceRank(right, seed));
    selected.push(...items.slice(0, quota));
  }
  return selected.sort((left, right) => stableWorkspaceRank(left, `${seed}:final`) - stableWorkspaceRank(right, `${seed}:final`));
}

function proportionalQuotas(groups, count) {
  const total = groups.reduce((sum, group) => sum + group.size, 0);
  const calculated = groups.map((group) => {
    const exact = count * group.size / total;
    return { ...group, quota: Math.min(group.size, Math.floor(exact)), remainder: exact - Math.floor(exact) };
  });
  let remaining = count - calculated.reduce((sum, group) => sum + group.quota, 0);
  calculated.sort((left, right) => right.remainder - left.remainder || left.community.localeCompare(right.community));
  while (remaining > 0) {
    let changed = false;
    for (const group of calculated) {
      if (remaining === 0) break;
      if (group.quota < group.size) {
        group.quota += 1;
        remaining -= 1;
        changed = true;
      }
    }
    if (!changed) throw new Error("Unable to allocate requested historical simulation cohort.");
  }
  return calculated.sort((left, right) => left.community.localeCompare(right.community));
}

function uniqueProfileCandidate(candidates) {
  if (!Array.isArray(candidates)) return null;
  const normalized = candidates.filter(isPlainObject).map((candidate) => ({
    resident_name: normalizedText(candidate.resident_name) || null,
    resident_number: normalizedText(candidate.resident_number) || null,
    date_of_birth: validDate(candidate.date_of_birth),
    admit_date: validDate(candidate.admit_date),
    discharge_date: validDate(candidate.discharge_date),
    community: normalizedText(candidate.community) || null,
    resident_status: normalizedText(candidate.resident_status) || null,
  }));
  const unique = new Map(normalized.map((candidate) => [JSON.stringify(candidate), candidate]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function validateHistoricalSourceManifest(value) {
  validateSourceEnvelope(value);
  for (const workspace of value.workspaces) validateSourceWorkspace(workspace);
}

function validateSourceEnvelope(value) {
  if (value?.version !== 1) throw new Error("historical_source_manifest_invalid");
  if (value.data_class !== "user_supplied_real") throw new Error("historical_source_manifest_invalid");
  if (value.source_system !== "allo") throw new Error("historical_source_manifest_invalid");
  if (!Array.isArray(value.workspaces)) throw new Error("historical_source_workspace_count_invalid");
  if (value.workspaces.length !== Number(value.workspace_count)) throw new Error("historical_source_workspace_count_invalid");
}

function validateSourceWorkspace(workspace) {
  if (!normalizedText(workspace?.source_workspace_id)) throw new Error("historical_source_workspace_invalid");
  if (!normalizedText(workspace.source_workspace_name)) throw new Error("historical_source_workspace_invalid");
  if (!normalizedText(workspace.display_name)) throw new Error("historical_source_workspace_invalid");
  if (!Array.isArray(workspace.files)) throw new Error("historical_source_workspace_invalid");
  for (const file of workspace.files) validateSourceMaterial(file);
}

function validateSourceMaterial(file) {
  if (!normalizedText(file?.source_item_id)) throw new Error("historical_source_material_invalid");
  if (!normalizedText(file.source_file_name)) throw new Error("historical_source_material_invalid");
  if (!Number.isSafeInteger(file.source_byte_size)) throw new Error("historical_source_material_invalid");
  if (file.source_byte_size < 1) throw new Error("historical_source_material_invalid");
  if (file.source_available === true && !path.isAbsolute(String(file.source_path ?? ""))) {
    throw new Error("historical_source_path_invalid");
  }
}

function validatePlannedMaterial(material) {
  if (!/^material_[a-f0-9]{24}$/.test(String(material.material_id))
    || !["upload", "unsupported_type", "over_limit", "below_local_minimum", "invalid_descriptor", "missing_source"].includes(material.disposition)
    || !Number.isSafeInteger(material.source_byte_size)
    || material.source_byte_size < 1) {
    throw new Error("historical_simulation_material_invalid");
  }
  if (material.source_available && !path.isAbsolute(String(material.source_path ?? ""))) {
    throw new Error("historical_simulation_material_path_invalid");
  }
}

function validateTimeline(timeline) {
  const keys = [
    "referral_received_at",
    "assessment_scheduled_at",
    "assessment_started_at",
    "assessment_completed_at",
    "assessment_signed_at",
    "decision_at",
    "admit_at",
  ];
  const values = keys.map((key) => Date.parse(String(timeline?.[key] ?? "")));
  if (values.some((value) => !Number.isFinite(value))) throw new Error("historical_simulation_timeline_invalid");
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) throw new Error("historical_simulation_timeline_order_invalid");
  }
}

function ownerActorId(owner) {
  return `sim-owner-${hashText(owner).slice(0, 20)}`;
}

function objectRelativePath(digest) {
  return `objects/sha256/${digest.slice(0, 2)}/${digest}`;
}

function stableWorkspaceRank(workspace, seed) {
  return rank(`${seed}:${workspace.source_workspace_id}`);
}

function rank(value) {
  return Number.parseInt(hashText(value).slice(0, 12), 16);
}

function positiveInteger(value, name, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return number;
}

function safeSeed(value) {
  const seed = String(value).trim();
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(seed)) throw new Error("seed contains unsupported characters");
  return seed;
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const parsed = new Date(`${value.trim()}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.trim() ? value.trim() : null;
}

function validTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function maxDate(left, right) {
  return left >= right ? left : right;
}

function atNoon(date) {
  return `${date}T12:00:00.000Z`;
}

function sha256Json(value) {
  return hashText(`${JSON.stringify(value)}\n`);
}

function countBy(items, key) {
  return Object.fromEntries(
    [...items.reduce((counts, item) => {
      const value = key(item);
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
