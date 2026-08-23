import "server-only";

import {
  parseClinicalCensusResponse,
  parseClinicalClientDirectoryResponse,
  parseClinicalClientDocumentSearchResponse,
  parseClinicalClientFactEvidenceResponse,
  parseClinicalClientResponse,
  parseClinicalHealthResponse,
  parseClinicalMedicationSummaryResponse,
  parseClinicalResidentResponse,
  parseClinicalRosterResponse,
} from "./clinical-contracts";
import type {
  ClinicalCensusResponse,
  ClinicalClientDirectoryResponse,
  ClinicalClientDocumentSearchResponse,
  ClinicalClientFactEvidenceResponse,
  ClinicalClientResponse,
  ClinicalHealthResponse,
  ClinicalMedicationSummaryResponse,
  ClinicalResidentResponse,
  ClinicalRosterResponse,
} from "./clinical-contracts";
import {
  DemoClinicalDataError,
  demoClinicalSnapshotExists,
  demoMedicationSummaryUnavailable,
  getDemoClinicalCensus,
  getDemoClinicalHealth,
  getDemoClinicalResident,
  getDemoClinicalRoster,
} from "./demo-clinical-data";

export type {
  ClinicalCensusCommunity,
  ClinicalCensusResponse,
  ClinicalClientDatabaseDetail,
  ClinicalClientDatabaseSummary,
  ClinicalClientDetail,
  ClinicalClientDirectoryItem,
  ClinicalClientDirectoryResponse,
  ClinicalClientDocumentSearchResponse,
  ClinicalClientDocumentSearchResult,
  ClinicalClientFact,
  ClinicalClientFactEvidence,
  ClinicalClientFactEvidenceResponse,
  ClinicalClientRecord,
  ClinicalClientResponse,
  ClinicalClientSourceDocument,
  ClinicalResidentDirectoryResult,
  ClinicalFreshness,
  ClinicalHealthResponse,
  ClinicalMedicationSummaryResponse,
  ClinicalResident,
  ClinicalResidentResponse,
  ClinicalResidentSearchResult,
  ClinicalRosterResponse,
} from "./clinical-contracts";
export { toClinicalResidentDirectoryResult, toClinicalResidentSearchResult } from "./clinical-contracts";

export type ClinicalDataMode = "disconnected" | "demo_snapshot" | "alamo_api";
export type ClinicalAuthMode = "client_credentials" | "delegated" | "bearer";

export type ClinicalDataReadiness = {
  mode: ClinicalDataMode;
  auth_mode: ClinicalAuthMode;
  required: boolean;
  connected: boolean;
  ready: boolean;
  missing_env: string[];
  upstream: "alamo_platform" | null;
  warning: string | null;
};

