import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { actorApiContext, syntheticReferralInput } from "../support/pipeline-actors";
import { createOperationalReferral } from "../support/operational-api";

let assessor: APIRequestContext;
let otherAssessor: APIRequestContext;
let coordinator: APIRequestContext;

test.beforeEach(async ({ baseURL }) => {
  [assessor, otherAssessor, coordinator] = await Promise.all([
    actorApiContext("assessorA", baseURL!), actorApiContext("assessorB", baseURL!),
    actorApiContext("assessmentCoordinator", baseURL!),
  ]);
  await Promise.all([assessor.get("/api/members"), otherAssessor.get("/api/members")]);
});
test.afterEach(async () => {
  await Promise.all([assessor?.dispose(), otherAssessor?.dispose(), coordinator?.dispose()]);
});

test("a referral retry cannot acknowledge a changed command or reuse another actor's request", async () => {
  const command = { client_mutation_id: randomUUID(), referral: syntheticReferralInput("assessorA") };
  const created = await assessor.post("/api/referrals", { data: command });
  expect(created.status(), await created.text()).toBe(201);
  const { referral } = await created.json();
  // Approved Pipeline users share workspace access (3a53a0d5). Ownership is
  // accountability, not a read boundary; retries must still identify a command.
  expect((await otherAssessor.get(`/api/referrals/${referral.id}`)).status()).toBe(200);
  expect((await assessor.post("/api/referrals", { data: command })).status()).toBe(201);
  const changed = await assessor.post("/api/referrals", { data: { ...command, referral: { ...command.referral, name: "Different synthetic client" } } });
  expect.soft(changed.status(), await changed.text()).toBe(409);
  const foreign = await otherAssessor.post("/api/referrals", { data: { ...command, referral: syntheticReferralInput("assessorB") } });
  expect.soft(foreign.status(), await foreign.text()).toBe(409);
  expect.soft((await foreign.json()).referral).toBeUndefined();
  expect((await (await assessor.get(`/api/referrals/${referral.id}`)).json()).referral).toEqual(referral);
});

test("an assessment creation retry remains bound to its actor, referral and answers", async () => {
  const first = await createOperationalReferral(assessor, "assessorA");
  const second = await createOperationalReferral(otherAssessor, "assessorB");
  const command = { client_mutation_id: randomUUID(), data: { current_symptoms: "Synthetic first assessment" } };
  const path = `/api/referrals/${first.id}/assessments`;
  const created = await assessor.post(path, { data: command });
  expect(created.status(), await created.text()).toBe(201);
  const { assessment } = await created.json();
  expect((await otherAssessor.get(`/api/assessments/${assessment.assessment_id}`)).status()).toBe(200);
  expect((await assessor.post(path, { data: command })).status()).toBe(201);
  const changed = await assessor.post(path, { data: { ...command, data: { current_symptoms: "Different synthetic answer" } } });
  expect.soft(changed.status(), await changed.text()).toBe(409);
  const foreign = await otherAssessor.post(`/api/referrals/${second.id}/assessments`, { data: command });
  expect.soft(foreign.status(), await foreign.text()).toBe(409);
  expect.soft((await foreign.json()).assessment).toBeUndefined();
  expect((await (await assessor.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment).toEqual(assessment);
});

test("a contact retry cannot report success for different contact details", async () => {
  const referral = await createOperationalReferral(coordinator);
  const command = { referral_id: referral.id, client_mutation_id: randomUUID(), contact: {
    firstName: "Synthetic", lastName: randomUUID(), phone: "5550100",
  } };
  const created = await coordinator.post("/api/contacts", { data: command });
  expect(created.status(), await created.text()).toBe(201);
  const { record } = await created.json();
  const replayed = await coordinator.post("/api/contacts", { data: command });
  expect(replayed.status(), await replayed.text()).toBe(200);
  expect((await replayed.json()).record).toEqual(record);
  const changed = await coordinator.post("/api/contacts", { data: { ...command, contact: { ...command.contact, firstName: "Changed" } } });
  expect(changed.status(), await changed.text()).toBe(409);
});
