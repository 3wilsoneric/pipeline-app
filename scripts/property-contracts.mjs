#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const cursor = loadTypeScriptModule(root, "lib/pipeline/keyset-cursor.ts");
const referralSortCursor = loadTypeScriptModule(root, "lib/pipeline/referral-sort-cursor.ts");
const sections = loadTypeScriptModule(root, "lib/pipeline/referral-sections.ts");
const workflow = loadTypeScriptModule(root, "lib/pipeline/referral-workflow.ts");
const siteSearch = loadTypeScriptModule(root, "lib/pipeline/site-search.ts");
const uploads = loadTypeScriptModule(root, "lib/extraction/contracts.ts");
const ranges = loadTypeScriptModule(root, "lib/extraction/http-byte-range.ts");
const checks = [];
const check = (name, condition, cases) => checks.push({ name, ok: Boolean(condition), cases });
const random = mulberry32(0x50495045);

let cursorRoundTrips = true;
let cursorRejects = true;
for (let index = 0; index < 2_000; index += 1) {
  const timestamp = new Date(Date.UTC(2020 + integer(0, 10), integer(0, 12), integer(1, 28), integer(0, 24), integer(0, 60), integer(0, 60), integer(0, 1_000))).toISOString();
  const key = `referral-${integer(1, 1_000_000)}:${integer(0, 999)}`;
  const encoded = cursor.encodeKeysetCursor({ timestamp, key });
  const decoded = cursor.decodeKeysetCursor(encoded);
  cursorRoundTrips &&= decoded?.timestamp === timestamp && decoded?.key === key;
  cursorRejects &&= cursor.decodeKeysetCursor(randomGarbage(integer(1, 700))) === null;
}
check("keyset cursors round-trip and reject generated garbage", cursorRoundTrips && cursorRejects, 4_000);

let referralSortCursorRoundTrips = true;
let referralSortCursorRejectsMismatch = true;
const referralSorts = ["updated_desc", "created_desc", "created_asc", "owner_asc", "community_asc", "client_asc"];
for (let index = 0; index < 2_000; index += 1) {
  const sort = referralSorts[index % referralSorts.length];
  const value = sort.endsWith("_asc") && !sort.startsWith("created")
    ? `sort value ${integer(1, 1_000_000)}`
    : new Date(Date.UTC(2020 + integer(0, 10), integer(0, 12), integer(1, 28))).toISOString();
  const key = String(integer(1, 1_000_000));
  const encoded = referralSortCursor.encodeReferralSortCursor({ sort, value, key });
  const decoded = referralSortCursor.decodeReferralSortCursor(encoded, sort);
  referralSortCursorRoundTrips &&= decoded?.sort === sort && decoded?.value === value && decoded?.key === key;
  const otherSort = referralSorts[(index + 1) % referralSorts.length];
  referralSortCursorRejectsMismatch &&= referralSortCursor.decodeReferralSortCursor(encoded, otherSort) === null;
}
check("referral sort cursors preserve sort order and reject mismatched reuse", referralSortCursorRoundTrips && referralSortCursorRejectsMismatch, 4_000);

let rangesCorrect = true;
for (let index = 0; index < 3_000; index += 1) {
  const start = integer(0, 10_000_000);
  const end = integer(0, 10_000_000);
  rangesCorrect &&= ranges.isValidHttpByteRange(`bytes=${start}-${end}`) === (start <= end);
  rangesCorrect &&= ranges.isValidHttpByteRange(`bytes=${start}-`);
  rangesCorrect &&= ranges.isValidHttpByteRange(`bytes=-${end}`);
  rangesCorrect &&= !ranges.isValidHttpByteRange(`items=${start}-${end}`);
}
check("HTTP byte ranges obey ordering, suffix, and unit rules", rangesCorrect, 12_000);

