import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const load = (file) => loadTypeScriptModule(root, file);
const { buildChartIntake } = load("lib/pipeline/chart-intake.ts");
const context = load("lib/pipeline/client-chart-context.ts");
const fixture = JSON.parse(readFileSync("scripts/fixtures/alamo-pipeline-clinical.sanitized.json", "utf8"));
const presentation = load("lib/pipeline/client-profile-presentation.ts");
const medicalChart = load("lib/pipeline/client-medical-chart.ts");
const internalIdentity = { resident_number: "SYN-INTERNAL-71", resident_numbers: ["SYN-INTERNAL-71"], date_of_birth: "1984-06-12" };
const displayedSections = presentation.buildClientProfileSections(internalIdentity);
assert(!JSON.stringify(displayedSections).includes("SYN-INTERNAL-71"));
assert(displayedSections.flatMap((section) => section.facts).some((fact) => fact.label === "Date of birth"));
const displayedChart = medicalChart.buildClientMedicalChart({ name: "Synthetic Person", gender: null, community: "San Pablo" }, internalIdentity, displayedSections, []);
assert(!JSON.stringify(displayedChart).includes("Resident number"));
assert(!JSON.stringify(displayedChart).includes("SYN-INTERNAL-71"));
assert.equal(internalIdentity.resident_number, "SYN-INTERNAL-71", "presentation must preserve internal identity data");
const source = {
  id: 71, clientId: "known-person", name: "Source Person", stage: "Accepted / Admitted", community: "San Pablo",
  workspaceOrigin: "allo", workspaceStatus: "historical",
  date: "2025-01-01", createdAt: "2025-01-01T00:00:00Z", dob: "1980-01-01", gender: "Female", phone: "555-0101",
  email: "source@example.invalid", ssn: "fixture-only", owner: "Old assessor", ownerId: "old-assessor",
  admissionDate: "2025-01-03", county: "Alameda County", payer: "Source payer", source: "Old referrer",
  note: "Old episode only", interview: "Old interview only", currentMedications: "Old medication",
  responsiblePerson: "Recorded responsible person", documentName: "old.pdf", documentHash: "a".repeat(64),
  documentStatus: "Reviewed", packetId: "old-packet", requirements: [{ status: "reviewed" }],
  admissionDecision: { outcome: "accepted" }, assessment: { completedAt: "2025-01-02" }, conserved: "no",
};
const profile = {
  ...fixture.client, profile_origin: "alamo_platform", resident: null,
  client: { ...fixture.client.client, display_name: "Current Person", gender: "Female", enrichment: {
    date_of_birth: "1984-06-12", active_medications: ["Recorded medicine A", "Recorded medicine B"],
  } },
  pipeline: { referrals: [source], documents: [], assessments: [], connection: { status: "confirmed" } },
};
const before = JSON.stringify({ source, profile });
const createdAt = "2026-09-13T10:00:00Z";
const seed = buildChartIntake(profile, source, createdAt);
assert.equal(seed.name, "Current Person");
assert.equal(seed.dob, "1984-06-12");
assert.equal(seed.phone, "555-0101");
assert.equal(seed.responsiblePerson, "Recorded responsible person");
assert.equal(seed.currentMedications, "Recorded medicine A; Recorded medicine B");
assert.equal(seed.clientId, "known-person");
assert.equal(seed.stage, "New");
assert.equal(seed.owner, "Unassigned");
assert.equal(seed.date, "2026-09-13");
assert.equal(seed.admissionDate, "");
assert.equal(seed.documentName, "");
assert.equal(seed.documentStatus, "Missing");
assert.equal(seed.source, "");
assert.equal(seed.note, "");
assert.equal(seed.requirements.length, 0);
for (const key of ["packetId", "packetFields", "documentHash", "assessment", "admissionDecision", "manualIntakeAuthorization", "interview", "ownerId", "assignedAt", "assessmentReview", "ehrHandoff"]) assert.equal(seed[key], undefined, key);
assert.match(seed.fieldSources.currentMedications, /workspace #71.*verify/);
assert.equal(JSON.stringify({ source, profile }), before, "deriving a chart/intake must not mutate source material");
assert.equal(context.clientChartRecord(profile).date_of_birth, "1984-06-12");
const incompleteCensus = { ...profile, resident: { date_of_birth: null, payor: null, primary_diagnosis: null },
  client: { ...profile.client, enrichment: { ...profile.client.enrichment, primary_diagnosis: "Recorded diagnosis" } } };
const combinedRecord = context.clientChartRecord(incompleteCensus);
assert.equal(combinedRecord.date_of_birth, "1984-06-12");
assert.equal(combinedRecord.primary_diagnosis, "Recorded diagnosis");
assert.equal(combinedRecord.payor, "Source payer");
assert.equal(combinedRecord.gender, "Female");
assert(context.clientReferralSections(profile)[0].facts.some((fact) => fact.value === "Old episode only"));
assert.equal(load("lib/pipeline/referral-validation.ts").validateReferralCreateInput(seed).ok, true);

const intakeCanvas = readFileSync("components/pipeline/ReferralPacketCanvas.tsx", "utf8");
const visibleFields = intakeCanvas.match(/const visibleChartFieldKeys[^=]*=\s*\[([\s\S]*?)\];/);
assert(visibleFields, "intake declares its visible progress fields");
assert.doesNotMatch(visibleFields[1], /"summary"/, "hidden summary is not counted as intake work");
assert.doesNotMatch(intakeCanvas, /<ChartSection title="Referral summary"|<StructuredNarrativeField/, "intake does not render the removed summary editor");
const persistence = load("lib/pipeline/referral-canvas-persistence.ts");
const intakeFields = Object.fromEntries(persistence.persistedCanvasFieldKeys.map(key => [key, { value: persistence.referralCanvasValue(source, key) }]));
assert.equal(intakeFields.summary.value, source.note, "saved summary remains available to charts and recovery");
const contactPatch = persistence.buildReferralCanvasPatch({ keys: new Set(["phone"]), fields: intakeFields, conserved: "no", tags: [], requirements: [] });
assert.equal(Object.hasOwn(contactPatch, "note"), false, "editing intake does not clear the stored summary");

let user = { id: "assessor-a", name: "Assessor A", roles: ["reviewer"] };
let authenticated = true;
let originAllowed = true;
let accessAllowed = true;
let profileReads = 0;
const writes = [];
const require = createRequire(import.meta.url);
const stubs = {
  "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles = ["admin", "assessment_coordinator", "reviewer", "viewer"]) => !authenticated
    ? { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) }
    : user.roles.some((role) => roles.includes(role))
      ? { ok: true, user } : { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) } },
  "@/lib/auth/assessor-session-policy": { pipelineAuditActor: (value) => ({ id: value.id, name: value.name }) },
  "@/lib/auth/request-security": { requireSameOriginMutation: () => originAllowed ? null : Response.json({}, { status: 403 }) },
  "@/lib/extraction/contracts": { readJsonBody: async (request) => ({ ok: true, value: await request.json() }), jsonError: (error, status = 400) => Response.json({ error }, { status }) },
  "@/lib/observability/api-logging": { withApiLogging: (_request, _route, run) => run() },
  "@/lib/pipeline/referral-access": { requireReferralAccess: async () => accessAllowed ? { ok: true, referral: source } : { ok: false, response: Response.json({}, { status: 404 }) },
    assignedOwnerForCreate: (actor, owner) => actor.roles.includes("reviewer") && !actor.roles.includes("admin") ? { owner: actor.name, ownerId: actor.id } : { owner },
    isAssessorUser: (actor) => actor.roles.includes("reviewer") && !actor.roles.includes("admin") },
  "@/lib/pipeline/referral-store": { requireReferralStore: () => ({ ok: true }), createReferral: async (...args) => { writes.push(args); return { referral: { ...args[0], id: 72 }, idempotentReplay: false }; } },
  "@/lib/pipeline/unified-profile": { getUnifiedClientProfile: async (_request, id) => { assert.equal(id, "pipeline:known-person"); profileReads++; return profile; } },
  "@/lib/pipeline/chart-intake": { buildChartIntake },
  "@/lib/pipeline/referral-ownership": { createReferralOwners: () => [] },
  "@/lib/pipeline/workflow-records": { createDefaultAdmissionRequirements: () => [] },
  "@/lib/pipeline/referral-validation": load("lib/pipeline/referral-validation.ts"),
  "@/lib/pipeline/workspace-members": { touchWorkspaceMember: async () => undefined },
};
const filename = "app/api/referrals/[referralId]/new-intake/route.ts";
const routeModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: routeModule, exports: routeModule.exports, require: (id) => stubs[id] ?? require(id), Request, Response, Date, Number, Object, JSON });
const requestBody = { client_mutation_id: "65f07840-d28a-478d-a892-0b73591a0f99", clientId: "different-person", referral: { name: "Injected", stage: "Accepted / Admitted" } };
const post = (body = requestBody, id = "71") => routeModule.exports.POST(new Request("https://pipeline.invalid/api/referrals/71/new-intake", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ referralId: id }) });
authenticated = false;
assert.equal((await post()).status, 401);
authenticated = true;
for (const roles of [["unknown"], []]) {
  user = { ...user, roles };
  assert.equal((await post()).status, 403);
}
assert.equal(profileReads, 0);
assert.equal(writes.length, 0);
user = { ...user, roles: ["reviewer"] };
accessAllowed = false;
assert.equal((await post()).status, 404);
assert.equal(profileReads, 0);
accessAllowed = true;
originAllowed = false;
assert.equal((await post()).status, 403);
originAllowed = true;
assert.equal((await post({})).status, 400);
assert.equal((await post(requestBody, "71oops")).status, 400);
assert.equal(writes.length, 0);
assert.equal((await post()).status, 201);
assert.equal(writes[0][0].clientId, "known-person");
assert.equal(writes[0][0].name, "Current Person");
assert.equal(writes[0][0].ownerId, "assessor-a");
assert.equal(writes[0][0].chartSource.referralId, 71);
assert.equal(writes[0][3].newEpisodeSourceReferralId, 71);
const assessorKey = writes[0][1];
user = { id: "admin", name: "Admin", roles: ["admin"] };
assert.equal((await post()).status, 201);
assert.equal(writes[1][0].owner, "Unassigned");
assert.notEqual(writes[1][1], assessorKey, "idempotency must be actor-bound");
user = { id: "viewer", name: "Pipeline Staff", roles: ["viewer"] };
assert.equal((await post()).status, 201, "existing all-staff policy permits a new intake");
source.workspaceOrigin = "allo";
source.workspaceStatus = "historical";
assert.equal((await post({ client_mutation_id: "21d72f7d-ab88-4e78-ac7a-63d111638f0a" })).status, 201,
  "a historical ALLO workspace can seed a new intake without becoming mutable");
assert.equal(writes.at(-1)[0].workspaceOrigin, "pipeline");
assert.equal(writes.at(-1)[0].workspaceStatus, "active");
assert.equal(source.workspaceStatus, "historical");
for (const [workspaceOrigin, mutationId] of [["import", "5f072d56-b806-4b49-8637-98674c2fe008"], ["pipeline", "4b864258-4a40-4bf3-88a9-2e939efc2ef7"]]) {
  source.workspaceOrigin = workspaceOrigin;
  assert.equal((await post({ client_mutation_id: mutationId })).status, 201,
    `${workspaceOrigin} workspaces can seed a new intake`);
}
profile.pipeline.connection.status = "unavailable";
assert.equal((await post()).status, 503);
assert.equal(writes.length, 6);
console.log("Chart/intake contracts passed: field mapping, source preservation, clean episode, protected provenance, role/access/origin checks, actor-bound retry keys, client-id injection and incomplete-chart refusal.");
