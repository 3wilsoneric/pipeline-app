"use client";

import {
  loginRequest,
  msalInstance,
  pipelineAuthRequired,
} from "@/lib/auth/entra-client";
import {
  clearPipelineBrowserSessionCache,
  probePipelineServerSession,
  renewActivePipelineSession,
  type PipelineSessionUser,
} from "@/lib/auth/browser-session";
import { normalizePostLoginPath, savePostLoginPath } from "@/lib/auth/post-login-path";
import { toPipelinePath } from "@/lib/pipeline/base-path";

const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 8 * 1024 * 1024;
export const REAUTHENTICATION_KEY = "pipeline.reauthentication.v1";

type PipelineFetchOptions = {
  timeoutMs?: number;
  maxResponseBytes?: number;
  cacheTtlMs?: number;
};

const jsonResponseCache = new Map<string, { expiresAt: number; payload: unknown }>();
const pendingJsonRequests = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

export function getPipelineClientCacheGeneration() {
  return cacheGeneration;
}

export function readPipelineJsonCache<T>(input: string): T | undefined {
  const cached = jsonResponseCache.get(input);
  if (!cached || cached.expiresAt <= Date.now()) return undefined;
  return cached.payload as T;
}

function invalidatePipelineDataCache() {
  cacheGeneration += 1;
  jsonResponseCache.clear();
  pendingJsonRequests.clear();
}

function isNavigationBookkeeping(input: string) {
  const pathname = input.split("?")[0];
  return /^\/api\/(?:me\/(?:recents|presence|work-continuity)|referrals\/\d+\/presence)$/.test(pathname);
}

function invalidatesPipelineData(input: string, init: RequestInit) {
  return (init.method ?? "GET").toUpperCase() !== "GET" && !isNavigationBookkeeping(input);
}

export type PipelineCurrentUser = PipelineSessionUser;

export class PipelineApiError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly requestId?: string,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "PipelineApiError";
  }
}

export async function fetchPipelineJson<T>(
  input: string,
  init: RequestInit = {},
  options: PipelineFetchOptions = {},
) {
  const method = (init.method ?? "GET").toUpperCase();
  const generation = cacheGeneration;
  const cacheKey = method === "GET" && options.cacheTtlMs ? input : null;
  if (init.signal?.aborted) throw new PipelineApiError("Request cancelled.", 499);
  if (cacheKey) {
    const cached = jsonResponseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.payload as T;
    if (cached) jsonResponseCache.delete(cacheKey);
  }
  const pending = cacheKey ? pendingJsonRequests.get(cacheKey) : undefined;
  if (pending) return await joinPipelineRead(pending as Promise<T>, init.signal);
  // A prefetched GET belongs to the cache, not the first component to mount.
  // Unmounting one consumer cancels its wait without cancelling another reader.
  const request = requestPipelineJson<T>(input, cacheKey ? { ...init, signal: undefined } : init, options, cacheKey, generation);
  if (cacheKey) {
    pendingJsonRequests.set(cacheKey, request);
    const cleanup = () => {
      if (pendingJsonRequests.get(cacheKey) === request) pendingJsonRequests.delete(cacheKey);
    };
    void request.then(cleanup, cleanup);
  }
  return await joinPipelineRead(request, init.signal);
}

function joinPipelineRead<T>(request: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new PipelineApiError("Request cancelled.", 499));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new PipelineApiError("Request cancelled.", 499));
    signal.addEventListener("abort", abort, { once: true });
    void request.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

async function requestPipelineJson<T>(
  input: string,
  init: RequestInit,
  options: PipelineFetchOptions,
  cacheKey: string | null,
  generation: number,
) {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetchPipelineApi(input, init, options);
      const text = await readBoundedResponseText(response, options.maxResponseBytes ?? defaultMaxResponseBytes);
      const payload = parseJson(text);
      if (response.ok) {
        retainPipelineRead(cacheKey, generation, payload, options.cacheTtlMs);
        return payload as T;
      }
      if (response.status === 401) void beginReauthentication();
      throw new PipelineApiError(
        getErrorMessage(payload, response.status), response.status,
        response.headers.get("x-request-id") ?? getPayloadRequestId(payload), payload,
      );
    } catch (error) {
      if (!shouldRetryPipelineRead(attempt, attempts, init.signal, response, error)) throw error;
      await waitForRetry(response, attempt);
    }
  }
  throw new PipelineApiError("Pipeline could not complete that request.");
}

