import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { listClientFileImportReviewItems } from "@/lib/pipeline/client-file-import-store";

export const runtime = "nodejs";

const statuses = new Set(["unmatched", "candidate", "confirmed", "rejected", "imported"]);

export async function GET(request: Request) {
  return withApiLogging(request, "/api/files/import-review", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "unmatched";
    const limit = integer(url.searchParams.get("limit"), 100, 1, 200);
    const offset = integer(url.searchParams.get("offset"), 0, 0, 100_000);
    if (query.length > 200) return error("q must be 200 characters or fewer.");
    if (!statuses.has(status)) return error("status is invalid.");
    return Response.json(await listClientFileImportReviewItems({
      query,
      status: status as "unmatched" | "candidate" | "confirmed" | "rejected" | "imported",
      limit,
      offset,
    }), { headers: privateHeaders() });
  });
}

function integer(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function error(message: string) {
  return Response.json({ error: message }, { status: 400, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
