import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const require = createRequire(import.meta.url);
export const root = resolve(import.meta.dirname, "..");
export const clean = (value) => JSON.parse(JSON.stringify(value));
export const actor = { id: "directory-import-fixture", name: "Directory Fixture" };
export const imports = loadTypeScriptModule(root, "lib/pipeline/contact-import.ts");
export const validation = loadTypeScriptModule(root, "lib/pipeline/contact-validation.ts");

// Execute real owners with only storage/auth infrastructure replaced. Unlike the
// generic loader, this entry-point loader lets route fixtures inject exact owners.
export function loadEntry(file, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(resolve(root, file), "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText;
  const commonjsModule = { exports: {} };
  vm.runInNewContext(output, {
    AbortController, AbortSignal, Buffer, Headers, Request, Response, URL, URLSearchParams,
    TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto, console, process,
    module: commonjsModule, exports: commonjsModule.exports,
    require: (specifier) => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      if (specifier === "server-only") return {};
      if (specifier.startsWith("@/")) return loadTypeScriptModule(root, `${specifier.slice(2)}.ts`);
      return require(specifier);
    },
    ...globals,
  }, { filename: file });
  return commonjsModule.exports;
}

export function loadContactStore({ path, sql, fs, state } = {}) {
  return loadEntry("lib/pipeline/contact-store.ts", {
    "@/lib/pipeline/contact-import": imports,
    "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
    "@/lib/pipeline/referral-store": { getReferralStoreReadiness: () => ({ mode: sql ? "postgres" : "local_file", ready: true, multi_instance_safe: !!sql }) },
    ...(fs ? { "node:fs/promises": fs } : {}),
  }, {
    ...(path ? { process: { ...process, env: { ...process.env, PIPELINE_CONTACT_STORE_PATH: path } } } : {}),
    ...(state ? { __pipelineContactState: state } : {}),
  });
}

export function makeRoutes(store, { user, logs = [] } = {}) {
  const logging = loadEntry("lib/observability/api-logging.ts", {
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => undefined },
    "@/lib/reliability/request-governor": { acquireRequestCapacity: () => ({ ok: true, release: () => undefined }) },
  }, { console: Object.fromEntries(["log", "warn", "error"].map((method) => [method, (line) => logs.push(line)])) });
  const dependencies = {
    "@/lib/pipeline/contact-import": imports,
    "@/lib/pipeline/contact-store": store,
    "@/lib/observability/api-logging": logging,
    "@/lib/auth/pipeline-auth": {
      requirePipelineUser: (_request, roles = ["admin", "assessment_coordinator", "reviewer", "viewer"]) => !user
        ? { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) }
        : !roles.some((role) => user.roles.includes(role)) || user.accessScope !== "pipeline"
          ? { ok: false, response: Response.json({ error: "Insufficient role" }, { status: 403 }) }
          : { ok: true, user },
    },
    "@/lib/pipeline/referral-access": {
      requireReferralAccess: async (_user, id) => id === 42
        ? { ok: true } : { ok: false, response: Response.json({ error: "Referral not found." }, { status: 404 }) },
      requireMutableReferralAccess: async (_user, id) => id === 42
        ? { ok: true } : { ok: false, response: Response.json({ error: "Referral not found." }, { status: 404 }) },
    },
  };
  return {
    directory: loadEntry("app/api/contacts/route.ts", dependencies),
    importer: loadEntry("app/api/contacts/import/route.ts", dependencies),
  };
}

export function csvRequest(csv, mode = "preview", mutationId, headers = {}) {
  return new Request(`http://localhost/api/contacts/import?mode=${mode}`, {
    method: "POST", body: csv,
    headers: { "Content-Type": "text/csv", Origin: "http://localhost", ...(mutationId ? { "x-client-mutation-id": mutationId } : {}), ...headers },
  });
}

export function userWith(roles) {
  return { ...actor, email: "fixture@example.test", roles, accessScope: "pipeline" };
}