function shouldRetryPipelineRead(attempt: number, attempts: number, signal: AbortSignal | null | undefined, response: Response | undefined, error: unknown) {
  return attempt + 1 < attempts && !signal?.aborted
    && (response ? isTransientStatus(response.status) : isRetryableRequestError(error));
}

function retainPipelineRead(key: string | null, generation: number, payload: unknown, ttl = 0) {
  if (!key || generation !== cacheGeneration) return;
  jsonResponseCache.set(key, { expiresAt: Date.now() + ttl, payload });
  trimJsonResponseCache();
}

export function fetchCurrentPipelineUser() {
  return probePipelineServerSession().then(({ response, user }) => {
    if (response.ok && user) return { user };
    throw new PipelineApiError(
      response.status === 401 ? "Your Microsoft session expired. Sign in again." : "Pipeline could not load your account.",
      response.status,
      response.headers.get("x-request-id") ?? undefined,
    );
  });
}

export function clearPipelineClientSessionCache() {
  clearPipelineBrowserSessionCache();
  invalidatePipelineDataCache();
}

export async function fetchPipelineApi(
  input: string,
  init: RequestInit = {},
  options: PipelineFetchOptions = {},
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type") && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const abortFromCaller = () => controller.abort();
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const request = (requestHeaders: Headers) => fetch(toPipelinePath(input), {
      ...init,
      headers: requestHeaders,
      credentials: "same-origin",
      signal: controller.signal,
    });
    let response = await request(headers);

    // The encrypted HttpOnly cookie is Pipeline's normal, fast application
    // session. Only involve MSAL when the server says that session is gone.
    if (pipelineAuthRequired && response.status === 401) {
      clearPipelineClientSessionCache();
      const renewedToken = await renewActivePipelineSession(true);
      if (renewedToken) {
        const renewedHeaders = new Headers(headers);
        renewedHeaders.set("Authorization", `Bearer ${renewedToken}`);
        response = await request(renewedHeaders);
      }
    }
    if (response.ok && invalidatesPipelineData(input, init)) {
      invalidatePipelineDataCache();
    }
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (init.signal?.aborted) throw new PipelineApiError("Request cancelled.", 499);
      throw new PipelineApiError("Pipeline took too long to respond.");
    }
    throw new PipelineApiError("Pipeline could not be reached.");
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function trimJsonResponseCache() {
  const now = Date.now();
  for (const [key, value] of jsonResponseCache) {
    if (value.expiresAt <= now) jsonResponseCache.delete(key);
  }
  while (jsonResponseCache.size > 50) {
    const oldest = jsonResponseCache.keys().next().value;
    if (typeof oldest !== "string") break;
    jsonResponseCache.delete(oldest);
  }
}

async function beginReauthentication() {
  if (!pipelineAuthRequired || typeof window === "undefined") return;
  if (window.sessionStorage.getItem(REAUTHENTICATION_KEY) === "true") return;

  window.sessionStorage.setItem(REAUTHENTICATION_KEY, "true");
  const currentPath = normalizePostLoginPath(`${window.location.pathname}${window.location.search}`);
  savePostLoginPath(currentPath);
  try {
    await msalInstance.loginRedirect({
      ...loginRequest,
      redirectStartPage: `${window.location.origin}${currentPath}`,
    });
  } catch {
    window.sessionStorage.removeItem(REAUTHENTICATION_KEY);
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new PipelineApiError("Pipeline response was too large.");
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PipelineApiError("Pipeline response was too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PipelineApiError("Pipeline returned an unreadable response.");
  }
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "That Pipeline record was not found.";
  return "Pipeline could not complete that request.";
}

function getPayloadRequestId(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("request_id" in payload)) return undefined;
  return typeof payload.request_id === "string" ? payload.request_id : undefined;
}

function isTransientStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableRequestError(error: unknown) {
  return error instanceof PipelineApiError && error.status === 0;
}

async function waitForRetry(response: Response | undefined, attempt: number) {
  const retryAfter = Number.parseInt(response?.headers.get("retry-after") ?? "", 10);
  const delay = Number.isInteger(retryAfter)
    ? Math.min(2_000, Math.max(0, retryAfter * 1_000))
    : 200 * (attempt + 1);
  await new Promise((resolve) => window.setTimeout(resolve, delay));
}
