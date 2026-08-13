import { NextResponse } from "next/server";

import {
  clearPipelineSessionCookie,
  createPipelineSessionCookie,
  requirePipelineUser,
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
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    try {
      const cookie = await createPipelineSessionCookie(request);
      return NextResponse.json({ ok: true }, { headers: { ...noStoreHeaders, "Set-Cookie": cookie } });
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
    return NextResponse.json(
      { ok: true },
      { headers: { ...noStoreHeaders, "Set-Cookie": clearPipelineSessionCookie(request) } },
    );
  });
}
