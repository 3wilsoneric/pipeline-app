import { NextResponse, type NextRequest } from "next/server";

import {
  canAccessNoteLab,
  canAccessPipeline,
  clearVerifiedPipelineUserHeader,
  isProtectedPath,
  requireAuthenticatedUser,
  setVerifiedPipelineUserHeader,
} from "@/lib/auth/pipeline-auth";
import { getCanonicalPageRedirect } from "@/lib/auth/canonical-origin";
import { fromPipelinePath, toPipelinePath } from "@/lib/pipeline/base-path";
import { PIPELINE_PERMISSIONS_POLICY } from "@/shared/pipeline-security-headers.mjs";

export async function proxy(request: NextRequest) {
  const canonicalUrl = getCanonicalPageRedirect(request);
  if (canonicalUrl) {
    return withSecurityHeaders(NextResponse.redirect(canonicalUrl, 308), request);
  }

  const { pathname } = request.nextUrl;
  const applicationPathname = fromPipelinePath(pathname);

  if (applicationPathname.startsWith("/api/internal/")) {
    const denied = requireInternalWorkerAtProxy(request);
    return withSecurityHeaders(denied ?? NextResponse.next(), request);
  }

  if (!isProtectedPath(applicationPathname)) {
    return withSecurityHeaders(NextResponse.next(), request);
  }

  const auth = await requireAuthenticatedUser(request);

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

  if (isNoteLabPath(applicationPathname)) {
    if (!canAccessNoteLab(auth.user)) {
      return withSecurityHeaders(NextResponse.json({ error: "Forbidden" }, { status: 403 }), request);
    }

    const requestHeaders = new Headers(request.headers);
    clearVerifiedPipelineUserHeader(requestHeaders);
    setVerifiedPipelineUserHeader(requestHeaders, auth.user);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return withSecurityHeaders(response, request);
  }

  if (isSharedIdentityPath(applicationPathname)) {
    return withSecurityHeaders(NextResponse.next(), request);
  }

  if (!canAccessPipeline(auth.user)) {
    if (applicationPathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Pipeline access is not assigned." }, { status: 403 }),
        request,
      );
    }

    const noteLabUrl = request.nextUrl.clone();
    noteLabUrl.pathname = toPipelinePath("/note-lab/practice");
    noteLabUrl.search = "";
    return withSecurityHeaders(NextResponse.redirect(noteLabUrl), request);
  }

  return withSecurityHeaders(NextResponse.next(), request);
}

function isNoteLabPath(pathname: string) {
  return pathname === "/note-lab"
    || pathname.startsWith("/note-lab/")
    || pathname === "/api/note-lab"
    || pathname.startsWith("/api/note-lab/");
}

function isSharedIdentityPath(pathname: string) {
  return pathname === "/api/auth/me";
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
  response.headers.set("Permissions-Policy", PIPELINE_PERMISSIONS_POLICY);
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
