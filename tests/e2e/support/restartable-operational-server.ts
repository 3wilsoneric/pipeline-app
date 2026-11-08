import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { expect } from "@playwright/test";
import operationalConfig from "../../../playwright.operational.config";

export async function restartableServer(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "pipeline-replay-"));
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Test port was not allocated.");
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${address.port}`;
  const configured = operationalConfig.webServer;
  if (!configured || Array.isArray(configured)) throw new Error("Expected one operational server configuration.");
  const env: NodeJS.ProcessEnv = {
    ...configured.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(address.port),
    PIPELINE_ALLOWED_MUTATION_ORIGINS: url,
    PIPELINE_REFERRAL_STORE_PATH: path.join(root, "referrals.json"),
    PIPELINE_ASSESSMENT_STORE_PATH: path.join(root, "assessments.json"),
    PIPELINE_RESIDENT_LINK_STORE_PATH: path.join(root, "resident-links.json"),
    PIPELINE_DESKTOP_STATE_STORE_PATH: path.join(root, "desktop-state.json"),
    PIPELINE_NOTE_LAB_STORE_PATH: path.join(root, "note-lab.json"),
    PIPELINE_CONTACT_STORE_PATH: path.join(root, "contacts.json"),
    PIPELINE_LOCAL_DOCUMENT_ROOT: path.join(root, "documents"),
    ...overrides,
  };
  let child: ChildProcess | undefined;
  return {
    root, url,
    async start() {
      // The parent Playwright server already staged assets. Launch the entry
      // directly so the restart test cannot race static-directory staging.
      child = spawn(process.execPath, [path.resolve(process.env.PIPELINE_NEXT_DIST_DIR || ".next", "standalone/server.js")], { env, stdio: "ignore" });
      await expect.poll(async () => {
        if (child?.exitCode !== null) return false;
        try { return (await fetch(`${url}/api/health/live`)).ok; } catch { return false; }
      }, { timeout: 15_000, intervals: [100, 250, 500] }).toBe(true);
    },
    async stop() {
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit", { signal: AbortSignal.timeout(10_000) });
      child.kill("SIGTERM");
      try { await exited; } catch { child.kill("SIGKILL"); await once(child, "exit"); }
      child = undefined;
    },
  };
}

export async function eraseBindings(root: string, filename: string, ids: string[]) {
  if (process.env.PIPELINE_DATABASE_MODE === "postgres") {
    const databaseUrl = new URL(process.env.PIPELINE_DATABASE_URL!);
    expect(["127.0.0.1", "localhost"]).toContain(databaseUrl.hostname);
    expect(databaseUrl.pathname).toMatch(/^\/pipeline_(?:state_machine_|ci$)/);
    const sql = postgres(databaseUrl.toString(), { ssl: false, max: 1 });
    try {
      const rows = await sql`update pipeline.idempotency_keys set request_fingerprint=null where mutation_id=any(${ids}) returning mutation_id`;
      expect(rows).toHaveLength(ids.length);
    } finally { await sql.end(); }
  } else {
    const destination = path.join(root, filename), stored = JSON.parse(await readFile(destination, "utf8"));
    expect(Object.keys(stored.request_fingerprints).length).toBeGreaterThan(0);
    delete stored.request_fingerprints;
    await writeFile(destination, JSON.stringify(stored));
  }
}
