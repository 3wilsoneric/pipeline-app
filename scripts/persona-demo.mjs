import { spawn } from "node:child_process";
import { mkdir, lstat, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { assertPersonaDemoIsolation, personaDemoRequiredEnvironment, personaDemoStoreFiles } from "../shared/persona-demo-config.mjs";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.argv.find((arg) => arg.startsWith("--port="))?.split("=")[1] || 3216);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Choose a port from 1024 to 65535.");
const root = resolve(cwd, ".data", `persona-demo-${port}`);
const origin = `http://127.0.0.1:${port}`;
await new Promise((accept, reject) => {
  const probe = createServer();
  probe.once("error", () => reject(new Error(`Port ${port} is in use. Stop that demo before starting or resetting it.`)));
  probe.listen(port, "127.0.0.1", () => probe.close(accept));
});
const metadata = await lstat(root).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
if (metadata?.isSymbolicLink()) throw new Error("Demo storage must not be a symlink.");
if (process.argv.includes("--reset") || process.argv.includes("--fresh")) {
  if (metadata) {
    const backup = `${root}-backup-${Date.now()}`;
    await rename(root, backup);
    console.log(`Previous practice data kept at ${backup}`);
  }
  if (process.argv.includes("--reset")) {
    console.log("Practice data reset. Restart the demo and reload the browser.");
    process.exit(0);
  }
}
await mkdir(root, { recursive: true, mode: 0o700 });

// Do not inherit Azure, database, Graph, or production application settings.
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "TERM"].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, personaDemoRequiredEnvironment, {
  PIPELINE_PERSONA_DEMO: "true",
  PIPELINE_PERSONA_DEMO_ROOT: root,
  PIPELINE_PERSONA_DEMO_ORIGIN: origin,
  PIPELINE_NEXT_DIST_DIR: `.next-persona-demo-${port}`,
  PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH: "true",
  PIPELINE_ALLOWED_MUTATION_ORIGINS: origin,
  PIPELINE_ALLOWED_EMAILS: "supervisor@pipeline.example,assessor@pipeline.example",
  PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true",
  PIPELINE_ALLOW_LOCAL_RESIDENT_LINK_STORE: "true",
  PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE: "true",
  PIPELINE_DESKTOP_STATE_ENABLED: "true",
  NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED: "true",
  PIPELINE_ALLOW_LOCAL_NOTE_LAB_STORE: "true",
  PIPELINE_NOTE_LAB_ENABLED: "true",
  PIPELINE_ENABLE_SYNTHETIC_PROFILES: "false",
  PIPELINE_CLINICAL_DATA_REQUIRED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
});
for (const [key, filename] of Object.entries(personaDemoStoreFiles)) env[key] = resolve(root, filename);
assertPersonaDemoIsolation(env);
console.log(`Pipeline: ${origin}\nPractice data: ${root}\nCtrl+C stops this copy. No live configuration is used.`);
const child = spawn(process.execPath, [resolve(cwd, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 0; });
