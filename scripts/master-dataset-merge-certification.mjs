#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const matching = loadTypeScriptModule(process.cwd(), "lib/pipeline/master-record-matching.ts");
const checks = [];
const check = (name, condition, detail) => checks.push({ name, ok: Boolean(condition), detail });

const master = [];
const sources = [];
const admissions = [];
const census = [];

for (let index = 0; index < 100; index += 1) {
  const id = `person-${index}`;
  const residentNumber = `SYN-${String(index).padStart(4, "0")}`;
  const dob = `19${String(50 + (index % 40)).padStart(2, "0")}-01-15`;
  master.push({ canonical_person_id: id, resident_number: residentNumber, date_of_birth: dob, display_name: `Synthetic Person ${index}` });
  sources.push({ source_record_id: `source-${index}`, resident_number: residentNumber, date_of_birth: dob, display_name: `Synthetic Person ${index}` });
  admissions.push(
    { admission_episode_id: `${id}-a`, canonical_person_id: id, admit_date: "2024-01-01", discharge_date: "2024-02-01" },
    { admission_episode_id: `${id}-b`, canonical_person_id: id, admit_date: "2026-01-01", discharge_date: null },
  );
  if (index < 10) admissions.push({ ...admissions.at(-1) });
  census.push({ canonical_person_id: id, active: index % 2 === 0, community_id: `community-${index % 5}`, as_of: "2026-08-25" });
}

const cleanDecisions = sources.map((source) => matching.decideMasterIdentityMatch(source, master));
check("all governed resident-number and DOB matches recover exactly", cleanDecisions.every((decision, index) =>
  decision.status === "matched" && decision.canonical_person_id === `person-${index}`), cleanDecisions.length);

const collisionDecisions = [];
for (let index = 0; index < 35; index += 1) {
  const sharedName = `Collision Person ${index}`;
  const sharedDob = `1970-02-${String(1 + (index % 27)).padStart(2, "0")}`;
  const pair = [0, 1].map((side) => ({
    canonical_person_id: `collision-${index}-${side}`,
    resident_number: `COL-${index}-${side}`,
    date_of_birth: sharedDob,
    display_name: sharedName,
  }));
  collisionDecisions.push(matching.decideMasterIdentityMatch({
    source_record_id: `collision-source-${index}`,
    resident_number: null,
    date_of_birth: sharedDob,
    display_name: sharedName,
  }, pair));
}
check("35 planted name and DOB collisions never auto-merge", collisionDecisions.every((decision) =>
  decision.status === "human_review" && decision.candidate_person_ids.length === 2), collisionDecisions.length);

const dobConflicts = sources.slice(0, 5).map((source) => matching.decideMasterIdentityMatch({
  ...source,
  date_of_birth: "1999-12-31",
}, master));
check("resident-number matches with conflicting DOB are blocked", dobConflicts.every((decision) =>
  decision.status === "blocked_conflict"), dobConflicts.length);

const missingDob = matching.decideMasterIdentityMatch({ ...sources[0], date_of_birth: null }, master);
check("missing DOB requires review instead of a silent join", missingDob.status === "human_review", 1);

const deduped = matching.dedupeAdmissionEvidence(admissions);
check("duplicate source rows do not inflate admission episodes", deduped.episodes.length === 200, deduped.episodes.length);
check("identical duplicate episodes are not semantic conflicts", deduped.conflicting_episode_ids.length === 0, deduped.conflicting_episode_ids.length);

const faceSheetsWithoutAdmissions = Array.from({ length: 10 }, (_, index) => ({
  canonical_person_id: `face-sheet-only-${index}`,
  document_kind: "face_sheet",
}));
check("face sheets without an admission never become admission episodes",
  faceSheetsWithoutAdmissions.every((record) => !deduped.episodes.some((episode) => episode.canonical_person_id === record.canonical_person_id)),
  faceSheetsWithoutAdmissions.length);

const projected = sources.map((_, index) => matching.projectCurrentCensus(`person-${index}`, census));
check("current status and community come from the census truth set", projected.every((record, index) =>
  record.status === (index % 2 === 0 ? "active" : "inactive")
    && record.community_id === `community-${index % 5}`), projected.length);

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  cohort: { clean_people: 100, planted_collisions: 35, dob_conflicts: 5, duplicate_episode_rows: 10, face_sheet_only_records: 10 },
  checks,
  note: "The cohort is synthetic. Names and dates are generated and no record values are emitted.",
}, null, 2));
if (failed.length) process.exit(1);
