const CACHE_PREFIX = "pipeline-static-";
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const scopedPath = (path) => `${SCOPE_PATH}${path}`;
const OFFLINE_URL = scopedPath("/offline.html");
const OFFLINE_ASSESSMENT_URL = scopedPath("/offline-assessment.html");
const STATIC_ASSETS = [
  OFFLINE_URL,
  OFFLINE_ASSESSMENT_URL,
  scopedPath("/offline-assessment.js"),
  scopedPath("/brand/pipeline-mark.svg"),
  scopedPath("/pwa/pipeline-favicon-32-v3.png"),
  scopedPath("/pwa/pipeline-icon-192-v2.png"),
  scopedPath("/pwa/pipeline-icon-512-v2.png"),
  scopedPath("/pwa/pipeline-icon-maskable-512-v2.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    pruneOldPipelineCaches()
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "PIPELINE_PRUNE_DESKTOP_CACHES") {
    event.waitUntil(pruneOldPipelineCaches());
    return;
  }
  if (event.data?.type !== "PIPELINE_DISABLE_DESKTOP_CACHE") return;
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
      ))
      .then(() => self.registration.unregister()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(OFFLINE_ASSESSMENT_URL) ?? await cache.match(OFFLINE_URL) ?? new Response("A connection is required.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }));
    return;
  }

  if (!url.search && (isExplicitStaticAsset(url.pathname) || url.pathname.startsWith(scopedPath("/_next/static/")))) {
    event.respondWith(cacheStaticAsset(request));
  }
});

function isExplicitStaticAsset(pathname) {
  return STATIC_ASSETS.includes(pathname);
}

async function cacheStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (
    response.ok
    && response.type === "basic"
    && !response.headers.has("set-cookie")
  ) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function pruneOldPipelineCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  );
}