export class ClinicalDataError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { matching_resident_keys: string[] } | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: { matching_resident_keys: string[] } | null = null,
  ) {
    super(message);
    this.name = "ClinicalDataError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const CLINICAL_API_PREFIX = "/api/integrations/pipeline/clinical";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_DOCUMENT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_THUMBNAIL_MAX_BYTES = 1024 * 1024;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const clinicalModes: readonly ClinicalDataMode[] = ["disconnected", "demo_snapshot", "alamo_api"];
const authModes: readonly ClinicalAuthMode[] = ["client_credentials", "delegated", "bearer"];

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;
let tokenPromise: Promise<string> | null = null;

export function getClinicalDataMode(): ClinicalDataMode {
  const configured = process.env.PIPELINE_CLINICAL_DATA_MODE?.trim() as ClinicalDataMode | undefined;
  if (configured && clinicalModes.includes(configured)) return configured;
  return isProductionLikeRuntime() ? "alamo_api" : "disconnected";
}

export function getClinicalAuthMode(): ClinicalAuthMode {
  const configured = process.env.PIPELINE_ALAMO_AUTH_MODE?.trim() as ClinicalAuthMode | undefined;
  if (configured && authModes.includes(configured)) return configured;
  return "client_credentials";
}

export function getClinicalDataReadiness(): ClinicalDataReadiness {
  const mode = getClinicalDataMode();
  const authMode = getClinicalAuthMode();
  const configuredRequirement = process.env.PIPELINE_CLINICAL_DATA_REQUIRED?.trim();
  const required = configuredRequirement === "false"
    ? false
    : configuredRequirement === "true"
      ? true
      : isProductionLikeRuntime();
  const demoBlocked = isProductionLikeRuntime() && mode === "demo_snapshot";
  const missingEnv = mode === "alamo_api"
    ? getMissingClinicalEnvironment(authMode)
    : mode === "demo_snapshot" && !demoClinicalSnapshotExists()
      ? ["PIPELINE_CLINICAL_DEMO_SNAPSHOT_PATH"]
      : [];
  if (demoBlocked) missingEnv.push("PIPELINE_CLINICAL_DATA_MODE=alamo_api");
  const productionBearerBlocked = isProductionLikeRuntime() && authMode === "bearer";
  if (productionBearerBlocked) missingEnv.push("PIPELINE_ALAMO_AUTH_MODE=client_credentials|delegated");
  const connected = mode !== "disconnected" && missingEnv.length === 0;

  return {
    mode,
    auth_mode: authMode,
    required,
    connected,
    ready: mode === "disconnected" ? !required : connected && !demoBlocked,
    missing_env: missingEnv,
    upstream: mode === "disconnected" ? null : "alamo_platform",
    warning:
      mode === "disconnected"
        ? "Clinical data is not connected in this environment."
        : mode === "demo_snapshot"
          ? demoBlocked
            ? "Production clinical access must use the Alamo Platform API."
            : missingEnv.length > 0
              ? "Import a one-time Alamo roster snapshot before enabling demo clinical data."
              : "Using a one-time local Alamo snapshot. It does not refresh automatically."
        : productionBearerBlocked
          ? "Production clinical access requires delegated Entra or service-to-service authentication."
          : missingEnv.length > 0
            ? "Configure the Alamo Platform clinical API before enabling clinical data."
            : null,
  };
}

export async function getClinicalHealth(request?: Request): Promise<ClinicalHealthResponse> {
  if (getClinicalDataMode() === "demo_snapshot") {
    assertClinicalReady();
    return mapDemoError(() => getDemoClinicalHealth());
  }
  return requestClinicalEndpoint(
    "/health",
    request,
    parseClinicalHealthResponse,
    { acceptedStatuses: [200, 503] },
  );
}

export async function getClinicalCensus(request?: Request): Promise<ClinicalCensusResponse> {
  if (getClinicalDataMode() === "demo_snapshot") {
    assertClinicalReady();
    return mapDemoError(() => getDemoClinicalCensus());
  }
  return requestClinicalEndpoint("/census", request, parseClinicalCensusResponse);
}

export async function getClinicalRoster(
  request: Request | undefined,
  options: { query?: string; community?: string; limit?: number | string; cursor?: string } = {},
): Promise<ClinicalRosterResponse> {
  const query = boundedParameter(options.query, "q", 128);
  const community = boundedParameter(options.community, "community", 128);
  const cursor = boundedParameter(options.cursor, "cursor", 2048);
  const limit = parsePageSize(options.limit);
  if (getClinicalDataMode() === "demo_snapshot") {
    assertClinicalReady();
    return mapDemoError(() => getDemoClinicalRoster({ query, community, cursor, limit }));
  }
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (community) params.set("community", community);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return requestClinicalEndpoint(`/roster?${params}`, request, parseClinicalRosterResponse);
}

export async function getClinicalResident(
  request: Request | undefined,
  residentId: string,
): Promise<ClinicalResidentResponse> {
  const normalized = boundedParameter(residentId, "residentId", 256);
  if (!normalized) {
    throw new ClinicalDataError(400, "resident_identifier_invalid", "A resident identifier is required.");
  }
  if (getClinicalDataMode() === "demo_snapshot") {
    assertClinicalReady();
    return mapDemoError(() => getDemoClinicalResident(normalized));
  }
  return requestClinicalEndpoint(
    `/residents/${encodeURIComponent(normalized)}`,
    request,
    parseClinicalResidentResponse,
  );
}

export async function getClinicalClients(
  request: Request | undefined,
  options: { query?: string; community?: string; limit?: number | string; cursor?: string } = {},
): Promise<ClinicalClientDirectoryResponse> {
  const query = boundedParameter(options.query, "q", 128);
  const community = boundedParameter(options.community, "community", 128);
  const cursor = boundedParameter(options.cursor, "cursor", 2048);
  const limit = parsePageSize(options.limit);
  if (getClinicalDataMode() === "demo_snapshot") {
    throw new ClinicalDataError(
      503,
      "client_database_unavailable",
      "The enhanced client database is not available in demo snapshot mode.",
    );
  }
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (community) params.set("community", community);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", String(limit));
  return requestClinicalEndpoint(`/clients?${params}`, request, parseClinicalClientDirectoryResponse);
}

export async function getClinicalClient(
  request: Request | undefined,
  canonicalClientId: string,
): Promise<ClinicalClientResponse> {
  const normalized = boundedParameter(canonicalClientId, "canonicalClientId", 256);
  if (!normalized) {
    throw new ClinicalDataError(400, "client_identifier_invalid", "A canonical client identifier is required.");
  }
  if (getClinicalDataMode() === "demo_snapshot") {
    throw new ClinicalDataError(
      503,
      "client_database_unavailable",
      "The enhanced client database is not available in demo snapshot mode.",
    );
  }
  return requestClinicalEndpoint(
    `/clients/${encodeURIComponent(normalized)}`,
    request,
    parseClinicalClientResponse,
  );
}

export async function getClinicalClientDocumentAsset(
  request: Request | undefined,
  canonicalClientId: string,
  documentId: string,
  variant: "thumbnail" | "preview",
) {
  const normalizedClientId = boundedParameter(canonicalClientId, "canonicalClientId", 256);
  const normalizedDocumentId = boundedParameter(documentId, "documentId", 256);
  if (!normalizedClientId || !normalizedDocumentId) {
    throw new ClinicalDataError(400, "client_document_identifier_invalid", "A client and document identifier are required.");
  }
  if (getClinicalDataMode() === "demo_snapshot") {
    throw new ClinicalDataError(503, "client_document_unavailable", "Governed client files are unavailable in demo mode.");
  }
  return requestClinicalAsset(
    `/clients/${encodeURIComponent(normalizedClientId)}/documents/${encodeURIComponent(normalizedDocumentId)}/${variant}`,
    request,
    variant,
  );
}

export async function getClinicalClientFactEvidence(
  request: Request | undefined,
  canonicalClientId: string,
  fieldName: string,
  options: { limit?: number | string; cursor?: string } = {},
): Promise<ClinicalClientFactEvidenceResponse> {
  const normalizedClientId = boundedParameter(canonicalClientId, "canonicalClientId", 256);
  const normalizedFieldName = boundedParameter(fieldName, "fieldName", 128);
  const cursor = boundedParameter(options.cursor, "cursor", 2048);
  const limit = parseIntelligencePageSize(options.limit);
  if (!normalizedClientId || !normalizedFieldName) {
    throw new ClinicalDataError(400, "client_fact_identifier_invalid", "A client and fact field are required.");
  }
  if (getClinicalDataMode() === "demo_snapshot") {
    throw new ClinicalDataError(503, "client_evidence_unavailable", "Governed client evidence is unavailable in demo mode.");
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return requestClinicalEndpoint(
    `/clients/${encodeURIComponent(normalizedClientId)}/facts/${encodeURIComponent(normalizedFieldName)}/evidence?${params}`,
    request,
    parseClinicalClientFactEvidenceResponse,
  );
}

export async function searchClinicalClientDocuments(
  request: Request | undefined,
  canonicalClientId: string,
  options: { query?: string; documentId?: string; limit?: number | string; cursor?: string } = {},
): Promise<ClinicalClientDocumentSearchResponse> {
  const normalizedClientId = boundedParameter(canonicalClientId, "canonicalClientId", 256);
  const query = boundedParameter(options.query, "q", 128);
  const documentId = boundedParameter(options.documentId, "documentId", 256);
  const cursor = boundedParameter(options.cursor, "cursor", 2048);
  const limit = parseIntelligencePageSize(options.limit);
  if (!normalizedClientId || query.length < 2) {
    throw new ClinicalDataError(400, "client_document_query_invalid", "A client and a search of at least two characters are required.");
  }
  if (getClinicalDataMode() === "demo_snapshot") {
    throw new ClinicalDataError(503, "client_document_search_unavailable", "Governed document search is unavailable in demo mode.");
  }
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (documentId) params.set("document_id", documentId);
  if (cursor) params.set("cursor", cursor);
  return requestClinicalEndpoint(
    `/clients/${encodeURIComponent(normalizedClientId)}/search?${params}`,
    request,
    parseClinicalClientDocumentSearchResponse,
  );
}

export async function getClinicalMedicationSummary(
  request?: Request,
): Promise<ClinicalMedicationSummaryResponse> {
  if (getClinicalDataMode() === "demo_snapshot") {
    assertClinicalReady();
    return mapDemoError(async () => demoMedicationSummaryUnavailable());
  }
  return requestClinicalEndpoint(
    "/medications/summary",
    request,
    parseClinicalMedicationSummaryResponse,
  );
}

async function mapDemoError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DemoClinicalDataError) {
      throw new ClinicalDataError(error.status, error.code, error.message, error.details);
    }
    throw new ClinicalDataError(
      503,
      "clinical_demo_snapshot_unavailable",
      "The one-time clinical snapshot is unavailable.",
    );
  }
}

