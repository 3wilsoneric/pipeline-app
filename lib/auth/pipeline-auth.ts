import "server-only";

import { EncryptJWT, createRemoteJWKSet, jwtDecrypt, jwtVerify } from "jose";

export type PipelineRole = "admin" | "assessment_coordinator" | "reviewer" | "viewer";

export type PipelineUser = {
  id: string;
  email: string;
  name: string;
  roles: PipelineRole[];
  entraAppRoleAssigned?: boolean;
};

type ParsedHeaderUser = Omit<PipelineUser, "roles"> & {
  claimRoles?: string[];
};

type AuthMode = "mock" | "headers" | "entra_jwt" | "disabled";

type AuthSuccess = {
  ok: true;
  user: PipelineUser;
};

type AuthFailure = {
  ok: false;
  response: Response;
};

export type PipelineAuthResult = AuthSuccess | AuthFailure;

const rolePriority: PipelineRole[] = [
  "admin",
  "assessment_coordinator",
  "reviewer",
  "viewer",
];
const sessionCookieName = "pipeline_entra_session";
const sessionLifetimeSeconds = 8 * 60 * 60;

class PipelineAuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
    this.name = "PipelineAuthError";
  }
}

export function getPipelineAuthMode(): AuthMode {
  const configured = process.env.PIPELINE_AUTH_MODE;

  if (configured === "mock" || configured === "headers" || configured === "entra_jwt" || configured === "disabled") {
    if (configured === "disabled" && isProductionRuntime()) return "entra_jwt";
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "entra_jwt" : "mock";
}

export function requirePipelineUser(
  request: Request,
  allowedRoles: PipelineRole[] = rolePriority,
): PipelineAuthResult | Promise<PipelineAuthResult> {
  const mode = getPipelineAuthMode();

  if (mode === "entra_jwt") {
    return requireEntraPipelineUser(request, allowedRoles);
  }

  if (mode === "mock" && !isMockRequestAllowed(request)) {
    return authFailure(401, "Unauthorized");
  }

  if (mode === "headers" && isProductionRuntime() && !isTrustedGatewayConfigured()) {
    return authFailure(503, "Pipeline trusted gateway authentication is not configured.");
  }

  return authorizeUser(getPipelineUserFromHeaders(request.headers), allowedRoles);
}

export async function getPipelineUserFromRequest(request: Request) {
  const mode = getPipelineAuthMode();

  if (mode === "mock") {
    return isMockRequestAllowed(request) ? mockUser() : null;
  }
  if (mode === "disabled") return isProductionRuntime() ? null : anonymousAdmin();
  if (mode === "headers") {
    if (isProductionRuntime() && !isTrustedGatewayConfigured()) return null;
    return getPipelineUserFromHeaders(request.headers);
  }

  const token = getBearerToken(request.headers);
  if (token) return verifyEntraAccessToken(token);
  return readSessionUser(request.headers.get("cookie"));
}

export function getPipelineUserFromHeaders(headers: Headers): PipelineUser | null {
  const mode = getPipelineAuthMode();

  if (mode === "disabled") return anonymousAdmin();
  if (mode === "mock") return mockUser();

  const headerUser = parseHeaderUser(headers);
  if (!headerUser) return null;

  return {
    ...headerUser,
    roles: rolesForUser(headerUser.email, headerUser.claimRoles),
    entraAppRoleAssigned: hasMappedClaimRole(headerUser.claimRoles),
  };
}

export async function createPipelineSessionCookie(request: Request) {
  const token = getBearerToken(request.headers);
  if (!token) throw new PipelineAuthError(401, "Sign in is required to establish a Pipeline session.");

  const secret = getSessionSecret();
  const user = await verifyEntraAccessToken(token);
  const encrypted = await new EncryptJWT({ user })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${sessionLifetimeSeconds}s`)
    .encrypt(secret);

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookieName}=${encrypted}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}${secure}`;
}

export function clearPipelineSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

export function isProtectedPath(pathname: string) {
  const publicPrefixes = ["/sign-in", "/auth", "/api/health", "/api/auth/session"];

  return !publicPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function getPipelineAuthReadiness() {
  const mode = getPipelineAuthMode();
  if (isProductionRuntime() && mode !== "entra_jwt") {
    return {
      required: true,
      mode,
      ready: false,
      missing_env: ["PIPELINE_AUTH_MODE=entra_jwt"],
    };
  }
  if (mode !== "entra_jwt") {
    return {
      required: false,
      mode,
      ready: true,
      missing_env: [] as string[],
    };
  }

  const required = [
    "NEXT_PUBLIC_ENTRA_TENANT_ID",
    "NEXT_PUBLIC_ENTRA_CLIENT_ID",
    "NEXT_PUBLIC_PIPELINE_API_SCOPE",
    "NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED",
    "PIPELINE_ENTRA_TENANT_ID",
    "PIPELINE_ENTRA_API_AUDIENCE",
    "PIPELINE_ENTRA_API_SCOPE",
    "PIPELINE_ENTRA_SESSION_SECRET",
  ];
  const missing_env = required.filter((name) => !process.env[name]?.trim());

  return {
    required: true,
    mode,
    ready: missing_env.length === 0 && process.env.NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED === "true",
    missing_env,
  };
}

async function requireEntraPipelineUser(request: Request, allowedRoles: PipelineRole[]) {
  try {
    const user = await getPipelineUserFromRequest(request);
    return authorizeUser(user, allowedRoles);
  } catch (error) {
    if (error instanceof PipelineAuthError) return authFailure(error.status, error.message);
    return authFailure(401, "Unauthorized");
  }
}

function authorizeUser(user: PipelineUser | null, allowedRoles: PipelineRole[]): AuthSuccess | AuthFailure {
  if (!user) return authFailure(401, "Unauthorized");

  if (!isAllowedUser(user)) {
    return authFailure(403, "Forbidden");
  }

  if (!allowedRoles.some((role) => user.roles.includes(role))) {
    return authFailure(403, "Insufficient role");
  }

  return { ok: true, user };
}

function authFailure(status: 401 | 403 | 503, error: string): AuthFailure {
  return {
    ok: false,
    response: Response.json({ error }, { status }),
  };
}

async function verifyEntraAccessToken(token: string) {
  const config = getEntraConfig();
  let payload;

  try {
    ({ payload } = await jwtVerify(token, getTenantJwks(config.tenantId), {
      audience: config.audience,
      issuer: config.issuers,
    }));
  } catch {
    throw new PipelineAuthError(401, "Your sign-in token is invalid or expired.");
  }

  const scopes = String(payload.scp ?? "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(config.requiredScope)) {
    throw new PipelineAuthError(403, "Your sign-in does not include permission to use Pipeline.");
  }

  const email = firstClaim(payload, ["preferred_username", "email", "upn"]);
  const id = firstClaim(payload, ["oid", "sub"]);
  if (!email || !id) throw new PipelineAuthError(403, "Your sign-in does not include a usable Pipeline identity.");

  const name = firstClaim(payload, ["name"]) ?? email;
  const claimRoles = getTokenRoles(payload);
  return {
    id,
    email,
    name,
    roles: rolesForUser(email, claimRoles),
    entraAppRoleAssigned: hasMappedClaimRole(claimRoles),
  } satisfies PipelineUser;
}

function getEntraConfig() {
  const tenantId = process.env.PIPELINE_ENTRA_TENANT_ID?.trim();
  const audience = process.env.PIPELINE_ENTRA_API_AUDIENCE?.trim();
  const requiredScope = process.env.PIPELINE_ENTRA_API_SCOPE?.trim() || "access_as_user";

  if (!tenantId || !audience || !requiredScope) {
    throw new PipelineAuthError(503, "Pipeline Entra authentication is not configured.");
  }

  return {
    tenantId,
    audience,
    requiredScope,
    issuers: [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ],
  };
}

const jwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getTenantJwks(tenantId: string) {
  let jwks = jwksByTenant.get(tenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
    jwksByTenant.set(tenantId, jwks);
  }
  return jwks;
}

function getSessionSecret() {
  const value = process.env.PIPELINE_ENTRA_SESSION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new PipelineAuthError(503, "Pipeline Entra session encryption is not configured.");
  }
  return new TextEncoder().encode(value.slice(0, 32));
}

async function readSessionUser(cookieHeader: string | null) {
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`))
    ?.slice(sessionCookieName.length + 1);
  if (!value) return null;

  try {
    const { payload } = await jwtDecrypt(value, getSessionSecret(), { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    if (!payload.user || typeof payload.user !== "object") return null;
    const user = payload.user as Partial<PipelineUser>;
    if (
      typeof user.id !== "string" ||
      typeof user.email !== "string" ||
      typeof user.name !== "string" ||
      !Array.isArray(user.roles) ||
      (user.entraAppRoleAssigned !== undefined && typeof user.entraAppRoleAssigned !== "boolean")
    ) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.filter((role): role is PipelineRole => rolePriority.includes(role as PipelineRole)),
      entraAppRoleAssigned: user.entraAppRoleAssigned === true,
    } satisfies PipelineUser;
  } catch {
    return null;
  }
}

function getBearerToken(headers: Headers) {
  const authorization = headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function firstClaim(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getTokenRoles(payload: Record<string, unknown>) {
  if (Array.isArray(payload.roles)) return payload.roles.map(String).filter(Boolean);
  return String(payload.roles ?? "").split(/\s+/).filter(Boolean);
}

function parseHeaderUser(headers: Headers): ParsedHeaderUser | null {
  const principal = headers.get("x-ms-client-principal");
  const principalName =
    headers.get("x-ms-client-principal-name") ??
    headers.get("x-pipeline-user-email") ??
    headers.get("x-auth-request-email");

  if (principal) {
    const decoded = decodePrincipal(principal);
    const email = decoded?.email ?? principalName;
    if (email) {
      return {
        id: decoded?.id ?? email,
        email,
        name: decoded?.name ?? email,
        claimRoles: decoded?.claimRoles,
      };
    }
  }

  if (isProductionRuntime() && process.env.PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS !== "true") return null;
  if (!principalName) return null;

  return {
    id: principalName,
    email: principalName,
    name: headers.get("x-ms-client-principal-name") ?? principalName,
  };
}

function decodePrincipal(value: string) {
  try {
    const json = atob(value);
    const parsed = JSON.parse(json) as {
      userId?: string;
      userDetails?: string;
      claims?: { typ: string; val: string }[];
    };
    const claims = parsed.claims ?? [];
    const email = parsed.userDetails ?? findClaim(claims, "preferred_username") ?? findClaim(claims, "email") ?? findClaim(claims, "upn");
    const name = findClaim(claims, "name") ?? findClaim(claims, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ?? email;

    return {
      id: parsed.userId,
      email,
      name,
      claimRoles: claims.filter(isRoleClaim).map((claim) => claim.val),
    };
  } catch {
    return null;
  }
}

function findClaim(claims: { typ: string; val: string }[], key: string) {
  return claims.find((claim) => claim.typ === key || claim.typ.endsWith(`/${key}`))?.val;
}

function mockUser(): PipelineUser {
  const email = process.env.PIPELINE_MOCK_USER_EMAIL ?? "demo@pipeline.local";
  const configuredRoles = parseRoleList(process.env.PIPELINE_MOCK_USER_ROLES);

  return {
    id: email,
    email,
    name: process.env.PIPELINE_MOCK_USER_NAME ?? "Eric Wilson",
    roles: configuredRoles.length > 0 ? configuredRoles : ["assessment_coordinator", "reviewer", "viewer"],
  };
}

function anonymousAdmin(): PipelineUser {
  return {
    id: "auth-disabled",
    email: "auth-disabled@pipeline.local",
    name: "Auth Disabled",
    roles: ["admin"],
  };
}

function rolesForUser(email: string, claimRoles?: string[]): PipelineRole[] {
  const mappedRoles = mapClaimRoles(claimRoles ?? []);
  return mappedRoles.length > 0 ? mappedRoles : rolesForEmail(email);
}

function rolesForEmail(email: string): PipelineRole[] {
  const normalized = normalizeEmail(email);
  if (parseEmailList(process.env.PIPELINE_ADMIN_EMAILS).includes(normalized)) return ["admin", "assessment_coordinator", "reviewer", "viewer"];
  if (parseEmailList(process.env.PIPELINE_COORDINATOR_EMAILS).includes(normalized)) return ["assessment_coordinator", "reviewer", "viewer"];
  if (parseEmailList(process.env.PIPELINE_REVIEWER_EMAILS).includes(normalized)) return ["reviewer", "viewer"];
  return ["viewer"];
}

function isAllowedUser(user: Pick<PipelineUser, "id" | "email" | "entraAppRoleAssigned">) {
  // A tenant-scoped, audience-checked delegated token is the production
  // admission boundary. Entra's enterprise-app assignment controls who can
  // obtain it; local lists remain only for trusted legacy header mode.
  if (getPipelineAuthMode() === "entra_jwt") return true;

  if (user.entraAppRoleAssigned === true) return true;

  const allowedObjectIds = parseIdentifierList(process.env.PIPELINE_ALLOWED_ENTRA_OBJECT_IDS);
  if (allowedObjectIds.includes(user.id.trim().toLowerCase())) return true;

  const allowed = parseEmailList(process.env.PIPELINE_ALLOWED_EMAILS);
  if (allowed.length === 0) return !isProductionRuntime();
  return allowed.includes(normalizeEmail(user.email));
}

function hasMappedClaimRole(claimRoles: string[] | undefined) {
  return mapClaimRoles(claimRoles ?? []).length > 0;
}

function mapClaimRoles(claimRoles: string[]): PipelineRole[] {
  const mapped = new Set<PipelineRole>();
  for (const role of claimRoles) {
    const normalized = role.trim().toLowerCase().replace(/[._\s-]/g, "");
    const mappedRole = normalized === "admin" || normalized === "pipelineadmin"
      ? "admin"
      : normalized === "assessmentcoordinator" || normalized === "pipelineassessmentcoordinator" || normalized === "assessor" || normalized === "pipelineassessor"
        ? "assessment_coordinator"
        : normalized === "reviewer" || normalized === "pipelinereviewer"
          ? "reviewer"
          : normalized === "viewer" || normalized === "pipelineviewer"
            ? "viewer"
            : null;
    if (mappedRole) mapped.add(mappedRole);
  }
  if (mapped.size === 0) return [];
  const highestRoleIndex = Math.min(...[...mapped].map((role) => rolePriority.indexOf(role)));
  return rolePriority.slice(highestRoleIndex);
}

function parseEmailList(value: string | undefined) {
  return (value ?? "").split(",").map(normalizeEmail).filter(Boolean);
}

function parseIdentifierList(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function parseRoleList(value: string | undefined): PipelineRole[] {
  const requestedRoles = (value ?? "").split(",").map((role) => role.trim() as PipelineRole).filter((role): role is PipelineRole => rolePriority.includes(role));
  if (requestedRoles.length === 0) return [];
  const highestRoleIndex = Math.min(...requestedRoles.map((role) => rolePriority.indexOf(role)));
  return rolePriority.slice(highestRoleIndex);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isRoleClaim(claim: { typ: string; val: string }) {
  const type = claim.typ.toLowerCase();
  return type === "roles" || type.endsWith("/role") || type.endsWith("/roles");
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

function isTrustedGatewayConfigured() {
  return process.env.PIPELINE_TRUSTED_GATEWAY === "true";
}

function isMockRequestAllowed(request: Request) {
  if (!isProductionRuntime()) return true;
  if (process.env.PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH !== "true") return false;

  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
