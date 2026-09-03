const browserDocumentDestination = "document";

export function getCanonicalPageRedirect(request: Request): URL | null {
  const canonicalOrigin = normalizeOrigin(process.env.PIPELINE_CANONICAL_ORIGIN ?? "");
  if (!canonicalOrigin || !isBrowserDocumentRequest(request)) return null;

  const canonicalUrl = new URL(canonicalOrigin);
  if (getObservedHosts(request).has(canonicalUrl.host.toLowerCase())) return null;

  const requestUrl = new URL(request.url);
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, canonicalUrl);
}

function isBrowserDocumentRequest(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const destination = request.headers.get("sec-fetch-dest")?.toLowerCase();
  if (destination && destination !== browserDocumentDestination) return false;

  return request.headers.get("accept")?.toLowerCase().includes("text/html") ?? false;
}

function getObservedHosts(request: Request) {
  const hosts = new Set<string>();
  addHosts(hosts, request.headers.get("host"));
  addHosts(hosts, request.headers.get("x-forwarded-host"));
  addHosts(hosts, new URL(request.url).host);
  return hosts;
}

function addHosts(hosts: Set<string>, value: string | null) {
  for (const candidate of value?.split(",") ?? []) {
    const host = candidate.trim().toLowerCase().replace(/\.$/, "");
    if (host) hosts.add(host);
  }
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
