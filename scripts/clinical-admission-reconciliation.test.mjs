import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { selectAutomaticAdmissions, evaluateAutomaticAdmissions, selectAdmissionIdentityCandidates, verifiedAdmissionBirthDate } = loadTypeScriptModule(root, "lib/pipeline/clinical-admission-selection.ts");
const { legacySelectAutomaticAdmissions } = loadTypeScriptModule(root, "scripts/fixtures/legacy-automatic-admission-selection.ts");
const { explainAssumedAdmissionBlockers } = loadTypeScriptModule(root, "lib/pipeline/admission-confirmation-explain.ts");
const { admissionConfirmationBlockerLabels } = loadTypeScriptModule(root, "lib/pipeline/admission-confirmation.ts");
const { calendarToday } = loadTypeScriptModule(root, "lib/pipeline/calendar-date.ts");
const today = calendarToday();
const yesterday = calendarToday(new Date(Date.now() - 86_400_000));
const twoDaysAgo = calendarToday(new Date(Date.now() - 2 * 86_400_000));

function fixtures() {
  const referral = {
    id: 42, version: 3, sectionVersions: { workflow: 2 }, clientId: "client-42",
    createdAt: `${yesterday}T08:00:00Z`, name: "Synthetic Client", dob: "1970-01-01",
    stage: "Community Review", community: "San Pablo", workspaceStatus: "active", workspaceOrigin: "pipeline",
    plannedAdmissionDate: yesterday,
    admissionDecision: { outcome: "accepted", decidedAt: `${yesterday}T12:00:00Z` },
  };
  const link = {
    pipeline_client_id: "client-42", status: "confirmed", resident_key: "site:42",
    resident_number: "42", community_id: "site", referral_id: 42,
  };
  const resident = {
    resident_key: "site:42", resident_id: "42", resident_number: "42",
    community_id: "site", community_name: "San Pablo", date_of_birth: "1970-01-01",
    canonical_client_id: "alamo-42", display_name: "Synthetic Client", admit_date: today,
  };
  return { referral, link, resident };
}

function clientDetail(resident, patch = {}) {
  return {
    snapshot_id: "snapshot-42", data_as_of: today, freshness: { status: "fresh" },
    client: {
      canonical_client_id: resident.canonical_client_id, display_name: resident.display_name,
      resident_numbers: [resident.resident_number], current_resident: true,
      current_community: resident.community_name, admit_date: resident.admit_date,
      enrichment: { date_of_birth: resident.date_of_birth }, resident_profiles: [], resident_profile: null,
      ...patch,
    },
  };
}

test("an overdue accepted referral needs unique census identity before an automatic link", () => {
  const { referral, resident } = fixtures();
  const select = (rows = [referral], roster = [resident], links = []) =>
    selectAdmissionIdentityCandidates(rows, links, roster, today);
  assert.equal(select().length, 1);
  assert.equal(select([{ ...referral, plannedAdmissionDate: "2099-01-01" }]).length, 0);
  assert.equal(select([{ ...referral, placementCancellation: { reason: "Other placement" } }]).length, 0);
  assert.equal(select([referral, { ...referral, id: 43, clientId: "another" }]).length, 0);
  assert.equal(select([referral, { ...referral, id: 43, admissionDecision: null }]).length, 0);
  assert.equal(select([referral], [resident, { ...resident, resident_key: "site:43" }]).length, 0);
  assert.equal(select([referral], [{ ...resident, community_name: "Turlock" }]).length, 0);
  assert.equal(select([referral], [resident], [{ pipeline_client_id: referral.clientId, status: "rejected", resident_key: resident.resident_key }]).length, 0);
  assert.equal(select([referral], [{ ...resident, canonical_client_id: null }]).length, 1,
    "a governed roster DOB can verify a current resident without an older canonical client record");
  assert.equal(select([referral], [{ ...resident, canonical_client_id: null, date_of_birth: null }]).length, 0);
  assert.equal(select([referral], [{ ...resident, canonical_client_id: null, date_of_birth: "1970-01-02" }]).length, 0);
  const middleInitial = { ...resident, display_name: "Synthetic A. Client", canonical_client_id: null };
  assert.equal(select([referral], [middleInitial]).length, 1);
  assert.equal(select([{ ...referral, name: "Synthetic B. Client" }], [middleInitial]).length, 0,
    "two conflicting recorded middle initials must not be treated as the same identity");
  assert.equal(select([referral], [middleInitial, { ...resident, resident_key: "site:43", display_name: "Synthetic B. Client" }]).length, 0,
    "two census residents with the same first and last name are ambiguous even with different initials");
  assert.equal(select([referral], [{ ...middleInitial, display_name: "Synthetic A. Other" }]).length, 0);
});

