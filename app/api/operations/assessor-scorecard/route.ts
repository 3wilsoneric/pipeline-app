import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness } from "@/lib/database/pipeline-database";
import { withApiLogging } from "@/lib/observability/api-logging";
import { canAccessAssessorScorecard } from "@/lib/pipeline/application-activity-access";
import { getAssessorScorecard } from "@/lib/pipeline/assessor-scorecard";
import { renderAssessorScorecardPdf } from "@/lib/pipeline/assessor-scorecard-pdf";
import { scorecardSorts, type ScorecardSort } from "@/lib/pipeline/assessor-scorecard-presentation";
import { scorecardPeriods, scorecardRange, ScorecardPeriodError } from "@/lib/pipeline/assessor-scorecard-period";
import type { ScorecardPeriod } from "@/lib/pipeline/assessor-scorecard-types";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/assessor-scorecard", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessAssessorScorecard(auth.user)) return Response.json({ error: "This scorecard is restricted to its executive audience." }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const period = (params.get("period") ?? "4w") as ScorecardPeriod;
    if (!scorecardPeriods.includes(period)) return Response.json({ error: "Choose a valid scorecard period." }, { status: 400 });
    const now = new Date();
    const dates = { start: params.get("start") ?? undefined, end: params.get("end") ?? undefined };
    try { scorecardRange(period, now, dates); } catch (error) {
      if (!(error instanceof ScorecardPeriodError)) throw error;
      return Response.json({ error: error.message }, { status: 400 });
    }
    const format = params.get("format") ?? "json";
    const sort = params.get("sort") ?? "confirmed";
    if (!["json", "pdf"].includes(format) || !scorecardSorts.includes(sort as ScorecardSort)) return Response.json({ error: "Choose a valid scorecard export." }, { status: 400 });
    if (!getPipelineDatabaseReadiness().ready) return Response.json({ error: "The shared Pipeline database is required. Local records are not staff performance data." }, { status: 503 });
    const snapshot = await getAssessorScorecard(auth.user, period, dates, now);
    const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie, Authorization" };
    if (format === "pdf") {
      const pdf = await renderAssessorScorecardPdf(snapshot, sort as ScorecardSort);
      return new Response(new Uint8Array(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="pipeline-assessor-scorecard-${period}-${snapshot.through.slice(0, 10)}.pdf"` } });
    }
    return Response.json(snapshot, { headers });
  });
}
