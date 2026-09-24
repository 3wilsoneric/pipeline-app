#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const shaPattern = /^[0-9a-f]{40}$/;

export function classifyFastDeployFiles(files) {
  const runtime = [];
  const unsupported = [];

  for (const file of files) {
    if (
      file.startsWith("docs/")
      || file.startsWith("tests/")
      || file === "lib/academy/academy-atlas.generated.json"
      || file === "scripts/fast-deploy-eligibility.mjs"
      || /^scripts\/.*(?:\.test|-fixtures|-contracts)\.mjs$/.test(file)
    ) continue;

    if (
      file === "app/globals.css"
      || file === "app/api/referrals/[referralId]/new-intake/route.ts"
      || /^(?:app\/\(pipeline\)\/|components\/pipeline\/).+\.(?:css|ts|tsx)$/.test(file)
      || /^public\/.+\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$/.test(file)
    ) {
      runtime.push(file);
    } else {
      unsupported.push(file);
    }
  }

  return {
    eligible: runtime.length > 0 && unsupported.length === 0,
    runtime,
    unsupported,
  };
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "buffer" });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

export function changedFiles(base, head, cwd = process.cwd()) {
  if (!shaPattern.test(base) || !shaPattern.test(head) || base === head) {
    throw new Error("Fast deployment requires distinct, complete commit SHAs.");
  }
  git(["merge-base", "--is-ancestor", base, head], cwd);
  const output = git(["diff", "--no-renames", "--name-only", "-z", "--diff-filter=ACDMRTUXB", base, head, "--"], cwd);
  return output.toString("utf8").split("\0").filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const base = process.argv[process.argv.indexOf("--base") + 1];
    const head = process.argv[process.argv.indexOf("--head") + 1];
    const result = classifyFastDeployFiles(changedFiles(base, head));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.eligible) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
