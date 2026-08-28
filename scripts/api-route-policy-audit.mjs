#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const apiRoot = path.join(root, "app", "api");
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const publicMethods = new Set([
  "app/api/health/route.ts#GET",
  "app/api/health/live/route.ts#GET",
  "app/api/auth/session/route.ts#POST",
  "app/api/auth/session/route.ts#DELETE",
]);
const personalStateWrites = new Set([
  "app/api/me/recents/route.ts#POST",
  "app/api/me/recents/route.ts#DELETE",
  "app/api/training/progress/route.ts#PUT",
]);
const ownerScopedMethods = new Set([
  "app/api/academy/progress/route.ts#GET",
  "app/api/academy/progress/route.ts#PUT",
]);
const roleRestrictedReads = new Map([
  ["app/api/operations/supervisor-queue/route.ts#GET", ["admin", "assessment_coordinator"]],
  ["app/api/profiles/[residentKey]/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/profiles/[residentKey]/source-documents/[documentId]/thumbnail/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/profiles/[residentKey]/source-documents/[documentId]/preview/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/clinical/clients/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/clinical/residents/[residentId]/route.ts#GET", ["admin", "assessment_coordinator", "reviewer"]],
]);

const routeFiles = findRouteFiles(apiRoot);
const methods = [];
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

for (const absoluteFile of routeFiles) {
  const file = path.relative(root, absoluteFile).split(path.sep).join("/");
  const sourceText = readFileSync(absoluteFile, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const route = routeFromFile(file);
  const declarations = new Map(source.statements
    .filter((statement) => ts.isFunctionDeclaration(statement) && statement.name && statement.body)
    .map((statement) => [statement.name.text, statement]));

  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    if (!hasExportModifier(statement)) continue;
    const method = statement.name.text;
    if (!httpMethods.has(method)) continue;

    const key = `${file}#${method}`;
    const body = resolvedFunctionText(statement, source, declarations);
    const isInternal = route.startsWith("/api/internal/");
    const isPublic = publicMethods.has(key);
    const isMutation = mutationMethods.has(method);
    const roleList = pipelineRoles(body);

    methods.push({ key, route, method, boundary: isInternal ? "worker" : isPublic ? "public" : "user" });
    check(`${key} uses centralized API logging`, body.includes("withApiLogging("));
    check(`${key} logs the canonical route template`, body.includes(`withApiLogging(request, "${route}"`));

    if (isInternal) {
      check(`${key} requires internal-worker authentication`, body.includes("requireInternalWorker("));
      check(`${key} does not accept browser-user authentication`, !body.includes("requirePipelineUser("));
    } else if (key === "app/api/health/route.ts#GET") {
      check(`${key} is the only unauthenticated readiness endpoint`, !body.includes("requirePipelineUser(") && body.includes("getPipelineAuthReadiness("));
    } else if (key === "app/api/health/live/route.ts#GET") {
      check(`${key} is a data-free unauthenticated liveness endpoint`, !body.includes("requirePipelineUser(") && body.includes('service: "pipeline-app"'));
    } else if (key === "app/api/auth/session/route.ts#DELETE") {
      check(`${key} clears only the same-origin session`, body.includes("clearPipelineSessionCookie(") && !body.includes("requirePipelineUser("));
    } else if (ownerScopedMethods.has(key)) {
      check(`${key} requires the configured private Academy owner`, body.includes("getDeveloperAcademyOwner("));
    } else {
      check(`${key} requires Pipeline user authentication`, body.includes("requirePipelineUser("));
    }

    if (isMutation && !isInternal) {
      check(`${key} rejects cross-origin browser mutations`, body.includes("requireSameOriginMutation("));
    }
    if (!isMutation) {
      check(`${key} does not apply mutation-origin checks to reads`, !body.includes("requireSameOriginMutation("));
    }
    if (route.includes("/referrals/[referralId]")) {
      check(`${key} enforces referral-record access`, enforcesReferralAccess(body));
    }
    if (route.includes("/packets/[packetId]")) {
      check(`${key} enforces packet ownership access`, body.includes("requirePacketAccess("));
    }
    if (route.includes("/files/[documentId]")) {
      check(`${key} resolves document ownership before access`, body.includes("requireReferralAccess("));
    }
    if (route.includes("/assessments/[assessmentId]")) {
      check(`${key} resolves assessment ownership before access`, body.includes("requireReferralAccess("));
    }
    if (isMutation && !isInternal && !isPublic && !personalStateWrites.has(key) && !ownerScopedMethods.has(key)) {
      check(`${key} excludes the viewer role from writes`, roleList.length > 0 && !roleList.includes("viewer"));
    }
    if (personalStateWrites.has(key)) {
      check(`${key} writes only principal-scoped personal state`, body.includes("auth.user.id") && body.includes("requirePipelineUser("));
    }
    if (isMutation && ownerScopedMethods.has(key)) {
      check(`${key} writes only owner-scoped private Academy state`, body.includes("owner.id") && body.includes("getDeveloperAcademyOwner("));
    }

    const expectedRoles = roleRestrictedReads.get(key);
    if (expectedRoles) {
      check(`${key} has its governed read-role set`, sameItems(roleList, expectedRoles));
    }
  }
}

check("every API route exports at least one HTTP method", routeFiles.length > 0 && routeFiles.every((file) => {
  const relative = path.relative(root, file).split(path.sep).join("/");
  return methods.some((entry) => entry.key.startsWith(`${relative}#`));
}));
check("public API surface is limited to health and session establishment", methods.filter((entry) => entry.boundary === "public").every((entry) => publicMethods.has(entry.key)));
check("central logging enforces private no-store responses", readFileSync(path.join(root, "lib/observability/api-logging.ts"), "utf8").includes('response.headers.set("Cache-Control", "private, no-store, max-age=0")'));
check("central logging applies the overload governor", readFileSync(path.join(root, "lib/observability/api-logging.ts"), "utf8").includes("acquireRequestCapacity("));

const failed = checks.filter((item) => !item.ok);
const boundaryCounts = Object.fromEntries(["public", "user", "worker"].map((boundary) => [
  boundary,
  methods.filter((entry) => entry.boundary === boundary).length,
]));
console.log(JSON.stringify({
  ok: failed.length === 0,
  route_files: routeFiles.length,
  method_count: methods.length,
  boundary_counts: boundaryCounts,
  checks,
  note: "The audit derives method policy from route source and emits no request data, identities, parameters, or route values from live traffic.",
}, null, 2));
if (failed.length) process.exit(1);

function findRouteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findRouteFiles(fullPath);
      return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
    })
    .sort();
}

function routeFromFile(file) {
  return `/${file.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`;
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function resolvedFunctionText(statement, source, declarations) {
  let text = statement.getText(source);
  const delegate = text.match(/return\s+(\w+)\(request\)/)?.[1];
  const declaration = delegate ? declarations.get(delegate) : null;
  if (declaration) text += `\n${declaration.getText(source)}`;
  return text;
}

function pipelineRoles(body) {
  const match = body.match(/requirePipelineUser\(\s*request\s*,\s*\[([\s\S]*?)\]\s*\)/);
  if (!match) return [];
  return [...match[1].matchAll(/"(admin|assessment_coordinator|reviewer|viewer)"/g)].map((item) => item[1]);
}

function enforcesReferralAccess(body) {
  return body.includes("requireReferralAccess(") || (
    body.includes("canAccessReferral(auth.user, snapshot.referral)") &&
    body.includes("getReferralWorkflowSnapshot(")
  );
}

function sameItems(actual, expected) {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}
