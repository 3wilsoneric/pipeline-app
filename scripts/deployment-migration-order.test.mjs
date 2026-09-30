import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/deploy-azure.yml", import.meta.url), "utf8");
const step = workflow.split("      - name: Back up and migrate before application rollout\n")[1]?.split("      - name: Deploy runtime and scheduled jobs\n")[0];
assert.ok(step?.includes("if: ${{ !inputs.initial_database_bootstrap }}"));
const script = step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");

test("the approved redesign stays on by default and both runtime invocations receive its explicit value and rollout identity", () => {
  assert.match(workflow, /enable_design_v2:[\s\S]*?default: true/);
  assert.equal(workflow.match(/enableDesignV2='\$\{\{ inputs.enable_design_v2 \}\}'/g)?.length, 2);
  assert.equal(workflow.match(/rolloutId='r\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}'/g)?.length, 2);
  assert.equal(workflow.match(/postgresServerName='\$\{\{ steps.foundation.outputs.postgres_name \}\}'/g)?.length, 2);
  const runtime = readFileSync(new URL("../infra/azure/runtime.bicep", import.meta.url), "utf8");
  assert.match(runtime, /param enableDesignV2 bool = false/);
  assert.match(runtime, /name: 'PIPELINE_DESIGN_V2', value: enableDesignV2 \? 'true' : 'false'/);
  assert.match(runtime, /var revisionSuffix = .*rolloutId/);
});

for (const scenario of ["off", "on", "configuration-changed"]) {
  test(`image-only deployment preserves flags: ${scenario}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "pipeline-fast-flags-"));
    try {
      const fast = readFileSync(new URL("../.github/workflows/deploy-azure-fast.yml", import.meta.url), "utf8");
      const promotion = fast.split("      - name: Promote only the web image and roll back on failed health\n")[1];
      const command = promotion.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");
      const environment = [{ name: "PIPELINE_DESIGN_V2", value: scenario === "off" ? "false" : "true" }];
      const calls = join(directory, "calls.jsonl"), state = join(directory, "state.json");
      writeFileSync(state, JSON.stringify({ latest: "web--previous", ready: "web--previous", image: "previous-image", environment }));
      const stub = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const name = path.basename(process.argv[1]), args = process.argv.slice(2);
if (name === "git") { console.log(process.env.GITHUB_SHA + "\\trefs/heads/main"); }
else if (name === "curl") {}
else if (name === "sha256sum") console.log(crypto.createHash("sha256").update(fs.readFileSync(0)).digest("hex") + "  -");
else if (name === "az") {
  const state = JSON.parse(fs.readFileSync(process.env.TEST_STATE));
  fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify(args) + "\\n");
  if (args[1] === "update") {
    state.image = args[args.indexOf("--image") + 1];
    state.ready = state.latest = "web--" + args[args.indexOf("--revision-suffix") + 1];
    if (process.env.TEST_SCENARIO === "configuration-changed") state.environment[0].value = "false";
    fs.writeFileSync(process.env.TEST_STATE, JSON.stringify(state));
  } else if (args[1] === "show") {
    const query = args[args.indexOf("--query") + 1];
    console.log(query === "properties.template.containers[0].image" ? state.image : query === "properties.latestReadyRevisionName" ? state.ready : JSON.stringify(state));
  } else process.exit(2);
} else process.exit(2);
`;
      for (const name of ["az", "git", "curl", "sha256sum"]) writeFileSync(join(directory, name), stub, { mode: 0o755 });
      const result = spawnSync("bash", ["-c", command], { encoding: "utf8", timeout: 10_000, env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, RESOURCE_GROUP: "synthetic", WEB_NAME: "web", REGISTRY_SERVER: "synthetic.invalid",
        PREVIOUS_IMAGE: "previous-image", PREVIOUS_REVISION: "web--previous", FQDN: "synthetic.invalid",
        GITHUB_SHA: "1234567890abcdef", GITHUB_RUN_ID: "1234", GITHUB_RUN_ATTEMPT: "2",
        ENVIRONMENT_DIGEST: createHash("sha256").update(JSON.stringify(environment) + "\n").digest("hex"),
        TEST_CALLS: calls, TEST_STATE: state, TEST_SCENARIO: scenario,
      } });
      assert.equal(result.status, scenario === "configuration-changed" ? 1 : 0, result.stderr);
      const updates = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line)).filter(args => args[1] === "update");
      assert.equal(updates.length, scenario === "configuration-changed" ? 2 : 1);
      assert.ok(updates.every(args => !args.some(arg => /env-vars/.test(arg))));
      if (scenario === "configuration-changed") assert.match(result.stderr, /Runtime flags changed/);
      else assert.deepEqual(JSON.parse(readFileSync(state, "utf8")).environment, environment);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