test("current census client detail must verify DOB, resident number, community and snapshot", () => {
  const { referral, resident } = fixtures();
  const verify = (detail) => verifiedAdmissionBirthDate(referral, resident, detail, "snapshot-42", today);
  assert.equal(verify(clientDetail(resident)), referral.dob);
  assert.equal(verify(clientDetail(resident, { enrichment: { date_of_birth: "1970-01-02" } })), null);
  assert.equal(verify(clientDetail(resident, { resident_profiles: [{ date_of_birth: "1970-01-02" }] })), null);
  assert.equal(verify(clientDetail(resident, { resident_numbers: ["43"] })), null);
  assert.equal(verify(clientDetail(resident, { current_community: "Turlock" })), null);
  assert.equal(verify({ ...clientDetail(resident), snapshot_id: "older" }), null);
  assert.equal(verify({ ...clientDetail(resident), freshness: { status: "stale" } }), null);
});

test("only a uniquely confirmed current resident with matching identity, community and admission timing is automatic", () => {
  const { referral, link, resident } = fixtures();
  const select = (referrals = [referral], links = [link], residents = [resident], asOf = today) =>
    selectAutomaticAdmissions(referrals, links, residents, asOf);
  assert.equal(select().length, 1);
  assert.equal(select()[0].actualDate, today);
  assert.equal(select([{ ...referral, plannedAdmissionDate: twoDaysAgo }]).length, 1, "a passed plan is confirmed only by the governed roster match");
  assert.equal(select([referral], [{ ...link, status: "candidate" }]).length, 0);
  assert.equal(select([referral], [link, { ...link, resident_key: "site:other" }]).length, 0);
  assert.equal(select([referral], [link, { ...link, status: "candidate", resident_key: "site:other" }]).length, 0);
  assert.equal(select([referral, { ...referral, id: 43 }]).length, 0);
  assert.equal(select([referral, { ...referral, id: 43, stage: "New", admissionDecision: null }]).length, 0);
  assert.equal(select([{ ...referral, stage: "Declined" }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, community_name: "Turlock" }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, date_of_birth: "1971-01-01" }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, date_of_birth: null }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, display_name: "Synthetic A. Client" }]).length, 1);
  assert.equal(select([{ ...referral, name: "Synthetic B. Client" }], [link], [{ ...resident, display_name: "Synthetic A. Client" }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, display_name: "Synthetic A. Other" }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, admit_date: twoDaysAgo }], today).length, 0);
  assert.equal(select([referral], [link], [resident], yesterday).length, 0);
  assert.equal(select([{ ...referral, placementCancellation: { reason: "Placed elsewhere" } }]).length, 0);
});

test("daily reconciliation records a confirmed admission once with census provenance", async () => {
  const { referral, link, resident } = fixtures();
  const referrals = [referral];
  const transitions = [];
  let fresh = true;
  const worker = loadEntry("lib/pipeline/clinical-backlog-reconciliation.ts", {
    "@/lib/clinical/clinical-data": {
      ClinicalDataError: class extends Error {},
      getClinicalAuthMode: () => "client_credentials",
      getClinicalRoster: async () => ({
        residents: [resident], snapshot_id: "snapshot-42", data_as_of: today,
        freshness: { status: fresh ? "fresh" : "stale" }, next_cursor: null,
      }),
    },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => {} },
    "@/lib/pipeline/referral-store": { listReferrals: async () => ({ referrals, next_cursor: null }) },
    "@/lib/pipeline/resident-link-store": {
      listResidentLinks: async () => ({ links: [link], next_cursor: null }),
      createResidentLink: async () => { throw Error("A confirmed identity must not be recreated."); },
    },
    "@/lib/pipeline/referral-clinical-reconciliation": { findClinicalResidentMatch: () => null },
    "@/lib/pipeline/workflow-store": { transitionReferral: async (...args) => {
      transitions.push(args);
      referrals[0] = { ...referrals[0], stage: "Accepted / Admitted" };
      return { ok: true };
    } },
  });
  const first = await worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"));
  assert.equal(first.admissions_confirmed, 1);
  assert.equal(first.no_match, 0);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0][1], "Accepted / Admitted");
  assert.equal(transitions[0][6], today);
  assert.match(transitions[0][7], /snapshot-42/);
  const second = await worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"));
  assert.equal(second.admissions_confirmed, 0);
  assert.equal(transitions.length, 1);
  referrals[0] = referral;
  fresh = false;
  const stale = await worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"));
  assert.equal(stale.status, "source_not_fresh");
  assert.equal(stale.admissions_confirmed, 0);
  assert.equal(transitions.length, 1);
});

