#!/usr/bin/env node

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const store = read("lib/pipeline/referral-store.ts");
const assessments = read("lib/assessment/assessment-store.ts");
const residentLinks = read("lib/pipeline/resident-link-store.ts");
const processingWorker = read("lib/extraction/processing-worker.ts");
const cursor = read("lib/pipeline/keyset-cursor.ts");
const migration = read("database/migrations/0004_document_processing.sql");
const operations = read("lib/pipeline/operations-snapshot.ts");
const changeMetadataQuery = store.match(/async function getPostgresReferralChangeMetadata[\s\S]*?\n}\n/)?.[0] ?? "";
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

check("referral and file lists do not use SQL offset", !/limit \$\{limit\} offset/i.test(store));
check("assessment lists do not use SQL offset", !/limit \$\{limit\} offset/i.test(assessments));
check("resident-link lists do not use SQL offset", !/limit \$\{limit\} offset/i.test(residentLinks));
check("referral and file lists encode keyset cursors", store.includes("encodeKeysetCursor") && store.includes("decodeKeysetCursor"));
check("assessment lists encode keyset cursors", assessments.includes("encodeKeysetCursor") && assessments.includes("decodeKeysetCursor"));
check("resident-link lists encode keyset cursors", residentLinks.includes("encodeKeysetCursor") && residentLinks.includes("decodeKeysetCursor"));
check("keyset cursor is versioned and bounded", cursor.includes("v: 1") && cursor.includes("{8,512}"));
check("referral ordering has a matching index", migration.includes("referrals_updated_keyset_idx"));
check("document ordering has a matching index", migration.includes("documents_uploaded_keyset_idx"));
check("assessment ordering has a matching index", migration.includes("assessments_updated_keyset_idx"));
check("resident-link ordering has a matching index", migration.includes("resident_links_updated_keyset_idx"));
check("active queue paging is bounded", operations.includes("limit: 200") && operations.includes("referrals.length < 5_000"));
check("API page size remains capped", store.includes("const maxPageSize = 200"));
check(
  "active-canvas change checks read metadata only",
  changeMetadataQuery.includes("select version, section_versions, updated_at, updated_by, updated_by_name")
    && !changeMetadataQuery.includes("select r.*")
    && !changeMetadataQuery.includes(" data,"),
);
check("packet field counts use the document-to-packet join", !processingWorker.includes("rf.packet_id") && processingWorker.includes("pf.document_id = rf.source_document_id"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length) process.exit(1);
