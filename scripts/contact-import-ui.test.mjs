import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

import { imports, loadContactStore, makeRoutes, root, userWith } from "./contact-import-fixtures.mjs";

const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");

// A test-only browser bundle mounts the real isolated component, never editing a
// production page. Its HTTP fixture runs the real importer over disposable files.
test("contact import component: no-prop auth, accessible upload/preview/errors/template/retry and responsive layout", { skip: process.env.PIPELINE_CONTACT_IMPORT_UI !== "true" }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline-contact-import-ui-"));
  const store = loadContactStore({ path: join(directory, "contacts.json") });
  const logs = [];
  const { importer } = makeRoutes(store, { user: userWith(["admin"]), logs });
  const commits = [];
  let interrupt = true;
  let browser;
  let server;
  try {
    writeFileSync(join(directory, "ts-loader.cjs"), `const ts = require(${JSON.stringify(require.resolve("typescript"))}); module.exports = function(source) { return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }, fileName: this.resourcePath }).outputText; };`);
    writeFileSync(join(directory, "auth.ts"), `export class PipelineApiError extends Error { constructor(message, public status = 0, public requestId?, public payload?) { super(message); } }
      export async function fetchCurrentPipelineUser() { return { user: { roles: [new URL(location.href).searchParams.get("role") || "assessment_coordinator"] } }; }
      export async function fetchPipelineJson(url, init) { const response = await fetch(url, init); const payload = await response.json(); if (!response.ok) throw new PipelineApiError(payload.error, response.status, undefined, payload); return payload; }`);
    writeFileSync(join(directory, "entry.tsx"), `import React from "react"; import { createRoot } from "react-dom/client"; import ContactDirectoryImport from ${JSON.stringify(join(root, "components/pipeline/ContactDirectoryImport.tsx"))}; createRoot(document.getElementById("root")).render(<ContactDirectoryImport />);`);
    await bundle(directory);
    const builder = await compile('@import "tailwindcss"; body { margin: 0; font-family: Arial, sans-serif; background: white; } main { max-width: 900px; margin: 0 auto; padding: 24px 16px; } h1 { font-size: 20px; font-weight: 700; padding-bottom: 20px; }', { base: root, onDependency: () => undefined });
    const css = builder.build(new Scanner({}).scanFiles([{ content: readFileSync(join(root, "components/pipeline/ContactDirectoryImport.tsx"), "utf8"), extension: "tsx" }]));
    const serveImportRequest = async (incoming, outgoing) => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const request = new Request(`http://127.0.0.1:${server.address().port}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
      const response = incoming.method === "POST" ? await importer.POST(request) : await importer.GET(request);
      if (incoming.url.includes("mode=commit")) {
        commits.push({ id: incoming.headers["x-client-mutation-id"], status: response.status });
        if (interrupt && response.ok) {
          interrupt = false;
          outgoing.writeHead(503, { "Content-Type": "application/json" });
          outgoing.end(JSON.stringify({ error: "Synthetic response interruption. Retry the same import." }));
          return;
        }
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    };
    server = http.createServer(async (incoming, outgoing) => {
      try {
        if (incoming.url.startsWith("/api/contacts/import")) {
          await serveImportRequest(incoming, outgoing);
        } else if (incoming.url === "/bundle.js") {
          outgoing.writeHead(200, { "Content-Type": "application/javascript" }); outgoing.end(readFileSync(join(directory, "bundle.js")));
        } else if (incoming.url === "/style.css") {
          outgoing.writeHead(200, { "Content-Type": "text/css" }); outgoing.end(css);
        } else {
          outgoing.writeHead(200, { "Content-Type": "text/html" });
          outgoing.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Directory fixture</title><link rel="stylesheet" href="/style.css"></head><body><main><h1>Referral directory</h1><div id="root"></div></main><script src="/bundle.js"></script></body></html>');
        }
      } catch {
        outgoing.writeHead(500); outgoing.end("Fixture failure");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(url);
    await page.getByRole("heading", { name: "Contact and facility directory" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Preview", exact: true }).isDisabled(), true);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV template", exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "contact-directory-template.csv");
    assert.equal(readFileSync(await download.path(), "utf8"), imports.contactImportTemplate);
    const fileInput = page.getByLabel("Contacts or referral facilities CSV");
    await fileInput.setInputFiles({ name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from("organization,email\nFacility,bad") });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByText("1 rows: 0 new, 0 skipped duplicates, 1 invalid").waitFor();
    assert.equal(await page.getByRole("button", { name: "Import 0 new entries" }).isDisabled(), true);
    assert.equal(await page.getByRole("alert").count(), 1);
    const csv = 'first_name,last_name,organization,phone,email,notes\n,,"Facility, East",555-0101,facility@example.test,"First line\nSecond line"\n,,"Facility, East",555-9999,,\nAvery,Taylor,Community,555-0102,avery@example.test,';
    await fileInput.setInputFiles({ name: "directory.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByText("3 rows: 2 new, 1 skipped duplicates, 0 invalid").waitFor();
    assert.equal((await store.searchContacts("", 50)).length, 0);
    const outputs = join(root, "outputs/contact-import");
    mkdirSync(outputs, { recursive: true });
    await page.screenshot({ path: join(outputs, "desktop-preview.png"), fullPage: true });
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => (await window.axe.run(document)).violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) })));
    assert.deepEqual(violations, []);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(outputs, "mobile-preview.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Preview may scroll internally, never overflow the page");
    const importButton = page.getByRole("button", { name: "Import 2 new entries", exact: true });
    await importButton.click();
    await page.getByRole("alert").filter({ hasText: "Retry the same import" }).waitFor();
    assert.equal((await store.searchContacts("", 50)).length, 2);
    await importButton.click();
    await page.getByText("2 entries imported. 1 duplicates skipped. Existing entries unchanged.").waitFor();
    assert.equal(commits.length, 2);
    assert.equal(commits[0].status, 201);
    assert.equal(commits[1].status, 200);
    assert.equal(commits[0].id, commits[1].id);
    assert.equal((await store.searchContacts("", 50)).length, 2);
    assert.equal(JSON.parse(readFileSync(join(directory, "contacts.json"), "utf8")).auditEvents.length, 1);
    assert.equal(logs.some((line) => /Facility, East|avery@example.test|First line/.test(line)), false);
    await page.screenshot({ path: join(outputs, "mobile-success.png"), fullPage: true });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByText("3 rows: 0 new, 3 skipped duplicates, 0 invalid").waitFor();
    assert.equal(await page.getByRole("button", { name: "Import 0 new entries" }).isDisabled(), true);
    await page.goto(`${url}/?role=reviewer`);
    await page.waitForFunction(() => !document.body.textContent.includes("Loading directory..."));
    assert.equal(await page.getByRole("button", { name: "CSV template" }).count(), 1);
    await page.goto(`${url}/?role=unassigned`);
    await page.waitForFunction(() => !document.body.textContent.includes("Loading directory..."));
    assert.equal(await page.getByRole("button", { name: "CSV template" }).count(), 0);
    assert.deepEqual(browserErrors, []);
    t.diagnostic(`Verified desktop/mobile screenshots: ${outputs}`);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

function bundle(directory) {
  return new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "production", target: "web", entry: join(directory, "entry.tsx"),
      output: { path: directory, filename: "bundle.js" }, optimization: { minimize: false },
      resolve: { extensions: [".tsx", ".ts", ".js"], modules: [join(root, "node_modules"), "node_modules"], alias: { "@/lib/auth/authenticated-fetch$": join(directory, "auth.ts"), "@": root } },
      module: { rules: [{ test: /\.tsx?$/, use: join(directory, "ts-loader.cjs") }] },
    });
    compiler.run((error, stats) => compiler.close((closeError) => error || closeError || stats.hasErrors()
      ? reject(error ?? closeError ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
}