test("daily reconciliation confirms only a uniquely verified overdue census arrival", async () => {
  const { referral, resident } = fixtures();
  const currentResident = { ...resident, date_of_birth: null };
  const transitions = [];
  const links = [];
  let detail = clientDetail(resident);
  const worker = loadEntry("lib/pipeline/clinical-backlog-reconciliation.ts", {
    "@/lib/clinical/clinical-data": {
      ClinicalDataError: class extends Error {},
      getClinicalAuthMode: () => "client_credentials",
      getClinicalRoster: async () => ({
        residents: [currentResident], snapshot_id: "snapshot-42", data_as_of: today,
        freshness: { status: "fresh" }, next_cursor: null,
      }),
      getClinicalClient: async () => detail,
    },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => {} },
    "@/lib/pipeline/referral-store": { listReferrals: async () => ({ referrals: [referral], next_cursor: null }) },
    "@/lib/pipeline/resident-link-store": {
      listResidentLinks: async () => ({ links, next_cursor: null }),
      createResidentLink: async (input) => ({ ok: true, link: {
        link_id: "link-42", version: 1, pipeline_client_id: input.pipeline_client_id,
        status: "candidate", resident_key: input.resident_key,
        resident_number: input.resident_number, community_id: input.community_id,
      } }),
      reviewResidentLink: async (_id, input, _actor, version) => ({ ok: true, link: {
        link_id: "link-42", version: version + 1, pipeline_client_id: referral.clientId,
        status: input.action === "confirm" ? "confirmed" : "rejected",
        resident_key: resident.resident_key, resident_number: resident.resident_number,
        community_id: resident.community_id,
      } }),
    },
    "@/lib/pipeline/referral-clinical-reconciliation": { findClinicalResidentMatch: () => null },
    "@/lib/pipeline/workflow-store": { transitionReferral: async (...args) => {
      transitions.push(args);
      return { ok: true };
    } },
  });
  const first = await worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"));
  assert.equal(first.admissions_confirmed, 1);
  assert.equal(first.no_match, 0);
  assert.equal(transitions[0][6], today);
  transitions.length = 0;
  detail = clientDetail(resident, { enrichment: { date_of_birth: "1970-01-02" } });
  const mismatch = await worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"));
  assert.equal(mismatch.admissions_confirmed, 0);
  assert.equal(mismatch.no_match, 1);
  assert.equal(transitions.length, 0);
});

test("daily reconciliation accepts a fresh roster DOB when the canonical database has not caught up", async () => {
  const { referral, resident } = fixtures();
  const current = { ...resident, canonical_client_id: null };
  const transitions = [];
  const worker = loadEntry("lib/pipeline/clinical-backlog-reconciliation.ts", {
    "@/lib/clinical/clinical-data": {
      ClinicalDataError: class extends Error {},
      getClinicalAuthMode: () => "client_credentials",
      getClinicalRoster: async () => ({
        residents: [current], snapshot_id: "snapshot-42", data_as_of: today,
        freshness: { status: "fresh" }, next_cursor: null,
      }),
      getClinicalClient: async () => { throw Error("Current roster DOB does not need an older canonical profile."); },
    },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => {} },
    "@/lib/pipeline/referral-store": { listReferrals: async () => ({ referrals: [referral], next_cursor: null }) },
    "@/lib/pipeline/resident-link-store": {
      listResidentLinks: async () => ({ links: [], next_cursor: null }),
      createResidentLink: async (input) => ({ ok: true, link: {
        link_id: "link-42", version: 1, pipeline_client_id: input.pipeline_client_id,
        status: "candidate", resident_key: input.resident_key,
        resident_number: input.resident_number, community_id: input.community_id,
      } }),
      reviewResidentLink: async (_id, input, _actor, version) => ({ ok: true, link: {
        link_id: "link-42", version: version + 1, pipeline_client_id: referral.clientId,
        status: input.action === "confirm" ? "confirmed" : "rejected",
        resident_key: resident.resident_key, resident_number: resident.resident_number,
        community_id: resident.community_id,
      } }),
    },
    "@/lib/pipeline/referral-clinical-reconciliation": { findClinicalResidentMatch: () => null },
    "@/lib/pipeline/workflow-store": { transitionReferral: async (...args) => {
      transitions.push(args);
      return { ok: true };
    } },
  });
  const result = await worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"));
  assert.equal(result.admissions_confirmed, 1);
  assert.equal(result.no_match, 0);
  assert.equal(transitions[0][6], today);
});

