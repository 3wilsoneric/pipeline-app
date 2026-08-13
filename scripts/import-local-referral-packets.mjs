#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const confirmation = "IMPORT-USER-SUPPLIED-REAL-REFERRALS";
const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...rest] = argument.split("=");
  return [key, rest.join("=")];
}));
const manifestPath = args.get("--manifest");
const baseUrl = new URL(args.get("--base-url") || "http://localhost:3000");
const confirmed = args.get("--confirm") === confirmation;
const dryRun = args.has("--dry-run");

if (!manifestPath) fail("Use --manifest=/absolute/path/to/private-manifest.json.");
if (!["127.0.0.1", "localhost"].includes(baseUrl.hostname)) fail("Local referral import only accepts a loopback Pipeline URL.");
if (!dryRun && !confirmed) fail(`Refusing to import without --confirm=${confirmation}.`);

const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
if (manifest.version !== 1 || manifest.data_class !== "user_supplied_real") {
  fail("The manifest must declare version 1 and data_class user_supplied_real.");
}
if (!Array.isArray(manifest.packets) || manifest.packets.length === 0 || manifest.packets.length > 100) {
  fail("The manifest must contain between 1 and 100 packets.");
}

const prepared = [];
for (const [index, packet] of manifest.packets.entries()) {
  if (!packet || typeof packet !== "object" || packet.provenance_class !== "user_supplied_real") {
    fail(`Packet ${index + 1} is missing real-data provenance.`);
  }
  const sourcePath = path.resolve(String(packet.source_path || ""));
  const metadata = await stat(sourcePath);
  if (!metadata.isFile() || metadata.size < 5 || metadata.size > 100 * 1024 * 1024) {
    fail(`Packet ${index + 1} is not a supported file size.`);
  }
  const bytes = await readFile(sourcePath);
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") fail(`Packet ${index + 1} is not a PDF.`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const tags = Array.isArray(packet.referral?.tags) ? packet.referral.tags.map((tag) => String(tag).toLowerCase()) : [];
  if (tags.some((tag) => /(^|[-_])(fake|sample|synthetic|demo)([-_]|$)/.test(tag))) {
    fail(`Packet ${index + 1} contains a forbidden synthetic-data tag.`);
  }
  prepared.push({ packet, sourcePath, metadata, hash });
}

if (dryRun) {
  console.log(JSON.stringify({ ok: true, dry_run: true, packet_count: prepared.length, data_class: manifest.data_class }));
  process.exit(0);
}

const storageRoot = path.resolve(process.env.PIPELINE_LOCAL_DOCUMENT_ROOT?.trim() || ".data/documents");
await mkdir(storageRoot, { recursive: true, mode: 0o700 });
await chmod(storageRoot, 0o700);
let imported = 0;
let existing = 0;

for (const { packet, sourcePath, metadata, hash } of prepared) {
  const packetId = `local-${hash.slice(0, 32)}`;
  const storageDirectory = path.join(storageRoot, hash);
  const storagePath = path.join(storageDirectory, "original.pdf");
  await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
  await chmod(storageDirectory, 0o700);
  await copyFile(sourcePath, storagePath);
  await chmod(storagePath, 0o600);

  const referral = {
    ...packet.referral,
    clientId: packet.referral.clientId || `intake-${hash.slice(0, 24)}`,
    stage: "New",
    community: packet.referral.community || "Unassigned",
    owner: packet.referral.owner || "Unassigned",
    documentName: path.basename(sourcePath),
    documentSizeBytes: metadata.size,
    documentHash: hash,
    documentStatus: "Uploaded",
    packetId,
    packetStatus: "ready_for_review",
  };
  const response = await fetch(new URL("/api/referrals", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl.origin,
    },
    body: JSON.stringify({
      client_mutation_id: `real-referral-${hash}`,
      referral,
    }),
  });
  if (response.status === 409) {
    existing += 1;
    continue;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    fail(`Pipeline rejected packet ${imported + existing + 1}: ${payload.error || `HTTP ${response.status}`}`);
  }
  imported += 1;
}

const auditPath = path.resolve(".data/local-real-import-events.jsonl");
await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
const existingAudit = await readFile(auditPath, "utf8").catch(() => "");
const temporaryAudit = `${auditPath}.${process.pid}.tmp`;
const event = JSON.stringify({
  event: "local_real_referral_import",
  imported,
  existing,
  attempted: prepared.length,
  actor: "local_operator",
  occurred_at: new Date().toISOString(),
});
await writeFile(temporaryAudit, `${existingAudit}${event}\n`, { mode: 0o600 });
await chmod(temporaryAudit, 0o600);
await rename(temporaryAudit, auditPath);

console.log(JSON.stringify({ ok: true, imported, existing, total: prepared.length, data_class: manifest.data_class }));

function fail(message) {
  console.error(message);
  process.exit(1);
}
