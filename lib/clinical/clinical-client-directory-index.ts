import "server-only";

import type { ClinicalClientDirectoryItem } from "./clinical-contracts";
import { ClinicalDataError, getClinicalClients } from "./clinical-data";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;
const FRESH_TTL_MS = 5 * 60_000;
const STALE_TTL_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 16;

type DirectoryIndex = {
  byCanonicalClientId: Map<string, ClinicalClientDirectoryItem>;
  byResidentNumber: Map<string, ClinicalClientDirectoryItem>;
};

type CacheEntry = {
  index?: DirectoryIndex;
  expiresAt: number;
  staleUntil: number;
  promise?: Promise<DirectoryIndex>;
};

const globalForDirectoryIndex = globalThis as typeof globalThis & {
  __pipelineClinicalDirectoryIndexes?: Map<string, CacheEntry>;
};

const cache = globalForDirectoryIndex.__pipelineClinicalDirectoryIndexes
  ?? (globalForDirectoryIndex.__pipelineClinicalDirectoryIndexes = new Map());

export async function getClinicalClientDirectoryIndex(request: Request, accessKey: string) {
  const key = accessKey.trim().toLowerCase() || "default";
  const now = Date.now();
  pruneCache(now);
  const cached = cache.get(key);
  if (cached?.index && cached.expiresAt > now) return cached.index;
  if (cached?.promise) return cached.promise;

  const promise = loadDirectoryIndex(request).catch((error) => {
    if (cached?.index && cached.staleUntil > Date.now()) return cached.index;
    throw error;
  });
  cache.set(key, {
    ...cached,
    expiresAt: cached?.expiresAt ?? 0,
    staleUntil: cached?.staleUntil ?? 0,
    promise,
  });

  try {
    const index = await promise;
    cache.set(key, {
      index,
      expiresAt: Date.now() + FRESH_TTL_MS,
      staleUntil: Date.now() + STALE_TTL_MS,
    });
    return index;
  } finally {
    const current = cache.get(key);
    if (current?.promise === promise) delete current.promise;
  }
}

async function loadDirectoryIndex(request: Request) {
  const byCanonicalClientId = new Map<string, ClinicalClientDirectoryItem>();
  const byResidentNumber = new Map<string, ClinicalClientDirectoryItem>();
  const ambiguousResidentNumbers = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await getClinicalClients(request, { limit: PAGE_SIZE, cursor });
    for (const client of response.clients) {
      byCanonicalClientId.set(client.canonical_client_id, client);
      for (const residentNumber of client.resident_numbers) {
        const normalized = residentNumber.trim();
        if (!normalized || ambiguousResidentNumbers.has(normalized)) continue;
        const existing = byResidentNumber.get(normalized);
        if (existing && existing.canonical_client_id !== client.canonical_client_id) {
          byResidentNumber.delete(normalized);
          ambiguousResidentNumbers.add(normalized);
          continue;
        }
        byResidentNumber.set(normalized, client);
      }
    }
    if (!response.next_cursor) return { byCanonicalClientId, byResidentNumber };
    cursor = response.next_cursor;
  }
  throw new ClinicalDataError(
    502,
    "client_directory_page_limit_exceeded",
    "The Alamo client directory exceeded Pipeline's bounded page limit.",
  );
}

function pruneCache(now: number) {
  for (const [key, entry] of cache) {
    if (!entry.promise && entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const candidate = [...cache].find(([, entry]) => !entry.promise)?.[0];
    if (!candidate) break;
    cache.delete(candidate);
  }
}
