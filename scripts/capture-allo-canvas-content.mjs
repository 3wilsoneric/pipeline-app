#!/usr/bin/env node

import { access, chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

import {
  buildManifest,
  captureConfirmation,
  finalizeSnapshot,
  manifestBytes,
  normalizeText,
  validateManifest,
} from "./allo-canvas-content-common.mjs";

const args = argumentMap();
const inventoryPath = absoluteArgument("--inventory");
const outputPath = absoluteArgument("--output");
const storageStatePath = optionalAbsoluteArgument("--storage-state");
const profileDirectory = optionalAbsoluteArgument("--profile-dir");
const resume = args.get("--resume") === "true";
const headless = args.get("--headless") !== "false";
const limit = integerArgument("--limit", Number.MAX_SAFE_INTEGER, 1, 100_000);
const loginWaitMs = integerArgument("--login-wait-seconds", 0, 0, 900) * 1_000;
const navigationTimeoutMs = integerArgument("--navigation-timeout-seconds", 45, 10, 180) * 1_000;
const baseUrl = validBaseUrl(args.get("--base-url") || "https://allo.io");
const selectedCanvasId = normalizeText(args.get("--canvas-id"));
if (storageStatePath && profileDirectory) fail("Use either --storage-state or --profile-dir, not both.");

const inventoryRows = parseCommentedCsv(await readFile(inventoryPath, "utf8"));
const inventory = uniqueCanvases(inventoryRows, baseUrl)
  .filter((canvas) => !selectedCanvasId || canvas.source_canvas_id === selectedCanvasId)
  .slice(0, limit);
if (inventory.length === 0) fail("No canvases matched the requested capture scope.");

if (args.get("--confirm") !== captureConfirmation) {
  console.log(JSON.stringify({
    ok: true,
    mode: "plan",
    canvas_count: inventory.length,
    authentication: storageStatePath ? "storage_state" : profileDirectory ? "persistent_profile" : "not_configured",
    output_exists: await exists(outputPath),
    changes_made: false,
    required_confirmation: captureConfirmation,
  }));
  process.exit(0);
}
if (!storageStatePath && !profileDirectory) {
  fail("Authenticated capture requires --storage-state or --profile-dir in an approved protected location.");
}

const previous = resume && await exists(outputPath)
  ? validateManifest(JSON.parse(await readFile(outputPath, "utf8")))
  : null;
const snapshotsByCanvas = new Map((previous?.snapshots ?? []).map((snapshot) => [snapshot.source_canvas_id, snapshot]));
const pending = inventory.filter((canvas) => !snapshotsByCanvas.has(canvas.source_canvas_id));
if (pending.length === 0) {
  console.log(JSON.stringify({ ok: true, mode: "capture", canvas_count: snapshotsByCanvas.size, resumed: true, captured: 0 }));
  process.exit(0);
}

const launchOptions = { headless };
const persistentContext = profileDirectory
  ? await chromium.launchPersistentContext(profileDirectory, launchOptions)
  : null;
const browser = persistentContext ? null : await chromium.launch(launchOptions);
const context = persistentContext ?? await browser.newContext({ storageState: storageStatePath });
context.setDefaultTimeout(navigationTimeoutMs);
const page = context.pages()[0] ?? await context.newPage();
let captured = 0;
let failed = 0;

try {
  for (const canvas of pending) {
    try {
      const snapshot = await captureCanvas(page, canvas, { loginWaitMs, navigationTimeoutMs });
      snapshotsByCanvas.set(canvas.source_canvas_id, snapshot);
      captured += 1;
      await writeCheckpoint(outputPath, [...snapshotsByCanvas.values()]);
    } catch {
      failed += 1;
    }
    const completed = captured + failed;
    if (completed % 25 === 0) console.log(JSON.stringify({ progress: true, completed, total: pending.length, captured, failed }));
  }
} finally {
  await context.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}

console.log(JSON.stringify({
  ok: failed === 0,
  mode: "capture",
  requested: pending.length,
  captured,
  failed,
  total_snapshots: snapshotsByCanvas.size,
  output_written: snapshotsByCanvas.size > 0,
}));
if (failed > 0) process.exitCode = 1;

async function captureCanvas(page, canvas, options) {
  let lastCode = "capture_failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(canvas.source_locator, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });
      if (isAuthenticationPage(page.url(), await page.locator('input[type="password"]').count())) {
        if (!options.loginWaitMs) throw new Error("authentication_required");
        await page.waitForFunction(() => !document.querySelector('input[type="password"]')
          && /allo\.io$/i.test(window.location.hostname), undefined, { timeout: options.loginWaitMs });
      }
      await page.waitForFunction(() => (document.body?.innerText?.trim().length ?? 0) > 100, undefined, {
        timeout: options.navigationTimeoutMs,
      });
      await page.waitForTimeout(1_500);
      const capture = await extractVisibleContent(page);
      if (capture.blocks.length < 3) throw new Error("canvas_content_missing");
      if (!canvasNamePresent(canvas.source_canvas_name, capture.document_text)) throw new Error("canvas_not_open");
      return finalizeSnapshot({
        ...canvas,
        capture_method: "browser_dom",
        captured_at: new Date().toISOString(),
        blocks: capture.blocks,
      });
    } catch (error) {
      lastCode = safeCaptureCode(error);
      if (lastCode === "authentication_required") break;
      if (attempt < 3) await page.waitForTimeout(attempt * 1_000);
    }
  }
  throw new Error(lastCode);
}

