#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readlink, writeFile } from "node:fs/promises";

const options = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const checksums = JSON.parse(await readFile("database/migration-checksums.json", "utf8"));
const revision = sourceRevision();
const sourceState = await fingerprintSourceState(revision);
const manifest = {
  schema_version: 2,
  created_at: releaseTimestamp(),
  application: packageJson.name,
  application_version: packageJson.version,
  source_revision: revision,
  source_dirty: sourceState.tracked_file_count > 0 || sourceState.untracked_file_count > 0,
  source_state: sourceState,
  runtime: process.version,
  framework: packageJson.dependencies?.next ?? null,
  package_lock_sha256: await sha256("package-lock.json"),
  migration_manifest_sha256: await sha256("database/migration-checksums.json"),
  ci_workflow_sha256: await sha256(".github/workflows/ci.yml"),
  security_workflow_sha256: await sha256(".github/workflows/security.yml"),
  route_policy_sha256: await sha256("scripts/api-route-policy-audit.mjs"),
  operational_alerts_sha256: await sha256("infra/azure/operational-alerts.bicep"),
  migrations: Object.keys(checksums.migrations ?? {}).sort(),
  desktop_distribution: {
    enabled_by_default: false,
    service_worker_sha256: await sha256("public/sw.js"),
    offline_fallback_sha256: await sha256("public/offline.html"),
    manifest_route_sha256: await sha256("app/desktop-manifest.webmanifest/route.ts"),
  },
  required_quality_gates: [
    "npm run check:platform",
    "npm run test:e2e",
    "npm run test:e2e:desktop",
    "npm run test:e2e:cross-browser",
    "npm run test:e2e:visual",
    "npm run check:artifacts",
    "npm run check:route-policy",
    "npm run check:supply-chain",
    "npm run check:alerts",
  ],
  required_health_checks: [
    "/api/health",
    "/api/clinical/health",
  ],
  external_configuration_required: [
    "Azure PostgreSQL",
    "Microsoft Entra",
    "Alamo clinical API",
    "Azure Blob and extraction worker",
    "Azure Monitor log forwarding and action groups",
    "Distributed edge rate limiting",
    "MSIX publisher and signing identity",
  ],
};
if (options.out) await writeFile(options.out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  ...(options.out ? { manifest_file: options.out } : {}),
  manifest,
  note: "The release manifest contains hashes and version identifiers only; it contains no environment values or data.",
}, null, 2));

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function sourceRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unavailable";
  }
}

async function fingerprintSourceState(revision) {
  const trackedPatch = gitBuffer(["diff", "--binary", "--full-index", "HEAD", "--", "."]);
  const trackedPaths = nulSeparatedPaths(gitBuffer(["diff", "--name-only", "-z", "HEAD", "--", "."]));
  const untrackedPaths = nulSeparatedPaths(gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"]));
  const untrackedHash = createHash("sha256");

  for (const file of untrackedPaths) {
    const metadata = await lstat(file);
    const payload = metadata.isSymbolicLink()
      ? Buffer.from(await readlink(file), "utf8")
      : await readFile(file);
    addLengthPrefixed(untrackedHash, Buffer.from(file, "utf8"));
    addLengthPrefixed(untrackedHash, Buffer.from(metadata.isSymbolicLink() ? "symlink" : "file", "utf8"));
    addLengthPrefixed(untrackedHash, Buffer.from((metadata.mode & 0o777).toString(8), "utf8"));
    addLengthPrefixed(untrackedHash, Buffer.from(createHash("sha256").update(payload).digest("hex"), "utf8"));
  }

  const state = {
    algorithm: "sha256",
    scope: "tracked binary diff from HEAD plus non-ignored untracked files",
    tracked_diff_sha256: createHash("sha256").update(trackedPatch).digest("hex"),
    untracked_source_sha256: untrackedHash.digest("hex"),
    tracked_file_count: trackedPaths.length,
    untracked_file_count: untrackedPaths.length,
  };
  return {
    ...state,
    candidate_sha256: candidateDigest(revision, state),
  };
}

function candidateDigest(revision, state) {
  return createHash("sha256").update([
    "pipeline-source-state-v1",
    revision,
    state.tracked_diff_sha256,
    state.untracked_source_sha256,
    String(state.tracked_file_count),
    String(state.untracked_file_count),
  ].join("\0")).digest("hex");
}

function gitBuffer(args) {
  return execFileSync("git", args, {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function nulSeparatedPaths(value) {
  return value.toString("utf8").split("\0").filter(Boolean).sort();
}

function addLengthPrefixed(hash, value) {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(value.length);
  hash.update(length).update(value);
}

function releaseTimestamp() {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }
  try {
    const committedAt = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return new Date(committedAt).toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

function parseArgs(args) {
  const result = { out: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out") result.out = args[++index] ?? null;
    else throw new Error(`Unknown option: ${args[index]}`);
  }
  return result;
}
