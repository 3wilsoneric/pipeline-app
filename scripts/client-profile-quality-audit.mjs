#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  formatClientIdentityTitle,
  isPersonOnlyClientName,
  normalizeClientName,
  resolveClientGender,
} from "../lib/pipeline/client-identity-presentation.mjs";

const root = process.cwd();
const referralsPath = path.resolve(root, process.env.PIPELINE_REFERRAL_STORE_PATH?.trim() || ".data/referrals.json");
const clinicalSnapshotPath = path.resolve(root, process.env.PIPELINE_CLINICAL_DEMO_SNAPSHOT_PATH?.trim() || ".data/demo-clinical-snapshot.json");
const clientHistoryPath = path.resolve(
  root,
  process.env.PIPELINE_CLIENT_HISTORY_PATH?.trim()
    || process.env.PIPELINE_CLIENT_HISTORY_SNAPSHOT_PATH?.trim()
    || ".data/master-client-history.json",
);

const [referralStore, clinicalSnapshot, clientHistory] = await Promise.all([
  readJson(referralsPath),
  readJson(clinicalSnapshotPath),
  readJson(clientHistoryPath),
]);

const referrals = Array.isArray(referralStore?.referrals) ? referralStore.referrals : [];
const residents = Array.isArray(clinicalSnapshot?.residents) ? clinicalSnapshot.residents : [];
const episodes = Array.isArray(clientHistory?.episodes) ? clientHistory.episodes : [];

const workspaceRequiredFields = ["name", "gender", "community", "dob", "owner", "source", "date", "clientId"];
const workspaceMissing = countMissing(referrals, workspaceRequiredFields);
const workspaceTitleFailures = referrals.filter((referral) => {
  const title = formatClientIdentityTitle(referral);
  return title !== normalizeClientName(referral.name, {
    gender: referral.gender,
    community: referral.community,
  });
}).length;
const workspaceNameFailures = referrals.filter((referral) => referral.name !== normalizeClientName(referral.name, {
  gender: referral.gender,
  community: referral.community,
}) || !isPersonOnlyClientName(referral.name)).length;
const duplicateWorkspaceIds = duplicateCount(referrals.map((referral) => String(referral.id ?? "")).filter(Boolean));

const residentMissing = countMissing(residents, [
  "display_name",
  "community_name",
  "date_of_birth",
  "resident_key",
  "resident_number",
  "unit",
  "admit_date",
]);
const residentNameFailures = residents.filter((resident) => resident.display_name !== normalizeClientName(
  resident.display_name,
  { firstName: resident.first_name, lastName: resident.last_name },
) || !isPersonOnlyClientName(resident.display_name)).length;
const historyMissing = {
  resident_name: episodes.filter((episode) => !readable(episode.resident_name)).length,
  community: episodes.filter((episode) => !readable(episode.community) && !readable(episode.facility_canonical)).length,
  resident_number: episodes.filter((episode) => !readable(episode.resident_number)).length,
};
const historyNameFailures = episodes.filter((episode) => episode.resident_name !== normalizeClientName(
  episode.resident_name,
  { community: episode.community || episode.facility_canonical },
) || !isPersonOnlyClientName(episode.resident_name)).length;

