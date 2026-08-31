"use strict";

const STATE_KEY = "alloCanvasTextState";
const RESULT_PREFIX = "alloCanvasTextResult:";
const ManifestCore = globalThis.AlloCanvasManifestCore;

const inventoryTemplateEl = document.querySelector("#inventory-template");
const catalogStatusEl = document.querySelector("#catalog-status");
const contentStatusEl = document.querySelector("#content-status");
const manifestInput = document.querySelector("#manifest");
const manifestStatusEl = document.querySelector("#manifest-status");
const workerProgressEl = document.querySelector("#worker-progress");
const workerProgressTextEl = document.querySelector("#worker-progress-text");
const messageEl = document.querySelector("#message");
const scanButton = document.querySelector("#scan");
const cancelButton = document.querySelector("#cancel");
const summaryButton = document.querySelector("#summary");
const normalizedButton = document.querySelector("#normalized");
const evidenceButton = document.querySelector("#evidence");

let activeTab;
let tabStatus;
let state;

const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const safeName = (value) => String(value || "ALLO-canvas-text").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120);
const stageLabels = {
  starting: "Starting the worker tab",
  opening: "Opening the next canvas",
  reading: "Reading the open canvas",
  closing: "Saving it and closing the canvas",
  loading: "Scrolling to load more canvases",
  skipped: "Skipped one card that would not open",
  cancelling: "Finishing the current safe stop",
  cancelled: "Stopped safely",
  complete: "Extraction complete",
  error: "Extraction needs attention"
};

const getAlloTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id && tab.url?.startsWith("https://allo.io/") ? tab : undefined;
};

const tabMessage = (message) => new Promise((resolve, reject) => {
  if (!activeTab?.id) return reject(new Error("Open the signed-in ALLO tab first."));
  chrome.tabs.sendMessage(activeTab.id, message, (response) => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(new Error(response?.error || "The ALLO tab rejected the request."));
    else resolve(response);
  });
});

const backgroundMessage = (message) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(new Error(response?.error || "The exporter rejected the request."));
    else resolve(response);
  });
});

