import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { expect, request, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { actorApiContext, operationalHeadersForActor, pipelineActors, syntheticReferralInput } from "../support/pipeline-actors";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { eraseBindings, restartableServer } from "../support/restartable-operational-server";

async function body(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
async function conflict(response: APIResponse) {
  expect(await body(response, 409)).toMatchObject({ code: "mutation_replay_conflict" });
}
const operations = ["patch", "delete", "restore", "manual-intake", "admission-flow", "transition", "work-item", "recommendation", "decision", "reopen", "placement-cancellation", "ehr-handoff"] as const;
type Operation = typeof operations[number];
// These allowlisted identities exist only in the isolated, trusted-header test server.
async function executive(url: string, index: number) {
  return request.newContext({ baseURL: url, extraHTTPHeaders: operationalHeadersForActor({
    ...pipelineActors.assessmentCoordinator,
    id: ["f73371d5-d2b4-48b4-a32b-1edc7c88869f", "e9f39185-d751-45c0-bcf5-c24d3565bdd9"][index],
    email: `synthetic-executive-${index}@pipeline.local`, name: `Synthetic Executive ${index}`,
  }, url) });
}
async function commandFor(api: APIRequestContext, operation: Operation, key = randomUUID()) {
  let referral = await createOperationalReferral(api);
  let assessmentId: string | undefined, decisionId: string | undefined;
  if (operation === "restore") {
    referral = (await body(await api.delete(`/api/referrals/${referral.id}`, { data: { if_match: referral.version, client_mutation_id: randomUUID() } }))).referral;
  }
  if (operation === "recommendation") {
    const assessment = await createOperationalAssessment(api, referral.id);
    assessmentId = assessment.assessment_id;
    referral = (await body(await api.get(`/api/referrals/${referral.id}`))).referral;
  }
  if (["reopen", "placement-cancellation", "ehr-handoff"].includes(operation)) {
    const saved = await body(await api.put(`/api/referrals/${referral.id}/decision`, { data: {
      if_match: referral.version, if_match_section: referral.sectionVersions.decision,
      outcome: operation === "reopen" ? "declined" : "accepted", reason_note: "Synthetic setup", client_mutation_id: randomUUID(),
    } }));
    referral = saved.referral; decisionId = saved.decision.decisionId;
  }
  const item = operation === "work-item" ? (await body(await api.get(`/api/referrals/${referral.id}`))).referral.requirements[0] : undefined;
  const data = {
    client_mutation_id: key, if_match: item?.version ?? referral.version,
    ...(operation === "patch" ? { patch: { note: "Synthetic retry binding" } } : {}),
    ...(operation === "manual-intake" ? { if_match_section: referral.sectionVersions.documents, reason: "Synthetic manual intake" } : {}),
    ...(operation === "admission-flow" ? { if_match_section: referral.sectionVersions.workflow, action: "start_hold", reason: "source_records", responsible_party: "pipeline" } : {}),
    ...(operation === "transition" ? { if_match_section: referral.sectionVersions.workflow, target_stage: "Packet Needed" } : {}),
    ...(operation === "work-item" ? { patch: { status: "requested", nextStep: "Synthetic follow-up" } } : {}),
    ...(operation === "recommendation" ? { if_match_section: referral.sectionVersions.decision, assessment_id: assessmentId, outcome: "accept", reason_note: "Synthetic recommendation" } : {}),
    ...(operation === "decision" ? { if_match_section: referral.sectionVersions.decision, outcome: "declined", reason_note: "Synthetic decision" } : {}),
    ...(operation === "reopen" ? { if_match_section: referral.sectionVersions.decision, action: "reopen", decision_id: decisionId } : {}),
    ...(operation === "placement-cancellation" ? { if_match_section: referral.sectionVersions.workflow, reason: "Synthetic cancellation" } : {}),
    ...(operation === "ehr-handoff" ? { if_match_section: referral.sectionVersions.decision, action: "queue" } : {}),
  };
  const url = operation === "restore" ? `/api/trash/referrals/${referral.id}/restore`
    : `/api/referrals/${referral.id}` + (["patch", "delete"].includes(operation) ? "" : operation === "work-item" ? `/work-items/${item.id}` : operation === "reopen" ? "/decision" : `/${operation}`);
  const method = ["patch", "work-item"].includes(operation) ? "PATCH" : operation === "delete" ? "DELETE"
    : ["admission-flow", "recommendation", "decision", "placement-cancellation"].includes(operation) ? "PUT" : "POST";
  return { referral, url, method, data, send: (context = api, command: object = data, target = url) => context.fetch(target, { method, data: command }) };
}

for (const operation of operations) {
  test(`${operation} binds account, command, version and target without repeating writes`, async ({ baseURL }) => {
    test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
    const a = operation === "admission-flow" ? await executive(baseURL!, 0) : await actorApiContext("assessmentCoordinator", baseURL!);
    const b = operation === "admission-flow" ? await executive(baseURL!, 1) : await actorApiContext("sandeep", baseURL!);
    try {
      const first = await commandFor(a, operation), second = await commandFor(a, operation, first.data.client_mutation_id);
      const initial = await Promise.all(Array.from({ length: 6 }, () => first.send()));
      const saved = (await body(initial[0])).referral;
      for (const response of initial.slice(1)) expect((await body(response)).referral).toEqual(saved);
      expect(saved.version).toBe(first.referral.version + 1);
      const auditBefore = operation === "delete" ? null : await body(await a.get(`/api/referrals/${first.referral.id}/activity`));
      const retries = await Promise.all(Array.from({ length: 4 }, () => first.send()));
      for (const response of retries) expect((await body(response)).referral).toEqual(saved);
      await conflict(await first.send(b));
      await conflict(await first.send(a, { ...first.data, if_match: first.data.if_match + 1 }));
      await conflict(await second.send());
      if (first.data.patch) await conflict(await first.send(a, { ...first.data, patch: operation === "patch" ? { note: "Different command" } : { nextStep: "Different command" } }));
      if (auditBefore) expect(await body(await a.get(`/api/referrals/${first.referral.id}/activity`))).toEqual(auditBefore);
      expect((await body(await first.send())).referral).toEqual(saved);
    } finally { await a.dispose(); await b.dispose(); }
  });
}

for (const operation of operations) {
  test(`${operation} serializes one key shared by different targets`, async ({ baseURL }) => {
    test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
    const api = operation === "admission-flow" ? await executive(baseURL!, 0) : await actorApiContext("assessmentCoordinator", baseURL!);
    try {
      const first = await commandFor(api, operation), second = await commandFor(api, operation, first.data.client_mutation_id);
      const results = await Promise.all([first.send(), second.send()]);
      expect(results.map(result => result.status()).sort()).toEqual([200, 409]);
      await conflict(results.find(result => result.status() === 409)!);
      const winner = results[0].status() === 200 ? first : second;
      expect((await body(await winner.send())).referral.version).toBe(winner.referral.version + 1);
    } finally { await api.dispose(); }
  });
}

test("delegated retries bind initiating and effective accounts for edits and decisions", async ({ baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  const a = await actorApiContext("assessmentCoordinator", baseURL!), b = await actorApiContext("assessorB", baseURL!), admin = await actorApiContext("admin", baseURL!);
  try {
    await a.get("/api/members"); await b.get("/api/members");
    const delegate = async (target: string) => {
      await body(await admin.post("/api/auth/assessor-session", { data: { target_principal_id: target, reason: "Synthetic workflow retry verification" } }));
      const user = (await body(await admin.get("/api/auth/me"))).user;
      expect(user.id).toBe(target); expect(user.delegation.initiatedBy.id).toBe("ops-admin");
    };
    for (const operation of ["patch", "decision"] as const) {
      const direct = await commandFor(a, operation), delegated = await commandFor(a, operation);
      await body(await direct.send());
      await delegate("admissions-coordinator");
      await conflict(await direct.send(admin));
      const saved = (await body(await delegated.send(admin))).referral;
      await conflict(await delegated.send(a));
      await delegate("assessor-b");
      await conflict(await delegated.send(admin));
      await delegate("admissions-coordinator");
      expect((await body(await delegated.send(admin))).referral).toEqual(saved);
      await body(await admin.delete("/api/auth/assessor-session"));
    }
  } finally { await a.dispose(); await b.dispose(); await admin.dispose(); }
});

test("work-item targets and create/patch namespaces cannot share another command's receipt", async ({ baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  const api = await actorApiContext("assessmentCoordinator", baseURL!);
  try {
    const key = randomUUID();
    const create = { referral: syntheticReferralInput(), client_mutation_id: `referral_patch:${key}` };
    const created = (await body(await api.post("/api/referrals", { data: create }), 201)).referral;
    const patch = { if_match: created.version, client_mutation_id: key, patch: { note: "Synthetic independent scope" } };
    await body(await api.patch(`/api/referrals/${created.id}`, { data: patch }));
    expect((await body(await api.post("/api/referrals", { data: create }), 201)).referral.note).toBe("Synthetic independent scope");
    // Distinct targets under one referral must be part of the original command.
    const command = await commandFor(api, "work-item");
    const items = (await body(await api.get(`/api/referrals/${command.referral.id}`))).referral.requirements;
    await body(await command.send());
    await conflict(await command.send(api, command.data, `/api/referrals/${command.referral.id}/work-items/${items[1].id}`));
    const current = (await body(await api.get(`/api/referrals/${command.referral.id}`))).referral;
    expect(current.requirements.find((item: { id: string }) => item.id === items[1].id)).toEqual(items[1]);
  } finally { await api.dispose(); }
});

test("referral and workflow receipts survive restart, reject legacy bindings and keep later lifecycle changes", async () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(90_000);
  const server = await restartableServer();
  const api = await actorApiContext("assessmentCoordinator", server.url);
  try {
    await server.start();
    const commands = [];
    for (const operation of operations.filter(item => item !== "admission-flow")) {
      const command = await commandFor(api, operation);
      const saved = (await body(await command.send())).referral;
      commands.push({ command, saved });
    }
    await server.stop(); await server.start();
    for (const { command, saved } of commands) expect((await body(await command.send())).referral).toEqual(saved);
    const trashed = commands.find(item => item.command.method === "DELETE")!;
    const restored = (await body(await api.post(`/api/trash/referrals/${trashed.saved.id}/restore`, { data: {
      if_match: trashed.saved.version, client_mutation_id: randomUUID(),
    } }))).referral;
    expect((await body(await trashed.command.send())).referral).toEqual(restored);
    await server.stop();
    await eraseBindings(server.root, "referrals.json", commands.map(item => item.command.data.client_mutation_id));
    await server.start();
    for (const { command } of commands) await conflict(await command.send());
  } finally { await server.stop(); await api.dispose(); await rm(server.root, { recursive: true, force: true }); }
});


for (const kind of ["historical-admission", "assessment-review"] as const) {
  test(`${kind} preserves legacy records through concurrent retry, delegation and restart`, async () => {
    test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
    test.setTimeout(90_000);
    const server = await restartableServer();
    const a = await actorApiContext("assessmentCoordinator", server.url), b = await actorApiContext("sandeep", server.url), admin = await actorApiContext("admin", server.url);
    try {
      await server.start();
      let referral = await createOperationalReferral(a);
      const other = await createOperationalReferral(a);
      const reviewId = randomUUID();
      let assessmentId = "", recommendationId = "", assessmentVersion = 1;
      if (kind === "assessment-review") {
        const assessment = await createOperationalAssessment(a, referral.id);
        assessmentId = assessment.assessment_id; assessmentVersion = assessment.version;
        referral = (await body(await a.get(`/api/referrals/${referral.id}`))).referral;
        const saved = await body(await a.put(`/api/referrals/${referral.id}/recommendation`, { data: {
          if_match: referral.version, if_match_section: referral.sectionVersions.decision, assessment_id: assessmentId,
          outcome: "accept", client_mutation_id: randomUUID(), reason_note: "Preserved synthetic legacy recommendation",
        } }));
        referral = saved.referral; recommendationId = saved.recommendation.recommendationId;
      }
      await server.stop();
      // Seed only the isolated fixture's pre-upgrade historical/submitted state.
      // New recommendations no longer create review records in the product.
      const now = new Date().toISOString();
      const review = { reviewId, assessmentId, assessmentVersion, recommendationId, recommendationVersion: 1,
        submissionNumber: 1, status: "submitted", notificationStatus: "pending", submittedBy: "admissions-coordinator",
        submittedByName: "Admissions Coordinator", submittedAt: now, dueAt: now, version: 1, updatedAt: now };
      if (process.env.PIPELINE_DATABASE_MODE === "postgres") {
        const database = new URL(process.env.PIPELINE_DATABASE_URL!);
        expect(["127.0.0.1", "localhost"]).toContain(database.hostname);
        expect(database.pathname).toMatch(/^\/pipeline_(?:state_machine_|ci$)/);
        const sql = postgres(database.toString(), { ssl: false, max: 1 });
        try {
          await sql.begin(async tx => {
            if (kind === "historical-admission") {
              await tx`update pipeline.referrals set workspace_origin='import', workspace_status='historical', source_workspace_id=${`synthetic-${randomUUID()}`} where referral_id=${referral.id}`;
            } else {
              await tx`update pipeline.assessments set status='complete', completed_at=${now}, signed_at=${now}, signed_by='admissions-coordinator' where assessment_id=${assessmentId}`;
              await tx`insert into pipeline.assessment_reviews (review_id, referral_id, assessment_id, assessment_version, recommendation_id,
                recommendation_version, submission_number, status, submitted_by, submitted_by_name, due_at)
                values (${reviewId}::uuid, ${referral.id}, ${assessmentId}, ${assessmentVersion}, ${recommendationId}::uuid,
                1, 1, 'submitted', 'admissions-coordinator', 'Admissions Coordinator', ${now})`;
              await tx`update pipeline.referrals set data=data || ${tx.json({ assessmentReview: review, assessmentReviewHistory: [review] })}::jsonb where referral_id=${referral.id}`;
            }
          });
        } finally { await sql.end(); }
      } else {
        const file = path.join(server.root, "referrals.json"), stored = JSON.parse(await readFile(file, "utf8"));
        const item = stored.referrals.find((item: { id: number }) => item.id === referral.id);
        Object.assign(item, kind === "historical-admission" ? { workspaceOrigin: "import", workspaceStatus: "historical", sourceWorkspaceId: `synthetic-${randomUUID()}` }
          : { assessmentReview: review, assessmentReviewHistory: [review] });
        await writeFile(file, JSON.stringify(stored));
        if (kind === "assessment-review") {
          const file = path.join(server.root, "assessments.json"), stored = JSON.parse(await readFile(file, "utf8"));
          Object.assign(stored.assessments.find((item: { assessment_id: string }) => item.assessment_id === assessmentId), { status: "complete", signed_at: now, signed_by: "admissions-coordinator", completed_at: now });
          await writeFile(file, JSON.stringify(stored));
        }
      }
      await server.start();
      const data = { if_match: referral.version, client_mutation_id: randomUUID(), ...(kind === "historical-admission"
        ? { confirmed: true, admissionDate: "2025-02-03", community: "Turlock" }
        : { action: "request_changes", review_id: reviewId, if_match_review: 1, if_match_section: referral.sectionVersions.decision, reason_note: "Synthetic correction request" }) };
      const send = (api = a, command: object = data, id = referral.id) => api.post(`/api/referrals/${id}/${kind}`, { data: command });
      const results = await Promise.all(Array.from({ length: 6 }, () => send()));
      const saved = (await body(results[0])).referral;
      for (const response of results.slice(1)) expect((await body(response)).referral).toEqual(saved);
      expect(saved.version).toBe(referral.version + 1);
      await conflict(await send(b));
      await conflict(await send(a, { ...data, if_match: data.if_match + 1 }));
      await conflict(await send(a, { ...data, ...(kind === "historical-admission" ? { admissionDate: "2025-02-04" } : { reason_note: "Changed request" }) }));
      await a.get("/api/members");
      await body(await admin.post("/api/auth/assessor-session", { data: { target_principal_id: "admissions-coordinator", reason: "Synthetic legacy replay verification" } }));
      await conflict(await send(admin));
      await body(await admin.delete("/api/auth/assessor-session"));
      if (kind === "assessment-review") {
        await conflict(await send(a, data, other.id));
        const assessments = (await body(await a.get(`/api/referrals/${referral.id}/assessments`))).assessments;
        expect(assessments).toHaveLength(2);
        expect(assessments.filter((item: { supersedes_assessment_id: string }) => item.supersedes_assessment_id === assessmentId)).toHaveLength(1);
      }
      const events = await body(await a.get(`/api/referrals/${referral.id}/activity`));
      await server.stop(); await server.start();
      expect((await body(await send())).referral).toEqual(saved);
      expect(await body(await a.get(`/api/referrals/${referral.id}/activity`))).toEqual(events);
      await server.stop(); await eraseBindings(server.root, "referrals.json", [data.client_mutation_id]); await server.start();
      await conflict(await send());
    } finally { await server.stop(); await a.dispose(); await b.dispose(); await admin.dispose(); await rm(server.root, { recursive: true, force: true }); }
  });
}