export function clinicalDataErrorResponse(error: unknown) {
  if (error instanceof ClinicalDataError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
        readiness: getClinicalDataReadiness(),
      },
      { status: error.status, headers: privateHeaders() },
    );
  }

  return Response.json(
    {
      error: "Clinical data is unavailable right now.",
      code: "clinical_data_unavailable",
    },
    { status: 503, headers: privateHeaders() },
  );
}

async function requestClinicalEndpoint<T>(
  endpoint: string,
  request: Request | undefined,
  parse: (value: unknown) => T,
  options: { acceptedStatuses?: number[] } = {},
): Promise<T> {
  const context = await createClinicalRequestContext(endpoint, request);

  try {
    const response = await fetch(context.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: context.authorization,
      },
      cache: "no-store",
      signal: context.controller.signal,
    });
    const payload = await readBoundedJson(
      response,
      getBoundedIntegerEnv(
        "PIPELINE_CLINICAL_MAX_RESPONSE_BYTES",
        DEFAULT_MAX_RESPONSE_BYTES,
        64 * 1024,
        8 * 1024 * 1024,
      ),
    );
    if (!response.ok && !options.acceptedStatuses?.includes(response.status)) {
      throw upstreamError(response.status, payload);
    }
    try {
      return parse(payload);
    } catch {
      throw new ClinicalDataError(
        response.status === 503 ? 503 : 502,
        "clinical_payload_invalid",
        response.status === 503
          ? "The Alamo Platform clinical readiness endpoint is unavailable."
          : "The Alamo Platform returned a clinical response that does not match the approved contract.",
      );
    }
  } catch (error) {
    if (error instanceof ClinicalDataError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ClinicalDataError(503, "clinical_upstream_timeout", "The Alamo Platform clinical request timed out.");
    }
    throw new ClinicalDataError(503, "clinical_upstream_unavailable", "The Alamo Platform clinical API could not be reached.");
  } finally {
    clearTimeout(context.timeout);
  }
}