const render = () => {
  const renderedPageReady = /^\/canvases(?:\/|$)/i.test(tabStatus?.path || "");
  const importedCatalog = state?.catalog?.source === "imported-file-manifest" && Number(state.catalog.count) > 0;
  const inventoryReady = importedCatalog || renderedPageReady || Boolean(tabStatus?.pagedCanvasReady);
  const workerBusy = ["starting", "running", "cancelling"].includes(state?.worker?.status);
  const worker = state?.worker || {};
  inventoryTemplateEl.textContent = workerBusy
    ? "Dedicated ALLO worker tab is running. You may use or navigate away from your current tab."
    : importedCatalog
      ? `${number(state.catalog.count)} canvas IDs are ready for direct read-only extraction.`
    : inventoryReady
      ? "Ready. Extraction runs in a separate ALLO worker tab."
      : "Open ALLO → All canvases to start. After starting, you may navigate anywhere.";
  inventoryTemplateEl.className = `status ${inventoryReady || workerBusy ? "ready" : "warn"}`;
  manifestStatusEl.textContent = importedCatalog
    ? `${number(state.catalog.count)} unique canvas IDs imported across ${number(state.catalog.projectCount)} projects.`
    : "No manifest imported yet.";
  manifestStatusEl.className = `status ${importedCatalog ? "ready" : "muted"}`;

  const workerStage = worker.stage || worker.status || "idle";
  const workerCompleted = Number(worker.completed ?? state?.content?.completed) || 0;
  const workerDiscovered = Math.max(Number(worker.discovered) || 0, Number(state?.catalog?.count) || 0);
  const workerSkipped = Number(worker.skipped) || 0;
  if (workerBusy) {
    workerProgressTextEl.textContent = `${number(workerCompleted)} captured · ${number(workerDiscovered)} discovered${workerSkipped ? ` · ${number(workerSkipped)} skipped` : ""} · ${stageLabels[workerStage] || "Working"}`;
    workerProgressEl.className = "progress running";
  } else if (worker.status === "complete") {
    workerProgressTextEl.textContent = `${number(workerCompleted || state?.content?.completed)} canvases captured · Extraction complete`;
    workerProgressEl.className = "progress complete";
  } else if (worker.status === "error") {
    workerProgressTextEl.textContent = `Stopped after ${number(workerCompleted)} captured · ${worker.error || "Open the worker tab for details."}`;
    workerProgressEl.className = "progress error";
  } else if (worker.status === "cancelled") {
    workerProgressTextEl.textContent = `${number(workerCompleted)} canvases retained · Stopped safely`;
    workerProgressEl.className = "progress idle";
  } else {
    workerProgressTextEl.textContent = "Ready to start.";
    workerProgressEl.className = "progress idle";
  }

  const renderedCapture = state?.content?.captureMode === "rendered-dom";

  const catalog = state?.catalog;
  catalogStatusEl.textContent = catalog
    ? importedCatalog
      ? `Imported inventory: ${number(catalog.count)} file-backed canvas IDs.`
      : `${catalog.status}: ${number(catalog.count)}${catalog.expected ? ` of ${number(catalog.expected)}` : ""} canvases${catalog.completeCoverage ? " · count verified" : catalog.status === "complete" ? " · PARTIAL—do not continue" : ""}${catalog.lastSource ? ` · ${catalog.lastSource}` : ""}${catalog.error ? ` · ${catalog.error}` : ""}`
    : "No canvas scan yet.";

  const content = state?.content;
  contentStatusEl.textContent = content
    ? renderedCapture && workerBusy
      ? `${number(workerCompleted)} captured so far · ${stageLabels[workerStage] || "Working"}${workerSkipped ? ` · ${number(workerSkipped)} skipped` : ""}`
      : `${content.status}: ${number(content.completed)}${content.total ? ` of ${number(content.total)}` : ""} canvases${content.contentTemplateCount ? ` · ${content.contentTemplateCount} native reads each` : ""}${content.error ? ` · ${content.error}` : ""}`
    : "No canvas text export yet.";

  const busy = workerBusy || ["starting", "running"].includes(catalog?.status) || ["starting", "running"].includes(content?.status);
  scanButton.disabled = !inventoryReady || busy;
  scanButton.textContent = importedCatalog ? `Extract ${number(catalog.count)} canvas notes` : "Extract all canvas notes";
  cancelButton.disabled = !busy;
  const hasResults = Number(content?.completed) > 0;
  summaryButton.disabled = !hasResults;
  normalizedButton.disabled = !hasResults;
  evidenceButton.disabled = !hasResults;
};

manifestInput.addEventListener("change", async () => {
  const file = manifestInput.files?.[0];
  if (!file) return;
  manifestStatusEl.textContent = "Reading and deduplicating the manifest locally…";
  manifestStatusEl.className = "status warn";
  try {
    const canvases = ManifestCore.canvasesFromManifest(await file.text());
    const response = await backgroundMessage({ type: "ALLO_CANVAS_TEXT_IMPORT_CATALOG", canvases });
    messageEl.textContent = `${number(response.count)} unique canvas IDs imported. The source file stayed local.`;
    await refresh();
  } catch (error) {
    manifestStatusEl.textContent = error.message;
    manifestStatusEl.className = "status warn";
  } finally {
    manifestInput.value = "";
  }
});

const refresh = async () => {
  activeTab = await getAlloTab();
  if (activeTab) {
    try { tabStatus = await tabMessage({ type: "ALLO_CANVAS_TEXT_TAB_STATUS" }); }
    catch { tabStatus = null; }
  } else tabStatus = null;
  try { state = (await backgroundMessage({ type: "ALLO_CANVAS_TEXT_STATUS" })).state; }
  catch (error) { messageEl.textContent = error.message; }
  render();
};

const loadResults = async () => {
  const stored = await chrome.storage.local.get(null);
  const runId = state?.content?.runId;
  const prefix = `${RESULT_PREFIX}${runId}:`;
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(prefix))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
};

