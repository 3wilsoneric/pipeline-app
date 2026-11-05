import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actorApiContext, actorPage } from "../support/pipeline-actors";
import { createOperationalReferral, createOperationalAssessment, startOperationalAssessment, completeOperationalAssessment, signOperationalAssessment } from "../support/operational-api";

async function deniedFixture(api: APIRequestContext) {
  const referral = await createOperationalReferral(api, "assessorA", { name: `Example Reopen ${randomUUID()}` });
  let assessment = await createOperationalAssessment(api, referral.id);
  assessment = await startOperationalAssessment(api, assessment);
  assessment = await completeOperationalAssessment(api, assessment);
  assessment = await signOperationalAssessment(api, assessment);
  const before = (await (await api.get(`/api/referrals/${referral.id}`)).json()).referral;
  const response = await api.put(`/api/referrals/${referral.id}/decision`, { data: {
    if_match: before.version, if_match_section: before.sectionVersions.decision,
    client_mutation_id: `denial-${referral.id}`,
    outcome: "declined", reason_note: "Original denial remains in the record.",
  } });
  expect(response.status(), await response.text()).toBe(200);
  return { ...await response.json(), assessment };
}

function reopenBody(saved: Awaited<ReturnType<typeof deniedFixture>>) {
  return { action: "reopen", decision_id: saved.decision.decisionId, if_match: saved.referral.version,
    if_match_section: saved.referral.sectionVersions.decision, client_mutation_id: randomUUID() };
}

test("denial reopening preserves the signed record, enforces access/conflicts, and safely replays", async ({ baseURL }) => {
  const api = await actorApiContext("assessorA", baseURL!);
  const outsider = await actorApiContext("outsider", baseURL!);
  try {
    const saved = await deniedFixture(api);
    const url = `/api/referrals/${saved.referral.id}/decision`;
    const body = reopenBody(saved);
    const assessmentBefore = (await (await api.get(`/api/assessments/${saved.assessment.assessment_id}`)).json()).assessment;
    expect((await outsider.post(url, { data: body })).status()).toBe(403);
    expect((await api.post(url, { headers: { Origin: "https://untrusted.invalid" }, data: body })).status()).toBe(403);
    expect((await api.post(url, { data: { ...body, if_match_section: body.if_match_section - 1 } })).status()).toBe(409);
    expect((await api.patch(`/api/referrals/${saved.referral.id}`, { data: { if_match: saved.referral.version, patch: { admissionDecisionHistory: [] } } })).status()).toBe(400);
    const otherBody = { ...body, client_mutation_id: randomUUID() };
    const attempts = await Promise.all([api.post(url, { data: body }), api.post(url, { data: otherBody })]);
    expect(attempts.map((response) => response.status()).sort()).toEqual([200, 409]);
    const winner = await attempts.find((response) => response.ok())!.json();
    expect(winner.decision).toBeNull();
    expect(winner.referral).toMatchObject({ stage: "Community Review", workflowStatus: "decision_pending", admissionDecisionHistory: [saved.decision] });
    for (const field of ["name", "requirements", "additionalDocuments", "dob", "note", "community", "assessmentRecommendation", "assessmentReview"]) {
      expect(winner.referral[field]).toEqual(saved.referral[field]);
    }
    expect((await (await api.get(`/api/assessments/${saved.assessment.assessment_id}`)).json()).assessment).toEqual(assessmentBefore);
    expect((await (await api.get(url)).json()).decision).toBeNull();
    expect((await api.put(url, { data: { if_match: winner.referral.version, if_match_section: winner.referral.sectionVersions.decision, outcome: "declined", client_mutation_id: `denial-${saved.referral.id}` } })).status()).toBe(409);
    const accepted = await api.put(url, { data: { if_match: winner.referral.version, if_match_section: winner.referral.sectionVersions.decision, outcome: "accepted", reason_note: "New information supports admission." } });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const replacement = await accepted.json();
    expect(replacement.referral.admissionDecisionHistory).toEqual([saved.decision]);
    expect(replacement.decision.outcome).toBe("accepted");
    const winningRequest = attempts[0].ok() ? body : otherBody;
    // A successful request ID may be replayed even after a replacement decision.
    if (winningRequest) {
      const replay = await api.post(url, { data: winningRequest });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).decision.decisionId).toBe(replacement.decision.decisionId);
    }
    expect((await api.post(url, { data: { ...reopenBody(replacement), decision_id: replacement.decision.decisionId } })).status()).toBe(422);
    const activity = await (await api.get(`/api/referrals/${saved.referral.id}/activity`)).json();
    expect(activity.events.filter((event: { action: string }) => event.action === "admission_decision_reopened")).toHaveLength(1);
    expect(activity.events.some((event: { entity_id: string }) => event.entity_id === saved.decision.decisionId)).toBe(true);
  } finally { await Promise.all([api.dispose(), outsider.dispose()]); }
});

