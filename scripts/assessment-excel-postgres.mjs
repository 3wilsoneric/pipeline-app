import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "pipeline-excel-pg-"));
const data = join(directory, "data");
const socket = join(directory, "socket");
const binary = (name) => process.env.PIPELINE_EXCEL_PG_BIN ? join(process.env.PIPELINE_EXCEL_PG_BIN, name) : name;
let started = false;

// A new loopback cluster only: configured application/test databases are never used.
try {
  mkdirSync(socket);
  execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
  const databasePort = await availablePort();
  execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${databasePort} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
  started = true;
  const url = `postgres://${encodeURIComponent(userInfo().username)}@127.0.0.1:${databasePort}/postgres`;
  const env = {
    ...process.env,
    PIPELINE_DATABASE_URL: url,
    PIPELINE_TEST_DATABASE_URL: url,
    PIPELINE_ALLOW_TEST_DATABASE_REUSE: "true",
    PIPELINE_DATABASE_SSL_MODE: "disable",
    PIPELINE_DATABASE_MODE: "postgres",
    PIPELINE_REFERRAL_STORE_MODE: "postgres",
    PIPELINE_ASSESSMENT_STORE_MODE: "postgres",
    PIPELINE_RESIDENT_LINK_STORE_MODE: "postgres",
    PIPELINE_EXCEL_POSTGRES: "true",
    PIPELINE_OPERATIONAL_E2E: "true",
    PIPELINE_OPERATIONAL_PREBUILT: "true",
    PIPELINE_HISTORICAL_RUN_ROOT: join(directory, "browser"),
    PORT: String(await availablePort()),
  };
  for (const name of ["REFERRAL", "ASSESSMENT", "RESIDENT_LINK", "DESKTOP_STATE", "NOTE_LAB", "CONTACT"]) {
    env[`PIPELINE_E2E_${name}_STORE_PATH`] = join(directory, `${name.toLowerCase()}.json`);
  }
  env.PIPELINE_E2E_DOCUMENT_STORE_PATH = join(directory, "documents");
  execFileSync(process.execPath, ["scripts/apply-database-migrations.mjs"], { cwd: root, env, stdio: "pipe" });
  const result = spawnSync(join(root, "node_modules", ".bin", "playwright"), [
    "test", "-c", "playwright.operational.config.ts", "assessment-excel-restore.spec.ts", "--reporter=list", "--retries=0",
  ], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
  rmSync(directory, { recursive: true, force: true });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
