#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const baseUrl = requiredBaseUrl(process.env.PIPELINE_ACCESS_SMOKE_BASE_URL);
const roleSpecs = [
  { key: "viewer", tokenFileEnv: "PIPELINE_ACCESS_SMOKE_VIEWER_TOKEN_FILE", expectedRole: "viewer", supervisorStatus: 403 },
  { key: "assessor", tokenFileEnv: "PIPELINE_ACCESS_SMOKE_ASSESSOR_TOKEN_FILE", expectedRole: "reviewer", supervisorStatus: 403 },
  { key: "supervisor", tokenFileEnv: "PIPELINE_ACCESS_SMOKE_SUPERVISOR_TOKEN_FILE", expectedRole: "assessment_coordinator", supervisorStatus: 200 },
  { key: "admin", tokenFileEnv: "PIPELINE_ACCESS_SMOKE_ADMIN_TOKEN_FILE", expectedRole: "admin", supervisorStatus: 200 },
];
const checks = [];

for (const spec of roleSpecs) {
  const token = await tokenFromFile(spec.tokenFileEnv);
  const me = await request("/api/auth/me", token);
  check(`${spec.key} identity is accepted`, me.status === 200);
  if (me.status === 200) {
    const roles = await responseRoles(me.response);
    check(`${spec.key} receives its expected application role`, roles.includes(spec.expectedRole));
  }

  const workspaces = await request("/api/referrals?limit=1", token);
  check(`${spec.key} can read the workspace directory`, workspaces.status === 200);

  const supervisorQueue = await request("/api/operations/supervisor-queue", token);
  check(
    `${spec.key} supervisor access is correctly scoped`,
    supervisorQueue.status === spec.supervisorStatus,
  );
}

const anonymous = await request("/api/auth/me");
check("anonymous access is rejected", anonymous.status === 401);
const invalid = await request("/api/auth/me", "not-a-valid-access-token");
check("invalid bearer tokens are rejected", invalid.status === 401);

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  base_url_configured: true,
  role_token_files_configured: roleSpecs.length,
  checks,
  privacy: "No token, principal, response body, record identifier, or query result is emitted.",
}, null, 2));
if (failed.length > 0) process.exit(1);

async function request(path, token) {
  try {
    const response = await fetch(new URL(path, baseUrl), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, response };
  } catch {
    return { status: 0, response: null };
  }
}

async function responseRoles(response) {
  try {
    const body = await response.json();
    return Array.isArray(body?.user?.roles)
      ? body.user.roles.filter((role) => typeof role === "string")
      : [];
  } catch {
    return [];
  }
}

async function tokenFromFile(name) {
  const file = process.env[name]?.trim();
  if (!file) fail(`Configure ${name} with a protected access-token file path.`);
  const token = (await readFile(file, "utf8")).trim();
  if (token.length < 100) fail(`${name} does not contain a usable access token.`);
  return token;
}

function requiredBaseUrl(value) {
  if (!value?.trim()) fail("Configure PIPELINE_ACCESS_SMOKE_BASE_URL.");
  const parsed = new URL(value.trim());
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if ((!loopback && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("PIPELINE_ACCESS_SMOKE_BASE_URL must be a clean HTTPS origin.");
  }
  return parsed;
}

function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, secrets_emitted: false }, null, 2));
  process.exit(1);
}