test("reopen button returns to an editable decision and history survives reload", async ({ browser, baseURL }) => {
  const { context, page } = await actorPage(browser, "assessorA", baseURL!);
  try {
    const saved = await deniedFixture(context.request);
    await page.goto(`/?view=referrals&screen=packet&referralId=${saved.referral.id}&workspaceView=workflow`);
    await page.getByRole("button", { name: "Reopen decision", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Reopen decision?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Reopen decision", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reopen decision", exact: true }).click();
    await dialog.getByRole("button", { name: "Reopen decision", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Accept", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("radio", { name: "Accept", exact: true })).toBeEnabled();
    await page.getByText("Previous decisions", { exact: true }).click();
    await expect(page.getByText("Original denial remains in the record.", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await context.close(); }
});

test("a failed PostgreSQL audit rolls back the entire reopen and remains retryable", async ({ baseURL }) => {
  test.skip(process.env.PIPELINE_REOPEN_POSTGRES !== "true", "Dedicated disposable PostgreSQL fixture only");
  const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL!);
  expect(url.hostname).toBe("127.0.0.1");
  const postgres = (await import("postgres")).default;
  const sql = postgres(url.toString(), { ssl: false, max: 1, prepare: false });
  const api = await actorApiContext("assessorA", baseURL!);
  try {
    const saved = await deniedFixture(api);
    const body = reopenBody(saved);
    const revisions = await sql`select store_name, revision from pipeline.store_revisions order by store_name`;
    await sql.unsafe(`create function pipeline.reject_reopen_fixture() returns trigger language plpgsql as $$ begin if NEW.action = 'admission_decision_reopened' then raise exception 'synthetic audit failure'; end if; return NEW; end $$;
      create trigger reject_reopen_fixture before insert on pipeline.audit_events for each row execute function pipeline.reject_reopen_fixture();`);
    try {
      expect((await api.post(`/api/referrals/${saved.referral.id}/decision`, { data: body })).status()).toBe(500);
      expect((await (await api.get(`/api/referrals/${saved.referral.id}`)).json()).referral).toEqual(saved.referral);
      expect((await (await api.get(`/api/referrals/${saved.referral.id}/decision`)).json()).decision).toEqual(saved.decision);
      expect(Array.from(await sql`select store_name, revision from pipeline.store_revisions order by store_name`)).toEqual(Array.from(revisions));
      expect(await sql`select entity_id from pipeline.idempotency_keys where scope = 'admission_decision_reopen' and mutation_id = ${body.client_mutation_id}`).toHaveLength(0);
    } finally {
      await sql.unsafe("drop trigger reject_reopen_fixture on pipeline.audit_events; drop function pipeline.reject_reopen_fixture();");
    }
    expect((await api.post(`/api/referrals/${saved.referral.id}/decision`, { data: body })).status()).toBe(200);
  } finally { await api.dispose(); await sql.end({ timeout: 5 }); }
});
