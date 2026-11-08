import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { restartableServer, eraseBindings } from "../support/restartable-operational-server";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { actorApiContext } from "../support/pipeline-actors";
import { createOperationalReferral } from "../support/operational-api";

async function body(response: Awaited<ReturnType<APIRequestContext["post"]>>, status: number) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function expectReplayConflict(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(await body(response, 409)).toEqual({ code: "mutation_replay_conflict", error: expect.any(String) });
}


test("all five contact namespaces retain bound retries without duplicate updates or deleted-link resurrection", async () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(90_000);
  const server = await restartableServer();
  const a = await actorApiContext("assessmentCoordinator", server.url), b = await actorApiContext("admin", server.url);
  try {
    await server.start();
    const referral = await createOperationalReferral(a);
    const create = { referral_id: referral.id, client_mutation_id: randomUUID(), contact: { firstName: "Synthetic", lastName: randomUUID(), phone: "5105550100" } };
    const responses = await Promise.all(Array.from({ length: 8 }, () => a.post("/api/contacts", { data: create })));
    expect(responses.map(response => response.status()).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    const created = await Promise.all(responses.map(response => response.json()));
    const contact = created[0].record;
    expect(new Set(created.map(result => result.record.id)).size).toBe(1);
    const linksUrl = `/api/referrals/${referral.id}/contacts`;
    const attach = { contact_id: contact.id, role: "family", relationship: "Synthetic", notes: "", client_mutation_id: randomUUID() };
    const link = (await body(await a.post(linksUrl, { data: attach }), 201)).record;
    const duplicate = { ...attach, client_mutation_id: randomUUID() };
    expect((await body(await a.post(linksUrl, { data: duplicate }), 200)).record.id).toBe(link.id);
    await expectReplayConflict(await a.post(linksUrl, { data: { ...duplicate, notes: "Different command" } }));
    const update = { referral_id: referral.id, if_match: contact.version, client_mutation_id: randomUUID(), contact: { notes: "Persisted details" } };
    const savedContact = (await body(await a.patch(`/api/contacts/${contact.id}`, { data: update }), 200)).record;
    const updateLink = { if_match: link.version, client_mutation_id: randomUUID(), notes: "Persisted relationship", primary_for_scheduling: true };
    const savedLink = (await body(await a.patch(`${linksUrl}/${link.id}`, { data: updateLink }), 200)).record;
    const commands = [
      { url: "/api/contacts", method: "POST", data: create, changed: { ...create, contact: { ...create.contact, firstName: "Changed" } }, status: 200 },
      { url: linksUrl, method: "POST", data: attach, changed: { ...attach, notes: "Changed" }, status: 200 },
      { url: `/api/contacts/${contact.id}`, method: "PATCH", data: update, changed: { ...update, contact: { notes: "Changed" } }, status: 200 },
      { url: `${linksUrl}/${link.id}`, method: "PATCH", data: updateLink, changed: { ...updateLink, notes: "Changed" }, status: 200 },
    ];
    await server.stop(); await server.start();
    // POST is deliberately the first contact operation after restart: no GET may preload the local store.
    for (const command of commands) {
      expect((await body(await a.fetch(command.url, { method: command.method, data: command.data }), command.status)).idempotentReplay).toBe(true);
      await expectReplayConflict(await a.fetch(command.url, { method: command.method, data: command.changed }));
      await expectReplayConflict(await b.fetch(command.url, { method: command.method, data: command.data }));
    }
    const listed = (await body(await a.get(linksUrl), 200)).contacts;
    expect(listed).toHaveLength(1);
    expect(listed[0].version).toBe(savedLink.version);
    expect(listed[0].contact.version).toBe(savedContact.version);
    expect(listed[0].primaryForScheduling).toBe(true);
    expect((await a.patch(`/api/contacts/${contact.id}`, { data: { ...update, client_mutation_id: randomUUID() } })).status()).toBe(409);
    expect((await a.patch(`${linksUrl}/${link.id}`, { data: { ...updateLink, client_mutation_id: randomUUID() } })).status()).toBe(409);
    const unlink = { if_match: savedLink.version, client_mutation_id: randomUUID() };
    expect((await body(await a.delete(`${linksUrl}/${link.id}`, { data: unlink }), 200)).idempotentReplay).toBe(false);
    await server.stop(); await server.start();
    expect((await body(await a.delete(`${linksUrl}/${link.id}`, { data: unlink }), 200)).idempotentReplay).toBe(true);
    await expectReplayConflict(await a.delete(`${linksUrl}/${link.id}`, { data: { ...unlink, if_match: unlink.if_match + 1 } }));
    await expectReplayConflict(await b.delete(`${linksUrl}/${link.id}`, { data: unlink }));
    await expectReplayConflict(await a.post(linksUrl, { data: attach }));
    expect((await body(await a.get(linksUrl), 200)).contacts).toHaveLength(0);
    await server.stop();
    await eraseBindings(server.root, "contacts.json", [create.client_mutation_id, unlink.client_mutation_id]);
    await server.start();
    await expectReplayConflict(await a.post("/api/contacts", { data: create }));
    await expectReplayConflict(await a.delete(`${linksUrl}/${link.id}`, { data: unlink }));
  } finally {
    await server.stop();
    await Promise.all([a.dispose(), b.dispose(), rm(server.root, { recursive: true, force: true })]);
  }
});