async function requestClinicalAsset(
  endpoint: string,
  request: Request | undefined,
  variant: "thumbnail" | "preview",
) {
  const accept = variant === "thumbnail" ? "image/png,image/jpeg,image/webp" : "application/pdf,image/*";
  const context = await createClinicalRequestContext(endpoint, request);

  try {
    const response = await fetch(context.url, {
      method: "GET",
      headers: {
        Accept: accept,
        Authorization: context.authorization,
      },
      cache: "no-store",
      signal: context.controller.signal,
    });
    if (!response.ok) {
      const payload = await readBoundedJson(response, 64 * 1024);
      if (response.status === 404) {
        throw new ClinicalDataError(404, "client_document_not_found", "The governed client file was not found.");
      }
      throw upstreamError(response.status, payload);
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const allowed = variant === "thumbnail"
      ? ["image/png", "image/jpeg", "image/webp"].includes(contentType)
      : contentType === "application/pdf" || ["image/png", "image/jpeg", "image/webp"].includes(contentType);
    if (!allowed) {
      throw new ClinicalDataError(502, "client_document_type_invalid", "The governed client file has an unapproved content type.");
    }

    const maximumBytes = variant === "thumbnail"
      ? getBoundedIntegerEnv(
        "PIPELINE_CLINICAL_THUMBNAIL_MAX_BYTES",
        DEFAULT_THUMBNAIL_MAX_BYTES,
        64 * 1024,
        4 * 1024 * 1024,
      )
      : getBoundedIntegerEnv(
        "PIPELINE_CLINICAL_DOCUMENT_MAX_BYTES",
        DEFAULT_DOCUMENT_MAX_BYTES,
        1024 * 1024,
        32 * 1024 * 1024,
      );
    const body = await readBoundedBytes(response, maximumBytes);
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "Content-Disposition": `inline; filename="client-${variant}.${contentType === "application/pdf" ? "pdf" : contentType.split("/")[1]}"`,
        "Content-Length": String(body.byteLength),
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Content-Type": contentType,
        Pragma: "no-cache",
        Vary: "Authorization",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ClinicalDataError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ClinicalDataError(503, "client_document_timeout", "The governed client file request timed out.");
    }
    throw new ClinicalDataError(503, "client_document_unavailable", "The governed client file could not be reached.");
  } finally {
    clearTimeout(context.timeout);
  }
}

