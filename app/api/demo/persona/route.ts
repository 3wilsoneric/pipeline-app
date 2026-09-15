import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { personaCookie, requirePersonaDemoUser } from "@/lib/demo/persona-session";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";

export async function POST(request: Request) {
  const auth = requirePersonaDemoUser(request);
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
}
