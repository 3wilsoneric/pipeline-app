"use client";

import {
  loginRequest,
  msalInstance,
  pipelineAuthRequired,
} from "@/lib/auth/entra-client";
import {
  getOptionalPipelineAccessToken,
  renewActivePipelineSession,
  type PipelineSessionUser,
} from "@/lib/auth/browser-session";
import { normalizePostLoginPath, savePostLoginPath } from "@/lib/auth/post-login-path";
import { toPipelinePath } from "@/lib/pipeline/base-path";

const defaultTimeoutMs = 15_000;
const defaultMaxResponseBytes = 8 * 1024 * 1024;
export const REAUTHENTICATION_KEY = "pipeline.reauthentication.v1";

export type PipelineCurrentUser = PipelineSessionUser;

let currentUserRequest: Promise<{ user?: PipelineCurrentUser }> | null = null;

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
  options: { timeoutMs?: number; maxResponseBytes?: number } = {},
) {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchPipelineApi(input, init, options);
    } catch (error) {
      if (attempt + 1 < attempts && isRetryableRequestError(error) && !init.signal?.aborted) {
        await waitForRetry(undefined, attempt);
        continue;
      }
      throw error;
    }
    const text = await readBoundedResponseText(response, options.maxResponseBytes ?? defaultMaxResponseBytes);
    let payload: unknown;
    try {
      payload = parseJson(text);
    } catch (error) {
      if (attempt + 1 < attempts && isTransientStatus(response.status) && !init.signal?.aborted) {
        await waitForRetry(response, attempt);
        continue;
      }
      throw error;
    }

    if (response.ok) return payload as T;
    if (response.status === 401) void beginReauthentication();
    if (attempt + 1 < attempts && isTransientStatus(response.status) && !init.signal?.aborted) {
      await waitForRetry(response, attempt);
      continue;
    }
    throw new PipelineApiError(
      getErrorMessage(payload, response.status),
      response.status,
      response.headers.get("x-request-id") ?? getPayloadRequestId(payload),
      payload,
    );
  }
  throw new PipelineApiError("Pipeline could not complete that request.");
}

export function fetchCurrentPipelineUser() {
  if (!currentUserRequest) {
    currentUserRequest = fetchPipelineJson<{ user?: PipelineCurrentUser }>("/api/auth/me", { cache: "no-store" })
      .catch((error) => {
        currentUserRequest = null;
        throw error;
      });
  }
  return currentUserRequest;
}

export async function fetchPipelineApi(
  input: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; maxResponseBytes?: number } = {},
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);
  const headers = new Headers(init.headers);
  let accessToken: string | null = null;

  if (pipelineAuthRequired) {
    accessToken = await getOptionalPipelineAccessToken();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }

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

    // The HttpOnly cookie is the durable app session. If a cached bearer is
    // stale, retry against that cookie before sending the user through Entra.
    if (pipelineAuthRequired && response.status === 401 && accessToken) {
      const cookieHeaders = new Headers(headers);
      cookieHeaders.delete("Authorization");
      response = await request(cookieHeaders);
    }

    if (pipelineAuthRequired && response.status === 401) {
      const renewedToken = await renewActivePipelineSession(true);
      if (renewedToken) {
        const renewedHeaders = new Headers(headers);
        renewedHeaders.set("Authorization", `Bearer ${renewedToken}`);
        response = await request(renewedHeaders);
      }
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