let uploadBoundsCorrect = true;
for (let index = 0; index < 2_000; index += 1) {
  const count = integer(0, uploads.maxUploadFilesPerRequest + 8);
  const files = Array.from({ length: count }, (_, fileIndex) => ({
    file_id: `file-${index}-${fileIndex}`,
    filename: `synthetic-${fileIndex}.pdf`,
    content_type: "application/pdf",
    size: integer(1, uploads.maxUploadFileBytes),
  }));
  const result = uploads.validateCreateUploadUrlRequest({
    referral_id: String(index + 1),
    submitting_facility: "Synthetic fixture",
    source_type: "manual",
    files,
  });
  uploadBoundsCorrect &&= result.ok === (count >= 1 && count <= uploads.maxUploadFilesPerRequest && files.reduce((sum, file) => sum + file.size, 0) <= uploads.maxUploadRequestBytes);
}
check("upload descriptors enforce file-count and aggregate-size bounds", uploadBoundsCorrect, 2_000);

let sectionContentionCorrect = true;
for (let index = 0; index < 2_000; index += 1) {
  const current = sections.defaultReferralSectionVersions();
  const first = index % 2 === 0 ? "identity" : "intake";
  const second = index % 3 === 0 ? first : "documents";
  const afterFirst = sections.incrementReferralSections(current, [first]);
  sectionContentionCorrect &&= afterFirst[first] === current[first] + 1;
  if (first !== second) sectionContentionCorrect &&= afterFirst[second] === current[second];
  if (first === second) sectionContentionCorrect &&= current[second] !== afterFirst[second];
}
check("section versions isolate disjoint edits and expose same-section staleness", sectionContentionCorrect, 2_000);

let transitionsConstrained = true;
for (let index = 0; index < 1_000; index += 1) {
  const source = workflow.boardStages[integer(0, workflow.boardStages.length)];
  const target = workflow.boardStages[integer(0, workflow.boardStages.length)];
  const referral = syntheticReferral(source, index);
  const allowed = workflow.getAllowedReferralTargets(source).includes(target) || source === target;
  const blockers = workflow.getReferralTransitionBlockers(referral, target, {
    assessmentComplete: false,
    decision: null,
    requirements: [],
  });
  if (!allowed) transitionsConstrained &&= blockers.some((item) => item.code === "stage_sequence");
  if (source === target) transitionsConstrained &&= blockers.length === 0;
}
check("workflow fuzzing rejects non-sequential transitions", transitionsConstrained, 1_000);

const profileSearch = siteSearch.searchSiteDestinations("client profiles");
const typoSearch = siteSearch.searchSiteDestinations("profles");
const queueSearch = siteSearch.searchSiteDestinations("overdue queue");
const unrelatedSearch = siteSearch.searchSiteDestinations("zzyzx");
check(
  "site search resolves aliases and one-character typos without guessing unrelated destinations",
  profileSearch[0]?.screen === "profiles"
    && typoSearch[0]?.screen === "profiles"
    && queueSearch[0]?.screen === "operations"
    && unrelatedSearch.length === 0,
  4,
);

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  seed: "0x50495045",
  generated_cases: checks.reduce((sum, item) => sum + item.cases, 0),
  checks,
  note: "Generated values are synthetic and only aggregate outcomes are emitted.",
}, null, 2));
if (failed.length > 0) process.exit(1);

function integer(minimum, maximumExclusive) {
  return minimum + Math.floor(random() * Math.max(1, maximumExclusive - minimum));
}

function randomGarbage(length) {
  const alphabet = "!@#$%^&*(){}[];,'\"/\\ abcdef0123456789";
  return Array.from({ length }, () => alphabet[integer(0, alphabet.length)]).join("");
}

function syntheticReferral(stage, index) {
  return {
    id: index + 1,
    name: "Synthetic Person",
    date: "2026-01-01",
    stage,
    community: "San Pablo",
    source: "Synthetic",
    priority: "standard",
    documentName: "",
    documentStatus: "Missing",
    owner: "",
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    dob: "",
    phone: "",
    email: "",
    payer: "",
  };
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