// Seeded generator over small value domains so clients, links and residents collide often.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}

function randomCase(random) {
  const pick = (values) => values[Math.floor(random() * values.length)];
  // Start from a case that selects, then perturb each field with some probability.
  const vary = (value, values, chance = 0.12) => random() < chance ? pick(values) : value;
  const names = ["Synthetic Client", "Synthetic A. Client", "Synthetic B. Client", "Other Person"];
  const keys = ["site:1", "site:2", "site:3"];
  const referral = (id) => ({
    id,
    clientId: vary("c1", [undefined, "c2", "c3"], 0.08),
    version: vary(3, [undefined, 1.5], 0.05),
    sectionVersions: vary({ workflow: 2 }, [{}, undefined, { workflow: 0.5 }], 0.05),
    deletedAt: vary(undefined, ["2026-01-01T00:00:00Z"], 0.04),
    workspaceStatus: vary("active", ["historical", "archived", undefined], 0.06),
    workspaceOrigin: "pipeline",
    placementCancellation: vary(undefined, [{ reason: "Other placement" }], 0.04),
    stage: vary("Community Review", ["New", "Accepted / Admitted", "Declined"], 0.06),
    actualAdmissionDate: vary(undefined, [yesterday], 0.04),
    admissionDecision: vary({ outcome: "accepted", decidedAt: `${yesterday}T12:00:00Z` }, [
      { outcome: "accepted", decidedAt: `${twoDaysAgo}T12:00:00Z` }, { outcome: "accepted", decidedAt: `${today}T12:00:00Z` },
      { outcome: "accepted" }, { outcome: "declined" }, null,
    ]),
    plannedAdmissionDate: vary(yesterday, [twoDaysAgo, today, "2099-01-01", "", "not a date", undefined]),
    name: vary("Synthetic Client", names),
    dob: vary("1970-01-01", ["1971-01-01", "", undefined], 0.08),
    community: vary("San Pablo", ["Turlock"], 0.06),
  });
  const link = () => ({
    pipeline_client_id: vary("c1", ["c2", "c3"], 0.08),
    status: vary("confirmed", ["candidate", "rejected"], 0.1),
    resident_key: vary("site:1", keys, 0.1), resident_number: vary("1", ["2"], 0.05), community_id: vary("site", ["other"], 0.05),
  });
  const resident = () => ({
    resident_key: vary("site:1", keys, 0.1), resident_id: "1", resident_number: vary("1", ["2"], 0.05),
    community_id: vary("site", ["other"], 0.05), community_name: vary("San Pablo", ["Turlock"], 0.06),
    date_of_birth: vary("1970-01-01", ["1971-01-01", null], 0.08),
    canonical_client_id: "alamo-1", display_name: vary("Synthetic Client", names),
    admit_date: vary(today, [yesterday, twoDaysAgo, "2099-01-01", null]),
  });
  const many = (make, extraChance) => { const rows = [make(1)]; while (random() < extraChance) rows.push(make(rows.length + 1)); return rows; };
  return {
    referrals: many(referral, 0.25),
    links: random() < 0.06 ? [] : many(link, 0.2),
    residents: random() < 0.06 ? [] : many(resident, 0.2),
    dataAsOf: vary(today, [yesterday, null], 0.08),
  };
}

const selectionKey = (rows) => JSON.stringify(rows.map(({ referral, actualDate }) => [referral.id, actualDate]));