async function extractVisibleContent(page) {
  return page.evaluate(async () => {
    const excluded = "script,style,noscript,template,nav,header,footer,[role=navigation],[aria-hidden=true]";
    const rootCandidates = [
      ...document.querySelectorAll('[role="dialog"]'),
      ...document.querySelectorAll('[data-testid*="canvas" i]'),
      ...document.querySelectorAll("main,[role=main]"),
      document.body,
    ].filter(Boolean);
    const root = rootCandidates
      .map((element, index) => ({ element, index, length: element.innerText?.trim().length ?? 0 }))
      .filter((candidate) => candidate.length > 100)
      .sort((left, right) => {
        const leftDialog = left.element.getAttribute("role") === "dialog" ? 1 : 0;
        const rightDialog = right.element.getAttribute("role") === "dialog" ? 1 : 0;
        return rightDialog - leftDialog || right.length - left.length || left.index - right.index;
      })[0]?.element ?? document.body;
    const records = [];
    const seen = new Set();

    const collect = () => {
      collectTextNodes();
      collectControls();
    };

    const collectTextNodes = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!parent || parent.closest(excluded)) continue;
        const text = node.textContent?.replace(/\s+/g, " ").trim();
        if (!text) continue;
        addRecord(parent, text, null);
      }
    };

    const collectControls = () => {
      for (const control of root.querySelectorAll("input,textarea,select")) {
        if (control.closest(excluded)) continue;
        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          const label = control.labels?.[0]?.innerText?.trim()
            || control.getAttribute("aria-label")?.trim()
            || control.value?.trim();
          if (label) addRecord(control, label, { checked: control.checked });
        } else {
          const value = control.value?.trim();
          if (value) addRecord(control, value, { value });
        }
      }
    };

    const addRecord = (element, text, structuredValue) => {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return;
      const rect = element.getBoundingClientRect();
      const locator = domPath(element, root);
      const key = `${locator}\u0000${text}\u0000${JSON.stringify(structuredValue)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const pageElement = element.closest("[data-page-number],[data-page-index],[aria-label^='Page ' i]");
      const pageNumber = parsePageNumber(pageElement);
      const tag = element.tagName.toLocaleLowerCase("en-US");
      const role = element.getAttribute("role") || null;
      records.push({
        page_number: pageNumber,
        page_title: pageElement?.getAttribute("data-page-title") || null,
        block_type: blockType(tag, role, structuredValue),
        semantic_role: role || tag,
        text,
        structured_value: structuredValue,
        locator,
        bounding_box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    };

    collect();
    const scrollables = [root, ...root.querySelectorAll("*")].filter((element) => {
      const style = window.getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 100;
    }).sort((left, right) => right.scrollHeight - left.scrollHeight).slice(0, 4);
    for (const element of scrollables) {
      const original = element.scrollTop;
      const step = Math.max(300, Math.floor(element.clientHeight * 0.8));
      for (let top = 0; top < element.scrollHeight; top += step) {
        element.scrollTop = top;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        collect();
      }
      element.scrollTop = original;
    }
    return { blocks: records, document_text: root.innerText ?? "" };

    function blockType(tag, role, structuredValue) {
      const tagTypes = {
        h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
        input: "input", textarea: "input", select: "input", li: "list_item", p: "paragraph",
        td: "table_cell", th: "table_cell",
      };
      const roleTypes = {
        heading: "heading", listitem: "list_item", cell: "table_cell",
        columnheader: "table_cell", rowheader: "table_cell",
      };
      if (structuredValue && Object.hasOwn(structuredValue, "checked")) return "checkbox";
      return roleTypes[role] ?? tagTypes[tag] ?? "text";
    }

    function parsePageNumber(element) {
      if (!element) return null;
      const explicit = element.getAttribute("data-page-number");
      const indexed = element.getAttribute("data-page-index");
      const value = explicit
        || (indexed !== null && Number.isInteger(Number(indexed)) ? (Number(indexed) + 1).toString() : null)
        || element.getAttribute("aria-label")?.match(/page\s+(\d+)/i)?.[1];
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function domPath(element, boundary) {
      const parts = [];
      let current = element;
      while (current && current !== boundary && parts.length < 16) {
        const testId = current.getAttribute("data-testid");
        const role = current.getAttribute("role");
        const siblings = current.parentElement ? [...current.parentElement.children] : [];
        const sameTag = siblings.filter((sibling) => sibling.tagName === current.tagName);
        const index = Math.max(0, sameTag.indexOf(current)) + 1;
        parts.unshift(`${current.tagName.toLocaleLowerCase("en-US")}${testId ? `[data-testid=${JSON.stringify(testId)}]` : role ? `[role=${JSON.stringify(role)}]` : `:nth-of-type(${index})`}`);
        current = current.parentElement;
      }
      return parts.join(" > ").slice(0, 2_000);
    }
  });
}

async function writeCheckpoint(filePath, snapshots) {
  const manifest = buildManifest(snapshots, { capture_scope: "authorized_workspace_browser_capture" });
  validateManifest(manifest);
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, manifestBytes(manifest), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
}

function uniqueCanvases(rows, origin) {
  const canvases = new Map();
  for (const row of rows) {
    const id = normalizeText(row.canvas_id);
    const name = normalizeText(row.canvas_name);
    if (!id || !name || canvases.has(id)) continue;
    const locator = normalizeText(row.canvas_url) || `${origin}/home?task=${encodeURIComponent(id)}`;
    canvases.set(id, {
      source_canvas_id: id,
      source_canvas_name: name,
      source_project_id: normalizeText(row.project_id) || null,
      source_project_name: normalizeText(row.project_name) || null,
      source_locator: locator,
    });
  }
  return [...canvases.values()];
}

function parseCommentedCsv(source) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#"));
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

function canvasNamePresent(name, documentText) {
  const expected = normalizeText(name).toLocaleLowerCase("en-US").slice(0, 60);
  return normalizeText(documentText).toLocaleLowerCase("en-US").includes(expected);
}

function isAuthenticationPage(url, passwordCount) {
  return passwordCount > 0 || /\/(login|sign-in|signin|auth)(?:[/?#]|$)/i.test(url);
}

function safeCaptureCode(error) {
  const value = error instanceof Error ? error.message : "capture_failed";
  return new Set(["authentication_required", "canvas_content_missing", "canvas_not_open"]).has(value)
    ? value
    : "capture_failed";
}

function validBaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    fail("--base-url must be an HTTPS origin.");
  }
}

async function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

function absoluteArgument(name) {
  const value = args.get(name);
  if (!value || !path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function optionalAbsoluteArgument(name) {
  const value = args.get(name);
  if (!value) return null;
  if (!path.isAbsolute(value)) fail(`${name} must be an absolute path.`);
  return value;
}

function integerArgument(name, fallback, minimum, maximum) {
  const raw = args.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`${name} must be between ${minimum} and ${maximum}.`);
  return value;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}
