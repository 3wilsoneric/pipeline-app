import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

export function loadTypeScriptModule(root, filePath, globals = {}) {
  const source = readFileSync(join(root, filePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    // TypeScript preserves native ESM syntax for .mjs filenames even when the
    // requested module target is CommonJS. Contract fixtures execute modules
    // in a CommonJS VM, so transpile shared .mjs sources through a virtual .ts
    // filename while keeping their real path for resolution and diagnostics.
    fileName: filePath.endsWith(".mjs") ? `${filePath.slice(0, -4)}.ts` : filePath,
  }).outputText;

  const commonjsModule = { exports: {} };
  const { require: providedRequire = require, ...sandboxGlobals } = globals;
  const moduleDirectory = dirname(join(root, filePath));
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) {
      const target = resolveModulePath(root, specifier.slice(2));
      if (!target) return providedRequire(specifier);
      return loadTypeScriptModule(root, relative(root, target), sandboxGlobals);
    }
    if (!specifier.startsWith(".")) return providedRequire(specifier);

    const target = resolveModulePath(moduleDirectory, specifier);
    if (!target) return providedRequire(specifier);

    return loadTypeScriptModule(root, relative(root, target), sandboxGlobals);
  };
  const sandbox = {
    atob,
    Buffer,
    console,
    Headers,
    Request,
    Response,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    process,
    exports: commonjsModule.exports,
    module: commonjsModule,
    require: localRequire,
    structuredClone,
    ...sandboxGlobals,
  };

  vm.runInNewContext(output, sandbox, { filename: filePath });

  return commonjsModule.exports;
}

function resolveModulePath(directory, specifier) {
  const base = resolve(directory, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}
