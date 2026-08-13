#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const profileCount = 1_300;
const activeReferralCount = 50;
const assessorCount = 4;
const documentCount = 12_000;
const communities = ["San Pablo", "Santa Clarita", "Turlock", "Victoria's House", "JC Wallace"];
const stages = ["New", "Packet Needed", "Packet Review", "Assessment", "Community Review"];
const assessors = Array.from({ length: assessorCount }, (_, index) => `assessor-${index + 1}`);

const profiles = Array.from({ length: profileCount }, (_, index) => {
  const id = index + 1;
  return {
    resident_key: `synthetic-resident-${String(id).padStart(5, "0")}`,
    resident_number: `SYN-${String(id).padStart(6, "0")}`,
    community: communities[index % communities.length],
    completion: {
      identity: true,
      clinical: index % 17 !== 0,
      medications: index % 13 !== 0,
      assessment: index % 7 !== 0,
    },
    updated_at: new Date(Date.UTC(2026, 7, 9, 12, 0, 0) - index * 60_000).toISOString(),
  };
});

const referrals = Array.from({ length: activeReferralCount }, (_, index) => ({
  referral_id: index + 1,
  client_key: profiles[index * 13].resident_key,
  community: communities[index % communities.length],
  stage: stages[index % stages.length],
  assessor: assessors[index % assessors.length],
  due_at: new Date(Date.UTC(2026, 7, 10 + (index % 5))).toISOString(),
  version: 1,
}));

const documents = Array.from({ length: documentCount }, (_, index) => ({
  document_id: `synthetic-document-${String(index + 1).padStart(6, "0")}`,
  resident_key: profiles[index % profiles.length].resident_key,
  bytes: 3_900_000 + (index % 1_000) * 600,
  state: index % 101 === 0 ? "failed" : index % 11 === 0 ? "processing" : "ready",
}));

const samples = [];
for (let run = 0; run < 500; run += 1) {
  const started = performance.now();
  const community = communities[run % communities.length];
  const assessor = assessors[run % assessors.length];
  const queue = referrals
    .filter((item) => item.community === community || item.assessor === assessor)
    .sort((left, right) => left.due_at.localeCompare(right.due_at) || left.referral_id - right.referral_id)
    .slice(0, 20);
  const completion = profiles
    .filter((profile) => profile.community === community)
    .reduce((sum, profile) => sum + Object.values(profile.completion).filter(Boolean).length, 0);
  if (queue.length === 0 || completion === 0) throw new Error("Synthetic benchmark generated an empty operational result.");
  samples.push(performance.now() - started);
}

const sortedProfiles = [...profiles].sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.resident_key.localeCompare(left.resident_key));
const seen = new Set();
for (let start = 0; start < sortedProfiles.length; start += 100) {
  const page = sortedProfiles.slice(start, start + 100);
  for (const profile of page) {
    if (seen.has(profile.resident_key)) throw new Error("Keyset benchmark repeated a profile.");
    seen.add(profile.resident_key);
  }
}

let acceptedWrites = 0;
let staleWrites = 0;
for (let index = 0; index < 10_000; index += 1) {
  const referral = referrals[index % referrals.length];
  const suppliedVersion = index % 9 === 0 ? referral.version - 1 : referral.version;
  if (suppliedVersion !== referral.version) staleWrites += 1;
  else {
    referral.version += 1;
    acceptedWrites += 1;
  }
}

samples.sort((left, right) => left - right);
const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? 0;
const totalBytes = documents.reduce((sum, document) => sum + document.bytes, 0);
const assessorLoads = Object.fromEntries(assessors.map((assessor) => [assessor, referrals.filter((referral) => referral.assessor === assessor).length]));
const serializedBytes = Buffer.byteLength(JSON.stringify({ profiles, referrals, documents }));
const checks = {
  profile_count: profiles.length === profileCount,
  active_referral_count: referrals.length === activeReferralCount,
  assessor_count: Object.keys(assessorLoads).length === assessorCount,
  assessor_load_balanced: Math.max(...Object.values(assessorLoads)) - Math.min(...Object.values(assessorLoads)) <= 1,
  pagination_complete: seen.size === profileCount,
  optimistic_conflicts_observed: staleWrites > 0 && acceptedWrites > staleWrites,
  document_metadata_count: documents.length === documentCount,
  corpus_exceeds_40gb: totalBytes > 40 * 1024 ** 3,
  in_memory_fixture_under_25mb: serializedBytes < 25 * 1024 ** 2,
  query_p95_under_25ms: p95 < 25,
};
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({
  ok,
  fixture: { profiles: profileCount, active_referrals: activeReferralCount, assessors: assessorCount, documents: documentCount },
  assessor_loads: assessorLoads,
  corpus_gb: Math.round((totalBytes / 1024 ** 3) * 10) / 10,
  serialized_metadata_mb: Math.round((serializedBytes / 1024 ** 2) * 10) / 10,
  query_p95_ms: Math.round(p95 * 100) / 100,
  concurrency: { accepted_writes: acceptedWrites, rejected_stale_writes: staleWrites },
  checks,
  note: "All generated records are synthetic test metadata and are never loaded by runtime code.",
}, null, 2));
if (!ok) process.exit(1);
