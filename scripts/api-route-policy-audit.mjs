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
// These routes establish and enforce recipient-only packet sessions. They do
// not grant Pipeline staff access or expose packet content before verification.
const packetRecipientMethods = new Set([
  "app/api/admission-packets/[packetId]/route.ts#GET",
  "app/api/admission-packets/[packetId]/route.ts#POST",
  "app/api/admission-packets/[packetId]/files/[fileId]/route.ts#GET",
]);
const personalStateWrites = new Set([
  "app/api/me/recents/route.ts#POST",
  "app/api/me/recents/route.ts#DELETE",
  "app/api/me/home-layout/route.ts#PUT",
  "app/api/me/work-continuity/route.ts#PATCH",
  "app/api/training/progress/route.ts#PUT",
]);
const ownerScopedMethods = new Set([
  "app/api/academy/progress/route.ts#GET",
  "app/api/academy/progress/route.ts#PUT",
]);
const authenticatedBaseMethods = new Set([
  "app/api/auth/me/route.ts#GET",
  "app/api/auth/session/route.ts#POST",
  "app/api/note-lab/session/route.ts#GET",
  "app/api/note-lab/session/route.ts#POST",
  "app/api/auth/assessor-session/route.ts#GET",
  "app/api/auth/assessor-session/route.ts#POST",
  "app/api/auth/assessor-session/route.ts#DELETE",
]);
const authenticatedPipelineSelfMethods = new Set([
  "app/api/me/presence/route.ts#POST",
  "app/api/me/profile/route.ts#GET",
  "app/api/me/profile/route.ts#PATCH",
]);
const governedReadMutations = new Set([
  "app/api/operations/reports/route.ts#POST",
  // Data-free, strictly enumerated browser timings; no clinical mutation.
  "app/api/me/performance/route.ts#POST",
]);
const roleRestrictedReads = new Map([
  ["app/api/operations/supervisor-queue/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/profiles/[residentKey]/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/profiles/[residentKey]/source-documents/[documentId]/thumbnail/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/profiles/[residentKey]/source-documents/[documentId]/preview/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/clinical/clients/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
  ["app/api/clinical/residents/[residentId]/route.ts#GET", ["admin", "assessment_coordinator", "reviewer", "viewer"]],
]);

const routeFiles = findRouteFiles(apiRoot);
const methods = [];
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("awaited access helpers count only when their failure is immediately returned", resolvedFixture("const failure = await guard(request); if (failure) return failure;").includes("requirePipelineUser"));
check("unused access helpers cannot satisfy the route policy", !resolvedFixture("return Response.json({});").includes("requirePipelineUser"));
check("ignored access failures cannot satisfy the route policy", !resolvedFixture("const failure = await guard(request); return Response.json({});").includes("requirePipelineUser"));
check("returning a different value cannot satisfy the route policy", !resolvedFixture("const failure = await guard(request); if (failure) return null;").includes("requirePipelineUser"));

check("awaited result guards count only when their failed response is immediately returned", resolvedFixture("const access = await guard(request, context, true); if (!access.ok) return access.response;").includes("requirePipelineUser"));
check("result guards with ignored failures do not count", !resolvedFixture("const access = await guard(request, context); return Response.json({});").includes("requirePipelineUser"));
check("result guards returning a different response do not count", !resolvedFixture("const access = await guard(request, context); if (!access.ok) return null;").includes("requirePipelineUser"));
check("result guards with an inverted success check do not count", !resolvedFixture("const access = await guard(request, context); if (access.ok) return access.response;").includes("requirePipelineUser"));

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
    const isPacketRecipient = packetRecipientMethods.has(key);
    const isMutation = mutationMethods.has(method);
    const sharedWorkspace = /^\/api\/(referrals|assessments|files|packets|uploads|contacts|resident-links|trash)(\/|$)/.test(route);
    const personalRecovery = /^\/api\/me\/(assessment-drafts|referral-drafts)(\/|$)/.test(route);
    const roleList = pipelineRoles(body);

    methods.push({ key, route, method, boundary: isInternal ? "worker" : isPacketRecipient ? "packet_recipient" : isPublic ? "public" : "user" });
    check(`${key} uses centralized API logging`, body.includes("withApiLogging("));
    check(`${key} logs the canonical route template`, body.includes(`withApiLogging(request, "${route}"`));

    if (isInternal) {
      check(`${key} requires internal-worker authentication`, body.includes("requireInternalWorker("));
      check(`${key} does not accept browser-user authentication`, !body.includes("requirePipelineUser("));
    } else if (isPacketRecipient) {
      check(`${key} uses the canonical recipient access owner`, sourceText.includes('from "@/lib/notifications/admission-packet-access"'));
      if (method === "GET") {
        check(`${key} requires a verified packet-scoped session`, body.includes("await readVerifiedPacket(packetId, packetSessionToken(request, packetId)"));
        if (route.includes("/files/")) check(`${key} checks the requested file within that packet`, body.includes("packetSessionToken(request, packetId), fileId)"));
      } else {
        const mutation = declarations.get("packetMutation")?.getText(source) ?? "";
        const codeRequest = declarations.get("emailPacketCode")?.getText(source) ?? "";
        check(`${key} requires an explicit browser origin`, body.includes('!request.headers.get("origin")'));
        check(`${key} delegates bounded recipient authentication actions`, body.includes("await packetMutation(request, packetId, body.value)") && body.includes("readJsonBody(request, 2048)"));
        check(`${key} issues sessions only after one-time code verification`, mutation.includes("await verifyPacketCode(packetId, email, code.trim())") && mutation.includes("HttpOnly; SameSite=Strict"));
        check(`${key} sends codes only through recipient authorization`, mutation.includes("return emailPacketCode(packetId, email)") && codeRequest.includes("await requestPacketCode(packetId, email)") && codeRequest.includes("if (challenge) await sendPacketVerificationCode("));
        check(`${key} closes only the presented packet session`, mutation.includes("await closePacketSession(packetId, packetSessionToken(request, packetId))"));
      }
    } else if (key === "app/api/health/route.ts#GET") {
      check(`${key} is the only unauthenticated readiness endpoint`, !body.includes("requirePipelineUser(") && body.includes("getPipelineAuthReadiness("));
    } else if (key === "app/api/health/live/route.ts#GET") {
      check(`${key} is a data-free unauthenticated liveness endpoint`, !body.includes("requirePipelineUser(") && body.includes('service: "pipeline-app"'));
    } else if (key === "app/api/auth/session/route.ts#DELETE") {
      check(`${key} clears only the same-origin session`, body.includes("clearPipelineSessionCookie(") && !body.includes("requirePipelineUser("));
    } else if (authenticatedBaseMethods.has(key)) {
      check(`${key} requires authenticated identity without granting Pipeline access`, body.includes("requireAuthenticatedUser(") && !body.includes("requirePipelineUser("));
      if (key === "app/api/auth/session/route.ts#POST") {
        check(`${key} establishes only an authenticated session`, body.includes("createPipelineSessionCookie("));
      }
      if (route === "/api/note-lab/session") {
        check(`${key} enforces the standalone Note Lab reviewer allowlist`, body.includes("canAccessNoteLab(auth.user)"));
      }
    } else if (authenticatedPipelineSelfMethods.has(key)) {
      check(`${key} requires the signed-in Pipeline identity`, body.includes("requireAuthenticatedUser(") && body.includes("canAccessPipeline(auth.user)") && !body.includes("requirePipelineUser("));
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
      check(`${key} enforces packet ownership access`, enforcesPacketAccess(body));
    }
    if (route.includes("/files/[documentId]")) {
      check(`${key} resolves document ownership before access`, enforcesReferralAccess(body));
    }
    if (route.includes("/assessments/[assessmentId]")) {
      check(`${key} resolves assessment ownership before access`, enforcesReferralAccess(body));
    }
    if (isMutation && !isInternal && !isPublic && !isPacketRecipient && !personalStateWrites.has(key) && !ownerScopedMethods.has(key) && !authenticatedBaseMethods.has(key) && !authenticatedPipelineSelfMethods.has(key) && !governedReadMutations.has(key)) {
      if (sharedWorkspace || personalRecovery) check(`${key} permits every authenticated Pipeline role`, body.includes("requirePipelineUser(request)") || roleList.includes("viewer"));
      else check(`${key} excludes the viewer role from writes`, roleList.length > 0 && !roleList.includes("viewer"));
    }
    if (isMutation && authenticatedPipelineSelfMethods.has(key)) {
      check(`${key} mutates only the signed-in staff member`, body.includes("auth.user"));
    }
    if (key === "app/api/operations/reports/route.ts#POST") {
      check(`${key} enforces report access and audits the export`, body.includes("getOperationsReport(auth.user") && body.includes("ReportAccessError") && body.includes("recordOperationsReportExport("));
    }
    if (key === "app/api/me/performance/route.ts#POST") {
      check(`${key} accepts only bounded data-free timing samples`, body.includes("parseBrowserPerformanceSamples(body.value)") && body.includes("recordPipelineMetric(") && !body.includes("auth.user.id"));
    }
    if (key === "app/api/note-lab/session/route.ts#POST") {
      check(`${key} writes only principal-scoped reviewer state`, body.includes("submitNoteLabReview(auth.user.id"));
    }
    if (personalRecovery) {
      check(`${key} keeps recovery principal-scoped`, body.includes("auth.user.id") || (body.includes("authorize(auth.user, context)") && sourceText.includes("userId: user.id")));
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
const boundaryCounts = Object.fromEntries(["public", "packet_recipient", "user", "worker"].map((boundary) => [
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
  const delegate = text.match(/return\s+(\w+)\(\s*request\b/)?.[1];
  const declaration = delegate ? declarations.get(delegate) : null;
  if (declaration) text += `\n${declaration.getText(source)}`;
  // Only follow an awaited failure guard whose result immediately exits the
  // handler. Merely declaring or calling an authorization helper is not proof.
  for (const match of statement.getText(source).matchAll(/const\s+(\w+)\s*=\s*await\s+(\w+)\(request\);\s*if\s*\(\1\)\s*return\s+\1\s*;/g)) {
    const guard = declarations.get(match[2]);
    if (guard) text += `\n${guard.getText(source)}`;
  }
  for (const match of statement.getText(source).matchAll(/const\s+(\w+)\s*=\s*await\s+(\w+)\(request(?:,\s*\w+)*\);\s*if\s*\(!\1\.ok\)\s*return\s+\1\.response\s*;/g)) {
    const guard = declarations.get(match[2]);
    if (guard) text += `\n${guard.getText(source)}`;
  }
  if (text.includes("documentMutationResponse(request,")
    && source.text.includes('import { documentMutationResponse } from "@/lib/pipeline/document-mutation-route"')) {
    text += `\n${readFileSync(path.join(root, "lib/pipeline/document-mutation-route.ts"), "utf8")}`;
  }
  return text;
}

function resolvedFixture(body) {
  const source = ts.createSourceFile("fixture.ts", `export async function POST(request) { ${body} } async function guard(request) { return requirePipelineUser(request); }`, ts.ScriptTarget.Latest, true);
  return resolvedFunctionText(source.statements[0], source, new Map([["guard", source.statements[1]]]));
}

function pipelineRoles(body) {
  const match = body.match(/requirePipelineUser\(\s*request\s*,\s*\[([\s\S]*?)\]\s*(?:,\s*\{[\s\S]*?\})?\s*\)/);
  if (!match) return [];
  return [...match[1].matchAll(/"(admin|assessment_coordinator|reviewer|viewer)"/g)].map((item) => item[1]);
}

function enforcesReferralAccess(body) {
  return body.includes("requireReferralAccess(")
    || body.includes("requireMutableReferralAccess(") || (
    body.includes("canAccessReferral(auth.user, snapshot.referral)") &&
    body.includes("getReferralWorkflowSnapshot(")
  );
}

function enforcesPacketAccess(body) {
  return body.includes("requirePacketAccess(") || body.includes("requireMutablePacketAccess(");
}

function sameItems(actual, expected) {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}
