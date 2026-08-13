import "server-only";

import { timingSafeEqual } from "node:crypto";

export function requireInternalWorker(request: Request) {
  const expected = process.env.PIPELINE_WORKER_SHARED_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (!expected) {
    return Response.json({ error: "Worker authentication is not configured." }, { status: 503 });
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