for (const scenario of ["success", "backup-fails", "migration-fails"]) {
  test(`candidate migration order: ${scenario}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "pipeline-deployment-order-"));
    try {
      const log = join(directory, "calls.jsonl");
      const templatesLog = join(directory, "templates.jsonl");
      writeFileSync(join(directory, "az"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALL_LOG, JSON.stringify(args) + "\\n");
const job = args[args.indexOf("--name") + 1];
if (args[2] === "show") console.log(JSON.stringify({
  containers: [{ name: job.endsWith("backup") ? "database-backup" : "database-migrate", image: "previous-image",
    command: ["node"], args: [job.endsWith("backup") ? "scripts/database-backup-to-azure-blob.mjs" : "scripts/apply-database-migrations.mjs"],
    env: [{name: "PIPELINE_DATABASE_URL", secretRef: "database-migration-url"}], resources: { cpu: 0.5, memory: "1Gi" } }],
  initContainers: [], volumes: []
}));
else if (args[2] === "start") {
  fs.appendFileSync(process.env.TEST_TEMPLATES_LOG, fs.readFileSync(args[args.indexOf("--yaml") + 1], "utf8").replace(/\\n/g, "") + "\\n");
  console.log(job + "-this-execution");
}
else {
  const failed = process.env.TEST_SCENARIO === "backup-fails" ? job.endsWith("backup") : process.env.TEST_SCENARIO === "migration-fails" && job.endsWith("migrate");
  console.log(failed ? "Failed" : "Succeeded");
}
`, { mode: 0o755 });
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 10_000, env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, RESOURCE_GROUP: "synthetic-group", JOB_PREFIX: "pipeline-prod",
        CANDIDATE_IMAGE: "synthetic.azurecr.io/pipeline:exact-commit", TEST_CALL_LOG: log, TEST_TEMPLATES_LOG: templatesLog, TEST_SCENARIO: scenario,
      } });
      assert.equal(result.status, scenario === "success" ? 0 : 1, result.stderr);
      const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
      const starts = calls.filter(args => args[2] === "start");
      assert.deepEqual(starts.map(args => args[args.indexOf("--name") + 1]), scenario === "backup-fails"
        ? ["pipeline-prod-database-backup"] : ["pipeline-prod-database-backup", "pipeline-prod-database-migrate"]);
      const templates = readFileSync(templatesLog, "utf8").trim().split("\n").map(line => JSON.parse(line));
      for (const [index, args] of starts.entries()) {
        assert.ok(args.includes("--yaml"));
        assert.ok(!args.includes("--image"));
        const backup = index === 0;
        assert.deepEqual(templates[index], {
          containers: [{ name: backup ? "database-backup" : "database-migrate", image: "synthetic.azurecr.io/pipeline:exact-commit",
            command: ["node"], args: [backup ? "scripts/database-backup-to-azure-blob.mjs" : "scripts/apply-database-migrations.mjs"],
            env: [{ name: "PIPELINE_DATABASE_URL", secretRef: "database-migration-url" }], resources: { cpu: 0.5, memory: "1Gi" } }],
          initContainers: [], volumes: [],
        });
      }
      for (const args of calls.filter(args => args[2] === "execution")) {
        assert.equal(args[args.indexOf("--job-execution-name") + 1], `${args[args.indexOf("--name") + 1]}-this-execution`);
      }
      if (scenario !== "success") assert.match(result.stderr, /Application rollout stopped/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
