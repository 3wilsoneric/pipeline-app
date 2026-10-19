import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { selectAutomaticAdmissions, selectAdmissionIdentityCandidates, verifiedAdmissionBirthDate } = loadTypeScriptModule(root, "lib/pipeline/clinical-admission-selection.ts");
const { calendarToday } = loadTypeScriptModule(root, "lib/pipeline/calendar-date.ts");
const today = calendarToday();
const yesterday = calendarToday(new Date(Date.now() - 86_400_000));
const twoDaysAgo = calendarToday(new Date(Date.now() - 2 * 86_400_000));

function fixtures() {
  const referral = {
    id: 42, version: 3, sectionVersions: { workflow: 2 }, clientId: "client-42",
    createdAt: `${yesterday}T08:00:00Z`, name: "Synthetic Client", dob: "1970-01-01",
    stage: "Community Review", community: "San Pablo", workspaceStatus: "active",
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
