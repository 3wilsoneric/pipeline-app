import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

test("lint project matching preserves hidden files, exclusions, case and directory expansion", () => {
  const { globSync, isDynamicPattern } = require("tinyglobby");
  const fixture = mkdtempSync(path.join(tmpdir(), "pipeline-eslint-matching-"));
  try {
    for (const name of ["src/index.ts", "src/.hidden.ts", "src/nested/child.ts", "src/excluded/no.ts", "src/UPPER.TS", ".private/index.ts", "node_modules/pkg/index.ts", "packages/a/tsconfig.json", "packages/b/tsconfig.json"]) {
      mkdirSync(path.dirname(path.join(fixture, name)), { recursive: true });
      writeFileSync(path.join(fixture, name), "");
    }
    const match = (patterns, options = {}) => globSync(patterns, { cwd: fixture, ...options }).sort();
    assert.deepEqual(match("src", { dot: true, ignore: ["src/excluded"] }), ["src/.hidden.ts", "src/UPPER.TS", "src/index.ts", "src/nested/child.ts"]);
    assert.deepEqual(match("**/*.ts", { dot: true, ignore: ["**/node_modules/**", "src/excluded"] }), [".private/index.ts", "src/.hidden.ts", "src/index.ts", "src/nested/child.ts"]);
    assert.deepEqual(match(["src/**/*.ts", "!src/excluded/**"], { dot: true }), ["src/.hidden.ts", "src/index.ts", "src/nested/child.ts"]);
    assert.deepEqual(match("packages/{a,b}/tsconfig.json", { expandDirectories: false }), ["packages/a/tsconfig.json", "packages/b/tsconfig.json"]);
    assert.deepEqual(match("packages/*", { expandDirectories: false }), []);
    assert.deepEqual(match([]), []);
    assert.deepEqual(match("missing*"), []);
    assert.deepEqual(match("src/index.ts", { absolute: true }), [path.join(fixture, "src/index.ts")]);
    assert.equal(isDynamicPattern("src/index.ts"), false);
    for (const pattern of ["packages/*/tsconfig.json", "packages/{a,b}/tsconfig.json", "src/+(a|b).ts", "!excluded/**"]) {
      assert.equal(isDynamicPattern(pattern), true, pattern);
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("actual TypeScript project discovery and import aliases remain functional", async () => {
  const estreeRoot = path.dirname(require.resolve("@typescript-eslint/typescript-estree/package.json"));
  const { resolveProjectList } = require(path.join(estreeRoot, "dist/parseSettings/resolveProjectList.js"));
  const { resolve: resolveImport } = await import("eslint-import-resolver-typescript");
  const fixture = realpathSync(mkdtempSync(path.join(tmpdir(), "pipeline-eslint-projects-")));
  try {
    for (const project of ["alpha", "beta"]) {
      const dir = path.join(fixture, "packages", project);
      mkdirSync(path.join(dir, "src/.hidden"), { recursive: true });
      writeFileSync(path.join(dir, "src/.hidden/consumer.ts"), 'import { value } from "@fixture/value";');
      writeFileSync(path.join(dir, "src/value.ts"), "export const value = 1;");
      writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@fixture/*": ["src/*"] } }, include: ["src"], exclude: ["node_modules"] }));
    }
    mkdirSync(path.join(fixture, "node_modules/ignored"), { recursive: true });
    writeFileSync(path.join(fixture, "node_modules/ignored/tsconfig.json"), "{}");
    const projects = resolveProjectList({ project: ["packages/beta/tsconfig.json", "**/tsconfig.json"], tsconfigRootDir: fixture, singleRun: true });
    assert.deepEqual([...projects.values()], ["beta", "alpha"].map((name) => path.join(fixture, "packages", name, "tsconfig.json")));
    for (const project of ["alpha", "beta"]) {
      const dir = path.join(fixture, "packages", project);
      const options = { project: path.join(fixture, "packages/*/tsconfig.json") };
      assert.deepEqual(resolveImport("@fixture/value", path.join(dir, "src/.hidden/consumer.ts"), options), { found: true, path: path.join(dir, "src/value.ts") });
      assert.deepEqual(resolveImport("@fixture/missing", path.join(dir, "src/.hidden/consumer.ts"), options), { found: false });
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("the replacement rejects unreviewed options and pathological patterns finish promptly", () => {
  const adapter = require.resolve("tinyglobby");
  assert.throws(() => require(adapter).globSync("**/*", { unreviewed: true }), /Review the lint glob adapter/);
  const fixture = mkdtempSync(path.join(tmpdir(), "pipeline-eslint-patterns-"));
  try {
    writeFileSync(path.join(fixture, "a".repeat(200) + "!"), "");
    const result = execFileSync(process.execPath, ["-e", `
      const { globSync } = require(process.argv[1]);
      for (const pattern of ['+(*a)b', '+(a|aa)b', '*(*a)b']) {
        if (globSync(pattern, { cwd: process.argv[2] }).length) throw Error('Unexpected match');
      }
    `, adapter, fixture], { timeout: 5000, encoding: "utf8" });
    assert.equal(result, "");
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test("the pinned archive replaces only the reviewed lint callers without picomatch", () => {
  execFileSync("npm", ["ls", "fast-glob", "tinyglobby", "--json"], { cwd: root, stdio: "pipe" });
  const sourceRoot = path.join(root, "scripts/vendor/next-eslint-glob");
  for (const file of ["index.cjs", "package.json", "README.md"]) {
    assert.equal(
      execFileSync("tar", ["-xOf", path.join(sourceRoot, "next-eslint-glob-2.0.0.tgz"), `package/${file}`], { encoding: "utf8" }),
      readFileSync(path.join(sourceRoot, file), "utf8"),
    );
  }
  const pluginRequire = createRequire(path.join(pluginRoot, "package.json"));
  const plugin = JSON.parse(readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
  assert.equal(plugin.version, "16.4.6", "Review Next's glob callers after upgrades");
  assert.equal(plugin.dependencies["fast-glob"], "3.3.1");
  const consumers = readdirSync(path.join(pluginRoot, "dist"), { recursive: true })
    .filter((file) => file.endsWith(".js") && readFileSync(path.join(pluginRoot, "dist", file), "utf8").includes('require("fast-glob")'));
  assert.deepEqual(consumers, ["utils/get-root-dirs.js"]);
  const caller = readFileSync(path.join(pluginRoot, "dist", consumers[0]), "utf8");
  assert.match(caller, /_fastglob\.globSync/);
  assert.equal((caller.match(/_fastglob\./g) ?? []).length, 1);
  assert.match(caller, /onlyDirectories: true/);
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  for (const [name, version, dependency, source] of [
    ["@next/eslint-plugin-next", "16.4.6", "fast-glob", "dist/utils/get-root-dirs.js"],
    ["@typescript-eslint/typescript-estree", "8.57.1", "tinyglobby", "dist/parseSettings/resolveProjectList.js"],
    ["eslint-import-resolver-typescript", "3.10.1", "tinyglobby", "lib/index.js"],
  ]) {
    const packagePath = require.resolve(`${name}/package.json`);
    const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
    assert.equal(manifest.version, version, `Review ${name}'s glob callers after upgrades`);
    const consumerRequire = createRequire(packagePath);
    const installedPath = consumerRequire.resolve(`${dependency}/package.json`);
    const installed = JSON.parse(readFileSync(installedPath, "utf8"));
    assert.equal(installed.name, "next-eslint-glob");
    assert.equal(installed.version, "2.0.0");
    const lockedPath = path.relative(root, path.dirname(installedPath)).split(path.sep).join("/");
    assert.equal(lock.packages[lockedPath].version, installed.version);
    assert.equal(lock.packages[lockedPath].dev, true);
    assert.match(readFileSync(path.join(path.dirname(packagePath), source), "utf8"), /globSync/);
  }
  assert.ok(pluginRequire.resolve("fast-glob"));
  for (const name of ["picomatch", "micromatch", "fdir"]) {
    assert.ok(!Object.keys(lock.packages).some((entry) => entry.endsWith(`/node_modules/${name}`) || entry === `node_modules/${name}`), name);
  }
});