async function createClinicalRequestContext(endpoint: string, request: Request | undefined) {
  assertClinicalReady();
  const authorization = await getUpstreamAuthorization(request);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getBoundedIntegerEnv("PIPELINE_CLINICAL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000, 30_000),
  );
  return {
    authorization,
    controller,
    timeout,
    url: `${getAlamoBaseUrl()}${CLINICAL_API_PREFIX}${endpoint}`,
  };
}

function assertClinicalReady() {
  const readiness = getClinicalDataReadiness();
  if (readiness.mode === "disconnected") {
    throw new ClinicalDataError(
      503,
      "clinical_data_not_connected",
      "Clinical data is not connected. Configure the Alamo Platform clinical API first.",
    );
  }
  if (!readiness.connected) {
    throw new ClinicalDataError(
      503,
      "clinical_data_not_configured",
      "Clinical data authentication is not configured on this server.",
    );
  }
}

function getMissingClinicalEnvironment(authMode: ClinicalAuthMode) {
  const missing: string[] = [];
  if (!getAlamoBaseUrl()) missing.push("PIPELINE_ALAMO_API_BASE_URL");
  if (authMode === "client_credentials") {
    for (const name of [
      "PIPELINE_ALAMO_TENANT_ID",
      "PIPELINE_ALAMO_CLIENT_ID",
      "PIPELINE_ALAMO_CLIENT_SECRET",
      "PIPELINE_ALAMO_API_SCOPE",
    ]) {
      if (!process.env[name]?.trim()) missing.push(name);
    }
  }
  if (authMode === "bearer" && !process.env.PIPELINE_ALAMO_API_TOKEN?.trim()) {
    missing.push("PIPELINE_ALAMO_API_TOKEN");
  }
  return missing;
}

function getAlamoBaseUrl() {
  const raw = process.env.PIPELINE_ALAMO_API_BASE_URL?.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname)
    ) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function getUpstreamAuthorization(request: Request | undefined) {
  const authMode = getClinicalAuthMode();
  if (authMode === "delegated") {
    const authorization = request?.headers.get("authorization")?.trim() ?? "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      throw new ClinicalDataError(401, "clinical_delegated_token_required", "A delegated Alamo clinical access token is required.");
    }
    return authorization;
  }
  if (authMode === "bearer") {
    const token = process.env.PIPELINE_ALAMO_API_TOKEN?.trim() ?? "";
    if (!token) throw new ClinicalDataError(503, "clinical_data_not_configured", "The server clinical token is not configured.");
    return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }
  return `Bearer ${await acquireClientCredentialsToken()}`;
}

