import { withApiLogging } from "@/lib/observability/api-logging";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/health/live", () =>
    Response.json({ ok: true, service: "pipeline-app" }),
  );
}
