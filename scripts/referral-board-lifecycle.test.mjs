import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { getReferralBoardState: board } = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-flow.ts");
const { createEmptyAssessmentToolData } = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const referral = {
  id: 1, name: "Synthetic Client", community: "Turlock", date: "2026-09-21", dob: "", source: "Referral packet",
  owner: "Synthetic Assessor", ownerId: "synthetic", stage: "New", workflowStatus: "intake_documents_needed",
  documentStatus: "Missing", workspaceStatus: "active", requirements: [],
};
const accepted = { outcome: "accepted", decidedAt: "2026-09-20T00:00:00Z" };
const signed = { assessmentExists: true, assessmentComplete: true, assessmentSigned: true };
const admitted = { ...referral, stage: "Accepted / Admitted", workflowStatus: "admitted" };
const sent = "2026-09-21T12:00:00Z";

test("received becomes preparation from real input, not an empty assessment", () => {
  assert.equal(board(referral).stage, "received");
  assert.equal(board(referral, { assessmentExists: true, assessmentData: createEmptyAssessmentToolData() }).stage, "received");
  for (const change of [{ dob: "1980-01-01" }, { documentStatus: "Uploaded" }, { currentMedications: "Recorded medication history" }]) {
    assert.equal(board({ ...referral, ...change }).stage, "in_progress");
  }
  assert.equal(board(referral, { assessmentData: { ...createEmptyAssessmentToolData(), current_location: "Synthetic facility" } }).stage, "in_progress");
});

test("all extraction states remain document details, never a board status or next action", () => {
  for (const packetStatus of ["received", "normalizing", "extracting", "failed", "ready_for_review", "reviewed"]) {
    const result = board({ ...referral, packetId: "synthetic", packetStatus });
    assert.equal(result.stage, "in_progress");
    assert.equal(result.detail, "Preparation");
    assert.equal(result.next_action, "Continue preparation");
    assert.equal(result.location.view, "assessment");
  }
});

test("scheduled, started, completed and signed assessments move with their evidence", () => {
  assert.equal(board(referral, { assessmentScheduleStatus: "scheduled" }).detail, "Assessment scheduled");
  assert.equal(board(referral, { assessmentStarted: true }).detail, "Assessment underway");
  assert.equal(board(referral, { assessmentComplete: true }).detail, "Ready to sign");
  assert.equal(board(referral, { assessmentComplete: true }).location.assessmentMode, "review");
  assert.equal(board(referral, signed).stage, "decision");
  assert.equal(board(referral, signed).detail, "Under review");
  assert.equal(board(referral, { ...signed, decision: { outcome: "declined" } }).detail, "Denied");
});

test("acceptance needs signing and admission requirements, not later profile reconciliation", () => {
  const requirement = { id: "test", type: "signed_admission_agreement", label: "Admission agreement", nextStep: "Attach admission agreement", requiredFor: "move_in", status: "needed" };
  assert.equal(board(referral, { decision: accepted }).detail, "Accept");
  assert.equal(board(referral, { ...signed, decision: accepted, requirements: [requirement] }).stage, "decision");
  assert.equal(board(referral, { ...signed, decision: accepted, requirements: [requirement] }).location.view, "files");
  for (const status of ["received", "reviewed", "waived", "not_applicable"]) {
    const result = board(referral, { ...signed, decision: accepted, requirements: [{ ...requirement, status }, { ...requirement, requiredFor: "profile_completion" }] });
    assert.equal(result.stage, "awaiting_admit");
    assert.equal(result.location.view, "workflow");
  }
});

test("admission and confirmed email are both required to leave, in either order", () => {
  assert.equal(board(referral, { ...signed, decision: accepted, packetSentAt: sent }).stage, "awaiting_admit");
  assert.equal(board(admitted, { ...signed, decision: accepted }).stage, "awaiting_admit");
  assert.equal(board(admitted, { ...signed, decision: accepted }).detail, "Email not sent");
  assert.equal(board(admitted, { ...signed, decision: accepted, packetSentAt: sent }).stage, null);
  assert.equal(board({ ...referral, admissionDate: "2026-09-21" }, { ...signed, decision: accepted, packetSentAt: sent }).stage, "awaiting_admit", "a planned admission date is not admission");
});

test("reassessment reopens current work; archives never return to the board", () => {
  const reassessment = { decision: accepted, assessmentCreatedAt: "2026-09-21T00:00:00Z", assessmentStarted: true };
  assert.equal(board(admitted, reassessment).stage, "in_progress");
  assert.equal(board(admitted, { ...reassessment, ...signed }).detail, "Under review");
  assert.equal(board(admitted, { ...reassessment, ...signed, packetSentAt: sent }).stage, null);
  assert.equal(board({ ...referral, workspaceStatus: "archived" }, reassessment).stage, null);
  assert.equal(board({ ...referral, workspaceStatus: "historical" }).stage, null);
  assert.equal(board({ ...referral, deletedAt: sent }).stage, null);
});

