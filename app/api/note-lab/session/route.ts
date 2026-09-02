import { isNoteLabEnabled } from "@/lib/note-lab/note-lab-access";
import { validateNoteLabReviewInput } from "@/lib/note-lab/note-lab-contracts";
import { getNoteLabSession, submitNoteLabReview } from "@/lib/note-lab/note-lab-store";
import { canAccessNoteLab, requireAuthenticatedUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/note-lab/session", async () => {
    if (!isNoteLabEnabled()) return notFound();
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessNoteLab(auth.user)) return forbidden();
    try {
      const requestedField = new URL(request.url).searchParams.get("field");
      return Response.json(await getNoteLabSession(auth.user.id, requestedField), { headers: noStoreHeaders() });
    } catch {
      return Response.json({ error: "Assessment Language Lab is temporarily unavailable." }, { status: 503, headers: noStoreHeaders() });
    }
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/note-lab/session", async () => {
    if (!isNoteLabEnabled()) return notFound();
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessNoteLab(auth.user)) return forbidden();
    const parsed = await readJsonBody(request, 32_000);
    if (!parsed.ok) return Response.json({ error: parsed.message }, { status: parsed.status ?? 400, headers: noStoreHeaders() });
    const validation = validateNoteLabReviewInput(parsed.value);
    if (!validation.ok) return Response.json({ error: validation.error }, { status: 400, headers: noStoreHeaders() });
    try {
      const result = await submitNoteLabReview(auth.user.id, validation.value);
      return noteLabSubmissionResponse(result);
    } catch {
      return Response.json({ error: "The decision could not be saved." }, { status: 503, headers: noStoreHeaders() });
    }
  });
}

function noteLabSubmissionResponse(result: Awaited<ReturnType<typeof submitNoteLabReview>>) {
  if (result.ok) return Response.json(result.session, { headers: noStoreHeaders() });
  if ("conflict" in result && result.conflict) {
    return Response.json({ error: "This calibration field changed in another session.", current: result.current }, { status: 409, headers: noStoreHeaders() });
  }
  if ("invalid" in result && result.invalid) {
    return Response.json({ error: result.message }, { status: 400, headers: noStoreHeaders() });
  }
  return Response.json({ error: result.message ?? "Review storage is unavailable." }, { status: 503, headers: noStoreHeaders() });
}

function notFound() {
  return Response.json({ error: "Not found." }, { status: 404, headers: noStoreHeaders() });
}

function forbidden() {
  return Response.json({ error: "Forbidden" }, { status: 403, headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
