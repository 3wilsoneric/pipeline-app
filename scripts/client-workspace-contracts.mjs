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
const reconciliationTool = read("scripts/reconcile-client-file-import.mjs");
const rollbackTool = read("scripts/rollback-client-file-import.mjs");
const referralCanvas = read("components/pipeline/ReferralPacketCanvas.tsx");
const documentRequirements = read("lib/pipeline/document-requirements.ts");
const documentReconciliation = read("lib/pipeline/document-requirement-reconciliation.ts");
const uploadCompleteRoute = read("app/api/uploads/complete/route.ts");

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
check("initial document evidence is not duplicated in local profiles", referralStore.includes("initialDocumentRequirement") && referralStore.includes("includedIds.has(requirement.evidenceDocumentId)"));
check("global files include person-only and canonical-only documents", referralStore.includes("left join pipeline.referrals") && referralStore.includes("d.canonical_client_id"));
check("directory falls back without losing Pipeline workspaces", directoryRoute.includes("catch (error)") && directoryRoute.includes("pipelinePage"));
check("manifest creation is private and bounded", manifestTool.includes("chmod(outputPath, 0o600)") && manifestTool.includes("100_000") && manifestTool.includes("100 * 1024 * 1024"));
check("metadata staging is dry-run first and idempotent", stageTool.includes("--dry-run") && stageTool.includes("on conflict (import_batch_id, source_item_id) do nothing"));
check("binary import requires explicit confirmation", importTool.includes("UPLOAD-CONFIRMED-CLIENT-FILES") && importTool.includes("if (!dryRun"));
check("binary import verifies bytes before upload", importTool.includes("sha256 !== row.source_sha256") && importTool.includes("bytes.length !== Number(row.source_byte_size)"));
check("binary import uses deterministic blob keys and source identities", importTool.includes("client-import/${row.source_system}/${row.import_batch_id}/${row.import_item_id}") && migration.includes("documents_source_external_unique_idx"));
check("binary import does not overwrite an existing deterministic blob", importTool.includes('conditions: { ifNoneMatch: "*" }') && importTool.includes("existing_blob_mismatch"));
check("concurrent binary import retries converge on one document", importTool.includes("on conflict (source_system, source_external_id)") && importTool.includes("document_identity_conflict"));
check("binary import completes batches with reviewed exclusions", importTool.includes("counts.imported_count + counts.rejected_count = b.item_count"));
check("governed directory rows expose linked Pipeline file counts", workspaceStore.includes("getClinicalClientWorkspaceSummaries") && workspaceStore.includes("document_count"));
check("binary import never auto-imports unmatched rows", importTool.includes("i.match_status = 'confirmed'") && importTool.includes("i.imported_document_id is null"));
check("historical reconciliation is read-only by default", reconciliationTool.includes('args.has("--database")') && reconciliationTool.includes('args.has("--verify-blobs")') && !reconciliationTool.includes("insert into pipeline") && !reconciliationTool.includes("update pipeline"));
check("historical reconciliation emits a PHI-safe aggregate summary", reconciliationTool.includes("local_sources_verified") && reconciliationTool.includes("blob_objects_verified") && reconciliationTool.includes("counts,") && reconciliationTool.includes("protected_reconciliation_detail"));
check("historical reconciliation covers every disposition", ["present", "metadata-only", "file-only", "unmatched", "structured-not-imported", "intentionally-excluded", "source-changed"].every((status) => reconciliationTool.includes(status)));
check("client-file rollback is dry-run first and doubly confirmed", rollbackTool.includes("ROLLBACK-CONFIRMED-CLIENT-FILE-BATCH") && rollbackTool.includes("PIPELINE_CLIENT_FILE_ROLLBACK_ENABLED"));
check("client-file rollback refuses documents already used as evidence", rollbackTool.includes("downstream_references_present") && rollbackTool.includes("referral_fields") && rollbackTool.includes("work_items"));
check("client-file rollback is retryable across database and Blob phases", rollbackTool.includes("prepareRollback") && rollbackTool.includes("deleteBlobTargets") && rollbackTool.includes("finalizeRollback"));
check("document requirements have one category mapping", documentRequirements.includes("categoryByRequirement") && documentRequirements.includes("requirementByCategory"));
check("upload completion reconciles checklist evidence server-side", uploadCompleteRoute.includes("reconcileUploadedDocumentRequirements") && documentReconciliation.includes("patchReferralWorkItem"));
check("checklist reconciliation preserves reviewed evidence", documentReconciliation.includes('["reviewed", "waived"].includes(requirement.status)') && documentReconciliation.includes("requirement.evidenceDocumentId"));
check("supporting drop zones upload immediately for saved referrals", referralCanvas.includes('processing_intent: "preview_only"') && referralCanvas.includes("refreshed.referral") && referralCanvas.includes("linkedRequirement?.evidenceDocumentId"));
check("initial uploads require an explicit document type", referralCanvas.includes('aria-label="Initial document type"') && referralCanvas.includes('"face_sheet" | "referral_packet"'));
check("rollback removes only client-workspace additions", rollback.includes("client_file_import_items") && rollback.includes("client_community") && !rollback.includes("drop schema"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);
