import { after } from "next/server";

import { canAccessPipeline, requireAuthenticatedUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { touchWorkspaceMember } from "@/lib/pipeline/workspace-members";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/auth/me", async () => {
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;
    if (canAccessPipeline(auth.user)) {
      after(() => touchWorkspaceMember(auth.user).catch(() => undefined));
    }

    return Response.json(
      {
        user: {
          id: auth.user.id,
          email: auth.user.email,
          name: auth.user.name,
          roles: auth.user.roles,
        },
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  });
}