async function acquireClientCredentialsToken() {
  const tenantId = process.env.PIPELINE_ALAMO_TENANT_ID!.trim();
  const clientId = process.env.PIPELINE_ALAMO_CLIENT_ID!.trim();
  const clientSecret = process.env.PIPELINE_ALAMO_CLIENT_SECRET!.trim();
  const scope = process.env.PIPELINE_ALAMO_API_SCOPE!.trim();
  const cacheKey = `${tenantId}:${clientId}:${scope}`;
  const now = Date.now();
  if (tokenCache?.key === cacheKey && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      getBoundedIntegerEnv("PIPELINE_CLINICAL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000, 30_000),
    );
    try {
      const response = await fetch(
        `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "client_credentials",
            scope,
          }),
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const payload = await readBoundedJson(response, MAX_TOKEN_RESPONSE_BYTES);
      if (!response.ok || !isRecord(payload) || typeof payload.access_token !== "string") {
        throw new ClinicalDataError(503, "clinical_token_unavailable", "Pipeline could not obtain its Alamo clinical access token.");
      }
      const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? Math.min(Math.max(payload.expires_in, 60), 86_400)
        : 3_600;
      tokenCache = {
        key: cacheKey,
        token: payload.access_token,
        expiresAt: Date.now() + expiresIn * 1_000,
      };
      return payload.access_token;
    } catch (error) {
      if (error instanceof ClinicalDataError) throw error;
      throw new ClinicalDataError(503, "clinical_token_unavailable", "Pipeline could not obtain its Alamo clinical access token.");
    } finally {
      clearTimeout(timeout);
    }
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ClinicalDataError(502, "clinical_payload_too_large", "The Alamo clinical response exceeds its configured size limit.");
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new ClinicalDataError(502, "clinical_payload_too_large", "The Alamo clinical response exceeds its configured size limit.");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new ClinicalDataError(502, "clinical_payload_invalid", "The Alamo Platform returned invalid JSON.");
  }
}

async function readBoundedBytes(response: Response, maximumBytes: number) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ClinicalDataError(502, "client_document_too_large", "The governed client file exceeds its configured size limit.");
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new ClinicalDataError(502, "client_document_too_large", "The governed client file exceeds its configured size limit.");
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function upstreamError(status: number, payload: unknown) {
  const source = isRecord(payload) ? payload : null;
  const sourceCode = typeof source?.code === "string" ? source.code : "";
  const details = parseAmbiguityDetails(source?.details);
  if (status === 404) {
    if (sourceCode === "client_not_found") {
      return new ClinicalDataError(404, "client_not_found", "Client was not found in the governed client database.");
    }
    if (sourceCode === "client_fact_not_found") {
      return new ClinicalDataError(404, "client_fact_not_found", "That governed client fact is not available.");
    }
    if (sourceCode === "client_document_not_found") {
      return new ClinicalDataError(404, "client_document_not_found", "The governed client file was not found.");
    }
    return new ClinicalDataError(404, "resident_not_found", "Resident was not found in the current governed roster.");
  }
  if (status === 409) {
    const cursorChanged = sourceCode.endsWith("cursor_snapshot_changed") || sourceCode.endsWith("cursor_context_changed");
    return new ClinicalDataError(
      409,
      cursorChanged ? "clinical_cursor_context_changed" : "resident_identifier_ambiguous",
      cursorChanged
        ? "The governed data or search context changed. Restart pagination."
        : "More than one resident matched that identifier. Use a community-qualified resident key.",
      details,
    );
  }
  if (status === 401 || status === 403) {
    const delegated = getClinicalAuthMode() === "delegated";
    return new ClinicalDataError(
      delegated ? status : 502,
      delegated ? (status === 401 ? "clinical_auth_required" : "clinical_permission_denied") : "clinical_upstream_unauthorized",
      delegated
        ? status === 401
          ? "The delegated Alamo clinical token is missing or expired."
          : "The delegated identity lacks the Alamo clinical permission."
        : "The Alamo Platform did not authorize Pipeline's service identity.",
    );
  }
  if (status === 502) {
    return new ClinicalDataError(502, "clinical_upstream_invalid", "The Alamo Platform rejected its governed clinical snapshot.");
  }
  return new ClinicalDataError(503, "clinical_upstream_unavailable", "The Alamo Platform clinical API is unavailable.");
}

function parseAmbiguityDetails(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.matching_resident_keys)) return null;
  const keys = value.matching_resident_keys.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 256,
  );
  return keys.length > 0 && keys.length <= 200 ? { matching_resident_keys: keys } : null;
}

function parsePageSize(value: number | string | undefined) {
  if (value === undefined || value === "") return 50;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new ClinicalDataError(400, "clinical_limit_invalid", "Clinical roster limit must be between 1 and 200.");
  }
  return parsed;
}

function parseIntelligencePageSize(value: number | string | undefined) {
  if (value === undefined || value === "") return 20;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new ClinicalDataError(400, "clinical_limit_invalid", "Evidence and document search limits must be between 1 and 50.");
  }
  return parsed;
}

function boundedParameter(value: unknown, label: string, maximum: number) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim();
  if (normalized.length > maximum) {
    throw new ClinicalDataError(400, `clinical_${label}_invalid`, `${label} is too long.`);
  }
  return normalized;
}

function getBoundedIntegerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function isProductionLikeRuntime() {
  const deploymentEnvironment = String(process.env.PIPELINE_DEPLOYMENT_ENV ?? "").trim().toLowerCase();
  return (
    process.env.NODE_ENV === "production" ||
    deploymentEnvironment === "test" ||
    deploymentEnvironment === "prod"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Vary: "Authorization",
  };
}
