import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { readJsonBody } from "@/lib/extraction/contracts";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { replayDeadLetterJob } from "@/lib/extraction/processing-worker";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function POST(request: Request) {
  return withApiLogging(request, "/api/internal/extraction/dead-letter", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const body = await readJsonBody<{ extraction_job_id?: string }>(request);
    if (!body.ok || typeof body.value.extraction_job_id !== "string") {
      return Response.json({ error: body.ok ? "extraction_job_id is required." : body.message }, { status: body.ok ? 400 : body.status ?? 400 });
    }
    try {
      return Response.json(await replayDeadLetterJob(body.value.extraction_job_id), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  });
}
