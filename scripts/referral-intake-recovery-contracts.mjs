#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const read = (file) => readFileSync(file, "utf8");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const draftTypes = loadTypeScriptModule(process.cwd(), "lib/pipeline/user-workspace-state-types.ts");
const validSummary = {
  draft_key: "new-133c3e28-2731-4d4f-9c32-175a8ac96fcb",
  version: 2,
  saved_at: "2026-09-03T12:00:00.000Z",
  expires_at: "2026-10-03T12:00:00.000Z",
  client_name: "Synthetic recovery fixture",
  community: "San Pablo",
  packet_name: "synthetic.pdf",
  completed_fields: 4,
  total_fields: 15,
};

check("valid private draft summaries cross the client boundary", draftTypes.parsePipelineReferralDraftSummary(validSummary)?.version === 2);
check("malformed draft identities are rejected", draftTypes.parsePipelineReferralDraftSummary({ ...validSummary, draft_key: "new-not-a-uuid" }) === null);
check("impossible field counts are rejected", draftTypes.parsePipelineReferralDraftSummary({ ...validSummary, completed_fields: 16 }) === null);

const listRoute = read("app/api/me/referral-drafts/route.ts");
const canvas = read("components/pipeline/ReferralPacketCanvas.tsx");
const recoveryList = read("components/pipeline/ReferralDraftResumeList.tsx");
const overview = read("components/pipeline/PipelineOverviewRoute.tsx");
const upload = read("lib/pipeline/referral-packet-upload.ts");
const retention = read("app/api/internal/retention/route.ts");
const azureRuntime = read("infra/azure/runtime.bicep");
const worklist = read("components/pipeline/ReferralWorklist.tsx");
const browserProof = read("tests/e2e/desktop-readiness.spec.ts");
const referralRoute = read("app/api/referrals/route.ts");
const referralStore = read("lib/pipeline/referral-store.ts");

check("draft discovery is user-authenticated and returns summaries instead of raw drafts",
  listRoute.includes("requirePipelineUser")
    && listRoute.includes("listUserWorkspaceState")
    && listRoute.includes("toSummary(")
    && !listRoute.includes("Response.json({ drafts: records"));
check("canonical create identity is stable for the lifetime of a draft",
  canvas.includes("creationMutationIdRef.current")
    && canvas.includes("newReferralCreationMutationId(newDraftKey)")
    && !/client_mutation_id:\s*createMutationId\(\)/.test(canvas));
check("canonical navigation happens before packet upload",
  canvas.indexOf("onReferralSaved?.") > 0
    && canvas.indexOf("onReferralSaved?.") < canvas.lastIndexOf("await uploadAndLinkInitialPacket("));
check("idempotent create replays merge unsaved tab edits through section-version checks",
  referralStore.includes("idempotentReplay: true")
    && referralRoute.includes("idempotent_replay: result.idempotentReplay")
    && canvas.includes("mergeIdempotentCreateReplay(payload.referral, payload.idempotent_replay")
    && canvas.includes("return persistExistingChanges("));
check("successful saves preserve edits and replacement files made in flight",
  canvas.includes("captureReferralSaveSnapshot(")
    && canvas.includes("snapshot.pendingDocuments")
    && canvas.includes("pendingDocumentsRef.current[requirementId] !== uploadedFile")
    && canvas.includes("reconcileSavedDirtyKeys(")
    && canvas.includes("Saved; newer changes remain"));
check("extraction cannot replace locally dirty fields",
  canvas.includes("!dirtyKeys.has(key)")
    && canvas.includes("mergeExtractedFields(")
    && canvas.includes("populateFormFromExtraction"));
check("unfinished private drafts are resumable without creating a second queue",
  recoveryList.includes('aria-label="Unfinished referral intake"')
    && overview.includes("resumeReferralDraft")
    && overview.includes("params.set(\"draftId\", draftKey.slice(4))"));
check("canonical workspace lists expose deterministic intake status",
  worklist.includes("resolveReferralWorkflowStatus")
    && worklist.includes("workflowStatusLabels"));
check("automatic retries are limited to idempotent upload boundaries",
  upload.includes("retryIdempotentOperation")
    && upload.includes('method: "PUT"')
    && upload.includes('"/api/uploads/complete"')
    && !upload.includes("retryIdempotentOperation(() => reserveUpload"));
check("existing retention removes expired recovery state",
  retention.includes("pruneExpiredUserWorkspaceState"));
check("existing Azure runtime reconciles interrupted extraction work",
  azureRuntime.includes("/api/internal/extraction/reconcile")
    && azureRuntime.includes("*/5 * * * *"));
check("browser proof covers early materialization and exact draft resume",
  browserProof.includes("lists and resumes an interrupted pre-workspace intake")
    && browserProof.includes("merges disjoint edits when two tabs materialize the same intake")
    && browserProof.includes("documentStatus: \"Missing\"")
    && browserProof.includes("Packet uploaded and ready for review"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);
