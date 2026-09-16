import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

export async function packetContentUploadResults() {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-packet-content-"));
  const name = "identical file content permits independent referrals and edits while Save retries stay idempotent";
  try {
    const store = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-store.ts", {
      process: Object.assign(Object.create(process), { env: {
        ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: "disconnected",
        PIPELINE_DATABASE_URL: "", PIPELINE_REFERRAL_STORE_MODE: "local_file",
        PIPELINE_REFERRAL_STORE_PATH: join(directory, "referrals.json"),
        PIPELINE_DEMO_MODE: "false", NEXT_PUBLIC_PIPELINE_PERSONA_DEMO: "false",
      } }),
    });
    const actor = { id: "packet-content-fixture", name: "Fixture Assessor" };
    const documentHash = "a".repeat(64);
    const input = (clientName, hash = documentHash) => ({
      name: clientName, date: "9/16/2026", stage: "New", community: "Turlock",
      county: "Stanislaus County", source: "Fixture", priority: "standard",
      tags: [], owner: actor.name, note: "", createdAt: "2026-09-16T00:00:00Z",
      dob: "1/1/1980", phone: "", email: "", payer: "", documentHash: hash,
    });
    const first = await store.createReferral(input("Content Fixture Alpha"), "content-first", actor);
    const second = await store.createReferral(input("Content Fixture Beta"), "content-second", actor);
    assert.notEqual(first.referral.id, second.referral.id);
    assert.equal(second.referral.documentHash, documentHash);
    const replay = await store.createReferral(input("Content Fixture Beta"), "content-second", actor);
    assert.equal(replay.referral.id, second.referral.id);
    assert.equal(replay.idempotentReplay, true);
    const third = await store.createReferral(input("Content Fixture Gamma", "b".repeat(64)), "content-third", actor);
    const patched = await store.patchReferral(third.referral.id, { documentHash }, third.referral.version, actor);
    assert.equal(patched.ok, true);
    assert.equal(patched.referral.documentHash, documentHash);
    await store.softDeleteReferral(first.referral.id, actor, first.referral.version);
    const restarted = await store.createReferral(input("Content Fixture Alpha"), "content-restarted", actor);
    assert.notEqual(restarted.referral.id, first.referral.id);
    return [{ name, ok: true }];
  } catch (error) {
    return [{ name, ok: false, error: String(error.message ?? error) }];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
