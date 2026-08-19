#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizePipelineBasePath,
  withPipelineBasePath,
  withoutPipelineBasePath,
} from "../shared/pipeline-base-path.mjs";

assert.equal(normalizePipelineBasePath(undefined), "");
assert.equal(normalizePipelineBasePath("/"), "");
assert.equal(normalizePipelineBasePath(" /admissions/ "), "/admissions");
assert.throws(() => normalizePipelineBasePath("https://alamoplatform.com/admissions"));
assert.throws(() => normalizePipelineBasePath("/admissions?client=123"));
assert.throws(() => normalizePipelineBasePath("/admissions/../api"));

assert.equal(withPipelineBasePath("/", "/admissions"), "/admissions");
assert.equal(withPipelineBasePath("/?view=referrals", "/admissions"), "/admissions?view=referrals");
assert.equal(withPipelineBasePath("/api/referrals", "/admissions"), "/admissions/api/referrals");
assert.equal(withPipelineBasePath("/admissions/api/referrals", "/admissions"), "/admissions/api/referrals");
assert.equal(withPipelineBasePath("https://example.com/file", "/admissions"), "https://example.com/file");
assert.equal(withoutPipelineBasePath("/admissions", "/admissions"), "/");
assert.equal(withoutPipelineBasePath("/admissions/api/referrals", "/admissions"), "/api/referrals");

const root = path.resolve(import.meta.dirname, "..");
const [nextConfig, fetchAdapter, entraClient, proxy, auth, documentAssets, referralStore] = await Promise.all([
  readFile(path.join(root, "next.config.ts"), "utf8"),
  readFile(path.join(root, "lib/auth/authenticated-fetch.ts"), "utf8"),
  readFile(path.join(root, "lib/auth/entra-client.ts"), "utf8"),
  readFile(path.join(root, "proxy.ts"), "utf8"),
  readFile(path.join(root, "lib/auth/pipeline-auth.ts"), "utf8"),
  readFile(path.join(root, "lib/extraction/document-assets.ts"), "utf8"),
  readFile(path.join(root, "lib/pipeline/referral-store.ts"), "utf8"),
]);

assert.match(nextConfig, /basePath:\s*basePath \|\| undefined/);
assert.match(fetchAdapter, /fetch\(toPipelinePath\(input\)/);
assert.match(entraClient, /toPipelinePath\("\/sign-in"\)/);
assert.match(proxy, /fromPipelinePath\(pathname\)/);
assert.match(proxy, /toPipelinePath\("\/sign-in"\)/);
for (const appRole of ["alamoadmissionsadmin", "alamoadmissionssupervisor", "alamoadmissionsassessor"]) {
  assert.ok(auth.includes(appRole), `Missing Pipeline role mapping for ${appRole}.`);
}
assert.match(documentAssets, /preview_url:\s*toPipelinePath/);
assert.match(referralStore, /previewUrl:\s*toPipelinePath/);

console.log("Alamo Admissions zone contracts passed.");
