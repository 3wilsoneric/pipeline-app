import { after } from "next/server";

import { hasAssessorSession } from "@/lib/auth/assessor-session";
import { canAccessPipeline, getEffectivePipelineUser, requireAuthenticatedUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { touchWorkspaceMember } from "@/lib/pipeline/workspace-members";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/auth/me", async () => {
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;
    if (canAccessPipeline(auth.user)) {
      after(() => touchWorkspaceMember(auth.user).catch(() => undefined));
    }
    const user = canAccessPipeline(auth.user)
      ? await getEffectivePipelineUser(request, auth.user)
      : auth.user;

    return Response.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles,
          delegation: user.delegation,
          assessorSessionRecoveryRequired: hasAssessorSession(request) && !user.delegation,
        },
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  });
}
