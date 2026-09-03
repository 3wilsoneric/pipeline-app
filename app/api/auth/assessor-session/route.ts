import {
  clearAssessorSessionCookie,
  createAssessorSession,
  readAssessorSession,
  recordAssessorSessionEvent,
} from "@/lib/auth/assessor-session";
import { isEligibleGodModeTarget } from "@/lib/auth/assessor-session-policy";
import { canAccessPipeline, requireAuthenticatedUser, type PipelineAuthResult } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getActiveWorkspaceMember, listWorkspaceMembers } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

const defaultReason = "Administrator God mode";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/auth/assessor-session", async () => {
    const auth = authorizeAdministrator(await requireAuthenticatedUser(request));
    if (!auth.ok) return auth.response;
    const [members, active] = await Promise.all([
      listWorkspaceMembers(auth.user),
      readAssessorSession(request, auth.user),
    ]);

    return Response.json({
      members: members.filter((member) => isEligibleGodModeTarget(member, auth.user.id)),
      active,
    });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/auth/assessor-session", async () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const auth = authorizeAdministrator(await requireAuthenticatedUser(request));
    if (!auth.ok) return auth.response;

    const input = await readStartInput(request);
    if (!input.ok) return input.response;

    const member = await getActiveWorkspaceMember(input.targetPrincipalId);
    if (!member || !isEligibleGodModeTarget(member, auth.user.id)) {
      return jsonError("The selected Pipeline account is not available.", 404);
    }
    return startSessionResponse(request, auth.user, member, input.reason);
  });
}

export async function DELETE(request: Request) {
  return withApiLogging(request, "/api/auth/assessor-session", async () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const auth = authorizeAdministrator(await requireAuthenticatedUser(request));
    if (!auth.ok) return auth.response;

    const active = await readAssessorSession(request, auth.user);
    const headers = { "Set-Cookie": clearAssessorSessionCookie(request) };
    if (!active) return Response.json({ ok: true }, { headers });

    try {
      await recordAssessorSessionEvent(active, "god_mode_ended");
      return Response.json({ ok: true }, { headers });
    } catch {
      return Response.json(
        { error: "God mode ended, but its closing audit event could not be recorded." },
        { status: 503, headers },
      );
    }
  });
}

function authorizeAdministrator(auth: PipelineAuthResult): PipelineAuthResult {
  if (!auth.ok) return auth;
  if (!canAccessPipeline(auth.user) || !auth.user.roles.includes("admin")) {
    return {
      ok: false as const,
      response: Response.json({ error: "Administrator access is required." }, { status: 403 }),
    };
  }
  return auth;
}

async function readStartInput(request: Request): Promise<
  | { ok: true; targetPrincipalId: string; reason: string }
  | { ok: false; response: Response }
> {
  const body = await readJsonBody(request);
  if (!body.ok) return { ok: false, response: jsonError(body.message, body.status) };
  if (!isRecord(body.value)) return { ok: false, response: jsonError("The request body must be an object.") };
  const targetPrincipalId = body.value.target_principal_id;
  if (!safePrincipalId(targetPrincipalId)) return { ok: false, response: jsonError("target_principal_id is invalid.") };
  const reason = typeof body.value.reason === "string" ? body.value.reason.trim() : defaultReason;
  if (!reason || reason.length > 500) return { ok: false, response: jsonError("reason must contain 1 to 500 characters.") };
  return { ok: true, targetPrincipalId, reason };
}

async function startSessionResponse(
  request: Request,
  administrator: Extract<PipelineAuthResult, { ok: true }>["user"],
  member: NonNullable<Awaited<ReturnType<typeof getActiveWorkspaceMember>>>,
  reason: string,
) {
  try {
    const session = await createAssessorSession(request, administrator, member, reason);
    await recordAssessorSessionEvent(session.delegation, "god_mode_started");
    return Response.json(
      { ok: true, active: session.delegation },
      { headers: { "Set-Cookie": session.cookie } },
    );
  } catch {
    return jsonError("Pipeline could not enter God mode.", 503);
  }
}

function safePrincipalId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && /^[a-zA-Z0-9_.:@-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
