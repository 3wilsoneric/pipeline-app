import { requireAllySource } from "@/lib/auth/internal-worker-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { AllySourceError, readAllyPipelineSource } from "@/lib/pipeline/ally-source";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/integrations/platform/ally", async () => {
    const denied = requireAllySource(request);
    if (denied) return denied;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;
    const params = new URL(request.url).searchParams;
    const raw = params.get("input") ?? "{}";
    if (params.size > 1 || params.size === 1 && !params.has("input") || Buffer.byteLength(raw) > 6000) {
      return Response.json({ error: "Invalid source read." }, { status: 400 });
    }
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return Response.json({ error: "Invalid source read." }, { status: 400 }); }
    try {
      const result = await readAllyPipelineSource(input);
      const revoked = requireAllySource(request);
      if (revoked) return revoked;
      const body = JSON.stringify(result);
      if (Buffer.byteLength(body) > 4 * 1024 * 1024) {
        return Response.json({ error: "Source record exceeds 4 MiB. No evidence was truncated." }, { status: 413 });
      }
      return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    } catch (error) {
      if (error instanceof AllySourceError || error instanceof DocumentProcessingError) return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  });
}
