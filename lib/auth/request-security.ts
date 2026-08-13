export function requireSameOriginMutation(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");
  const allowedOrigins = getAllowedMutationOrigins(request);

  if (fetchSite === "cross-site") return originMismatchResponse();

  if (origin && !allowedOrigins.has(normalizeOrigin(origin))) {
    return originMismatchResponse();
  }

  if (!origin && referer) {
    try {
      if (!allowedOrigins.has(new URL(referer).origin)) {
        return originMismatchResponse();
      }
    } catch {
      return originMismatchResponse();
    }
  }

  return null;
}

function getAllowedMutationOrigins(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const configured = (process.env.PIPELINE_ALLOWED_MUTATION_ORIGINS ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
  return new Set([requestOrigin, ...configured]);
}

function normalizeOrigin(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function originMismatchResponse() {
  return Response.json(
    { error: "This write must come from the Pipeline application origin." },
    { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
