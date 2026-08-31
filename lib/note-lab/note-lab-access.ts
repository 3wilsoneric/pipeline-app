import "server-only";

import { getPipelineUserFromRequest, type PipelineUser } from "@/lib/auth/pipeline-auth";

const supervisorRoles = new Set(["admin", "assessment_coordinator"]);

export function isNoteLabEnabled() {
  if (process.env.NODE_ENV === "production") return process.env.PIPELINE_NOTE_LAB_ENABLED === "true";
  return process.env.PIPELINE_NOTE_LAB_ENABLED !== "false";
}

export async function getNoteLabUser(requestHeaders: Headers): Promise<PipelineUser | null> {
  if (!isNoteLabEnabled()) return null;
  const request = new Request(requestUrl(requestHeaders), { headers: new Headers(requestHeaders) });
  try {
    const user = await getPipelineUserFromRequest(request);
    return user?.roles.some((role) => supervisorRoles.has(role)) ? user : null;
  } catch {
    return null;
  }
}

function requestUrl(requestHeaders: Headers) {
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProtocol === "http" ? "http" : "https";
  const host = requestHeaders.get("host")?.split(",")[0].trim() || "pipeline.invalid";
  try {
    return new URL("/note-lab", `${protocol}://${host}`).toString();
  } catch {
    return "https://pipeline.invalid/note-lab";
  }
}
