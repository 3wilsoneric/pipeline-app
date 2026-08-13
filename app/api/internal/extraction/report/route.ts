import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { readJsonBody } from "@/lib/extraction/contracts";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { reportExtractionJob, type WorkerReport } from "@/lib/extraction/processing-worker";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function POST(request: Request) {
  return withApiLogging(request, "/api/internal/extraction/report", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const body = await readJsonBody<WorkerReport>(request, 2 * 1024 * 1024);
    if (!body.ok) return Response.json({ error: body.message }, { status: body.status ?? 400 });
    try {
      const result = await reportExtractionJob(body.value);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  });
}
