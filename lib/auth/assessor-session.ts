import "server-only";

import { EncryptJWT, jwtDecrypt } from "jose";

import type { PipelineDelegation, PipelineRole, PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";

const assessorSessionCookieName = "pipeline_admin_god_mode_v1";
const assessorSessionLifetimeSeconds = 8 * 60 * 60;

export function hasAssessorSession(request: Request) {
  return Boolean(readCookie(request.headers.get("cookie"), assessorSessionCookieName));
}

export async function createAssessorSession(
  request: Request,
  authenticatedUser: PipelineUser,
  member: WorkspaceMember,
  reason: string,
) {
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + assessorSessionLifetimeSeconds * 1_000);
  const delegation: PipelineDelegation = {
    sessionId: crypto.randomUUID(),
    initiatedBy: {
      id: authenticatedUser.id,
      email: authenticatedUser.email,
      name: authenticatedUser.name,
    },
    target: {
      id: member.principal_id,
      email: member.email ?? "",
      name: member.display_name,
      roles: member.roles.filter(isPipelineRole),
      identityStatus: member.identity_status,
    },
    reason,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const encrypted = await new EncryptJWT({ delegation })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setJti(delegation.sessionId)
    .setExpirationTime(`${assessorSessionLifetimeSeconds}s`)
    .encrypt(await getAssessorSessionSecret());

  return {
    delegation,
    cookie: serializeAssessorSessionCookie(request, encrypted, assessorSessionLifetimeSeconds),
  };
}

export async function readAssessorSession(
  request: Request,
  authenticatedUser: PipelineUser,
): Promise<PipelineDelegation | null> {
  const encrypted = readCookie(request.headers.get("cookie"), assessorSessionCookieName);
  if (!encrypted) return null;

  try {
    const { payload } = await jwtDecrypt(encrypted, await getAssessorSessionSecret(), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    const delegation = parseDelegation(payload.delegation);
    if (!delegation || delegation.sessionId !== payload.jti) return null;
    if (delegation.initiatedBy.id !== authenticatedUser.id) return null;
    if (!authenticatedUser.roles.includes("admin")) return null;
    return delegation;
  } catch {
    return null;
  }
}

export function clearAssessorSessionCookie(request: Request) {
  return serializeAssessorSessionCookie(request, "", 0, "Thu, 01 Jan 1970 00:00:00 GMT");
}

export async function recordAssessorSessionEvent(
  delegation: PipelineDelegation,
  action: "god_mode_started" | "god_mode_ended",
) {
  if (!getPipelineDatabaseReadiness().ready) return;
  const sql = getPipelineSql();
  await sql`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name, changed_fields, metadata
    ) values (
      'god_mode', ${delegation.sessionId}, ${action},
      ${delegation.initiatedBy.id}, ${delegation.initiatedBy.name}, ${["effective_principal"]},
      ${sql.json({
        effective_principal_id: delegation.target.id,
        effective_principal_name: delegation.target.name,
        identity_status: delegation.target.identityStatus,
        reason: delegation.reason,
        started_at: delegation.startedAt,
        expires_at: delegation.expiresAt,
      })}
    )
  `;
}

function parseDelegation(value: unknown): PipelineDelegation | null {
  if (!isRecord(value) || !isRecord(value.initiatedBy) || !isRecord(value.target)) return null;
  const initiatedBy = parseInitiator(value.initiatedBy);
  const target = parseTarget(value.target);
  if (!initiatedBy || !target) return null;
  if (!safeIdentifier(value.sessionId) || !boundedText(value.reason, 500)) return null;
  if (!isIsoDate(value.startedAt) || !isIsoDate(value.expiresAt)) return null;

  return {
    sessionId: value.sessionId,
    initiatedBy,
    target,
    reason: value.reason,
    startedAt: value.startedAt,
    expiresAt: value.expiresAt,
  };
}

function parseInitiator(value: Record<string, unknown>): PipelineDelegation["initiatedBy"] | null {
  if (!safeIdentifier(value.id)) return null;
  if (typeof value.email !== "string") return null;
  if (!boundedText(value.name, 200)) return null;
  return { id: value.id, email: value.email, name: value.name };
}

function parseTarget(value: Record<string, unknown>): PipelineDelegation["target"] | null {
  if (!safeIdentifier(value.id)) return null;
  if (typeof value.email !== "string" || value.email.length > 320) return null;
  if (!boundedText(value.name, 200)) return null;
  if (!Array.isArray(value.roles) || value.roles.some((role) => !isPipelineRole(role))) return null;
  if (value.identityStatus !== "provisional" && value.identityStatus !== "entra_linked") return null;
  return { id: value.id, email: value.email, name: value.name, roles: value.roles, identityStatus: value.identityStatus };
}

async function getAssessorSessionSecret() {
  const configured = process.env.PIPELINE_ENTRA_SESSION_SECRET?.trim();
  if (!configured || configured.length < 32) {
    throw new Error("Pipeline God mode is not configured.");
  }
  const bytes = new TextEncoder().encode(`pipeline-admin-god-mode-v1\u0000${configured}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function serializeAssessorSessionCookie(request: Request, value: string, maxAge: number, expires?: string) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const expiration = expires ? `; Expires=${expires}` : "";
  return `${assessorSessionCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${expiration}${secure}`;
}

function readCookie(cookieHeader: string | null, name: string) {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;
}

function isPipelineRole(value: unknown): value is PipelineRole {
  return value === "admin" || value === "assessment_coordinator" || value === "reviewer" || value === "viewer";
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[a-zA-Z0-9_.:@-]+$/.test(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
