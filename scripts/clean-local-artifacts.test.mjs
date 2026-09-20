import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { planArtifactCleanup } from "./clean-local-artifacts.mjs";

test("cleanup protects recent, locked, active, linked, and non-artifact paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pipeline-cleanup-test-"));
  try {
    const old = new Date(Date.now() - 14 * 86400000);
    for (const name of [".next-old", ".next-recent", ".next-locked", ".next", ".data", "tmp", "tools"]) {
      await mkdir(path.join(root, name));
      if (name !== ".next-recent") await utimes(path.join(root, name), old, old);
    }
    await writeFile(path.join(root, ".next-locked", "lock"), "");
    await utimes(path.join(root, ".next-locked"), old, old);
    await symlink(path.join(root, ".data"), path.join(root, ".next-link"));
    assert.deepEqual((await planArtifactCleanup(root)).candidates, [".next-old"]);
    assert.deepEqual((await planArtifactCleanup(root, { active: true })).candidates, []);
    const cli = fileURLToPath(new URL("./clean-local-artifacts.mjs", import.meta.url));
    const result = JSON.parse(execFileSync(process.execPath, [cli], { cwd: root, encoding: "utf8" }));
    assert.equal(result.dry_run, true);
    assert.deepEqual(result.removed, []);
    assert.throws(() => execFileSync(process.execPath, [cli, "--apply"], { cwd: root, stdio: "pipe" }), /Command failed/);
    assert.throws(() => execFileSync(process.execPath, [cli, "--apply", "--artifact=../outside"], { cwd: root, stdio: "pipe" }), /Command failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
