#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const directory = await mkdtemp(join(tmpdir(), "pipeline-owner-access-"));
const vince = { id: "vince-fixture", name: "Vince Ceja", email: "vince@aaahealthservices.com", roles: ["reviewer", "viewer"] };
const sandeep = { id: "sandeep-fixture", name: "Sandeep", email: "sandeep@aaahealthservices.com", roles: ["assessment_coordinator", "reviewer", "viewer"] };
const andrew = { ...sandeep, id: "andrew-fixture", email: "andrew@aaahealthservices.com" };
const administrator = { id: "admin-fixture", name: "Admin", email: "admin@pipeline.local", roles: ["admin"] };
const outsider = { id: "outsider-fixture", name: "Outsider", email: "outsider@pipeline.local", roles: [] };
const noteLabUser = { ...vince, id: "note-lab-fixture", accessScope: "note_lab" };
const referrals = [
  fixtureReferral(1, vince),
  fixtureReferral(2, sandeep),
  fixtureReferral(3, andrew),
  { ...fixtureReferral(4, vince), workspaceStatus: "historical" },
];
const environment = {
  ...process.env,
  NODE_ENV: "test",
  PIPELINE_DATABASE_MODE: "local_file",
  PIPELINE_DATABASE_URL: "",
  PIPELINE_REFERRAL_STORE_MODE: "local_file",
  PIPELINE_REFERRAL_STORE_PATH: join(directory, "referrals.json"),
  PIPELINE_ASSESSMENT_STORE_MODE: "local_file",
  PIPELINE_ASSESSMENT_STORE_PATH: join(directory, "assessments.json"),
  PIPELINE_RESIDENT_LINK_STORE_MODE: "local_file",
  PIPELINE_RESIDENT_LINK_STORE_PATH: join(directory, "resident-links.json"),
  PIPELINE_EXTRACTION_BACKEND: "mock",
  PIPELINE_DEMO_MODE: "false",
};

try {
  await writeFile(environment.PIPELINE_REFERRAL_STORE_PATH, JSON.stringify({ version: 1, revision: 1, next_id: 5, referrals }));
  const globals = { process: Object.assign(Object.create(process), { env: environment }) };
  const access = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-access.ts", globals);
  assert.equal((await access.requireMutableReferralAccess(vince, 1)).ok, true);
  assert.equal((await access.requireMutableReferralAccess(vince, 2)).ok, true);
  assert.equal((await access.requireMutableReferralAccess(sandeep, 1)).ok, true);
  assert.equal((await access.requireMutableReferralAccess(andrew, 1)).ok, true);
  assert.equal((await access.requireMutableReferralAccess(administrator, 1)).ok, true);
  assert.equal((await access.requireMutablePacketAccess(sandeep, "owner-fixture-1", "files")).ok, true);
  assert.equal((await access.requireMutablePacketAccess(vince, "owner-fixture-1", "files")).ok, true);
  assert.equal((await access.requireMutableReferralAccess(outsider, 1)).response.status, 404);
  assert.equal((await access.requireMutablePacketAccess(outsider, "owner-fixture-1", "files")).response.status, 404);
  assert.equal((await access.requireMutableReferralAccess(noteLabUser, 1)).response.status, 404);
  assert.equal((await access.requireMutableReferralAccess(vince, 4)).response.status, 422);
  assert.equal((await access.requireMutablePacketAccess(vince, "owner-fixture-4", "files")).response.status, 422);

  const operations = loadTypeScriptModule(process.cwd(), "lib/pipeline/operations-snapshot.ts", globals);
  await expectBoard(operations, vince, [1]);
  await expectBoard(operations, andrew, [3]);
  await expectBoard(operations, sandeep, [2]);
  await expectBoard(operations, administrator, []);
  console.log(JSON.stringify({ ok: true, checks: "approved shared referral/packet editing, outsider and historical guards, personal board scoping" }));
} finally {
  await rm(directory, { recursive: true, force: true });
}

function fixtureReferral(id, owner) {
  return {
    id, name: `Owner Fixture ${id}`, owner: owner.name, ownerId: owner.id, owners: [],
    stage: "Intake", workflowStatus: "ready_to_schedule", workspaceStatus: "active", workspaceOrigin: "pipeline",
    community: "Turlock", county: "Stanislaus County", priority: "normal", note: "", tags: [], requirements: [],
    packetId: `owner-fixture-${id}`, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", version: 1,
  };
}

async function expectBoard(operations, user, expectedIds) {
  const summary = await operations.getHomeWorkflowSummary(user);
  const ids = Array.from(summary.board_items, (item) => item.referral_id).sort((a, b) => a - b);
  assert.deepEqual(ids, expectedIds, `${user.name} board must contain only owned referrals`);
  assert.equal(summary.active_total, expectedIds.length, "Board counts must follow the same scoping");
  const allIds = Array.from(summary.all_board_items, (item) => item.referral_id).sort((a, b) => a - b);
  assert.deepEqual(allIds, [1, 2, 3], "Approved users may find all active workspaces outside their personal board");
}
