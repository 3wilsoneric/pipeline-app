import "server-only";

import {
  canAccessNoteLab,
  requireAuthenticatedUser,
  type PipelineUser,
} from "@/lib/auth/pipeline-auth";

const supervisorRoles = new Set(["admin", "assessment_coordinator"]);
const practiceRoles = new Set(["admin", "assessment_coordinator", "reviewer"]);

export function isNoteLabEnabled() {
  if (process.env.NODE_ENV === "production") return process.env.PIPELINE_NOTE_LAB_ENABLED === "true";
  return process.env.PIPELINE_NOTE_LAB_ENABLED !== "false";
}

export async function getNoteLabUser(requestHeaders: Headers): Promise<PipelineUser | null> {
  return getAuthorizedLabUser(requestHeaders, supervisorRoles, "/note-lab");
}

export async function getAssessmentPracticeUser(requestHeaders: Headers): Promise<PipelineUser | null> {
  return getAuthorizedLabUser(requestHeaders, practiceRoles, "/note-lab/practice");
}

export function canReviewAssessmentLanguage(user: PipelineUser) {
  return user.accessScope === "note_lab" || user.roles.some((role) => supervisorRoles.has(role));
}

async function getAuthorizedLabUser(requestHeaders: Headers, roles: ReadonlySet<string>, pathname: string) {
  if (!isNoteLabEnabled()) return null;
  const request = new Request(requestUrl(requestHeaders, pathname), { headers: new Headers(requestHeaders) });
  try {
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok || !canAccessNoteLab(auth.user)) return null;
    const user = auth.user;
    if (user.accessScope === "note_lab") return user;
    return user.roles.some((role) => roles.has(role)) ? user : null;
  } catch {
    return null;
  }
}

function requestUrl(requestHeaders: Headers, pathname: string) {
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProtocol === "http" ? "http" : "https";
  const host = requestHeaders.get("host")?.split(",")[0].trim() || "pipeline.invalid";
  try {
    return new URL(pathname, `${protocol}://${host}`).toString();
  } catch {
    return "https://pipeline.invalid/note-lab";
  }
}
