import "server-only";

import {
  canAccessDeveloperAcademy,
  createAcademyOwnerPolicy,
} from "@/lib/academy/academy-access-policy";
import {
  getPipelineUserFromRequest,
  type PipelineUser,
} from "@/lib/auth/pipeline-auth";

export async function getDeveloperAcademyOwner(
  requestHeaders: Headers,
): Promise<PipelineUser | null> {
  const request = new Request(
    academyRequestUrl(requestHeaders),
    { headers: new Headers(requestHeaders) },
  );

  let user: PipelineUser | null;
  try {
    user = await getPipelineUserFromRequest(request);
  } catch {
    return null;
  }

  const policy = createAcademyOwnerPolicy({
    ownerEmails: process.env.PIPELINE_ACADEMY_OWNER_EMAILS,
    ownerObjectIds: process.env.PIPELINE_ACADEMY_OWNER_ENTRA_OBJECT_IDS,
    mockUserEmail: process.env.PIPELINE_MOCK_USER_EMAIL,
    production: process.env.NODE_ENV === "production",
  });

  return canAccessDeveloperAcademy(user, policy) ? user : null;
}

function academyRequestUrl(requestHeaders: Headers) {
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProtocol === "http" ? "http" : "https";
  const host = requestHeaders.get("host")?.split(",")[0].trim() || "pipeline.invalid";
  try {
    return new URL("/academy", `${protocol}://${host}`).toString();
  } catch {
    return "https://pipeline.invalid/academy";
  }
}
