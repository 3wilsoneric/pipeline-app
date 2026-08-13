export function requireSameOriginMutation(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite === "cross-site") return originMismatchResponse();

  if (origin && origin !== new URL(request.url).origin) {
    return originMismatchResponse();
  }

  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== new URL(request.url).origin) {
        return originMismatchResponse();
      }
    } catch {
      return originMismatchResponse();
    }
  }

  return null;
}

function originMismatchResponse() {
  return Response.json(
    { error: "This write must come from the Pipeline application origin." },
    { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
