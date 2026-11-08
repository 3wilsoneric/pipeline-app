import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { actorApiContext } from "../support/pipeline-actors";
import { createOperationalReferral, createOperationalAssessment } from "../support/operational-api";
import { restartableServer, eraseBindings } from "../support/restartable-operational-server";

let a: APIRequestContext;
let b: APIRequestContext;
test.beforeEach(async ({ baseURL }) => {
  [a, b] = await Promise.all([actorApiContext("assessorA", baseURL!), actorApiContext("assessorB", baseURL!)]);
  await Promise.all([a.get("/api/members"), b.get("/api/members")]);
});
test.afterEach(async () => { await Promise.all([a.dispose(), b.dispose()]); });

async function conflict(response: Awaited<ReturnType<APIRequestContext["patch"]>>) {
  expect.soft(response.status(), await response.text()).toBe(409);
  expect.soft((await response.json()).code).toBe("mutation_replay_conflict");
}

test("assessment answer and lifecycle retries bind the requested action, version, target and principal", async () => {
  const referral = await createOperationalReferral(a, "assessorA");
  const assessment = await createOperationalAssessment(a, referral.id);
  const second = await createOperationalAssessment(a, referral.id);
  const url = `/api/assessments/${assessment.assessment_id}`;
  const command = { if_match: assessment.version, client_mutation_id: randomUUID(), patch: { data: { current_symptoms: "Synthetic saved answer" } } };
  const saved = await a.patch(url, { data: command });
  expect(saved.status(), await saved.text()).toBe(200);
  const record = (await saved.json()).assessment;
  expect((await a.patch(url, { data: command })).status()).toBe(200);
  await conflict(await a.patch(url, { data: { ...command, patch: { data: { current_symptoms: "Different answer" } } } }));
  await conflict(await b.patch(url, { data: command }));
  await conflict(await a.patch(`/api/assessments/${second.assessment_id}`, { data: command }));
  await conflict(await a.post(`${url}/start`, { data: { if_match: record.version, client_mutation_id: command.client_mutation_id } }));
  expect((await (await a.get(url)).json()).assessment).toEqual(record);
  expect((await (await a.get(`/api/assessments/${second.assessment_id}`)).json()).assessment.version).toBe(second.version);
});

test("assessment imports bind extraction evidence and remain exact retries when the server supplies the timestamp", async () => {
  const referral = await createOperationalReferral(a, "assessorA");
  const assessment = await createOperationalAssessment(a, referral.id);
  const command = { assessment_id: assessment.assessment_id, if_match: assessment.version, client_mutation_id: randomUUID(),
    fields: [{ field_key: "assessment.current_symptoms", proposed_value: "Synthetic evidence", confidence: 0.9, source_page_no: 1 }],
    context: { source_file: "synthetic.pdf" } };
  const url = `/api/referrals/${referral.id}/assessments/import`;
  const saved = await a.post(url, { data: command });
  expect(saved.status(), await saved.text()).toBe(200);
  const record = (await saved.json()).assessment;
  expect((await a.post(url, { data: command })).status()).toBe(200);
  await conflict(await a.post(url, { data: { ...command, fields: [{ ...command.fields[0], proposed_value: "Different evidence" }] } }));
  await conflict(await b.post(url, { data: command }));
  expect((await (await a.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment).toEqual(record);
});

test("assessment retries survive concurrency, restart and legacy receipts without repeating audit events", async () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(90_000);
  const server = await restartableServer();
  const actor = await actorApiContext("assessorA", server.url);
  const other = await actorApiContext("assessorB", server.url);
  try {
    await server.start();
    await Promise.all([actor.get("/api/members"), other.get("/api/members")]);
    const referral = await createOperationalReferral(actor, "assessorA");
    const createUrl = `/api/referrals/${referral.id}/assessments`;
    const create = { client_mutation_id: randomUUID(), data: { assessment_date: "2026-11-07", current_symptoms: "Synthetic symptoms" } };
    const responses = await Promise.all(Array.from({ length: 8 }, () => actor.post(createUrl, { data: create })));
    for (const response of responses) expect(response.status(), await response.text()).toBe(201);
    const records = await Promise.all(responses.map(async response => (await response.json()).assessment));
    expect(new Set(records.map(record => record.assessment_id)).size).toBe(1);
    let record = records[0];
    const url = `/api/assessments/${record.assessment_id}`;
    const commands: { url: string; method: string; data: Record<string, unknown>; status: number }[] = [
      { url: createUrl, method: "POST", data: create, status: 201 },
    ];
    const save = async (endpoint: string, method: string, data: Record<string, unknown>) => {
      const response = await actor.fetch(endpoint, { method, data });
      expect(response.status(), await response.text()).toBe(200);
      record = (await response.json()).assessment;
      commands.push({ url: endpoint, method, data, status: 200 });
    };
    await save(url, "PATCH", { if_match: record.version, client_mutation_id: randomUUID(), patch: { data: { assessment_notes: "Saved preparation" } } });
    await save(`${createUrl}/import`, "POST", { assessment_id: record.assessment_id, if_match: record.version, client_mutation_id: randomUUID(),
      fields: [{ field_key: "assessment.current_symptoms", proposed_value: "Synthetic imported evidence", confidence: 0.9 }], context: { source_file: "synthetic.pdf" } });
    await save(`${url}/schedule`, "POST", { if_match: record.version, client_mutation_id: randomUUID(),
      schedule: { status: "scheduled", start_at: "2027-11-07T18:00:00Z", duration_minutes: 60, method: "record_review" } });
    await save(`${url}/start`, "POST", { if_match: record.version, client_mutation_id: randomUUID() });
    await save(`${url}/sign`, "POST", { if_match: record.version, client_mutation_id: randomUUID() });
    expect((await actor.post(`${url}/start`, { data: { if_match: record.version, client_mutation_id: randomUUID() } })).status()).toBe(422);
    await server.stop(); await server.start();
    for (const command of commands) {
      const response = await actor.fetch(command.url, { method: command.method, data: command.data });
      expect(response.status(), await response.text()).toBe(command.status);
      expect((await response.json()).assessment).toEqual(record);
      await conflict(await other.fetch(command.url, { method: command.method, data: command.data }));
    }
    expect((await (await actor.get(url)).json()).assessment).toEqual(record);
    await server.stop();
    await eraseBindings(server.root, "assessments.json", commands.map(command => String(command.data.client_mutation_id)));
    await server.start();
    for (const command of commands) await conflict(await actor.fetch(command.url, { method: command.method, data: command.data }));
    expect((await (await actor.get(url)).json()).assessment).toEqual(record);
  } finally {
    await server.stop();
    await Promise.all([actor.dispose(), other.dispose(), rm(server.root, { recursive: true, force: true })]);
  }
});