const triggerDownload = async (content, mimeType, filename) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const exportSummary = async () => {
  const results = await loadResults();
  const columns = [
    "canvas_id", "canvas_name", "canvas_url", "project_id", "project_name", "archived",
    "block_count", "character_count", "read_status", "read_methods", "read_errors", "captured_at"
  ];
  const rows = [columns.map(csvCell).join(",")];
  for (const result of results) {
    const methods = [...new Set((result.raw_responses || []).map((entry) => entry.source_method))];
    const row = {
      canvas_id: result.canvas?.id,
      canvas_name: result.canvas?.name,
      canvas_url: result.canvas?.url || `https://allo.io/home?task=${encodeURIComponent(result.canvas?.id || "")}`,
      project_id: result.canvas?.project_id,
      project_name: result.project?.name || "",
      archived: result.canvas?.archived,
      block_count: result.blocks?.length || 0,
      character_count: result.character_count || 0,
      read_status: result.errors?.length ? (result.blocks?.length ? "partial" : "error") : (result.blocks?.length ? "ok" : "no_native_text"),
      read_methods: methods.join("; "),
      read_errors: (result.errors || []).join("; "),
      captured_at: result.captured_at
    };
    rows.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  const folder = safeName(`ALLO-canvas-text-${new Date().toISOString().slice(0, 10)}`);
  await triggerDownload(rows.join("\n"), "text/csv;charset=utf-8", `${folder}/canvas-content-summary.csv`);
};

const exportNormalized = async () => {
  const results = await loadResults();
  const metadata = {
    format: "allo-canvas-native-content-v1",
    generated_at: new Date().toISOString(),
    safety: { workspace_mutations_performed: false, operation: "read-only native text export" },
    catalog: state.catalog,
    content: state.content
  };
  const records = results.map(({ raw_responses: _raw, ...result }) => result);
  const output = [JSON.stringify({ metadata }), ...records.map((result) => JSON.stringify(result))].join("\n");
  const folder = safeName(`ALLO-canvas-text-${new Date().toISOString().slice(0, 10)}`);
  await triggerDownload(output, "application/x-ndjson", `${folder}/canvas-content.jsonl`);
};

const exportEvidence = async () => {
  const results = await loadResults();
  const metadata = {
    format: "allo-canvas-native-content-evidence-v1",
    generated_at: new Date().toISOString(),
    safety: { workspace_mutations_performed: false, operation: "read-only native response evidence" },
    catalog: state.catalog,
    content: state.content
  };
  const output = [JSON.stringify({ metadata }), ...results.map((result) => JSON.stringify(result))].join("\n");
  const folder = safeName(`ALLO-canvas-text-${new Date().toISOString().slice(0, 10)}`);
  await triggerDownload(output, "application/x-ndjson", `${folder}/canvas-content-evidence.jsonl`);
};

scanButton.addEventListener("click", async () => {
  messageEl.textContent = "Creating a dedicated read-only ALLO worker tab…";
  try {
    await backgroundMessage({ type: "ALLO_CANVAS_TEXT_START_DEDICATED_SCAN" });
    messageEl.textContent = "Extraction is running separately. You may close this popup and navigate away.";
    await refresh();
  } catch (error) { messageEl.textContent = error.message; }
});

cancelButton.addEventListener("click", async () => {
  try {
    await backgroundMessage({ type: "ALLO_CANVAS_TEXT_CANCEL_DEDICATED_SCAN" });
    messageEl.textContent = "Safe stop requested. Completed local results are retained.";
  } catch (error) { messageEl.textContent = error.message; }
});

summaryButton.addEventListener("click", async () => {
  try { await exportSummary(); messageEl.textContent = "Canvas summary CSV downloaded locally."; }
  catch (error) { messageEl.textContent = error.message; }
});
normalizedButton.addEventListener("click", async () => {
  try { await exportNormalized(); messageEl.textContent = "Normalized native canvas text downloaded locally."; }
  catch (error) { messageEl.textContent = error.message; }
});
evidenceButton.addEventListener("click", async () => {
  try { await exportEvidence(); messageEl.textContent = "Detailed native response evidence downloaded locally."; }
  catch (error) { messageEl.textContent = error.message; }
});

refresh();
setInterval(refresh, 1500);
