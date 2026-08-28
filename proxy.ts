import { NextResponse, type NextRequest } from "next/server";

import { requirePipelineUser, isProtectedPath } from "@/lib/auth/pipeline-auth";
import { fromPipelinePath, toPipelinePath } from "@/lib/pipeline/base-path";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const applicationPathname = fromPipelinePath(pathname);

  if (applicationPathname.startsWith("/api/internal/")) {
    const denied = requireInternalWorkerAtProxy(request);
    return withSecurityHeaders(denied ?? NextResponse.next(), request);
  }

  if (!isProtectedPath(applicationPathname)) {
    return withSecurityHeaders(NextResponse.next(), request);
  }

  const auth = await requirePipelineUser(request);

  if (!auth.ok) {
    if (!applicationPathname.startsWith("/api/")) {
      const signInUrl = request.nextUrl.clone();
      signInUrl.pathname = toPipelinePath("/sign-in");
      signInUrl.search = "";
      signInUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return withSecurityHeaders(NextResponse.redirect(signInUrl), request);
    }

    return withSecurityHeaders(auth.response, request);
  }

  return withSecurityHeaders(NextResponse.next(), request);
}

function requireInternalWorkerAtProxy(request: NextRequest) {
  const primarySecret = process.env.PIPELINE_WORKER_SHARED_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const expected = primarySecret || cronSecret;
  if (!expected) {
    return NextResponse.json({ error: "Worker authentication is not configured." }, { status: 503 });
  }

  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  if (constantTimeStringEqual(supplied, expected)) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function constantTimeStringEqual(left: string, right: string) {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function withSecurityHeaders(response: Response, request: NextRequest) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  const sameOriginPacketPreview = /^\/api\/referrals\/\d+\/packet$/.test(
    fromPipelinePath(request.nextUrl.pathname),
  );
  response.headers.set("X-Frame-Options", sameOriginPacketPreview ? "SAMEORIGIN" : "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    // Local demo uploads can be up to 100 MB. The route performs its own auth,
    // same-origin, size, and file-signature checks, so do not let Proxy clone
    // and truncate that multipart body at Next's 10 MB default.
    "/((?!_next|api/uploads/local|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/api/((?!uploads/local(?:/|$)).*)",
  ],
};
