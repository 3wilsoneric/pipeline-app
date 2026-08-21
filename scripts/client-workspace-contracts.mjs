#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");
const migration = read("database/migrations/0008_client_workspaces.sql");
const rollback = read("database/rollbacks/0008_client_workspaces.sql");
const referralStore = read("lib/pipeline/referral-store.ts");
const workspaceStore = read("lib/pipeline/client-workspace-store.ts");
const profileStore = read("lib/pipeline/unified-profile.ts");
const importStore = read("lib/pipeline/client-file-import-store.ts");
const importRoute = read("app/api/files/import-review/[itemId]/route.ts");
const directoryRoute = read("app/api/profiles/directory/route.ts");
const manifestTool = read("scripts/create-client-file-import-manifest.mjs");
const stageTool = read("scripts/stage-client-file-import.mjs");
const importTool = read("scripts/import-confirmed-client-files.mjs");
const referralCanvas = read("components/pipeline/ReferralPacketCanvas.tsx");

const checks = [];
const check = (name, value) => checks.push({ name, ok: Boolean(value) });

check("documents retain source and client identity", [
  "source_system", "source_external_id", "source_canvas_id", "canonical_client_id",
  "client_display_name", "client_community", "identity_status",
].every((column) => migration.includes(column)));
check("referral documents backfill person identity deterministically", migration.includes("from pipeline.referrals r") && migration.includes("d.referral_id = r.referral_id"));
check("unmatched imports stay outside durable documents", migration.includes("client_file_import_items") && migration.includes("match_status text not null default 'unmatched'"));
check("historical clients can be created only by explicit review", importRoute.includes('action !== "create_client"') && importStore.includes('input.action === "create_client"'));
check("historical clients use a new stable Pipeline identity", importStore.includes("historical-${randomUUID()}") && importStore.includes("insert into pipeline.people"));
check("file-only people appear in the unified directory", workspaceStore.includes("pipeline.documents access_document") && workspaceStore.includes("access_document.identity_status = 'linked'"));
check("confirmed resident links use the physical person relationship", workspaceStore.includes("rl.person_id = p.person_id") && !workspaceStore.includes("rl.pipeline_client_id"));
check("assessors cannot discover unassigned file-only workspaces", workspaceStore.includes("${ownerId}::text is null and exists") && profileStore.includes("isAssessorUser(user) && referrals.length === 0"));
check("file-only profiles load from durable documents", profileStore.includes("referrals.length === 0 && documents.length === 0") && profileStore.includes("historical workspace preserves reviewed client files"));
check("checklist evidence appears in the local client inventory", referralStore.includes("requirement.evidenceDocumentId") && referralStore.includes("requirementFileCategory"));
check("global files include person-only and canonical-only documents", referralStore.includes("left join pipeline.referrals") && referralStore.includes("d.canonical_client_id"));
check("directory falls back without losing Pipeline workspaces", directoryRoute.includes("catch (error)") && directoryRoute.includes("pipelinePage"));
check("manifest creation is private and bounded", manifestTool.includes("chmod(outputPath, 0o600)") && manifestTool.includes("100_000") && manifestTool.includes("100 * 1024 * 1024"));
check("metadata staging is dry-run first and idempotent", stageTool.includes("--dry-run") && stageTool.includes("on conflict (import_batch_id, source_item_id) do nothing"));
check("binary import requires explicit confirmation", importTool.includes("UPLOAD-CONFIRMED-CLIENT-FILES") && importTool.includes("if (!dryRun"));
check("binary import verifies bytes before upload", importTool.includes("sha256 !== row.source_sha256") && importTool.includes("bytes.length !== Number(row.source_byte_size)"));
check("binary import uses deterministic blob keys and source identities", importTool.includes("client-import/${row.source_system}/${row.import_batch_id}/${row.import_item_id}") && migration.includes("documents_source_external_unique_idx"));
check("governed directory rows expose linked Pipeline file counts", workspaceStore.includes("getClinicalClientWorkspaceSummaries") && workspaceStore.includes("document_count"));
check("binary import never auto-imports unmatched rows", importTool.includes("i.match_status = 'confirmed'") && importTool.includes("i.imported_document_id is null"));
check("supporting drop zones upload immediately for saved referrals", referralCanvas.includes('processing_intent: "preview_only"') && referralCanvas.includes("evidenceDocumentId"));
check("rollback removes only client-workspace additions", rollback.includes("client_file_import_items") && rollback.includes("client_community") && !rollback.includes("drop schema"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);
