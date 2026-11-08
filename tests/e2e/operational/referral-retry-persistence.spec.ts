import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { restartableServer, eraseBindings } from "../support/restartable-operational-server";
import { actorApiContext, pipelineActors, syntheticReferralInput } from "../support/pipeline-actors";
import { createOperationalReferral } from "../support/operational-api";

async function body(response: Awaited<ReturnType<APIRequestContext["post"]>>, status: number) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function conflict(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(await body(response, 409)).toEqual({ code: "mutation_replay_conflict", error: expect.any(String) });
}

test("intake creation and private draft resolution survive concurrent retry, restart, trash and legacy receipts", async () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(90_000);
  const server = await restartableServer();
  const a = await actorApiContext("assessmentCoordinator", server.url);
  const b = await actorApiContext("assessorB", server.url);
  const outsider = await actorApiContext("outsider", server.url);
  try {
    await server.start();
    const lists = (await body(await a.get("/api/community-recipient-lists"), 200)).lists;
    expect(lists).toHaveLength(5);
    expect(lists.every((list: { to: unknown[]; cc: unknown[] }) => list.to.length === 0 && list.cc.length === 0)).toBe(true);
    const draft = `new-${randomUUID()}`;
    const command = { draft_key: draft, client_mutation_id: `referral-create:${draft}`, referral: syntheticReferralInput("assessmentCoordinator") };
    const responses = await Promise.all(Array.from({ length: 8 }, () => a.post("/api/referrals", { data: command })));
    const results = await Promise.all(responses.map(response => body(response, 201)));
    expect(results.filter(result => !result.idempotent_replay)).toHaveLength(1);
    expect(new Set(results.map(result => result.referral.id)).size).toBe(1);
    const saved = results[0].referral;
    const resolve = `/api/referrals?draft_key=${draft}`;
    const resolved = await a.get(resolve);
    expect((await body(resolved, 200)).referral).toEqual(saved);
    expect(resolved.headers()["cache-control"]).toContain("private, no-store");
    expect(resolved.headers().vary).toContain("Authorization");
    expect((await b.get(`/api/referrals/${saved.id}`)).status()).toBe(200);
    expect(await body(await b.get(resolve), 200)).toEqual({ referral: null });
    expect((await outsider.get(resolve)).status()).toBe(403);
    expect((await a.get("/api/referrals?draft_key=not-a-draft")).status()).toBe(400);
    await conflict(await b.post("/api/referrals", { data: command }));
    await server.stop(); await server.start();
    // The first referral operation after restart is a POST, not a preload.
    const replay = await body(await a.post("/api/referrals", { data: command }), 201);
    expect(replay).toMatchObject({ idempotent_replay: true, referral: saved });
    await conflict(await a.post("/api/referrals", { data: { ...command, referral: { ...command.referral, note: "A different command" } } }));
    expect((await body(await a.get(resolve), 200)).referral).toEqual(saved);
    const events = (await body(await a.get(`/api/referrals/${saved.id}/activity`), 200)).events;
    expect(events.filter((event: { action: string }) => event.action === "referral_created")).toHaveLength(1);
    const deleted = (await body(await a.delete(`/api/referrals/${saved.id}`, { data: { if_match: saved.version } }), 200)).referral;
    await server.stop(); await server.start();
    await conflict(await a.post("/api/referrals", { data: command }));
    expect(await body(await a.get(resolve), 200)).toEqual({ referral: null });
    const restored = (await body(await a.post(`/api/trash/referrals/${saved.id}/restore`, { data: { if_match: deleted.version } }), 200)).referral;
    expect((await body(await a.post("/api/referrals", { data: command }), 201)).referral).toEqual(restored);
    await server.stop();
    await eraseBindings(server.root, "referrals.json", [command.client_mutation_id]);
    await server.start();
    await conflict(await a.post("/api/referrals", { data: command }));
    expect((await body(await a.get(resolve), 200)).referral).toEqual(restored);
    expect((await body(await a.get(`/api/referrals/${saved.id}/activity`), 200)).events.filter((event: { action: string }) => event.action === "referral_created")).toHaveLength(1);
  } finally {
    await server.stop();
    await Promise.all([a.dispose(), b.dispose(), outsider.dispose(), rm(server.root, { recursive: true, force: true })]);
  }
});

test("chart intake retries bind the original selection across changing chart seeds and server restart", async () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(90_000);
  const server = await restartableServer();
  const a = await actorApiContext("assessmentCoordinator", server.url);
  const assessor = await actorApiContext("assessorA", server.url);
  try {
    await server.start();
    expect((await assessor.get("/api/members")).status()).toBe(200);
    const source = await createOperationalReferral(a);
    const url = `/api/referrals/${source.id}/new-intake`;
    const command = { client_mutation_id: randomUUID() };
    const responses = await Promise.all(Array.from({ length: 8 }, () => a.post(url, { data: command })));
    const results = await Promise.all(responses.map(response => body(response, 201)));
    expect(results.filter(result => !result.idempotent_replay)).toHaveLength(1);
    expect(new Set(results.map(result => result.referral.id)).size).toBe(1);
    const created = results[0].referral;
    expect(created.id).not.toBe(source.id);
    expect(created.clientId).toBe(source.clientId);
    const changedSource = (await body(await a.patch(`/api/referrals/${source.id}`, { data: {
      if_match: source.version, patch: { phone: "5105550137" },
    } }), 200)).referral;
    await server.stop(); await server.start();
    expect(await body(await a.post(url, { data: command }), 201)).toMatchObject({ idempotent_replay: true, referral: created });
    expect((await assessor.get("/api/members")).status()).toBe(200);
    await conflict(await a.post(url, { data: { ...command, assignee_id: pipelineActors.assessorA.id } }));
    expect((await body(await a.get(`/api/referrals/${source.id}`), 200)).referral).toEqual(changedSource);
    expect((await body(await a.get(`/api/referrals/${created.id}/activity`), 200)).events.filter((event: { action: string }) => event.action === "referral_created")).toHaveLength(1);
    expect((await body(await a.get(`/api/referrals?q=${encodeURIComponent(created.name)}`), 200)).referrals.filter((referral: { clientId: string }) => referral.clientId === source.clientId)).toHaveLength(2);
  } finally {
    await server.stop();
    await Promise.all([a.dispose(), assessor.dispose(), rm(server.root, { recursive: true, force: true })]);
  }
});
