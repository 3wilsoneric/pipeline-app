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