test("persisted sent admissions leave Home but remain in Workspaces after a fresh read", async () => {
  const root = await mkdtemp(join(tmpdir(), "board-lifecycle-"));
  const user = { id: "synthetic", name: "Synthetic Assessor", roles: ["reviewer"] };
  const environment = { ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: "disconnected", PIPELINE_DATABASE_URL: "",
    PIPELINE_REFERRAL_STORE_MODE: "local_file", PIPELINE_REFERRAL_STORE_PATH: join(root, "referrals.json"),
    PIPELINE_ASSESSMENT_STORE_MODE: "local_file", PIPELINE_ASSESSMENT_STORE_PATH: join(root, "assessments.json"),
    PIPELINE_RESIDENT_LINK_STORE_MODE: "local_file", PIPELINE_RESIDENT_LINK_STORE_PATH: join(root, "links.json"),
    PIPELINE_EXTRACTION_BACKEND: "mock", PIPELINE_DEMO_MODE: "false" };
  const files = [1, 2, 3].map(id => ({ ...admitted, id, name: `Synthetic ${id}`, version: 1, createdAt: "2026-09-19T00:00:00Z", updatedAt: sent, priority: "standard", note: "", tags: [] }));
  const assessments = files.map(file => ({ ...createEmptyAssessmentToolData(), assessment_id: `board-${file.id}`, referral_id: file.id,
    assessor_id: user.id, assessor: user.name, status: "complete", version: 1, created_at: "2026-09-19T00:00:00Z", updated_at: sent,
    completed_at: sent, signed_at: sent, meet_client_sent_at: file.id === 1 ? sent : null,
    created_by: user, updated_by: user, provenance: [], unmapped_inputs: [], audit_trail: [], addenda: [], section_versions: {} }));
  try {
    await writeFile(environment.PIPELINE_REFERRAL_STORE_PATH, JSON.stringify({ version: 1, revision: 1, next_id: 4, referrals: files }));
    await writeFile(environment.PIPELINE_ASSESSMENT_STORE_PATH, JSON.stringify({ version: 1, revision: 1, assessments }));
    // New globals model a new process, not an in-memory optimistic board update.
    const globals = { globalThis: {}, process: Object.assign(Object.create(process), { env: environment }) };
    const operations = loadTypeScriptModule(process.cwd(), "lib/pipeline/operations-snapshot.ts", globals);
    const summary = await operations.getHomeWorkflowSummary(user);
    assert.deepEqual(Array.from(summary.board_items, item => item.referral_id).sort(), [2, 3]);
    assert.ok(summary.board_items.every(item => item.board.detail === "Email not sent"));
    const store = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-store.ts", globals);
    const workspaces = await store.listReferrals({ workspaceStatus: "all" });
    assert.deepEqual(Array.from(workspaces.referrals, item => item.id).sort(), [1, 2, 3]);
    const workflow = loadTypeScriptModule(process.cwd(), "lib/pipeline/workflow-store.ts", globals);
    assert.equal((await workflow.getReferralWorkflowSnapshot(1)).context.packetSentAt, new Date(sent).toISOString());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("PostgreSQL context projection selects persisted email evidence for each referral", async () => {
  const queries = [];
  const sql = async (parts) => {
    const query = parts.join("?");
    queries.push(query);
    if (query.includes("from pipeline.assessments")) {
      assert.match(query, /meet_client_sent_at/);
      return [{ referral_id: 1, assessment_id: "board-1", status: "complete", signed_at: new Date(sent), meet_client_sent_at: new Date(sent), data: {} }];
    }
    return [];
  };
  const environment = { ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: "postgres", PIPELINE_DATABASE_URL: "postgres://localhost/fixture", PIPELINE_REFERRAL_STORE_MODE: "postgres" };
  const workflow = loadTypeScriptModule(process.cwd(), "lib/pipeline/workflow-store.ts", {
    globalThis: { __pipelineSql: sql }, process: Object.assign(Object.create(process), { env: environment }),
  });
  const contexts = await workflow.getReferralWorkflowContexts([admitted, { ...admitted, id: 2 }]);
  assert.equal(contexts.get(1).packetSentAt, new Date(sent).toISOString());
  assert.equal(contexts.get(2).packetSentAt, null);
  assert.equal(board(admitted, contexts.get(1)).stage, null);
  assert.equal(board({ ...admitted, id: 2 }, contexts.get(2)).stage, "awaiting_admit");
  assert.ok(queries.every(query => /^\s*select\s/.test(query)), "the board is a read-only projection");
});
