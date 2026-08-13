import "server-only";

export type TriggerDatabricksJobInput = {
  packet_id: string;
  raw_blob_prefix: string;
  extraction_job_id?: string;
  attempt_count: number;
  attempt_token: string;
  job_type?: "referral_packet" | "assessment_workbook" | "document_preview";
};

export type TriggerDatabricksJobResult = {
  job_run_id: string;
};

export type DatabricksJobAdapter = {
  triggerExtractionJob(input: TriggerDatabricksJobInput): Promise<TriggerDatabricksJobResult>;
  getRunState(jobRunId: string): Promise<"queued" | "running" | "succeeded" | "failed">;
};

export function getDatabricksJobAdapter(): DatabricksJobAdapter {
  const host = normalizeHost(required("DATABRICKS_HOST"));
  const jobId = required("DATABRICKS_JOB_ID");
  requireOAuthM2M();

  return {
    async triggerExtractionJob(input) {
      const payload = await databricksJson(host, "/api/2.1/jobs/run-now", {
        method: "POST",
        body: JSON.stringify({
          job_id: jobId,
          job_parameters: {
            packet_id: input.packet_id,
            raw_blob_prefix: input.raw_blob_prefix,
            extraction_job_id: input.extraction_job_id ?? "",
            attempt_count: String(input.attempt_count),
            attempt_token: input.attempt_token,
            job_type: input.job_type ?? "referral_packet",
          },
        }),
      });
      const runId = stringId(isRecord(payload) ? payload.run_id : undefined);
      if (!runId) throw new DatabricksAdapterError("databricks_invalid_run_response", false);
      return { job_run_id: runId };
    },
    async getRunState(jobRunId) {
      const payload = await databricksJson(
        host,
        `/api/2.1/jobs/runs/get?run_id=${encodeURIComponent(jobRunId)}`,
        { method: "GET" },
      );
      const stateValue = isRecord(payload) ? payload.state : undefined;
      const state = isRecord(stateValue) ? stateValue : {};
      const lifeCycle = String(state.life_cycle_state ?? "").toUpperCase();
      const result = String(state.result_state ?? "").toUpperCase();
      if (["PENDING", "BLOCKED", "WAITING_FOR_RETRY", "QUEUED"].includes(lifeCycle)) return "queued";
      if (["RUNNING", "TERMINATING"].includes(lifeCycle)) return "running";
      if (lifeCycle === "TERMINATED" && result === "SUCCESS") return "succeeded";
      if (["TERMINATED", "SKIPPED", "INTERNAL_ERROR"].includes(lifeCycle)) return "failed";
      return "running";
    },
  };
}

export class DatabricksAdapterError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(code);
    this.name = "DatabricksAdapterError";
  }
}

type CachedDatabricksToken = { host: string; clientId: string; token: string; expiresAtMs: number };
let tokenCache: CachedDatabricksToken | undefined;

async function databricksJson(host: string, path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await getDatabricksAccessToken(host)}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new DatabricksAdapterError("databricks_request_failed", true);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new DatabricksAdapterError(
      "databricks_upstream_rejected",
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status,
    );
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxResponseBytes()) {
    throw new DatabricksAdapterError("databricks_response_too_large", false, 502);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > maxResponseBytes()) {
    throw new DatabricksAdapterError("databricks_response_too_large", false, 502);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DatabricksAdapterError("databricks_invalid_response", false, 502);
  }
}

async function getDatabricksAccessToken(host: string) {
  const clientId = required("DATABRICKS_CLIENT_ID");
  const clientSecret = required("DATABRICKS_CLIENT_SECRET");
  if (tokenCache?.host === host && tokenCache.clientId === clientId && tokenCache.expiresAtMs > Date.now() + 5 * 60 * 1000) {
    return tokenCache.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  let response: Response;
  try {
    response = await fetch(`${host}/oidc/v1/token`, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "all-apis" }),
    });
  } catch {
    throw new DatabricksAdapterError("databricks_oauth_unavailable", true);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new DatabricksAdapterError(
      "databricks_oauth_rejected",
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status,
    );
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > 64 * 1024) {
    throw new DatabricksAdapterError("databricks_oauth_response_too_large", false, 502);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > 64 * 1024) {
    throw new DatabricksAdapterError("databricks_oauth_response_too_large", false, 502);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new DatabricksAdapterError("databricks_oauth_invalid_response", false, 502);
  }
  const record = isRecord(payload) ? payload : {};
  const token = typeof record.access_token === "string" ? record.access_token : "";
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : Number(record.expires_in);
  if (!token || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86_400) {
    throw new DatabricksAdapterError("databricks_oauth_invalid_response", false, 502);
  }
  tokenCache = { host, clientId, token, expiresAtMs: Date.now() + expiresIn * 1000 };
  return token;
}

function requireOAuthM2M() {
  const mode = process.env.PIPELINE_DATABRICKS_AUTH_MODE?.trim() || "oauth_m2m";
  if (mode !== "oauth_m2m") throw new Error("PIPELINE_DATABRICKS_AUTH_MODE must be oauth_m2m.");
}

function normalizeHost(value: string) {
  const url = new URL(value.startsWith("https://") ? value : `https://${value}`);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("DATABRICKS_HOST must be an HTTPS origin.");
  }
  return url.origin;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function timeoutMs() {
  const parsed = Number.parseInt(process.env.PIPELINE_DATABRICKS_TIMEOUT_MS ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(30_000, Math.max(1_000, parsed)) : 10_000;
}

function maxResponseBytes() {
  const parsed = Number.parseInt(process.env.PIPELINE_DATABRICKS_MAX_RESPONSE_BYTES ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(10 * 1024 * 1024, Math.max(16 * 1024, parsed)) : 1024 * 1024;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}
