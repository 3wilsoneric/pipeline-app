import "server-only";

import type { PipelineAuthResult, PipelineUser } from "@/lib/auth/pipeline-auth";
import { assertPersonaDemoIsolation } from "@/shared/persona-demo-config.mjs";

export type DemoPersona = "supervisor" | "assessor";

export function isPersonaDemo() {
  return process.env.PIPELINE_PERSONA_DEMO === "true";
}

export function personaUser(persona: DemoPersona): PipelineUser {
  return {
    id: `practice-${persona}`,
    name: persona === "supervisor" ? "Alex Morgan" : "Jordan Lee",
    email: `${persona}@pipeline.example`,
    roles: persona === "supervisor" ? ["admin", "assessment_coordinator", "reviewer", "viewer"] : ["reviewer", "viewer"],
    accessScope: "pipeline",
    entraAppRoleAssigned: true,
    demoPersona: persona,
  };
}

export function requirePersonaDemoUser(request: Request): PipelineAuthResult {
  const failure = (error: string, status: number) => ({ ok: false as const, response: Response.json({ error }, { status }) });
  if (!isPersonaDemo()) return failure("Not found.", 404);
  try { assertPersonaDemoIsolation(); } catch {
    return failure("The practice environment is not isolated. No access was granted.", 503);
  }
  const expectedHost = new URL(process.env.PIPELINE_PERSONA_DEMO_ORIGIN!).host;
  const url = new URL(request.url);
  // Next normalizes loopback request URLs to localhost in Proxy. The original
  // Host must still match the dedicated port; never trust forwarded hosts.
  if (request.headers.get("host") !== expectedHost || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    return failure("This environment is available only on its local address.", 403);
  }
  const cookie = request.headers.get("cookie")?.split(";").map((value) => value.trim())
    .find((value) => value.startsWith(`${personaCookieName()}=`))?.split("=")[1];
  if (cookie && cookie !== "supervisor" && cookie !== "assessor") return failure("Invalid account selection.", 403);
  const persona = cookie === "assessor" ? "assessor" : "supervisor";
  const expectedPersona = request.headers.get("x-pipeline-persona");
  if (expectedPersona && expectedPersona !== persona) {
    return failure("The account changed in another tab. Reload before continuing.", 409);
  }
  return { ok: true, user: personaUser(persona) };
}

export function personaCookie(persona: DemoPersona) {
  return `${personaCookieName()}=${persona}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`;
}

function personaCookieName() {
  return `pipeline_practice_persona_${new URL(process.env.PIPELINE_PERSONA_DEMO_ORIGIN!).port}`;
}
