import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const definitionFiles = [
  "lib/assessment/assessment-context.ts", "lib/assessment/assessment-tool-schema.ts",
  "lib/assessment/assessment-interview-schema.ts", "lib/assessment/assessment-completion.ts",
  "lib/assessment/assessment-history.ts", "lib/pipeline/client-identity-presentation.mjs",
];
const domains = [
  ["referrals", "Referral intake and identity", "referral|client-identity|resident-link|intake"],
  ["assessment", "Assessment questions and answers", "assessment|interview"],
  ["evidence", "Documents, extraction and provenance", "extraction|document|packet|upload|evidence"],
  ["coordination", "Assignments, scheduling and contacts", "assign|schedule|calendar|contact|collaboration"],
  ["review", "Review, signatures and revisions", "review|revision|sign|addend"],
  ["requirements", "Requirements and blockers", "requirement|work-item|workflow"],
  ["decisions", "Recommendations, admissions and outcomes", "recommendation|decision|admission|placement"],
  ["communication", "Handoffs, drafts and delivery", "handoff|email|outlook|meet-client"],
  ["history", "Activity, corrections and history", "activity|audit|history|historical|changes"],
  ["analytics", "Operations and analysis", "operations|report|worklist|supervisor|completion-memo"],
  ["notes", "Notes and assistance", "notes|question-assistant|note-lab"],
];

// Pipeline executes its own definition modules, from a committed tree staged in
// isolation. ProForma receives JSON only; neither app imports the other's runtime.
export async function capturePipelineCatalog({ repository, ref }) {
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const revision = git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A committed source revision is required.");
  const paths = git("ls-tree", "-r", "--name-only", revision).trim().split("\n").filter((file) =>
    /^lib\/(assessment|pipeline|extraction|clinical|auth|reliability)\/.*\.(ts|mjs)$/.test(file) ||
    /^app\/api\/.*\/route\.ts$/.test(file) || /^database\/migrations\/.*\.sql$/.test(file)).sort();
  const files = new Map(paths.map((file) => [file, git("show", `${revision}:${file}`)]));
  const sources = paths.map((file) => ({ path: file, hash: hash(files.get(file)) }));
  const location = (file, start = 0, end = files.get(file).length) => ({ path: file, fileHash: hash(files.get(file)),
    startLine: files.get(file).slice(0, start).split("\n").length,
    endLine: files.get(file).slice(0, Math.max(start, end - 1)).split("\n").length });
  const stage = await mkdtemp(path.join(tmpdir(), "pipeline-definition-export-"));
  let definitions;
  try {
    for (const file of definitionFiles) {
      if (!files.has(file)) throw new Error(`Missing definition source: ${file}`);
      await mkdir(path.dirname(path.join(stage, file)), { recursive: true });
      await writeFile(path.join(stage, file), files.get(file));
    }
    definitions = loadTypeScriptModule(stage, "lib/assessment/assessment-context.ts").assessmentContextDefinitions();
  } finally { await rm(stage, { recursive: true, force: true }); }
  const models = [], endpoints = [];
  for (const [file, content] of files) {
    if (!file.endsWith(".ts")) continue;
    const tree = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    for (const statement of tree.statements) {
      if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && file.startsWith("lib/")) {
        models.push({ id: `${file}#${statement.name.text}`, name: statement.name.text,
          declaration: statement.getText(tree), location: location(file, statement.getStart(tree), statement.end) });
      }
      if (file.startsWith("app/api/") && ts.isFunctionDeclaration(statement) && /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/.test(statement.name?.text ?? "")) {
        endpoints.push({ id: `${statement.name.text} /${file.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`,
          method: statement.name.text, path: `/${file.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`,
          location: location(file, statement.getStart(tree), statement.end),
          access: "source-declared-route-not-a-permission-grant" });
      }
    }
  }
  return {
    schemaVersion: 1, kind: "pipeline.knowledge-catalog", ownerApplication: "pipeline",
    authority: "source-code-not-policy", revision,
    definitions, definitionHash: hash(JSON.stringify(definitions)),
    definitionSources: definitionFiles.map((file) => location(file)),
    domains: domains.map(([id, title, pattern]) => ({ id, title, grounding: "inferred-path-relevance",
      sourcePaths: paths.filter((file) => new RegExp(pattern).test(file)),
      endpointIds: endpoints.filter((endpoint) => new RegExp(pattern).test(endpoint.path)).map((endpoint) => endpoint.id) })),
    models, endpoints, sources,
    coverage: {
      includes: ["all-canonical-assessment-fields", "all-canonical-interview-questions", "options-and-branch-conditions",
        "exported-types-in-scanned-modules", "exported-route-handlers", "migration-file-provenance"],
      excludes: ["patient-records", "staff-records", "credentials", "document-bytes", "runtime-deployment-proof",
        "approved-clinical-policy", "implicit-route-reexports", "database-schema-observation"],
      scope: "lib/{assessment,pipeline,extraction,clinical,auth,reliability}; app/api; database/migrations",
      historicalAnswerDefinitions: "not-established", captureEnabled: false, executionEnabled: false,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--ref" || args[2] !== "--output") throw new Error("Use --ref <commit> --output <file>.");
  const value = await capturePipelineCatalog({ repository: process.cwd(), ref: args[1] });
  const output = path.resolve(args[3]), pending = `${output}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(output), { recursive: true });
  try { await writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); await rename(pending, output); }
  finally { await rm(pending, { force: true }); }
  console.log(JSON.stringify({ revision: value.revision, fields: value.definitions.fields.length,
    questions: value.definitions.fields.filter((field) => field.question).length, models: value.models.length,
    endpoints: value.endpoints.length, sources: value.sources.length }));
}
