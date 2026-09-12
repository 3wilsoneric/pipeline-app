import "server-only";

import { cache } from "react";
import { getPipelineAuthMode, requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";

// Request-render memoization only, never a cross-user/session cache. Proxy
// overwrites this private hint; it is not authorization or a forwarded user.
export const getPipelineServerEntryUser = cache(async () => {
  if (process.env.NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED !== "true" || getPipelineAuthMode() !== "entra_jwt") return null;
  const requestHeaders = await getServerComponentRequestHeaders();
  if (requestHeaders.get("x-pipeline-server-entry") !== "1") return null;
  const auth = await requirePipelineUser(new Request("http://localhost/", { headers: requestHeaders }));
  return auth.ok ? auth.user : null;
});
