import { canAccessPipeline, requireAuthenticatedUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { parseStaffProfilePreferences } from "@/lib/pipeline/staff-profile";
import {
  touchWorkspaceMember,
  updateOwnWorkspaceMemberProfile,
} from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/profile", async () => {
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessPipeline(auth.user)) return jsonError("Pipeline access is not assigned.", 403);
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const member = await touchWorkspaceMember(auth.user);
    if (!member) return jsonError("Your profile settings could not be loaded.", 404);
    return Response.json({ member }, { headers: noStoreHeaders });
  });
}

export async function PATCH(request: Request) {
  return withApiLogging(request, "/api/me/profile", async () => {
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessPipeline(auth.user)) return jsonError("Pipeline access is not assigned.", 403);
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const input = await readProfileMutation(request);
    if (!input.ok) return input.response;

    const result = await updateOwnWorkspaceMemberProfile({
      user: auth.user,
      expectedVersion: input.expectedVersion,
      profile: input.profile,
    });
    if (!result.ok) return profileUpdateFailure(result);
    return Response.json({ member: result.member }, { headers: noStoreHeaders });
  });
}

async function readProfileMutation(request: Request) {
  const body = await readJsonBody<{ if_match?: unknown; profile?: unknown }>(request);
  if (!body.ok) return { ok: false as const, response: jsonError(body.message, body.status) };
  if (!Number.isSafeInteger(body.value?.if_match) || Number(body.value.if_match) < 1) {
    return { ok: false as const, response: jsonError("if_match must be a positive profile version.") };
  }
  const parsed = parseStaffProfilePreferences(body.value?.profile);
  if (!parsed.ok) return { ok: false as const, response: jsonError(parsed.message) };
  return { ok: true as const, expectedVersion: Number(body.value.if_match), profile: parsed.profile };
}

function profileUpdateFailure(result: Exclude<Awaited<ReturnType<typeof updateOwnWorkspaceMemberProfile>>, { ok: true }>) {
  if (result.reason === "version_conflict") {
    return Response.json(
      { error: "Your profile changed in another session. Review the latest version and try again.", member: result.current },
      { status: 409, headers: noStoreHeaders },
    );
  }
  return jsonError("Your profile settings could not be updated.", result.reason === "delegated_session" ? 403 : 404);
}
