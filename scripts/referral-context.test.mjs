import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const { buildReferralContext } = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-context.ts");
const { createEmptyAssessmentToolData } = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const workflow = () => ({ referral: { id: 42, version: 7, workspaceStatus: "active", stage: "Assessment" },
  context: { assessmentId: "fictional-1" }, work_items: [{ id: "fictional-item", status: "requested", blocker: true }],
  recommendation: { outcome: "needs_more_information" }, decision: null, review: { status: "changes_requested" },
  reviews: [{ version: 1, status: "submitted" }], transitions: [], capabilities: { can_update: true } });
const assessment = () => ({ ...createEmptyAssessmentToolData(), assessment_id: "fictional-1", referral_id: 42,
  version: 3, field_provenance: {}, unmapped_fields: [], audit_events: [] });
test("referral context preserves requirements, decisions, review history and the complete linked assessment", () => {
  const source = workflow(), record = assessment();
  const result = buildReferralContext(source, record);
  assert.deepEqual(plain(result.workflow), source);
  assert.deepEqual(plain(result.assessment.record), plain(record));
  assert.equal(result.source.referralVersion, 7);
  assert.equal(result.coverage.consistency, "separate-source-reads-not-an-atomic-snapshot");
  assert.equal(result.authority.canExecute, false);
  assert(result.relatedSources.some(item => item.kind === "activity" && item.limit === 100));
  assert(result.relatedSources.some(item => item.kind === "notes"));
});
test("missing data and cross-referral links never become a complete or merged context", () => {
  assert.equal(buildReferralContext(workflow(), null).coverage.assessment, "linked-record-unavailable");
  const unlinked = workflow(); unlinked.context.assessmentId = null;
  assert.equal(buildReferralContext(unlinked, null).coverage.assessment, "not-linked");
  assert.throws(() => buildReferralContext(workflow(), { ...assessment(), referral_id: 99 }), /does not belong/);
  assert.throws(() => buildReferralContext(workflow(), { ...assessment(), assessment_id: "other" }), /does not belong/);
});
const compiled = ts.transpileModule(readFileSync("app/api/referrals/[referralId]/workflow/route.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function routeFixture({ signedIn = true, allowed = true, record = assessment() } = {}) {
  let reads = 0;
  const modules = {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => signedIn ? { ok: true, user: { id: "fictional" } } : { ok: false, response: new Response(null, { status: 401 }) } },
    "@/lib/assessment/assessment-access": { canWorkAssessment: () => true },
    "@/lib/assessment/assessment-store": { getAssessment: async () => record },
    "@/lib/extraction/contracts": { jsonError: (error, status = 400) => Response.json({ error }, { status }) },
    "@/lib/observability/api-logging": { withApiLogging: async (_req, _path, fn) => fn() },
    "@/lib/pipeline/referral-access": { requireReferralAccess: async () => allowed ? { ok: true, referral: workflow().referral } : { ok: false, response: new Response(null, { status: 403 }) }, canConfirmAdmission: () => false, canRecordAdmissionDecision: () => false },
    "@/lib/pipeline/report-access": { canAccessExecutiveAdmissionFlow: () => false },
    "@/lib/pipeline/referral-ownership": { canCancelPlacement: () => false, canModifyReferral: () => true },
    "@/lib/pipeline/referral-workflow": { getAllowedReferralTargets: () => [] },
    "@/lib/pipeline/referral-store": { requireReferralStore: () => ({ ok: true }) },
    "@/lib/pipeline/workflow-store": { getReferralWorkflowSnapshot: async () => { reads++; return workflow(); } },
    "@/lib/pipeline/referral-context": { buildReferralContext },
  };
  const exports = {};
  new Function("require", "exports", compiled)((specifier) => modules[specifier] ?? {}, exports);
  return { read: (query = "?representation=context") => exports.GET(new Request(`https://example.invalid/api/referrals/42/workflow${query}`), { params: Promise.resolve({ referralId: "42" }) }), reads: () => reads };
}
test("referral context retains source authorization, default response and no-store behavior", async () => {
  for (const options of [{ signedIn: false }, { allowed: false }]) {
    const f = routeFixture(options); assert.equal((await f.read()).status, options.signedIn === false ? 401 : 403); assert.equal(f.reads(), 0);
  }
  const f = routeFixture(), response = await f.read();
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await response.json()).kind, "pipeline.referral-context");
  assert.equal((await (await f.read("")).json()).referral.id, 42);
  assert.equal((await routeFixture({ record: { ...assessment(), referral_id: 99 } }).read()).status, 409);
  assert.equal((await routeFixture({ record: { ...assessment(), assessment_notes: "x".repeat(600_000) } }).read()).status, 413);
});
