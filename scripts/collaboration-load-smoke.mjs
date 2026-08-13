#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

const configuredBaseUrl = process.env.PIPELINE_COLLABORATION_BASE_URL?.trim();
if (!configuredBaseUrl) fail("Configure PIPELINE_COLLABORATION_BASE_URL before running the collaboration load check.");
const baseUrl = new URL(configuredBaseUrl);
if (baseUrl.hostname === "127.0.0.1") baseUrl.hostname = "localhost";
if (!["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname) && !process.argv.includes("--allow-remote")) {
  fail("Remote collaboration checks require --allow-remote.");
}
const userCount = 10;
const users = Array.from({ length: userCount }, (_, index) => ({
  email: `pipeline-load-user-${index + 1}@example.invalid`,
  name: `Pipeline Load User ${index + 1}`,
}));
const timings = [];

const healthResponse = await request(0, "/api/health");
const health = await healthResponse.json().catch(() => ({}));
const databaseMode = health.checks?.database?.mode ?? "unknown";
const workspaceStateReady = health.checks?.desktop_workspace_state?.ready === true;
if (process.env.PIPELINE_COLLABORATION_REQUIRE_POSTGRES === "true" && databaseMode !== "postgres") {
  fail("The collaboration load check requires a PostgreSQL-backed Pipeline server.");
}
if (process.env.PIPELINE_COLLABORATION_REQUIRE_DESKTOP_STATE === "true" && !workspaceStateReady) {
  fail("The collaboration load check requires PostgreSQL-backed desktop workspace state.");
}

const now = new Date();
const createdResponse = await request(0, "/api/referrals", {
  method: "POST",
  body: {
    client_mutation_id: `collaboration-load-${randomUUID()}`,
    referral: {
      name: "Collaboration Load Record",
      date: now.toISOString().slice(0, 10),
      stage: "New",
      community: "San Pablo",
      source: "Load validation",
      priority: "standard",
      tags: ["collaboration-load"],
      documentName: "",
      documentStatus: "Missing",
      owner: users[0].name,
      note: "Initial",
      createdAt: now.toISOString(),
      dob: "",
      phone: "",
      email: "",
      payer: "",
      requirements: [],
    },
  },
});
expectStatus(createdResponse, 201, "create synthetic collaboration referral");
const created = await createdResponse.json();
const referral = created.referral;
if (!referral?.id || !referral.sectionVersions) fail("The collaboration referral did not return section versions.");

const leases = users.map(() => randomUUID());
const sections = ["identity", "intake", "documents", "assessment", "workflow", "decision"];
const heartbeatResponses = await Promise.all(users.map((_, index) => request(index, `/api/referrals/${referral.id}/presence`, {
  method: "POST",
  body: { lease_id: leases[index], section: sections[index % sections.length] },
})));
assertStatuses(heartbeatResponses, [200], "presence heartbeats");
const presenceResponse = await request(0, `/api/referrals/${referral.id}/presence`);
expectStatus(presenceResponse, 200, "presence list");
const presence = await presenceResponse.json();
if (presence.presence?.length !== userCount || new Set(presence.presence.map((item) => item.actor_id)).size !== userCount) {
  fail("The server did not preserve ten distinct authenticated editing leases. Run it in header auth mode with the load users allowlisted.");
}

const initialPolls = await Promise.all(users.map((_, index) => timedRequest("poll", index, `/api/referrals/${referral.id}/changes?after=${referral.version}`)));
assertStatuses(initialPolls, [200], "initial change polling");

const [identitySave, intakeSave] = await Promise.all([
  timedRequest("disjoint_save", 0, `/api/referrals/${referral.id}`, {
    method: "PATCH",
    body: {
      if_match: referral.version,
      if_match_sections: { identity: referral.sectionVersions.identity },
      patch: { name: "Collaboration Load Record A" },
    },
  }),
  timedRequest("disjoint_save", 1, `/api/referrals/${referral.id}`, {
    method: "PATCH",
    body: {
      if_match: referral.version,
      if_match_sections: { intake: referral.sectionVersions.intake },
      patch: { note: "Disjoint section save" },
    },
  }),
]);
assertStatuses([identitySave, intakeSave], [200], "disjoint section saves");

const latestResponse = await request(0, `/api/referrals/${referral.id}`);
expectStatus(latestResponse, 200, "load latest referral");
const latest = (await latestResponse.json()).referral;
const sameSectionResponses = await Promise.all(users.map((_, index) => timedRequest("contended_save", index, `/api/referrals/${referral.id}`, {
  method: "PATCH",
  body: {
    if_match: latest.version,
    if_match_sections: { intake: latest.sectionVersions.intake },
    patch: { note: `Contended synthetic save ${index + 1}` },
  },
})));
const sameSectionStatuses = sameSectionResponses.map((response) => response.status);
if (sameSectionStatuses.filter((status) => status === 200).length !== 1 || sameSectionStatuses.filter((status) => status === 409).length !== userCount - 1) {
  fail("Same-section optimistic contention did not produce exactly one winner and nine conflicts.");
}

const changedPolls = await Promise.all(users.map((_, index) => timedRequest("poll", index, `/api/referrals/${referral.id}/changes?after=${latest.version}`)));
assertStatuses(changedPolls, [200], "post-save change polling");
for (const response of changedPolls) {
  const payload = await response.json();
  if (!payload.changed || !Number.isInteger(payload.sequence)) fail("Change polling did not expose a newer sequence after the contended save.");
}

const releaseResponses = await Promise.all(users.map((_, index) => request(index, `/api/referrals/${referral.id}/presence`, {
  method: "DELETE",
  body: { lease_id: leases[index] },
})));
assertStatuses(releaseResponses, [200], "presence releases");

const workspaceChecks = workspaceStateReady
  ? await exerciseWorkspaceState()
  : {
      exercised: false,
      isolated_recent_destinations: 0,
      isolated_drafts: 0,
      contended_draft_winners: 0,
      expected_draft_conflicts: 0,
      drafts_deleted: 0,
    };

console.log(JSON.stringify({
  ok: true,
  users: userCount,
  backend: databaseMode,
  database_contention_exercised: databaseMode === "postgres",
  checks: {
    distinct_presence_leases: userCount,
    polling_requests: initialPolls.length + changedPolls.length,
    disjoint_section_saves: 2,
    contended_save_winners: 1,
    expected_save_conflicts: userCount - 1,
    leases_released: userCount,
    workspace_state: workspaceChecks,
  },
  timings: summarizeTimings(timings),
  note: "Only route templates, status counts, and latency aggregates are emitted; record values and identities are omitted.",
}, null, 2));

async function exerciseWorkspaceState() {
  const draftKey = String(Date.now());
  const recentWrites = await Promise.all(users.map((_, index) => timedRequest("recent_write", index, "/api/me/recents", {
    method: "POST",
    body: {
      destination: {
        id: "page:referrals",
        kind: "page",
        screen: "referrals",
        title: "Referrals",
        detail: "Synthetic collaboration load destination",
        visitedAt: new Date().toISOString(),
      },
    },
  })));
  assertStatuses(recentWrites, [200], "per-user recent writes");

  const recentReads = await Promise.all(users.map((_, index) => timedRequest("recent_read", index, "/api/me/recents")));
  assertStatuses(recentReads, [200], "per-user recent reads");
  for (const response of recentReads) {
    const payload = await response.json();
    if (!Array.isArray(payload.recents) || payload.recents.filter((item) => item.id === "page:referrals").length !== 1) {
      fail("Per-user recent destinations were not isolated and deduplicated.");
    }
  }

  const draftCreates = await Promise.all(users.map((_, index) => timedRequest("draft_create", index, `/api/me/referral-drafts/${draftKey}`, {
    method: "PUT",
    body: { if_match: 0, draft: recoveryDraft(`Synthetic workspace ${index + 1}`) },
  })));
  assertStatuses(draftCreates, [200], "per-user draft creates");

  const draftReads = await Promise.all(users.map((_, index) => timedRequest("draft_read", index, `/api/me/referral-drafts/${draftKey}`)));
  assertStatuses(draftReads, [200], "per-user draft reads");
  for (let index = 0; index < draftReads.length; index += 1) {
    const payload = await draftReads[index].json();
    if (payload.version !== 1 || payload.draft?.fields?.summary?.value !== `Synthetic workspace ${index + 1}`) {
      fail("Per-user recovery drafts crossed an identity boundary.");
    }
  }

  const contendedDrafts = await Promise.all(users.map((_, index) => timedRequest("contended_draft", 0, `/api/me/referral-drafts/${draftKey}`, {
    method: "PUT",
    body: { if_match: 1, draft: recoveryDraft(`Synthetic contender ${index + 1}`) },
  })));
  const contendedDraftStatuses = contendedDrafts.map((response) => response.status);
  if (contendedDraftStatuses.filter((status) => status === 200).length !== 1
    || contendedDraftStatuses.filter((status) => status === 409).length !== userCount - 1) {
    fail("Same-draft optimistic contention did not produce exactly one winner and nine conflicts.");
  }

  const deletes = await Promise.all(users.map((_, index) => request(index, `/api/me/referral-drafts/${draftKey}`, {
    method: "DELETE",
    body: { if_match: index === 0 ? 2 : 1 },
  })));
  assertStatuses(deletes, [200], "per-user draft cleanup");
  const recentDeletes = await Promise.all(users.map((_, index) => request(index, "/api/me/recents", {
    method: "DELETE",
    body: { id: "page:referrals" },
  })));
  assertStatuses(recentDeletes, [200], "per-user recent cleanup");

  return {
    exercised: true,
    isolated_recent_destinations: recentReads.length,
    isolated_drafts: draftReads.length,
    contended_draft_winners: 1,
    expected_draft_conflicts: userCount - 1,
    drafts_deleted: deletes.length,
  };
}

function recoveryDraft(summary) {
  const fields = Object.fromEntries([
    "name", "gender", "age", "dob", "ssn", "owner", "referralReceived",
    "admissionDate", "county", "referent", "responsiblePerson", "summary", "interview",
  ].map((key) => [key, { value: key === "summary" ? summary : "" }]));
  return {
    schema: 1,
    savedAt: new Date().toISOString(),
    dirtyKeys: ["summary"],
    fields,
    conserved: "",
    tagsInput: "",
    documents: {},
  };
}

async function timedRequest(operation, userIndex, path, options) {
  const startedAt = performance.now();
  const response = await request(userIndex, path, options);
  timings.push({ operation, milliseconds: performance.now() - startedAt, status: response.status });
  return response;
}

async function request(userIndex, path, options = {}) {
  const user = users[userIndex];
  const principal = Buffer.from(JSON.stringify({
    userId: `pipeline-load-user-${userIndex + 1}`,
    userDetails: user.email,
    claims: [
      { typ: "name", val: user.name },
      { typ: "roles", val: "Pipeline.Admin" },
    ],
  })).toString("base64");
  return fetch(new URL(path, baseUrl), {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      Origin: baseUrl.origin,
      "x-ms-client-principal": principal,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
}

function summarizeTimings(samples) {
  return Object.fromEntries([...new Set(samples.map((sample) => sample.operation))].sort().map((operation) => {
    const values = samples.filter((sample) => sample.operation === operation).map((sample) => sample.milliseconds).sort((left, right) => left - right);
    return [operation, {
      requests: values.length,
      p50_ms: rounded(percentile(values, 0.5)),
      p95_ms: rounded(percentile(values, 0.95)),
      max_ms: rounded(values.at(-1) ?? 0),
    }];
  }));
}

function percentile(values, value) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * value) - 1)];
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

function assertStatuses(responses, allowed, operation) {
  if (responses.some((response) => !allowed.includes(response.status))) {
    fail(`${operation} returned an unexpected status class.`);
  }
}

function expectStatus(response, status, operation) {
  if (response.status !== status) fail(`${operation} returned HTTP ${response.status}.`);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