test("refactored selection is identical to the frozen pre-refactor selection, and every other referral gets exactly one reason", () => {
  const random = seededRandom(20261125);
  const seen = new Set();
  let selectedCases = 0;
  for (let index = 0; index < 20_000; index += 1) {
    const { referrals, links, residents, dataAsOf } = randomCase(random);
    const legacy = legacySelectAutomaticAdmissions(referrals, links, residents, dataAsOf);
    const current = selectAutomaticAdmissions(referrals, links, residents, dataAsOf);
    assert.equal(selectionKey(current), selectionKey(legacy), `selection diverged for case ${index}`);
    assert.ok(current.every((row, position) => row.referral === legacy[position].referral), "same referral objects, same order");
    const { selected, blocked } = evaluateAutomaticAdmissions(referrals, links, residents, dataAsOf);
    assert.equal(selectionKey(selected), selectionKey(legacy));
    const selectedIds = new Set(selected.map(({ referral }) => referral.id));
    for (const referral of referrals) {
      assert.notEqual(selectedIds.has(referral.id), blocked.has(referral.id), "selected XOR blocked");
      if (blocked.has(referral.id)) {
        assert.ok(Object.hasOwn(admissionConfirmationBlockerLabels, blocked.get(referral.id)));
        seen.add(blocked.get(referral.id));
      }
    }
    if (legacy.length) selectedCases += 1;
  }
  assert.ok(selectedCases > 2_000, `fuzz exercised real selections (${selectedCases})`);
  const reachable = Object.keys(admissionConfirmationBlockerLabels)
    .filter((code) => !["ready_for_next_reconciliation", "census_not_fresh", "birth_date_lookup_failed"].includes(code)); // read-time only
  assert.deepEqual(reachable.filter((code) => !seen.has(code)), [], "every selection reason is exercised by the fuzz");
});

test("each automatic-admission check reports its own plain-language reason", () => {
  const { referral, link, resident } = fixtures();
  const reason = (referrals = [referral], links = [link], residents = [resident], asOf = today) =>
    evaluateAutomaticAdmissions(referrals, links, residents, asOf).blocked.get(referral.id) ?? null;
  assert.equal(reason(), null);
  assert.equal(reason([{ ...referral, clientId: undefined }]), "no_client_record");
  assert.equal(reason([referral, { ...referral, id: 43 }]), "multiple_active_referrals");
  assert.equal(reason([{ ...referral, plannedAdmissionDate: "2099-01-01" }]), "planned_after_census_date");
  assert.equal(reason([referral], [link], [resident], null), "census_unavailable");
  assert.equal(reason([{ ...referral, version: undefined }]), "missing_version_info");
  assert.equal(reason([referral], []), "no_confirmed_resident_link");
  assert.equal(reason([referral], [link, { ...link, resident_key: "site:other" }]), "multiple_confirmed_links");
  assert.equal(reason([referral], [link, { ...link, status: "candidate", resident_key: "site:other" }]), "conflicting_candidate_link");
  assert.equal(reason([referral], [link], []), "resident_not_in_census");
  assert.equal(reason([referral], [link], [resident, resident]), "ambiguous_census_resident");
  assert.equal(reason([referral], [link], [{ ...resident, community_name: "Turlock" }]), "community_mismatch");
  assert.equal(reason([referral], [link], [{ ...resident, display_name: "Other Person" }]), "name_mismatch");
  assert.equal(reason([{ ...referral, dob: "" }]), "birth_date_missing");
  assert.equal(reason([referral], [link], [{ ...resident, date_of_birth: null }]), "census_birth_date_missing");
  assert.equal(reason([referral], [link], [{ ...resident, date_of_birth: "1971-01-01" }]), "birth_date_mismatch");
  assert.equal(reason([referral], [{ ...link, resident_number: "99" }]), "governed_identity_conflict");
  assert.equal(reason([referral], [link], [{ ...resident, admit_date: null }]), "census_admit_date_missing");
  assert.equal(reason([{ ...referral, admissionDecision: { outcome: "accepted" } }]), "acceptance_date_missing");
  assert.equal(reason([referral], [link], [{ ...resident, admit_date: twoDaysAgo }]), "census_admit_before_acceptance");
  assert.equal(reason([referral], [link], [resident], yesterday), "census_admit_date_invalid");
});

test("assumed referrals are explained from the reconciliation inputs without persisting anything", () => {
  const { referral, link, resident } = fixtures();
  const explain = (rows, links, residents, fresh = true) =>
    Object.fromEntries([...explainAssumedAdmissionBlockers([42], rows, links, residents, today, fresh)].map(([id, value]) => [id, value.code]));
  assert.deepEqual(explain([referral], [link], [resident]), { 42: "ready_for_next_reconciliation" });
  assert.deepEqual(explain([referral], [], [resident]), { 42: "no_confirmed_resident_link" });
  assert.deepEqual(explain([referral], [link], [resident], false), { 42: "census_not_fresh" });
  assert.deepEqual(explain([], [link], [resident]), { 42: "not_eligible" }, "outside the reconciled active list");
  const labelled = explainAssumedAdmissionBlockers([42], [referral], [], [resident], today, true).get(42);
  assert.match(labelled.label, /No ElderMark resident is confirmed/);
});

