import { getDeveloperAcademyOwner } from "@/lib/academy/academy-access";
import {
  getAcademyProgressRecord,
  putAcademyProgressRecord,
} from "@/lib/academy/academy-progress-store";
import { validateAcademyProgressUpdate } from "@/lib/academy/academy-progress-contract";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/academy/progress", async () => {
    const owner = await getDeveloperAcademyOwner(request.headers);
    if (!owner) return notFoundResponse();

    try {
      const record = await getAcademyProgressRecord(owner.id);
      return Response.json(record, { headers: noStoreHeaders() });
    } catch {
      return Response.json(
        { error: "Academy progress is temporarily unavailable." },
        { status: 503, headers: noStoreHeaders() },
      );
    }
  });
}

export async function PUT(request: Request) {
  return withApiLogging(request, "/api/academy/progress", async () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;

    const owner = await getDeveloperAcademyOwner(request.headers);
    if (!owner) return notFoundResponse();

    const parsed = await readJsonBody(request, 320_000);
    if (!parsed.ok) {
      return Response.json(
        { error: parsed.message },
        { status: parsed.status ?? 400, headers: noStoreHeaders() },
      );
    }
    const validation = validateAcademyProgressUpdate(parsed.value);
    if (!validation.ok) {
      return Response.json(
        { error: validation.error },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    try {
      const result = await putAcademyProgressRecord({
        principalId: owner.id,
        expectedRevision: validation.value.expectedRevision,
        progress: validation.value.progress,
      });
      if (result.ok) return Response.json(result.record, { headers: noStoreHeaders() });
      if (result.unavailable) {
        return Response.json(
          { error: result.message, persistence: "browser" },
          { status: 503, headers: noStoreHeaders() },
        );
      }
      return Response.json(
        { error: "Academy progress changed in another session.", current: result.current },
        { status: 409, headers: noStoreHeaders() },
      );
    } catch {
      return Response.json(
        { error: "Academy progress could not be saved." },
        { status: 503, headers: noStoreHeaders() },
      );
    }
  });
}

function notFoundResponse() {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: noStoreHeaders() },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store, max-age=0" };
}
