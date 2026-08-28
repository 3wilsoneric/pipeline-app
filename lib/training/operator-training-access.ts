import "server-only";

import { getPipelineUserFromRequest } from "@/lib/auth/pipeline-auth";

export async function getOperatorTrainingUser(headers: Headers) {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim() || "localhost";
  const forwardedProtocol = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https" : "http";
  let url = "http://localhost/training";
  try {
    url = new URL("/training", `${protocol}://${host}`).toString();
  } catch {
    // Invalid forwarded host values fail closed in real auth modes and stay local in mock mode.
  }
  return getPipelineUserFromRequest(new Request(url, { headers }));
}
