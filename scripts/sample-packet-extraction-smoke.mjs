#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const samplePath = process.env.PIPELINE_SAMPLE_PACKET_PATH?.trim();
const baseUrl = (process.env.PIPELINE_SAMPLE_BASE_URL?.trim() || "http://127.0.0.1:3000").replace(/\/$/, "");
const timeoutMs = boundedInteger("PIPELINE_SAMPLE_EXTRACTION_TIMEOUT_MS", 5 * 60_000, 5_000, 20 * 60_000);
if (!samplePath) fail("Set PIPELINE_SAMPLE_PACKET_PATH to a local PDF before running this smoke check.");

const metadata = await stat(samplePath).catch(() => null);
if (!metadata?.isFile()) fail("The configured sample packet is not a readable file.");
if (metadata.size <= 0 || metadata.size > 100 * 1024 * 1024) fail("The sample packet must be between 1 byte and 100 MB.");
const pageCount = readPdfPageCount(samplePath);
if (!Number.isInteger(pageCount) || pageCount < 1) fail("The sample packet page count could not be verified.");
const bytes = await readFile(samplePath);
const digest = createHash("sha256").update(bytes).digest("hex");
const now = new Date();
const genericFileName = "sample-referral-packet.pdf";

const created = await json("/api/referrals", {
  method: "POST",
  body: {
    client_mutation_id: `sample-packet-${randomUUID()}`,
    referral: {
      name: "Sample Packet Validation",
      date: now.toISOString().slice(0, 10),
      stage: "New",
      community: "San Pablo",
      source: "Engineering validation",
      priority: "standard",
      tags: ["sample-validation"],
      documentName: genericFileName,
      documentSizeBytes: metadata.size,
      documentStatus: "Missing",
      owner: "Engineering Validation",
      note: "",
      createdAt: now.toISOString(),
      dob: "",
      phone: "",
      email: "",
      payer: "",
      requirements: [],
    },
  },
});
const referral = created.referral;
if (!referral?.id) fail("The validation referral was not created.");

const fileId = `sample_${randomUUID()}`;
const reservation = await json("/api/uploads/create-url", {
  method: "POST",
  body: {
    referral_id: String(referral.id),
    submitting_facility: "San Pablo",
    source_type: "manual",
    files: [{
      file_id: fileId,
      filename: genericFileName,
      content_type: "application/pdf",
      size: metadata.size,
      sha256: digest,
    }],
  },
});
const target = reservation.uploads?.find((upload) => upload.file_id === fileId);
if (!target) fail("The upload reservation did not include the sample file.");
const isMock = new URL(target.signed_url).hostname === "mock-storage.local";
if (!isMock) {
  await put(target.signed_url, bytes, "application/pdf");
  await put(reservation.sentinel_url, new Uint8Array(), "application/octet-stream");
}

await json("/api/uploads/complete", {
  method: "POST",
  body: { packet_id: reservation.packet_id, uploaded_file_ids: [fileId] },
});
const status = await waitForReviewableStatus(reservation.packet_id, timeoutMs);
const fieldsPayload = await json(`/api/packets/${encodeURIComponent(reservation.packet_id)}/fields`);
const fields = Array.isArray(fieldsPayload.fields) ? fieldsPayload.fields : [];
if (fields.length === 0) fail("Extraction returned no reviewable fields.");
if (!fields.every((field) => Number.isInteger(field.source_page_no) && field.source_page_no > 0)) {
  fail("Every extracted field must identify a positive source page.");
}
if (!fields.some((field) => typeof field.evidence_url === "string" && field.evidence_url.length > 0)) {
  fail("At least one extracted field must expose an authenticated evidence reference.");
}

const correctedField = fields[0];
await json(`/api/packets/${encodeURIComponent(reservation.packet_id)}/fields/${encodeURIComponent(correctedField.field_key)}/review`, {
  method: "POST",
  body: {
    if_match: correctedField.version,
    action: "edit",
    value: "Engineering correction verified",
  },
});
const correctedPayload = await json(`/api/packets/${encodeURIComponent(reservation.packet_id)}/fields`);
const auditEvents = Array.isArray(correctedPayload.audit_events) ? correctedPayload.audit_events : [];
if (!auditEvents.some((event) => event.field_key === correctedField.field_key && event.action === "edit")) {
  fail("The extracted-field correction was not present in correction history.");
}

const linked = await json(`/api/referrals/${referral.id}`, {
  method: "PATCH",
  body: {
    if_match: referral.version,
    if_match_sections: { documents: referral.sectionVersions?.documents ?? 1 },
    patch: {
      documentName: genericFileName,
      documentSizeBytes: metadata.size,
      documentHash: digest,
      documentStatus: "Uploaded",
      packetId: reservation.packet_id,
      packetStatus: status.status,
      packetFields: correctedPayload.fields,
      packetReadiness: correctedPayload.ehr_readiness,
      packetCompleteness: correctedPayload.packet_completeness,
    },
  },
});
if (!linked.referral?.packetId) fail("The reviewed extraction was not linked to the referral.");

console.log(JSON.stringify({
  ok: true,
  backend: isMock ? "mock" : "durable",
  sample: {
    bytes: metadata.size,
    pages: pageCount,
  },
  extraction: {
    status: status.status,
    field_count: fields.length,
    evidence_field_count: fields.filter((field) => field.evidence_url).length,
    referenced_pages: [...new Set(fields.map((field) => field.source_page_no))].sort((left, right) => left - right),
    correction_history_count: auditEvents.length,
  },
}, null, 2));

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.error === "string" && payload.error.length <= 300 ? ` ${payload.error}` : "";
    fail(`Pipeline returned HTTP ${response.status} for ${new URL(path, baseUrl).pathname}.${detail}`);
  }
  return payload;
}

async function put(url, body, contentType) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType, "x-ms-blob-type": "BlockBlob" },
    body,
  });
  if (!response.ok) fail(`Secure storage returned HTTP ${response.status}.`);
}

async function waitForReviewableStatus(packetId, maximumWaitMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maximumWaitMs) {
    const status = await json(`/api/packets/${encodeURIComponent(packetId)}/status`);
    if (["ready_for_review", "reviewed"].includes(status.status)) return status;
    if (status.status === "failed") fail("Sample extraction entered a failed state.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  fail("Sample extraction did not become reviewable before the timeout.");
}

function readPdfPageCount(path) {
  const output = execFileSync("pdfinfo", [path], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  const match = /^Pages:\s+(\d+)$/m.exec(output);
  return match ? Number(match[1]) : 0;
}

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
