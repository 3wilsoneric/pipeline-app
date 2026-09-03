import { NextResponse } from "next/server";

import { clearAssessorSessionCookie } from "@/lib/auth/assessor-session";
import {
  clearPipelineSessionCookie,
  createPipelineSessionCookie,
  requireAuthenticatedUser,
} from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { withApiLogging } from "@/lib/observability/api-logging";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export async function POST(request: Request) {
  return withApiLogging(request, "/api/auth/session", async () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;

    try {
      const cookie = await createPipelineSessionCookie(request, auth.user);
      const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders });
      response.headers.append("Set-Cookie", cookie);
      response.headers.append("Set-Cookie", clearAssessorSessionCookie(request));
      return response;
    } catch (error) {
      const message = error instanceof Error && error.message.includes("not configured")
        ? "Pipeline sign-in is not configured."
        : "Pipeline could not establish your sign-in session.";
      return NextResponse.json({ error: message }, { status: 503, headers: noStoreHeaders });
    }
  });
}

export async function DELETE(request: Request) {
  return withApiLogging(request, "/api/auth/session", () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    response.headers.append("Set-Cookie", clearPipelineSessionCookie(request));
    response.headers.append("Set-Cookie", clearAssessorSessionCookie(request));
    return response;
  });
}
