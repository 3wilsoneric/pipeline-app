import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = path.dirname(require.resolve("@next/eslint-plugin-next/package.json"));
const { getRootDirs } = require(path.join(pluginRoot, "dist/utils/get-root-dirs.js"));

test("Next root discovery retains literal, wildcard, brace, array and missing-root behavior", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "pipeline-eslint-roots-"));
  const originalCwd = process.cwd();
  try {
    for (const name of ["packages/alpha/pages", "packages/beta/app", "packages/.hidden/app"]) {
      mkdirSync(path.join(fixture, name), { recursive: true });
    }
    writeFileSync(path.join(fixture, "packages/not-a-directory"), "fixture");
    process.chdir(fixture);
    const roots = (rootDir) => getRootDirs({ cwd: fixture, settings: { next: { rootDir } } }).sort();
    assert.deepEqual(roots(undefined), [fixture]);
    assert.deepEqual(roots("packages/alpha"), ["packages/alpha"]);
    assert.deepEqual(roots("packages/*"), ["packages/alpha", "packages/beta"]);
    assert.deepEqual(roots("packages/{alpha,beta}"), ["packages/alpha", "packages/beta"]);
    assert.deepEqual(roots(["packages/alpha", "packages/beta", null]), ["packages/alpha", "packages/beta"]);
    assert.deepEqual(roots("packages\\alpha"), ["packages/alpha"]);
    assert.deepEqual(roots(path.join(fixture, "packages/alpha")), [path.join(fixture, "packages/alpha")]);
    assert.deepEqual(roots("packages/missing*"), []);
    assert.deepEqual(roots("packages/not-a-directory"), []);
  } finally {
    process.chdir(originalCwd);
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("the unchanged Next/React/TypeScript config still reports real violations", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "pipeline-eslint-rules-"));
  try {
    mkdirSync(path.join(fixture, "pages"));
    writeFileSync(path.join(fixture, "pages/index.js"), "export default function Page() { return null; }");
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: path.join(root, "eslint.config.mjs"),
      overrideConfig: { settings: { next: { rootDir: fixture } } },
    });
    const [result] = await eslint.lintText(
      'export default function Example({ items }: { items?: string[] }) { return <><a href="/">Home</a>{items?.map(() => <div>Item</div>)!}</>; }',
      { filePath: "components/NextLintRegression.tsx" },
    );
    for (const ruleId of ["@next/next/no-html-link-for-pages", "react/jsx-key", "@typescript-eslint/no-non-null-asserted-optional-chain"]) {
      assert.ok(result.messages.some((message) => message.ruleId === ruleId && message.severity === 2), ruleId);
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("the scoped replacement matches its reviewed source and sole upstream caller", () => {
  const sourceRoot = path.join(root, "scripts/vendor/next-eslint-glob");
  for (const file of ["index.cjs", "package.json", "README.md"]) {
    assert.equal(
      execFileSync("tar", ["-xOf", path.join(sourceRoot, "next-eslint-glob-1.0.0.tgz"), `package/${file}`], { encoding: "utf8" }),
      readFileSync(path.join(sourceRoot, file), "utf8"),
    );
  }
  const pluginRequire = createRequire(path.join(pluginRoot, "package.json"));
  assert.equal(readFileSync(pluginRequire.resolve("fast-glob"), "utf8"), readFileSync(path.join(sourceRoot, "index.cjs"), "utf8"));
  const consumers = readdirSync(path.join(pluginRoot, "dist"), { recursive: true })
    .filter((file) => file.endsWith(".js") && readFileSync(path.join(pluginRoot, "dist", file), "utf8").includes('require("fast-glob")'));
  assert.deepEqual(consumers, ["utils/get-root-dirs.js"]);
  const caller = readFileSync(path.join(pluginRoot, "dist", consumers[0]), "utf8");
  assert.match(caller, /_fastglob\.globSync/);
  assert.equal((caller.match(/_fastglob\./g) ?? []).length, 1);
  assert.match(caller, /onlyDirectories: true/);
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.ok(!Object.keys(lock.packages).some((key) => /node_modules\/(braces|micromatch)$/.test(key)));
});
