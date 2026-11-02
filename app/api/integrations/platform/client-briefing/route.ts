import { requirePlatformClientBriefing } from "@/lib/auth/internal-worker-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getPlatformClientBriefing } from "@/lib/pipeline/operations-snapshot";

export const runtime = "nodejs";

function parseDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

export async function GET(request: Request) {
  return withApiLogging(request, "/api/integrations/platform/client-briefing", async () => {
    const denied = requirePlatformClientBriefing(request);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const start = params.get("start");
    const end = params.get("end");
    const startTime = parseDay(start);
    const endTime = parseDay(end);
    const daysApart = startTime === null || endTime === null ? NaN : (endTime - startTime) / 86_400_000;
    const launchCohort = start === "2026-07-01" && endTime !== null && endTime >= startTime! && endTime <= Date.now() + 86_400_000;
    if (params.size !== 2 || (!launchCohort && ![6, 29].includes(daysApart))) {
      return Response.json({ error: "Choose the Pipeline launch cohort or a 7- or 30-day window." }, { status: 400 });
    }
    const briefing = await getPlatformClientBriefing(start!, end!);
    if (!briefing) return Response.json({ error: "Referral storage is unavailable." }, { status: 503 });
    return Response.json(briefing, {
      headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
    });
  });
}
