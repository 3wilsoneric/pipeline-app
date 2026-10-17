import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { selectAutomaticAdmissions } = loadTypeScriptModule(root, "lib/pipeline/clinical-admission-selection.ts");
const { calendarToday } = loadTypeScriptModule(root, "lib/pipeline/calendar-date.ts");
const today = calendarToday();
const yesterday = calendarToday(new Date(Date.now() - 86_400_000));
const twoDaysAgo = calendarToday(new Date(Date.now() - 2 * 86_400_000));

function fixtures() {
  const referral = {
    id: 42, version: 3, sectionVersions: { workflow: 2 }, clientId: "client-42",
    createdAt: `${yesterday}T08:00:00Z`, name: "Synthetic Client", dob: "1970-01-01",
    stage: "Community Review", community: "San Pablo", workspaceStatus: "active",
    admissionDecision: { outcome: "accepted", decidedAt: `${yesterday}T12:00:00Z` },
  };
  const link = {
    pipeline_client_id: "client-42", status: "confirmed", resident_key: "site:42",
    resident_number: "42", community_id: "site", referral_id: 42,
  };
  const resident = {
    resident_key: "site:42", resident_id: "42", resident_number: "42",
    community_id: "site", community_name: "San Pablo", date_of_birth: "1970-01-01",
    admit_date: today,
  };
  return { referral, link, resident };
}

test("only a uniquely confirmed current resident with matching identity, community and admission timing is automatic", () => {
  const { referral, link, resident } = fixtures();
  const select = (referrals = [referral], links = [link], residents = [resident], asOf = today) =>
    selectAutomaticAdmissions(referrals, links, residents, asOf);
  assert.equal(select().length, 1);
  assert.equal(select()[0].actualDate, today);
  assert.equal(select([referral], [{ ...link, status: "candidate" }]).length, 0);
  assert.equal(select([referral], [link, { ...link, resident_key: "site:other" }]).length, 0);
  assert.equal(select([referral], [link, { ...link, status: "candidate", resident_key: "site:other" }]).length, 0);
  assert.equal(select([referral, { ...referral, id: 43 }]).length, 0);
  assert.equal(select([referral, { ...referral, id: 43, stage: "New", admissionDecision: null }]).length, 0);
  assert.equal(select([{ ...referral, stage: "Declined" }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, community_name: "Turlock" }]).length, 0);
  assert.equal(select([referral], [link], [{ ...resident, date_of_birth: "1971-01-01" }]).length, 0);
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
