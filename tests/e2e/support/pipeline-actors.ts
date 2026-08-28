import { request, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export type PipelineActorKey =
  | "admin"
  | "assessmentCoordinator"
  | "assessorA"
  | "assessorB"
  | "viewer"
  | "outsider";

export type PipelineSyntheticRole =
  | "admin"
  | "assessment_coordinator"
  | "reviewer"
  | "viewer"
  | "outsider";

export type PipelineActor = {
  id: string;
  email: string;
  name: string;
  roleClaim?: string;
  expectedRoles: string[];
};

const roleClaimByRole: Record<Exclude<PipelineSyntheticRole, "outsider">, string> = {
  admin: "Pipeline.Admin",
  assessment_coordinator: "Pipeline.AssessmentCoordinator",
  reviewer: "Pipeline.Reviewer",
  viewer: "Pipeline.Viewer",
};

const expectedRolesByRole: Record<PipelineSyntheticRole, string[]> = {
  admin: ["admin", "assessment_coordinator", "reviewer", "viewer"],
  assessment_coordinator: ["assessment_coordinator", "reviewer", "viewer"],
  reviewer: ["reviewer", "viewer"],
  viewer: ["viewer"],
  outsider: [],
};

export const pipelineActors: Record<PipelineActorKey, PipelineActor> = {
  admin: {
    id: "ops-admin",
    email: "ops-admin@pipeline.local",
    name: "Ops Admin",
    roleClaim: "Pipeline.Admin",
    expectedRoles: ["admin", "assessment_coordinator", "reviewer", "viewer"],
  },
  assessmentCoordinator: {
    id: "admissions-coordinator",
    email: "admissions@pipeline.local",
    name: "Admissions Coordinator",
    roleClaim: "Pipeline.AssessmentCoordinator",
    expectedRoles: ["assessment_coordinator", "reviewer", "viewer"],
  },
  assessorA: {
    id: "assessor-a",
    email: "assessor-a@pipeline.local",
    name: "Assessor A",
    roleClaim: "Pipeline.Reviewer",
    expectedRoles: ["reviewer", "viewer"],
  },
  assessorB: {
    id: "assessor-b",
    email: "assessor-b@pipeline.local",
    name: "Assessor B",
    roleClaim: "Pipeline.Reviewer",
    expectedRoles: ["reviewer", "viewer"],
  },
  viewer: {
    id: "viewer",
    email: "viewer@pipeline.local",
    name: "Read Only Viewer",
    roleClaim: "Pipeline.Viewer",
    expectedRoles: ["viewer"],
  },
  outsider: {
    id: "outsider",
    email: "outsider@example.invalid",
    name: "Unauthorized Outsider",
    expectedRoles: [],
  },
};

export function requireOperationalBaseURL(baseURL: string | undefined) {
  if (!baseURL) throw new Error("Operational Playwright tests require a configured baseURL.");
  return baseURL;
}

export function operationalActorHeaders(actorKey: PipelineActorKey, baseURL: string) {
  return operationalHeadersForActor(pipelineActors[actorKey], baseURL);
}

export function operationalHeadersForActor(actor: PipelineActor, baseURL: string) {
  return {
    Accept: "application/json",
    Origin: new URL(baseURL).origin,
    "x-ms-client-principal": encodedPrincipal(actor),
  };
}

export function workerHeaders() {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${process.env.PIPELINE_WORKER_SHARED_SECRET ?? "operational-worker-secret"}`,
  };
}

export async function actorApiContext(
  actorKey: PipelineActorKey,
  baseURL: string,
): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: operationalActorHeaders(actorKey, baseURL),
  });
}

export async function workerApiContext(baseURL: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: workerHeaders(),
  });
}

export async function actorPage(
  browser: Browser,
  actorKey: PipelineActorKey,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: operationalActorHeaders(actorKey, baseURL),
  });
  const page = await context.newPage();
  return { context, page };
}

export function syntheticReferralInput(
  actorKey: PipelineActorKey | PipelineActor = "assessmentCoordinator",
  overrides: Record<string, unknown> = {},
) {
  const actor = typeof actorKey === "string" ? pipelineActors[actorKey] : actorKey;
  const stamp = randomUUID().slice(0, 8);
  const createdAt = new Date().toISOString();

  return {
    name: `Operational Test Referral ${stamp}`,
    date: createdAt.slice(0, 10),
    stage: "New",
    community: "San Pablo",
    source: "Operational certification",
    priority: "standard",
    tags: ["operational-certification"],
    documentName: "operator-packet.pdf",
    documentStatus: "Uploaded",
    owner: actor.name,
    note: "Synthetic operational certification referral. Contains no PHI.",
    createdAt,
    dob: "1970-01-01",
    phone: "",
    email: "",
    payer: "",
    requirements: [],
    ...overrides,
  };
}

export function operationalMutationId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function syntheticPipelineActor(
  role: PipelineSyntheticRole,
  index: number,
): PipelineActor {
  const padded = String(index).padStart(3, "0");
  const rolePrefix = role.replace(/_/g, "-");

  return {
    id: `${rolePrefix}-${padded}`,
    email: role === "outsider"
      ? `outside-${padded}@example.invalid`
      : `${rolePrefix}-${padded}@pipeline.local`,
    name: `${titleCase(role)} ${padded}`,
    roleClaim: role === "outsider" ? undefined : roleClaimByRole[role],
    expectedRoles: expectedRolesByRole[role],
  };
}

export function operationalLoadActors(total = 50): PipelineActor[] {
  return Array.from({ length: total }, (_, index) => {
    const role: PipelineSyntheticRole =
      index % 20 === 0
        ? "admin"
        : index % 5 === 0
          ? "assessment_coordinator"
          : index % 4 === 0
            ? "viewer"
            : "reviewer";

    return syntheticPipelineActor(role, index + 1);
  });
}

function encodedPrincipal(actor: PipelineActor) {
  const claims = [
    { typ: "name", val: actor.name },
    ...(actor.roleClaim ? [{ typ: "roles", val: actor.roleClaim }] : []),
  ];

  return Buffer.from(JSON.stringify({
    userId: actor.id,
    userDetails: actor.email,
    claims,
  })).toString("base64");
}

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
