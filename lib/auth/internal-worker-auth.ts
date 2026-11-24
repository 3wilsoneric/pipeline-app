import "server-only";

import { timingSafeEqual } from "node:crypto";

export function requireInternalWorker(request: Request) {
  return requireBearerSecret(
    request,
    process.env.PIPELINE_WORKER_SHARED_SECRET?.trim() || process.env.CRON_SECRET?.trim(),
    "Worker authentication is not configured.",
  );
}

/** Alamo Platform reads aggregate counts with its own secret, never the worker secret. */
export function requirePlatformIntegration(request: Request) {
  return requireBearerSecret(
    request,
    process.env.PIPELINE_PLATFORM_SUMMARY_SECRET?.trim(),
    "Platform integration is not configured.",
  );
}

/** Client-level briefing uses a separate credential from the broad board summary. */
export function requirePlatformClientBriefing(request: Request) {
  return requireBearerSecret(
    request,
    process.env.PIPELINE_PLATFORM_CLIENT_BRIEFING_SECRET?.trim(),
    "Platform client briefing is not configured.",
  );
}

/** Organization-wide analytical reads have their own credential and represented identity.
 * This is not a browser login, worker credential, or permission to mutate a record. */
export function requireAllySource(request: Request) {
  const denied = requireBearerSecret(request, process.env.PIPELINE_ALLY_SOURCE_SECRET?.trim(), "Ally source is not configured.");
  if (denied) return denied;
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  const tenant = process.env.PIPELINE_ALLY_SOURCE_TENANT_ID?.trim().toLowerCase();
  const subjects = process.env.PIPELINE_ALLY_SOURCE_SUBJECT_IDS?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!tenant || !uuid.test(tenant) || !subjects.length || subjects.some(value => !uuid.test(value))) {
    return Response.json({ error: "Ally source identity is not configured." }, { status: 503 });
  }
  const subject = request.headers.get("x-ally-subject")?.toLowerCase() ?? "";
  if (request.headers.get("x-ally-tenant")?.toLowerCase() !== tenant || !uuid.test(subject) || !subjects.includes(subject)) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }
  return null;
}

function requireBearerSecret(request: Request, expected: string | undefined, unconfiguredMessage: string) {
  if (!expected) {
    return Response.json({ error: unconfiguredMessage }, { status: 503 });
  }
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  if (!constantTimeEqual(supplied, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