// Read-time blockers reuse the job's governed client-record DOB lookup when the census row has no DOB.
function governedDobHarness({ clientRecordDob = "1970-01-01", lookupFails = false } = {}) {
  const { referral, link, resident: base } = fixtures();
  const resident = { ...base, date_of_birth: null };
  const lookups = [];
  const transitions = [];
  const worker = loadEntry("lib/pipeline/clinical-backlog-reconciliation.ts", {
    "@/lib/clinical/clinical-data": {
      ClinicalDataError: class extends Error {},
      getClinicalAuthMode: () => "client_credentials",
      getClinicalRoster: async () => ({ residents: [resident], snapshot_id: "snapshot-42", data_as_of: today, freshness: { status: "fresh" }, next_cursor: null }),
      getClinicalClient: async (_request, id) => {
        lookups.push(id);
        if (lookupFails) throw new Error("governed client record unavailable");
        return clientDetail(resident, { enrichment: { date_of_birth: clientRecordDob } });
      },
    },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => {} },
    "@/lib/pipeline/referral-store": { listReferrals: async () => ({ referrals: [referral], next_cursor: null }) },
    "@/lib/pipeline/resident-link-store": {
      listResidentLinks: async () => ({ links: [link], next_cursor: null }),
      createResidentLink: async () => { throw Error("read-time explanation must not create links"); },
      reviewResidentLink: async () => { throw Error("read-time explanation must not review links"); },
    },
    "@/lib/pipeline/referral-clinical-reconciliation": { findClinicalResidentMatch: () => null },
    "@/lib/pipeline/workflow-store": { transitionReferral: async (...args) => { transitions.push(args); return { ok: true }; } },
  });
  const blockers = loadEntry("lib/pipeline/admission-confirmation-blockers.ts", {
    "@/lib/clinical/clinical-data": {
      getClinicalAuthMode: () => "client_credentials", getClinicalDataMode: () => "alamo_api", getClinicalDataReadiness: () => ({ ready: true }),
    },
    "./clinical-backlog-reconciliation": worker,
  });
  const explain = async () => (await blockers.loadAdmissionConfirmationBlockers(new Date(), [referral])).get(referral.id)?.code;
  return { referral, worker, explain, lookups, transitions };
}

test("DOB present only in the governed client record: read time agrees with the job (ready, then confirmed)", async () => {
  const h = governedDobHarness();
  assert.equal(await h.explain(), "ready_for_next_reconciliation");
  assert.equal(await h.explain(), "ready_for_next_reconciliation");
  assert.deepEqual(h.lookups, ["alamo-42"], "the second read reuses the 60s lookup cache");
  assert.equal(h.transitions.length, 0, "explaining never transitions a referral");
  const result = await h.worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"));
  assert.equal(result.admissions_confirmed, 1, "the job selects the same referral using the same lookup");
});

test("DOB absent from census and governed record: census_birth_date_missing, and the job does not confirm", async () => {
  const h = governedDobHarness({ clientRecordDob: null });
  assert.equal(await h.explain(), "census_birth_date_missing");
  assert.equal((await h.worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"))).admissions_confirmed, 0);
});

test("a failed governed lookup degrades to birth_date_lookup_failed without throwing, and is retried", async () => {
  const h = governedDobHarness({ lookupFails: true });
  assert.equal(await h.explain(), "birth_date_lookup_failed");
  assert.equal(await h.explain(), "birth_date_lookup_failed");
  assert.equal(h.lookups.length, 2, "failures are not cached");
  assert.equal((await h.worker.reconcileClinicalBacklog(new Request("https://pipeline.invalid"))).admissions_confirmed, 0);
});

test("explainer maps a DOB-missing block to the lookup-failure code only for failed lookups", () => {
  const { referral, link, resident } = fixtures();
  const noDob = [{ ...resident, date_of_birth: null }];
  const code = (failed) => explainAssumedAdmissionBlockers([42], [referral], [link], noDob, today, true, new Set(failed)).get(42).code;
  assert.equal(code([]), "census_birth_date_missing");
  assert.equal(code([42]), "birth_date_lookup_failed");
  assert.equal(explainAssumedAdmissionBlockers([42], [referral], [link], [resident], today, true, new Set([42])).get(42).code,
    "ready_for_next_reconciliation", "a failed lookup never masks a passing referral");
});