const surfaceContracts = [
  ["components/pipeline/ClientProfileDirectory.tsx", "formatClientIdentityTitle"],
  ["components/pipeline/ClientMedicalChart.tsx", 'data-testid="client-identity-title"'],
  ["components/pipeline/ClientProfileView.tsx", 'aria-label="Referral episodes"'],
  ["components/pipeline/ReferralPacketCanvas.tsx", 'data-testid="workspace-identity-title"'],
  ["components/pipeline/ReferralWorklist.tsx", "formatClientIdentityTitle"],
  ["components/pipeline/ReferralWorkflowTracker.tsx", "formatClientIdentityTitle"],
  ["components/pipeline/PipelineSearchPanel.tsx", "formatClientIdentityTitle"],
  ["components/pipeline/PipelineWelcome.tsx", "clientDisplayName"],
  ["components/pipeline/PipelineCalendar.tsx", "calendarClientName"],
  ["components/pipeline/OperationsDashboard.tsx", "reportClientName"],
  ["components/pipeline/ReferralHome.tsx", "fileClientName"],
  ["components/pipeline/AssessmentWorkspace.tsx", "formatClientIdentityTitle"],
  ["components/pipeline/PipelineTrash.tsx", "formatClientIdentityTitle"],
  ["components/pipeline/HistoricalReferralProfile.tsx", "formatClientIdentityTitle"],
  ["lib/pipeline/recent-destinations.ts", "cleanRecentDestination"],
  ["lib/pipeline/client-workspace-store.ts", "normalizeClientName(row.display_name"],
  ["lib/pipeline/calendar-store.ts", "calendarClientName(row.client_name"],
  ["lib/pipeline/home-briefing.ts", "normalizeClientName(row.client_name"],
  ["lib/pipeline/client-file-import-store.ts", "normalizeClientName(row.source_client_name"],
];
const missingSurfaceContracts = [];
for (const [file, marker] of surfaceContracts) {
  const source = await readFile(path.join(root, file), "utf8");
  if (!source.includes(marker)) missingSurfaceContracts.push(file);
}
const formatterFailures = [
  formatClientIdentityTitle({ name: "Synthetic Client", gender: "Nonbinary", community: "San Pablo" })
    === "Synthetic Client",
  formatClientIdentityTitle({ name: "Synthetic Client", gender: null, community: "Turlock" })
    === "Synthetic Client",
  normalizeClientName("Synthetic Client · Nonbinary · San Pablo", { gender: "Nonbinary", community: "San Pablo" })
    === "Synthetic Client",
  normalizeClientName("Synthetic Client 123456") === "Synthetic Client",
  normalizeClientName("Xin Quan Lin - - San Francisco") === "Xin Lin",
  normalizeClientName("Xin Quan Lin -- San Francisco") === "Xin Lin",
  normalizeClientName("Xin Quan Lin - San Francisco", { community: "San Francisco" }) === "Xin Lin",
  normalizeClientName("Xuele Qu · Unknown · San Pablo", { community: "San Pablo" }) === "Xuele Qu",
  normalizeClientName("IRVIN AVILA (PSH) 09/03") === "Irvin Avila",
  normalizeClientName("Natalee Atwood-1/17/2025") === "Natalee Atwood",
  normalizeClientName("Hunter Slatten - 6/5/25 - Merced") === "Hunter Slatten",
  normalizeClientName("Christopher Abel-Jones") === "Christopher Abel-Jones",
  normalizeClientName("Zachary Laman- WL") === "Zachary Laman",
  normalizeClientName("Zachary Laman- LA JAIL") === "Zachary Laman",
  normalizeClientName("Yuri Kawaakoa- -Monterey County") === "Yuri Kawaakoa",
  normalizeClientName("Jordan Sample (Jr)") === "Jordan Sample",
  normalizeClientName("Yvonne") === "Yvonne",
  normalizeClientName("K\uFEFFhadijah Avery") === "Khadijah Avery",
  !isPersonOnlyClientName("Synthetic Pre-assessment"),
  !isPersonOnlyClientName("K Avery"),
  isPersonOnlyClientName("Khadijah Avery"),
  resolveClientGender('[{"value":"Female"}]') === "Female",
].filter((passed) => !passed).length;

const failures = {
  workspace_missing_required: sum(Object.values(workspaceMissing)),
  workspace_title_failures: workspaceTitleFailures,
  workspace_name_failures: workspaceNameFailures,
  duplicate_workspace_ids: duplicateWorkspaceIds,
  resident_missing_required: sum(Object.values(residentMissing)),
  resident_name_failures: residentNameFailures,
  history_missing_required: sum(Object.values(historyMissing)),
  history_name_failures: historyNameFailures,
  missing_surface_contracts: missingSurfaceContracts.length,
  formatter_contract_failures: formatterFailures,
};
const ok = Object.values(failures).every((count) => count === 0);

console.log(JSON.stringify({
  ok,
  data: {
    referral_workspaces: {
      audited: referrals.length,
      missing: workspaceMissing,
      title_failures: workspaceTitleFailures,
      name_failures: workspaceNameFailures,
      duplicate_workspace_ids: duplicateWorkspaceIds,
    },
    current_residents: {
      audited: residents.length,
      missing: residentMissing,
      name_failures: residentNameFailures,
      gender_source_available: residents.some((resident) => Boolean(readable(resident.gender))),
    },
    historical_episodes: {
      audited: episodes.length,
      missing: historyMissing,
      name_failures: historyNameFailures,
      gender_source_available: episodes.some((episode) => Boolean(readable(episode.gender))),
    },
  },
  presentation: {
    surfaces_audited: surfaceContracts.length,
    missing_contracts: missingSurfaceContracts,
    formatter_contract_failures: formatterFailures,
  },
  failures,
}, null, 2));

if (!ok) process.exit(1);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function countMissing(rows, fields) {
  return Object.fromEntries(fields.map((field) => [
    field,
    rows.filter((row) => !readable(row?.[field])).length,
  ]));
}

function duplicateCount(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.values()].filter((count) => count > 1).reduce((total, count) => total + count - 1, 0);
}

function readable(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
