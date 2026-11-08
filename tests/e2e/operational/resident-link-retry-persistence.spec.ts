import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { clinicalFixture } from "../support/pipeline-clinical-fixtures";
import { createOperationalReferral } from "../support/operational-api";
import { actorApiContext } from "../support/pipeline-actors";
import { restartableServer, eraseBindings } from "../support/restartable-operational-server";

async function body(response: Awaited<ReturnType<APIRequestContext["post"]>>, status: number) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
async function expectReplayConflict(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(await body(response, 409)).toEqual({ code: "mutation_replay_conflict", error: expect.any(String) });
}

test("resident retries bind principal, target and command through concurrency, restart and legacy recovery", async () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(90_000);
  const headers = { Authorization: "Bearer synthetic-clinical-test" };
  const clinical = createHttpServer((request, response) => {
    if (request.headers.authorization !== headers.Authorization) { response.writeHead(401).end(); return; }
    const payload = structuredClone(clinicalFixture.resident) as { resident: Record<string, unknown> };
    payload.resident.resident_key = decodeURIComponent((request.url ?? "").split("/").pop()!);
    payload.resident.date_of_birth = "1984-06-12";
    payload.resident.resident_number = "SYN-R-100";
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  });
  clinical.listen(0, "127.0.0.1");
  await once(clinical, "listening");
  const address = clinical.address();
  if (!address || typeof address === "string") throw new Error("Clinical fixture port unavailable");
  const server = await restartableServer({ PIPELINE_CLINICAL_DATA_MODE: "alamo_api", PIPELINE_ALAMO_AUTH_MODE: "delegated", PIPELINE_ALAMO_API_BASE_URL: `http://127.0.0.1:${address.port}` });
  const a = await actorApiContext("assessorA", server.url), b = await actorApiContext("assessorB", server.url);
  const admin = await actorApiContext("admin", server.url);
  const candidate = async (context: APIRequestContext, actor: "assessorA" | "assessorB", key = randomUUID()) => {
    const referral = await createOperationalReferral(context, actor, { dob: "1984-06-12" });
    return { pipeline_client_id: referral.clientId, referral_id: referral.id, display_name: referral.name,
      community_id: "337", resident_key: `337:${randomUUID()}`, resident_number: "SYN-R-100", match_method: "manual", client_mutation_id: key };
  };
  try {
    await server.start();
    await Promise.all([a.get("/api/members"), b.get("/api/members")]);
    const first = await candidate(a, "assessorA");
    const post = (data: typeof first, context = a) => context.post("/api/resident-links", { headers, data });
    const results = await Promise.all(Array.from({ length: 8 }, () => post(first).then(r => body(r, 201))));
    const link = results[0].link;
    expect(new Set(results.map(result => result.link.link_id)).size).toBe(1);
    // Approved users share referrals; command identity is still a separate retry invariant.
    expect((await b.get(`/api/resident-links/${link.link_id}`)).status()).toBe(200);
    await expectReplayConflict(await post(first, b));
    await expectReplayConflict(await post(await candidate(b, "assessorB", first.client_mutation_id), b));
    await expectReplayConflict(await post({ ...first, resident_key: `337:${randomUUID()}` }));
    await expectReplayConflict(await post(await candidate(a, "assessorA", first.client_mutation_id)));
    // Exercise real encrypted delegation cookies: same effective user with a
    // different initiating account, then the same initiator with a new target.
    const delegate = async (target: string) => {
      await body(await admin.post("/api/auth/assessor-session", { data: { target_principal_id: target, reason: "Synthetic replay verification" } }), 200);
      const user = (await body(await admin.get("/api/auth/me"), 200)).user;
      expect(user.id).toBe(target);
      expect(user.delegation.initiatedBy.id).toBe("ops-admin");
    };
    await delegate("assessor-a");
    await expectReplayConflict(await post(first, admin));
    const delegated = await candidate(a, "assessorA");
    const delegatedLink = (await body(await post(delegated, admin), 201)).link;
    expect(delegatedLink.created_by.id).toBe("assessor-a");
    await expectReplayConflict(await post(delegated));
    await delegate("assessor-b");
    await expectReplayConflict(await post(delegated, admin));
    await delegate("assessor-a");
    expect((await body(await post(delegated, admin), 201)).link.link_id).toBe(delegatedLink.link_id);
    await body(await admin.delete("/api/auth/assessor-session"), 200);
    const duplicate = { ...first, client_mutation_id: randomUUID() };
    expect((await body(await post(duplicate), 201)).link.link_id).toBe(link.link_id);
    await expectReplayConflict(await post({ ...duplicate, resident_key: `337:${randomUUID()}` }));
    const raceKey = randomUUID();
    const raceCommands = await Promise.all([candidate(a, "assessorA", raceKey), candidate(b, "assessorB", raceKey)]);
    const race = await Promise.all([post(raceCommands[0]), post(raceCommands[1], b)]);
    expect(race.map(response => response.status()).sort()).toEqual([201, 409]);
    for (const [index, command] of raceCommands.entries()) {
      const links = (await body(await a.get(`/api/resident-links?pipeline_client_id=${command.pipeline_client_id}`), 200)).links;
      expect(links).toHaveLength(race[index].status() === 201 ? 1 : 0);
    }
    // Mutable referral seeds are not a new user command on a transport retry.
    const current = (await body(await a.get(`/api/referrals/${first.referral_id}`), 200)).referral;
    await body(await a.patch(`/api/referrals/${first.referral_id}`, { data: { if_match: current.version, patch: { name: "Synthetic Renamed Client" } } }), 200);
    await server.stop(); await server.start();
    expect((await body(await post(first), 201)).link.link_id).toBe(link.link_id);
    expect((await body(await post(duplicate), 201)).link.link_id).toBe(link.link_id);
    await expectReplayConflict(await post(first, b));
    if (process.env.PIPELINE_DATABASE_MODE === "postgres") {
      const sql = postgres(process.env.PIPELINE_DATABASE_URL!, { ssl: false, max: 1 });
      try {
        const audit = await sql`select count(*)::int as count from pipeline.audit_events where entity_type='resident_link' and entity_id=${link.link_id}`;
        expect(audit[0].count).toBe(1);
      } finally { await sql.end(); }
    } else {
      expect((await body(await a.get(`/api/resident-links/${link.link_id}`), 200)).link.audit_events).toHaveLength(1);
    }
    for (const initial of ["candidate", "confirmed", "rejected"] as const) {
      for (const action of ["confirm", "reject"] as const) {
        let reviewed = (await body(await post(await candidate(a, "assessorA")), 201)).link;
        const url = `/api/resident-links/${reviewed.link_id}`;
        if (initial !== "candidate") {
          reviewed = (await body(await a.patch(url, { headers, data: { if_match: reviewed.version, action: initial === "confirmed" ? "confirm" : "reject", review_note: "Synthetic review" } }), 200)).link;
        }
        const data = { if_match: reviewed.version, action, review_note: "Synthetic review" };
        const same = initial === (action === "confirm" ? "confirmed" : "rejected");
        expect((await a.patch(url, { headers, data })).status()).toBe(initial === "candidate" || same ? 200 : 422);
        const final = (await body(await a.get(url), 200)).link;
        expect(final.version).toBe(reviewed.version + (initial === "candidate" ? 1 : 0));
        if (final.version > 1) expect((await a.patch(url, { headers, data: { ...data, if_match: final.version - 1 } })).status()).toBe(409);
      }
    }
    for (const collision of ["resident", "person"] as const) {
      const left = await candidate(a, "assessorA");
      const right = collision === "resident"
        ? { ...await candidate(a, "assessorA"), resident_key: left.resident_key }
        : { ...left, resident_key: `337:${randomUUID()}`, client_mutation_id: randomUUID() };
      const links = await Promise.all([left, right].map(command => post(command).then(r => body(r, 201)).then(result => result.link)));
      const reviewed = await Promise.all(links.map(link => a.patch(`/api/resident-links/${link.link_id}`, {
        headers, data: { if_match: 1, action: "confirm" },
      })));
      expect(reviewed.map(r => r.status()).sort()).toEqual([200, 422]);
      for (const [index, link] of links.entries()) {
        const current = (await body(await a.get(`/api/resident-links/${link.link_id}`), 200)).link;
        expect(current.version).toBe(reviewed[index].status() === 200 ? 2 : 1);
      }
    }
    // A duplicate candidate can point at a different (now trashed) referral.
    // Access to the incoming episode must not authorize that returned target.
    const oldEpisode = await candidate(a, "assessorA");
    await body(await post(oldEpisode), 201);
    const fresh = (await body(await a.post(`/api/referrals/${oldEpisode.referral_id}/new-intake`, { data: { client_mutation_id: randomUUID() } }), 201)).referral;
    const oldReferral = (await body(await a.get(`/api/referrals/${oldEpisode.referral_id}`), 200)).referral;
    await body(await a.delete(`/api/referrals/${oldEpisode.referral_id}`, { data: { if_match: oldReferral.version } }), 200);
    const deniedDuplicate = await post({ ...oldEpisode, referral_id: fresh.id, client_mutation_id: randomUUID() });
    expect((await body(deniedDuplicate, 404)).link).toBeUndefined();
    await server.stop();
    await eraseBindings(server.root, "resident-links.json", [first.client_mutation_id, duplicate.client_mutation_id]);
    await server.start();
    await expectReplayConflict(await post(first));
    await expectReplayConflict(await post(duplicate));
    // Legacy/imported candidates may lack a referral; list and detail access must agree.
    await server.stop();
    if (process.env.PIPELINE_DATABASE_MODE === "postgres") {
      const sql = postgres(process.env.PIPELINE_DATABASE_URL!, { ssl: false, max: 1 });
      try { await sql`update pipeline.resident_links set referral_id=null where resident_link_id=${link.link_id}`; }
      finally { await sql.end(); }
    } else {
      const filename = path.join(server.root, "resident-links.json");
      const stored = JSON.parse(await readFile(filename, "utf8"));
      const saved = stored.links.find((row: { link_id: string }) => row.link_id === link.link_id);
      saved.referral_id = null;
      await writeFile(filename, JSON.stringify(stored));
    }
    await server.start();
    expect.soft((await b.get(`/api/resident-links/${link.link_id}`)).status()).toBe(404);
    expect.soft((await b.patch(`/api/resident-links/${link.link_id}`, { data: { action: "reject", if_match: 1, review_note: "Unauthorized synthetic review" } })).status()).toBe(404);
  } finally {
    await server.stop();
    await Promise.all([a.dispose(), b.dispose(), admin.dispose(), rm(server.root, { recursive: true, force: true })]);
    await new Promise<void>(resolve => clinical.close(() => resolve()));
  }
});

