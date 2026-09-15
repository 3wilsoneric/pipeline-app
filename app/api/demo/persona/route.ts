import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { isPersonaDemo, personaCookie } from "@/lib/demo/persona-session";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function POST(request: Request) {
  return withApiLogging(request, "/api/demo/persona", async () => {
    if (!isPersonaDemo()) return jsonError("Not found.", 404);
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const persona = (body.value as { persona?: unknown } | null)?.persona;
    if (persona !== "supervisor" && persona !== "assessor") return jsonError("Choose Supervisor or Assessor.");
    return Response.json({ persona }, { headers: {
      "Set-Cookie": personaCookie(persona),
      "Cache-Control": "no-store",
    } });
  });
}
