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
    fileName: filePath,
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
