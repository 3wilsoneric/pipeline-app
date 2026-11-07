import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const { buildAssessmentContext, assessmentContextDefinitions } = loadTypeScriptModule(root, "lib/assessment/assessment-context.ts");
const { createEmptyAssessmentToolData, assessmentToolFieldDefinitions } = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const { assessmentInterviewQuestions, isAssessmentQuestionVisible } = loadTypeScriptModule(root, "lib/assessment/assessment-interview-schema.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
function record() {
  return { ...createEmptyAssessmentToolData(), assessment_id: "fictional-1", referral_id: 42,
    canonical_client_id: null, resident_key: null, version: 3, created_at: "2026-11-05T00:00:00Z", updated_at: "2026-11-05T01:00:00Z",
    created_by: { id: "fictional", name: "Fictional assessor" }, updated_by: { id: "fictional", name: "Fictional assessor" },
    assessor_id: "fictional", status: "draft", completed_at: null, field_provenance: {}, unmapped_fields: [],
    audit_events: [], section_versions: {}, };
}
test("all fields and questions preserve values, conditional applicability and source pointers", () => {
  const source = record();
  source.active_substance_use = "no";
  source.medications_at_intake = "Retained fictional medication answer";
  source.prior_hospitalizations_count = 0;
  source.language_barrier = "unable_to_assess";
  source.unable_to_assess_reasons = { language_barrier: "Fictional interpreter unavailable" };
  source.field_provenance.language_barrier = [{ source_field_key: "language", source_file: "fictional.pdf", confidence: 0.7, review_status: "pending", source_page_no: 2, evidence_url: null }];
  const before = plain(source), result = buildAssessmentContext(source);
  assert.deepEqual(plain(source), before);
  assert.deepEqual(plain(result.record), before);
  assert.equal(result.fields.length, assessmentToolFieldDefinitions.length);
  assert.equal(result.coverage.questions, assessmentInterviewQuestions.length);
  for (const field of result.fields) {
    assert.deepEqual(plain(field.answer.value), plain(source[field.definition.key]));
    const question = assessmentInterviewQuestions.find((item) => item.field === field.definition.key);
    assert.equal(field.answer.visible, question ? isAssessmentQuestionVisible(question, source) : null);
    assert.equal(field.evidence.pointer, `/assessment/${field.definition.key}`);
    assert.equal(field.answer.askedAt, null);
  }
  assert.equal(result.fields.find((field) => field.definition.key === "prior_hospitalizations_count").answer.state, "recorded");
  assert.equal(result.fields.find((field) => field.definition.key === "language_barrier").answer.provenance[0].review_status, "pending");
  assert.equal(result.coverage.history, "partial");
  assert.equal(result.authority.canExecute, false);
});
test("definition identity is independent of case answers and includes options and branch conditions", () => {
  const first = record(), second = record(); second.assessment_notes = "Different fictional answer";
  assert.equal(buildAssessmentContext(first).definitionHash, buildAssessmentContext(second).definitionHash);
  const definitions = assessmentContextDefinitions();
  assert.equal(new Set(definitions.fields.map((field) => field.key)).size, assessmentToolFieldDefinitions.length);
  const followup = definitions.fields.find((field) => field.key === "language_barrier_details");
  assert.deepEqual(plain(followup.question.conditions), [{ field: "language_barrier", operator: "equals", value: "yes" }]);
  assert.deepEqual(plain(followup.question.requiredWhen), plain(followup.question.conditions[0]));
  assert(definitions.fields.some((field) => field.question?.options?.some((option) => option.value === "unable_to_assess")));
});
test("no/unknown/unable/empty/null/absent remain distinct; hidden stored answers survive", () => {
  for (const value of ["no", "unknown", "unable_to_assess", "", null, undefined]) {
    const source = record(); source.language_barrier = value;
    const field = buildAssessmentContext(source).fields.find((item) => item.definition.key === "language_barrier");
    assert.equal(field.answer.value, value ?? null);
    assert.equal(field.answer.state, value === undefined ? "absent" : value === null ? "null" : value === "" ? "empty" : "recorded");
  }
  const source = record(); source.language_barrier = "no"; source.language_barrier_details = "Retained fictional answer";
  const hidden = buildAssessmentContext(source).fields.find((field) => field.definition.key === "language_barrier_details");
  assert.equal(hidden.answer.value, "Retained fictional answer"); assert.equal(hidden.answer.visible, false);
});

const routeSource = ts.transpileModule(readFileSync("app/api/assessments/[assessmentId]/route.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function routeFixture({ signedIn = true, allowed = true, source = record() } = {}) {
  let reads = 0, checks = 0;
  const modules = {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => signedIn ? { ok: true, user: { id: "fictional" } } : { ok: false, response: new Response(null, { status: 401 }) } },
    "@/lib/assessment/assessment-store": { requireAssessmentStore: () => ({ ok: true }), getAssessment: async () => { reads++; return source; } },
    "@/lib/pipeline/referral-access": { requireReferralAccess: async (_user, id) => { checks++; assert.equal(id, 42); return allowed ? { ok: true } : { ok: false, response: new Response(null, { status: 403 }) }; } },
    "@/lib/assessment/assessment-context": { buildAssessmentContext },
    "@/lib/observability/api-logging": { withApiLogging: async (_request, _path, fn) => fn() },
    "@/lib/extraction/contracts": { jsonError: (error, status = 400) => Response.json({ error }, { status }) },
  };
  const exports = {};
  new Function("require", "exports", routeSource)((specifier) => modules[specifier] ?? {}, exports);
  return { read: (query = "?representation=context") => exports.GET(new Request(`https://example.invalid/api/assessments/fictional-1${query}`), { params: Promise.resolve({ assessmentId: "fictional-1" }) }), counts: () => ({ reads, checks }) };
}
test("context uses existing sign-in and referral authorization and never caches responses", async () => {
  const denied = routeFixture({ signedIn: false });
  assert.equal((await denied.read()).status, 401); assert.equal(denied.counts().reads, 0);
  const forbidden = routeFixture({ allowed: false });
  assert.equal((await forbidden.read()).status, 403); assert.equal(forbidden.counts().checks, 1);
  const f = routeFixture(), response = await f.read();
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal((await response.json()).kind, "pipeline.assessment-context");
  assert.equal((await (await f.read("")).json()).assessment.assessment_id, "fictional-1");
});
test("oversize evidence fails visibly without truncating or claiming complete coverage", async () => {
  const source = record(); source.assessment_notes = "x".repeat(600_000);
  const response = await routeFixture({ source }).read();
  assert.equal(response.status, 413); assert.match((await response.json()).error, /no evidence was truncated/);
});
