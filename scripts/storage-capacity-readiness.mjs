#!/usr/bin/env node

import { readFileSync } from "node:fs";

const inventory = readFileSync("lib/extraction/storage-inventory.ts", "utf8");
const retentionRoute = readFileSync("app/api/internal/retention/route.ts", "utf8");
const blob = readFileSync("lib/extraction/azure-blob.ts", "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("storage inventory counts active and deleted document records", inventory.includes("active_documents") && inventory.includes("deleted_documents"));
check("storage inventory totals source, preview, and artifact bytes", ["source_bytes", "preview_bytes", "artifact_bytes"].every((value) => inventory.includes(value)));
check("storage inventory detects stale reservations and retention candidates", inventory.includes("stale_reservations") && inventory.includes("retention_candidates"));
check("storage inventory is included in the authenticated retention run", retentionRoute.includes("getStorageInventory()") && retentionRoute.includes("storage_inventory"));
check("storage failures emit a bounded aggregate metric", blob.includes('"pipeline.storage.failures"') && blob.includes("storageFailure(\"properties\")") && blob.includes("storageFailure(\"delete\")"));
check("inventory emits aggregate capacity metrics", [
  "pipeline.storage.source_bytes",
  "pipeline.storage.preview_bytes",
  "pipeline.storage.artifact_bytes",
  "pipeline.storage.documents",
].every((value) => inventory.includes(value)));
check("inventory never returns record identifiers or filenames", !/file_name|blob_key|person_id|referral_id/.test(inventory.slice(inventory.indexOf("export type StorageInventory"), inventory.indexOf("export async function"))));
check("inventory failures do not expose upstream errors", inventory.includes('reason: "database_unavailable" | "inventory_query_failed"') && !inventory.includes("error.message"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);
